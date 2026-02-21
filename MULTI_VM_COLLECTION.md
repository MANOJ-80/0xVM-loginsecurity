# Multi-VM Collection Guide

## Overview

This document covers the architecture and implementation details for collecting Windows Security Event ID 4625 (failed login) from multiple VMs into a centralized monitoring system.

## Collection Methods

### 1. Windows Event Forwarding (WEF)

**Architecture:**

```
[VM1] ──┐
[VM2] ──┼──► [Collector Server] ──► [Backend API] ──► [MSSQL]
[VM3] ──┘     (WEF Receiver)
```

**Pros:**

- No agent installation required on source VMs
- Built-in Windows feature (no additional software)
- Scalable for many VMs
- Secure via Kerberos/NTLM

**Cons:**

- Requires domain environment or complex auth setup
- More complex initial configuration
- Requires network connectivity between VMs and collector

**Prerequisites:**

- Windows Server 2012+ on collector
- Network connectivity: Ports 5985 (HTTP) / 5986 (HTTPS)
- Collector must be trusted for delegation (if using Kerberos)
- Source VMs: Windows Event Log service running

#### WEF Setup Steps

**1. On Collector Server:**

```powershell
# Install Event Collector service
Install-WindowsFeature -Name "Event-Collection"

# Or manually:
Start-Service Wecsvc
Set-Service Wecsvc -StartupType Automatic
```

**2. Create Subscription:**

> **Note:** This example uses `CollectorInitiated` mode with explicit
> source VM addresses. For `SourceInitiated` mode (where VMs register
> themselves via Group Policy), omit the `<EventSources>` block and
> configure source VMs through GPO instead.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Subscription xmlns="http://schemas.microsoft.com/2006/03/windows/events/subscription"
              xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <SubscriptionId>SecurityMonitor-FailedLogins</SubscriptionId>
    <SubscriptionType>CollectorInitiated</SubscriptionType>
    <Description>Forward failed login events (4625) to central collector</Description>
    <Enabled>true</Enabled>
    <ReadExistingEvents>true</ReadExistingEvents>

    <EventSources>
        <EventSource>
            <Address>vm1.yourdomain.com</Address>
            <Enabled>true</Enabled>
        </EventSource>
        <EventSource>
            <Address>vm2.yourdomain.com</Address>
            <Enabled>true</Enabled>
        </EventSource>
    </EventSources>

    <QueryList>
        <Query Path="Security">
            <Select>*[System[EventID=4625]]</Select>
        </Query>
    </QueryList>

    <Delivery Mode="Push">
        <PushSettings>
            <HeartbeatInterval>300</HeartbeatInterval>
            <BatchSize>50</BatchSize>
        </PushSettings>
    </Delivery>

    <Common>
        <LogFile>ForwardedEvents</LogFile>
        <PublisherName>Microsoft-Windows-Eventlog-ForwardingPlugin</PublisherName>
    </Common>
</Subscription>
```

**3. Apply Subscription:**

```powershell
# Save as FailedLogins.xml, then:
wecutil cs FailedLogins.xml

# Verify subscription status
wecutil gs SecurityMonitor-FailedLogins
```

**4. On Source VMs:**

```powershell
# Configure WinRM (for WEF)
Enable-PSRemoting -Force

# Configure firewall
New-NetFirewallRule -DisplayName "Windows Event Collector" -Direction Inbound -Protocol TCP -LocalPort 5985,5986 -Action Allow

# Set service to automatic
Set-Service WinRM -StartupType Automatic
Start-Service WinRM
```

**5. WEF Collector Service (reads ForwardedEvents and sends to API):**

Once WEF is set up, forwarded events land in the **ForwardedEvents** log
on the collector server. A Python service must read this log and push
normalized events to the backend API at `POST /api/v1/events`.

**collector/wef_reader.py:**

```python
import logging
import time
import os
import socket
import collections
import requests
import win32evtlog
import xml.etree.ElementTree as ET

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
)
logger = logging.getLogger(__name__)

EVT_NS = {'e': 'http://schemas.microsoft.com/win/2004/08/events/event'}


