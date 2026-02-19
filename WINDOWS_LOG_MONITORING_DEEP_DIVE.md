# Deep Technical Details: Windows Event Log Monitoring

## Understanding Event ID 4625

Event ID 4625 is logged in the **Windows Security Log** when an account fails to log on.

### Prerequisites to View Security Log
- Audit logon events must be enabled: `Security Policy` → `Audit Logon Events` → `Failure`
- Requires **Administrator** or `Event Log Readers` group membership

---

## Method 1: PowerShell - Query Event Log

### Basic Query
```powershell
# Query failed logins (Event ID 4625)
Get-WinEvent -FilterHashtable @{
    LogName = 'Security'
    ID = 4625
} -MaxEvents 10

# With time filter (last 24 hours)
Get-WinEvent -FilterHashtable @{
    LogName = 'Security'
    ID = 4625
    StartTime = (Get-Date).AddHours(-24)
} -MaxEvents 100
```

### Get Full Event Details (XML)
```powershell
$event = Get-WinEvent -FilterHashtable @{LogName='Security'; ID=4625} -MaxEvents 1
$event.ToXml()
```

### Sample XML Output (Truncated)
```xml
<Event xmlns="http://schemas.microsoft.com/win/2004/08/events/event">
  <System>
    <Provider Name="Microsoft-Windows-Security-Auditing" />
    <EventID>4625</EventID>
    <TimeCreated SystemTime="2024-01-15T10:30:45Z" />
  </System>
  <EventData>
    <Data Name="SubjectUserSid">S-1-0-0</Data>
    <Data Name="SubjectUserName">-</Data>
    <Data Name="TargetUserName">admin</Data>
    <Data Name="TargetDomainName">WIN-VM01</Data>
    <Data Name="Status">0xc000006d</Data>
    <Data Name="FailureReason">%%2313</Data>
    <Data Name="LogonType">3</Data>
    <Data Name="IpAddress">192.168.1.100</Data>
    <Data Name="IpPort">54321</Data>
  </EventData>
</Event>
```

---

## Method 2: Python - Using win32evtlog

### Installation
```bash
pip install pywin32
```

### Code to Monitor
```python
import win32evtlog
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta

class WindowsEventMonitor:
    """
    Queries the Windows Security Event Log for Event ID 4625
    using the modern EvtQuery / EvtNext / EvtRender API.

    NOTE: The older ReadEventLog API returns PyEventLogRecord
    objects whose StringInserts attribute is a *tuple of strings*,
    NOT XML.  Use the EvtQuery pipeline shown here to get proper
    event XML for parsing.
    """

    def __init__(self, event_id=4625):
        self.event_id = event_id

    def parse_event_xml(self, xml_string):
        """Extract fields from rendered event XML."""
        root = ET.fromstring(xml_string)
        ns = {'e': 'http://schemas.microsoft.com/win/2004/08/events/event'}

        data = {}
        for item in root.findall('.//e:Data', ns):
            name = item.get('Name')
            if name:
                data[name] = item.text

        time_el = root.find('.//e:TimeCreated', ns)

        return {
            'timestamp': time_el.get('SystemTime') if time_el is not None else None,
            'ip_address': data.get('IpAddress', 'N/A'),
            'username': data.get('TargetUserName', 'N/A'),
            'domain': data.get('TargetDomainName', 'N/A'),
            'logon_type': data.get('LogonType', 'N/A'),
            'status': data.get('Status', 'N/A'),
            'failure_reason': data.get('FailureReason', 'N/A'),
            'workstation': data.get('WorkstationName', 'N/A'),
            'source_port': data.get('IpPort', 'N/A'),
        }

    def query_events(self, hours=1, max_events=100):
        """Query recent failed login events via EvtQuery."""
        query = f"*[System[EventID={self.event_id}]]"
        flags = (win32evtlog.EvtQueryChannelPath
                 | win32evtlog.EvtQueryReverseDirection)

        handle = win32evtlog.EvtQuery('Security', flags, query)

        events = []
        cutoff = datetime.utcnow() - timedelta(hours=hours)

        while len(events) < max_events:
            try:
                batch = win32evtlog.EvtNext(handle, 50, -1, 0)
            except Exception:
                break
            if not batch:
                break
            for h in batch:
                xml_str = win32evtlog.EvtRender(h,
                                                win32evtlog.EvtRenderEventXml)
                parsed = self.parse_event_xml(xml_str)

                # Respect time cutoff
                if parsed['timestamp']:
                    ts = datetime.fromisoformat(
                        parsed['timestamp'].rstrip('Z'))
                    if ts < cutoff:
                        continue

                events.append(parsed)
                if len(events) >= max_events:
                    break

        return events

# Usage
monitor = WindowsEventMonitor()
events = monitor.query_events(hours=1, max_events=10)
for e in events:
    print(f"IP: {e['ip_address']} | User: {e['username']} | Time: {e['timestamp']}")
```

