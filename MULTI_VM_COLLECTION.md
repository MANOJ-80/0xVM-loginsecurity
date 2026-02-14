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

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Subscription xmlns="http://schemas.microsoft.com/2006/03/windows/events/subscription"
              xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <SubscriptionId>SecurityMonitor-FailedLogins</SubscriptionId>
    <SubscriptionType>SourceInitiated</SubscriptionType>
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
wecutil -c FailedLogins.xml
wecutil -r SecurityMonitor-FailedLogins

# Verify subscription
wecutil -gs SecurityMonitor-FailedLogins
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
import requests
import win32evtlog
import xml.etree.ElementTree as ET
import json
import os
from datetime import datetime

class SecurityEventAgent:
    def __init__(self, config):
        self.vm_id = config['vm_id']
        self.collector_url = config['collector_url']
        self.poll_interval = config.get('poll_interval', 2)
        self.event_id = config.get('event_id', 4625)
        self.last_event_time = self._load_last_timestamp()
        
    def _load_last_timestamp(self):
        """Load last processed event timestamp from file"""
        filepath = f"{self.vm_id}_last_event.txt"
        if os.path.exists(filepath):
            try:
                with open(filepath, 'r') as f:
                    return float(f.read().strip())
            except:
                pass
        return datetime.now().timestamp()
    
    def _save_last_timestamp(self, timestamp):
        """Save last processed event timestamp to file"""
        filepath = f"{self.vm_id}_last_event.txt"
        with open(filepath, 'w') as f:
            f.write(str(timestamp))
        
    def parse_event(self, xml_data):
        """Parse Event ID 4625 XML"""
        root = ET.fromstring(xml_data)
        ns = {'e': 'http://schemas.microsoft.com/win/2004/08/events/event'}
        
        data = {}
        for item in root.findall('.//e:Data', ns):
            name = item.get('Name')
            if name:
                data[name] = item.text
        
        return {
            'timestamp': root.find('.//e:TimeCreated', ns).get('SystemTime'),
            'ip_address': data.get('IpAddress'),
            'username': data.get('TargetUserName'),
            'domain': data.get('TargetDomainName'),
            'logon_type': data.get('LogonType'),
            'status': data.get('Status'),
            'workstation': data.get('WorkstationName'),
            'source_port': data.get('IpPort'),
        }
    
    def query_new_events(self):
        """Query only NEW failed login events since last check"""
        handle = win32evtlog.OpenEventLog(None, 'Security')
        flags = win32evtlog.EVENTLOG_BACKWARDS_READ | win32evtlog.EVENTLOG_SEQUENTIAL_READ
        
        new_events = []
        latest_time = self.last_event_time
        
        while True:
            batch = win32evtlog.ReadEventLog(handle, flags, 0)
            if not batch:
                break
                
            for event in batch:
                if event.EventID == self.event_id:
                    event_time = event.TimeGenerated.timestamp()
                    
                    # Only process events newer than last check
                    if event_time <= self.last_event_time:
                        continue
                    
                    # Track the latest event time
                    if event_time > latest_time:
                        latest_time = event_time
                    
                    try:
                        xml_data = event.StringInserts
                        parsed = self.parse_event(xml_data)
                        parsed['event_time'] = event_time
                        new_events.append(parsed)
                    except:
                        pass
        
        win32evtlog.CloseEventLog(handle)
        
        # Save latest timestamp
        if latest_time > self.last_event_time:
            self._save_last_timestamp(latest_time)
        
        return new_events
    
    def send_event(self, event):
        """Send single event to collector immediately"""
        import socket
        payload = {
            'vm_id': self.vm_id,
            'hostname': socket.gethostname(),
            'events': [event]
        }
        
        try:
            response = requests.post(
                self.collector_url,
                json=payload,
                verify=False,
                timeout=10
            )
            if response.status_code == 200:
                return True
            else:
                print(f"Server returned: {response.status_code}")
                return False
        except Exception as e:
            print(f"Failed to send event: {e}")
            return False
    
    def run(self):
        """Main loop - event-driven"""
        print(f"Agent started for VM: {self.vm_id}")
        print(f"Polling every {self.poll_interval} seconds...")
        
        while True:
            # Query only new events since last check
            events = self.query_new_events()
            
            # Send each event immediately
            for event in events:
                print(f"Failed login: {event.get('username')} from {event.get('ip_address')}")
                self.send_event(event)
            
            time.sleep(self.poll_interval)

if __name__ == '__main__':
    import yaml
    
    with open('config.yaml') as f:
        config = yaml.safe_load(f)
    
    agent = SecurityEventAgent(config)
    agent.run()
```

**agent/requirements.txt:**
```
pywin32>=306
requests>=2.28.0
pyyaml>=6.0
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
  "top_attackers": [
    {"ip": "192.168.1.100", "count": 20}
  ]
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