class WEFCollectorService:
    """
    Runs on the WEF collector server.  Continuously reads the
    ForwardedEvents log for Event ID 4625 entries, identifies
    the source VM from the event's Computer element, and sends
    normalized events to the central backend API.
    """

    def __init__(self, config):
        self.api_url = config['api_url']           # e.g. http://localhost:3000/api/v1/events
        self.poll_interval = config.get('poll_interval', 10)
        self.event_id = config.get('event_id', 4625)
        self.log_channel = config.get('log_channel', 'ForwardedEvents')

        self._bookmark_path = 'wef_collector_bookmark.xml'
        self._bookmark = self._load_bookmark()
        self._retry_queue = collections.deque(maxlen=5000)

    # ── bookmark persistence ────────────────────────────────────────

    def _load_bookmark(self):
        if os.path.exists(self._bookmark_path):
            try:
                with open(self._bookmark_path, 'r') as f:
                    xml_text = f.read().strip()
                if xml_text:
                    return win32evtlog.EvtCreateBookmark(xml_text)
            except Exception:
                logger.warning("Could not load bookmark; starting from now")
        return None

    def _save_bookmark(self, bookmark_handle):
        xml_text = win32evtlog.EvtRender(bookmark_handle,
                                         win32evtlog.EvtRenderBookmark)
        with open(self._bookmark_path, 'w') as f:
            f.write(xml_text)

    # ── event XML parsing ───────────────────────────────────────────

    @staticmethod
    def parse_event_xml(xml_string):
        root = ET.fromstring(xml_string)

        # Source VM is identified by the <Computer> element
        computer_el = root.find('.//e:Computer', EVT_NS)
        source_vm = computer_el.text if computer_el is not None else 'unknown'

        data = {}
        for item in root.findall('.//e:Data', EVT_NS):
            name = item.get('Name')
            if name:
                data[name] = item.text

        time_created = root.find('.//e:TimeCreated', EVT_NS)

        return {
            'source_vm': source_vm,
            'timestamp': time_created.get('SystemTime') if time_created is not None else None,
            'ip_address': data.get('IpAddress'),
            'username': data.get('TargetUserName'),
            'domain': data.get('TargetDomainName'),
            'logon_type': data.get('LogonType'),
            'status': data.get('Status'),
            'workstation': data.get('WorkstationName'),
            'source_port': data.get('IpPort'),
        }

    # ── query new events ────────────────────────────────────────────

    def query_new_events(self):
        query = f"*[System[EventID={self.event_id}]]"
        flags = win32evtlog.EvtQueryChannelPath | win32evtlog.EvtQueryForwardDirection
        query_handle = win32evtlog.EvtQuery(self.log_channel, flags, query)

        if self._bookmark is not None:
            try:
                win32evtlog.EvtSeek(
                    query_handle, 1,
                    self._bookmark,
                    win32evtlog.EvtSeekRelativeToBookmark,
                )
            except Exception:
                logger.debug("Bookmark seek failed; reading from start")

        events_by_vm = {}   # group events by source VM
        last_handle = None

        while True:
            try:
                handles = win32evtlog.EvtNext(query_handle, 50, -1, 0)
            except Exception:
                break
            if not handles:
                break

            for h in handles:
                xml_string = win32evtlog.EvtRender(h, win32evtlog.EvtRenderEventXml)
                try:
                    parsed = self.parse_event_xml(xml_string)
                    if parsed.get('ip_address') and parsed['ip_address'] != '-':
                        vm = parsed.pop('source_vm')
                        events_by_vm.setdefault(vm, []).append(parsed)
                except Exception as exc:
                    logger.warning("Failed to parse event: %s", exc)
                last_handle = h

        if last_handle is not None:
            self._bookmark = win32evtlog.EvtCreateBookmark(None)
            win32evtlog.EvtUpdateBookmark(self._bookmark, last_handle)
            self._save_bookmark(self._bookmark)

        return events_by_vm

    # ── send to API ─────────────────────────────────────────────────

    def send_events(self, vm_id, events):
        payload = {
            'vm_id': vm_id,
            'hostname': vm_id,
            'events': events,
        }
        try:
            resp = requests.post(self.api_url, json=payload, timeout=10)
            if resp.status_code == 200:
                logger.info("Sent %d event(s) for VM %s", len(events), vm_id)
                return True
            logger.error("API returned HTTP %d for VM %s", resp.status_code, vm_id)
        except Exception as e:
            logger.error("Failed to reach API: %s", e)
        # Queue for retry
        for ev in events:
            self._retry_queue.append((vm_id, ev))
        return False

    def _flush_retry_queue(self):
        if not self._retry_queue:
            return
        by_vm = {}
        while self._retry_queue:
            vm_id, ev = self._retry_queue.popleft()
            by_vm.setdefault(vm_id, []).append(ev)
        for vm_id, evts in by_vm.items():
            self.send_events(vm_id, evts)

    # ── main loop ───────────────────────────────────────────────────

    def run(self):
        logger.info("WEF Collector Service started  channel=%s", self.log_channel)
        logger.info("Polling every %d second(s)...", self.poll_interval)

        while True:
            try:
                events_by_vm = self.query_new_events()
                for vm_id, events in events_by_vm.items():
                    for ev in events:
                        logger.info("VM=%s  user=%s  ip=%s",
                                    vm_id, ev.get('username'), ev.get('ip_address'))
                    self.send_events(vm_id, events)
                self._flush_retry_queue()
            except Exception as exc:
                logger.exception("Unexpected error: %s", exc)
            time.sleep(self.poll_interval)