---

## Method 3: Python - Using wevtutil (Subprocess)

### Query via wevtutil
```python
import subprocess
import json
import xml.etree.ElementTree as ET
from datetime import datetime

def get_failed_logins_wevtutil(hours=1, max_events=100):
    """Use wevtutil.exe to query events"""
    
    # Calculate start time
    start_time = datetime.now().replace(second=0, microsecond=0)
    
    # Format: /q:TimeCreated[@SystemTime>'2024-01-15T10:00:00']
    query = f"/q:EventID=4625"
    
    cmd = [
        'wevtutil',
        'qe',
        'Security',
        '/c:{}'.format(max_events),
        '/f:xml',
        query
    ]
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    events = []
    
    # Parse XML events
    # Each event is separated by </Event>
    raw_events = result.stdout.split('</Event>')
    
    for raw in raw_events:
        if '<EventID>4625</EventID>' not in raw:
            continue
        
        # Parse fields
        ip_address = 'N/A'
        username = 'N/A'
        
        # Extract IpAddress
        if '<Data Name="IpAddress">' in raw:
            start = raw.find('<Data Name="IpAddress">') + len('<Data Name="IpAddress">')
            end = raw.find('</Data>', start)
            ip_address = raw[start:end]
        
        # Extract TargetUserName
        if '<Data Name="TargetUserName">' in raw:
            start = raw.find('<Data Name="TargetUserName">') + len('<Data Name="TargetUserName">')
            end = raw.find('</Data>', start)
            username = raw[start:end]
        
        if ip_address and ip_address != '-':
            events.append({
                'ip_address': ip_address,
                'username': username,
            })
    
    return events
```

---

## Method 4: Real-time Monitoring (Continuous)

### Using Windows Event Forwarding (WEF)

**On the VM (source):**
```powershell
# Configure subscription
wevtutil sl Security /ca:O:BAG:SYD:(A;;0x80100009;;;AU)(A;;0x1;;;S-1-5-20)
```

**Create subscription (via Group Policy):**
```
Computer Configuration → Administrative Templates → Windows Components → Event Forwarding
```

---

### Using Python - Event Log Subscription (Windows Event Log API)

```python
import win32evtlog
import win32evtlogutil
import threading
import time

class EventLogMonitor:
    """Real-time event log monitoring using Windows API"""
    
    def __init__(self, log_name='Security', event_id=4625):
        self.log_name = log_name
        self.event_id = event_id
        self.running = False
        self.callbacks = []
        self.bookmark = None
    
    def start_monitoring(self):
        """Start monitoring for new events"""
        self.running = True
        
        # Open event log
        self.handle = win32evtlog.OpenEventLog(None, self.log_name)
        
        # Create bookmark for last processed event
        self.bookmark = win32evtlog.CreateBookmark(None)
        
        # Start read
        self._monitor_loop()
    
    def _monitor_loop(self):
        """Main monitoring loop"""
        flags = win32evtlog.EVENTLOG_SEQUENTIAL_READ | win32evtlog.EVENTLOG_BACKWARDS_READ
        
        while self.running:
            try:
                # Wait for events (poll every 2 seconds)
                events = win32evtlog.ReadEventLog(
                    self.handle, 
                    flags, 
                    0
                )
                
                for event in events:
                    if event.EventID == self.event_id:
                        self._process_event(event)
                
                time.sleep(2)
                
            except Exception as e:
                print(f"Error: {e}")
                time.sleep(5)
    
    def _process_event(self, event):
        """Process a single event"""
        # Extract IP address from event
        # Note: Full implementation requires XML parsing
        
        event_data = {
            'timestamp': event.TimeGenerated,
            'event_id': event.EventID,
            'ip_address': getattr(event, 'IpAddress', None),
        }
        
        # Notify callbacks
        for callback in self.callbacks:
            callback(event_data)
    
    def add_callback(self, callback):
        """Add callback for new events"""
        self.callbacks.append(callback)
    
    def stop(self):
        """Stop monitoring"""
        self.running = False
        if self.handle:
            win32evtlog.CloseEventLog(self.handle)

# Usage
def on_failed_login(event_data):
    print(f"Failed login from: {event_data['ip_address']}")
    # Send to API or process

monitor = EventLogMonitor()
monitor.add_callback(on_failed_login)
monitor.start_monitoring()
```