if __name__ == '__main__':
    import yaml
    with open('config.yaml') as f:
        cfg = yaml.safe_load(f)
    WEFCollectorService(cfg).run()
```

**collector/config.yaml:**

```yaml
api_url: http://localhost:3000/api/v1/events
poll_interval: 10
event_id: 4625
log_channel: ForwardedEvents
```

> **How it works:** WEF delivers events into the `ForwardedEvents` log
> on the collector server. This service reads that log using
> `EvtQuery`, extracts the source VM hostname from the `<Computer>`
> element in each event XML, groups events by VM, and POSTs them to the
> backend API. A bookmark is persisted to disk so restarts are
> seamless.

---

### 2. Agent-Based Collection

**Architecture:**

```
[VM1] ──► [HTTPS POST] ──► [Collector API]
[VM2] ──► [HTTPS POST] ──►     │
[VM3] ──► [HTTPS POST] ──►     ▼
                         [Backend API]
```

**Pros:**

- Works in workgroup environments
- Simpler configuration
- More control over data collection
- Can work across firewalls (HTTPS)

**Cons:**

- Requires agent installation on each VM
- Agent needs to be maintained/updated
- Requires network access to collector

#### Agent Implementation

**agent/main.py:**

```python
import time
import logging
import socket
import json
import os
import collections
import requests
import win32evtlog
import xml.etree.ElementTree as ET
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
)
logger = logging.getLogger(__name__)

# XML namespace used in Windows event XML
EVT_NS = {'e': 'http://schemas.microsoft.com/win/2004/08/events/event'}


class SecurityEventAgent:
    """
    Monitors local Windows Security Event Log for Event ID 4625
    (failed logon) and sends normalized events to the central
    collector API.

    Uses the EvtQuery / EvtNext / EvtRender API (via pywin32) so
    that full event XML is available for parsing.
    """

    def __init__(self, config):
        self.vm_id = config['vm_id']
        self.collector_url = config['collector_url']
        self.poll_interval = config.get('poll_interval', 10)
        self.event_id = config.get('event_id', 4625)
        self.hostname = socket.gethostname()

        # Retry queue: events that could not be sent are buffered here
        self._retry_queue = collections.deque(maxlen=5000)

        # Bookmark: persisted so we never re-process events after restart
        self._bookmark_path = f"{self.vm_id}_bookmark.xml"
        self._bookmark = self._load_bookmark()

    # ── bookmark persistence ────────────────────────────────────────

    def _load_bookmark(self):
        """Load a persisted EvtBookmark, or None on first run."""
        if os.path.exists(self._bookmark_path):
            try:
                with open(self._bookmark_path, 'r') as f:
                    xml_text = f.read().strip()
                if xml_text:
                    return win32evtlog.EvtCreateBookmark(xml_text)
            except Exception:
                logger.warning("Could not load bookmark; starting from now")
        return None

    def _save_bookmark(self, bookmark_handle):
        """Persist the current bookmark to disk."""
        xml_text = win32evtlog.EvtRender(bookmark_handle,
                                         win32evtlog.EvtRenderBookmark)
        with open(self._bookmark_path, 'w') as f:
            f.write(xml_text)

    # ── event XML parsing ───────────────────────────────────────────

    @staticmethod
    def parse_event_xml(xml_string):
        """
        Parse a rendered Event XML string and return a normalized dict.

        The XML is produced by EvtRender(handle, EvtRenderEventXml) and
        follows the schema at
        http://schemas.microsoft.com/win/2004/08/events/event
        """
        root = ET.fromstring(xml_string)

        # Collect all <Data Name="...">value</Data> entries
        data = {}
        for item in root.findall('.//e:Data', EVT_NS):
            name = item.get('Name')
            if name:
                data[name] = item.text

        time_created = root.find('.//e:TimeCreated', EVT_NS)

        return {
            'timestamp': time_created.get('SystemTime') if time_created is not None else None,
            'ip_address': data.get('IpAddress'),
            'username': data.get('TargetUserName'),
            'domain': data.get('TargetDomainName'),
            'logon_type': data.get('LogonType'),
            'status': data.get('Status'),
            'workstation': data.get('WorkstationName'),
            'source_port': data.get('IpPort'),
        }

    # ── querying new events ─────────────────────────────────────────

    def query_new_events(self):
        """
        Query the Security log for new Event ID 4625 entries since the
        last bookmark.

        Uses the EvtQuery → EvtNext → EvtRender pipeline which returns
        full event XML (unlike the older ReadEventLog API whose
        StringInserts is a tuple of strings, NOT XML).
        """
        query = f"*[System[EventID={self.event_id}]]"

        flags = win32evtlog.EvtQueryChannelPath | win32evtlog.EvtQueryForwardDirection
        query_handle = win32evtlog.EvtQuery('Security', flags, query)

        # Seek past already-processed events
        if self._bookmark is not None:
            try:
                win32evtlog.EvtSeek(
                    query_handle, 1,  # skip the bookmarked event itself
                    self._bookmark,
                    win32evtlog.EvtSeekRelativeToBookmark,
                )
            except Exception:
                logger.debug("Bookmark seek failed; reading from start")

        new_events = []
        last_handle = None

        while True:
            try:
                handles = win32evtlog.EvtNext(query_handle, 50, -1, 0)
            except Exception:
                break  # no more events

            if not handles:
                break

            for h in handles:
                xml_string = win32evtlog.EvtRender(h, win32evtlog.EvtRenderEventXml)
                try:
                    parsed = self.parse_event_xml(xml_string)
                    # Skip entries with no useful IP (e.g. local console logon)
                    if parsed.get('ip_address') and parsed['ip_address'] != '-':
                        new_events.append(parsed)
                except Exception as exc:
                    logger.warning("Failed to parse event XML: %s", exc)
                last_handle = h

        # Update bookmark to the last event we processed
        if last_handle is not None:
            self._bookmark = win32evtlog.EvtCreateBookmark(None)
            win32evtlog.EvtUpdateBookmark(self._bookmark, last_handle)
            self._save_bookmark(self._bookmark)

        return new_events

    # ── sending events ──────────────────────────────────────────────

    def send_events(self, events):
        """
        Send a batch of events to the collector.  On failure the events
        are placed in the retry queue so they can be re-sent on the next
        poll cycle.
        """
        payload = {
            'vm_id': self.vm_id,
            'hostname': self.hostname,
            'events': events,
        }

        try:
            response = requests.post(
                self.collector_url,
                json=payload,
                verify=False,
                timeout=10,
            )
            if response.status_code == 200:
                logger.info("Sent %d event(s) to collector", len(events))
                return True
            else:
                logger.error("Collector returned HTTP %d", response.status_code)
        except Exception as e:
            logger.error("Failed to reach collector: %s", e)

        # Enqueue for retry
        self._retry_queue.extend(events)
        return False

    def _flush_retry_queue(self):
        """Attempt to re-send any queued events."""
        if not self._retry_queue:
            return
        batch = list(self._retry_queue)
        self._retry_queue.clear()
        logger.info("Retrying %d queued event(s)...", len(batch))
        self.send_events(batch)

    # ── main loop ───────────────────────────────────────────────────

    def run(self):
        logger.info("Agent started  vm_id=%s  hostname=%s", self.vm_id, self.hostname)
        logger.info("Polling every %d second(s)...", self.poll_interval)

        while True:
            try:
                events = self.query_new_events()

                if events:
                    for ev in events:
                        logger.info(
                            "Failed login: user=%s  ip=%s",
                            ev.get('username'), ev.get('ip_address'),
                        )
                    self.send_events(events)

                # Attempt to flush anything stuck in the retry queue
                self._flush_retry_queue()

            except Exception as exc:
                logger.exception("Unexpected error: %s", exc)

            time.sleep(self.poll_interval)