---

## Event ID 4625 - Complete Field Reference

| Field Name | XML Tag | Description | Example |
|------------|---------|-------------|---------|
| SubjectUserSid | SubjectUserName | SID of account requesting logon | S-1-0-0 |
| SubjectUserName | SubjectUserName | Account requesting logon | - |
| TargetUserName | TargetUserName | Account being logged onto | admin |
| TargetDomainName | TargetDomainName | Domain of target account | WIN-VM01 |
| Status | Status | NTSTATUS code | 0xc000006d |
| FailureReason | FailureReason | Failure reason string | %%2313 |
| LogonType | LogonType | Type of logon attempt | 3 |
| IpAddress | IpAddress | Source IP address | 192.168.1.100 |
| IpPort | IpPort | Source port | 54321 |
| WorkstationName | WorkstationName | Source computer name | ATTACK-PC |

### Logon Types (LogonType field)
| Type | Description |
|------|-------------|
| 2 | Interactive |
| 3 | Network |
| 4 | Batch |
| 5 | Service |
| 7 | Unlock |
| 10 | RemoteInteractive (RDP) |
| 11 | CachedInteractive |

### NTSTATUS Codes (Status field)
| Code | Meaning |
|------|---------|
| 0xc000006d | Bad username or password |
| 0xc000006e | Account restriction |
| 0xc000006f | Outside authorized hours |
| 0xc0000070 | Unauthorized workstation |
| 0xc00000dc | Server unavailable |
| 0xc0000133 | Clock skew too great |
| 0xc000015b | Logon type not granted |

---

## Method 5: C# / .NET Implementation

```csharp
using System;
using System.Diagnostics;
using System.Threading;
using System.Diagnostics.Eventing.Reader;

public class EventLogMonitor : IDisposable
{
    private EventLogReader _reader;
    private CancellationTokenSource _cts;
    
    public void StartMonitoring()
    {
        _cts = new CancellationTokenSource();
        
        // Create query for Event ID 4625
        string query = "*[System[EventID=4625]]";
        
        var logQuery = new EventLogQuery("Security", PathType.LogName, query)
        {
            ReverseDirection = true
        };
        
        _reader = new EventLogReader(logQuery);
        
        // Start reading in background
        Task.Run(() => ReadEvents(_cts.Token));
    }
    
    private void ReadEvents(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            var record = _reader.ReadEvent();
            
            if (record != null)
            {
                ProcessEvent(record);
            }
            else
            {
                Thread.Sleep(1000);
            }
        }
    }
    
    private void ProcessEvent(EventRecord record)
    {
        // Parse XML to get fields
        var xml = record.ToXml();
        
        // Extract IpAddress from EventData
        string ipAddress = GetXmlValue(xml, "IpAddress");
        string username = GetXmlValue(xml, "TargetUserName");
        
        Console.WriteLine($"Failed login: {username} from {ipAddress}");
    }
    
    private string GetXmlValue(string xml, string fieldName)
    {
        // Parse XML and extract field
        // Implementation here
    }
}
```

---

## Summary: Recommended Approach

| Method | Pros | Cons |
|--------|------|------|
| PowerShell Get-WinEvent | Easy, built-in | Not real-time |
| Python win32evtlog | Cross-platform capable | Requires pywin32 |
| Python wevtutil | Simple, reliable | Subprocess overhead |
| .NET EventLogReader | Native, performant | Windows only |
| WEF | Enterprise scalable | Complex setup |

**Recommended for your project:**
1. **Python + win32evtlog** for log monitor service
2. **PowerShell scripts** for firewall automation
3. **REST API** to connect components