if __name__ == '__main__':
    import yaml

    with open('config.yaml') as f:
        config = yaml.safe_load(f)

    agent = SecurityEventAgent(config)
    agent.run()
```

> **Implementation notes:**
>
> - Uses `EvtQuery` / `EvtNext` / `EvtRender` (the modern Windows Event Log API) instead of the legacy `ReadEventLog`. This returns proper event XML that can be parsed with `ElementTree`.
> - Persists an `EvtBookmark` to disk so that on restart the agent resumes from where it left off, without re-processing old events.
> - Failed sends are buffered in a retry queue (max 5 000 events) and retried on the next poll cycle.
> - Uses Python `logging` instead of bare `print()` for configurable log levels.

**agent/requirements.txt:**

```
pywin32>=306
requests>=2.28.0
pyyaml>=6.0
urllib3>=1.26.0
```

---

## API Endpoints for Multi-VM

### POST /api/v1/events

Receive events from agents or WEF collector.

**Request:**

```json
{
  "vm_id": "vm-001",
  "hostname": "WIN-VM01",
  "events": [
    {
      "timestamp": "2024-01-15T10:30:00Z",
      "ip_address": "192.168.1.100",
      "username": "admin",
      "logon_type": "10"
    }
  ]
}
```

**Response:**

```json
{
  "success": true,
  "events_received": 1
}
```

### GET /api/v1/vms

List all registered VMs.

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "vm_id": "vm-001",
      "hostname": "WIN-VM01",
      "ip_address": "192.168.1.10",
      "status": "active",
      "last_seen": "2024-01-15T10:30:00Z"
    }
  ]
}
```

### GET /api/v1/vms/:vm_id/attacks

Get attacks specific to a VM.

**Response:**

```json
{
  "success": true,
  "vm_id": "vm-001",
  "total_attacks": 45,
  "unique_attackers": 12,
  "top_attackers": [{ "ip": "192.168.1.100", "count": 20 }]
}
```

### POST /api/v1/vms

Register a new VM.

**Request:**

```json
{
  "vm_id": "vm-002",
  "hostname": "WIN-VM02",
  "ip_address": "192.168.1.11"
}
```

### DELETE /api/v1/vms/:vm_id

Unregister a VM.

---

## Per-VM Configuration

### Threshold Override

Set different thresholds per VM using the `PerVMThresholds` table:

```sql
INSERT INTO PerVMThresholds (vm_id, threshold, time_window_minutes, block_duration_minutes, auto_block_enabled)
VALUES
('vm-001', 10, 5, 60, 1),
('vm-002', 3, 5, 120, 1);
```

### Per-VM Blocking

Enable or disable blocking per VM:

```sql
UPDATE PerVMThresholds SET auto_block_enabled = 0 WHERE vm_id = 'vm-001';
UPDATE PerVMThresholds SET auto_block_enabled = 1 WHERE vm_id = 'vm-002';
```

---

## Best Practices

### Security

1. Use HTTPS for agent communication
2. Firewall: restrict collector port to trusted VM IPs only
3. Implement VM authentication (certificate-based) - post-MVP
4. Log all collection events for audit
5. Monitor for suspicious activity

### Scalability

1. Use message queue (RabbitMQ/Kafka) for high volume
2. Implement event batching - only if high event volume
3. Use load balancer for collector API
4. Consider separate databases per region

### Monitoring

1. Monitor collector queue depth
2. Track events per VM (detect silent VMs)
3. Alert on collection failures
4. Monitor API latency

---

## Troubleshooting

### WEF Issues

**Events not arriving:**

```powershell
# Check subscription status
wecutil -gs <subscription-name>

# Check forwarded events log
Get-WinEvent -LogName "ForwardedEvents" -MaxEvents 10

# Check event viewer logs
Get-WinEvent -LogName "Microsoft-Windows-Eventlog-ForwardingPlugin/Operational"
```

**Authentication failures:**

```powershell
# Check WinRM status on source VM
winrm enumerate winrm/config/listener

# Test connectivity
Test-WSMan -ComputerName vm1.yourdomain.com
```

### Agent Issues

**Connection refused:**

- Check collector URL and port
- Verify firewall rules
- Check SSL certificate

**High CPU:**

- Increase poll interval
- Reduce max_events per query
- Use event bookmarks for incremental reads
