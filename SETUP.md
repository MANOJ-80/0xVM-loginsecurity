# Setup Guide

## Prerequisites

### Software Requirements

- Windows Server 2019+ or Windows 10/11
- MSSQL Server 2019+
- Python 3.9+ (for backend + agent)
- Administrator privileges

### Permissions Required

- Read access to Windows Security Event Log
- MSSQL database creation permissions
- Firewall rule management (optional)

---

## Step 1: Database Setup

### 1.1 Install MSSQL Server

Download and install MSSQL Server from: https://www.microsoft.com/en-us/sql-server

### 1.2 Create Database

```sql
CREATE DATABASE SecurityMonitor;
GO
USE SecurityMonitor;
GO
```

### 1.3 Run Schema Scripts

Execute all `CREATE TABLE` and `INSERT` statements from [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md) in MSSQL Management Studio. This creates all 7 tables (`FailedLoginAttempts`, `SuspiciousIPs`, `BlockedIPs`, `AttackStatistics`, `Settings`, `VMSources`, `PerVMThresholds`) and the stored procedures.

---

## Step 2: Backend Setup

### 2.1 Clone/Setup Project

```bash
cd backend
pip install -r requirements.txt
```

### 2.2 Configure Environment

Create `.env` file:

```env
DB_SERVER=localhost\SQLEXPRESS
DB_NAME=SecurityMonitor
API_PORT=3000
THRESHOLD=5
TIME_WINDOW=5
BLOCK_DURATION=60
```

### 2.3 Start API Server

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 3000
```

---

## Step 3: Log Monitor Service Setup

### 3.1 Python Service

```bash
cd log-monitor
pip install -r requirements.txt
```

### 3.2 Configure Monitor

Edit `config.yaml`:

```yaml
database:
  server: localhost
  name: SecurityMonitor
  username: sa
  password: YourPassword

monitoring:
  event_id: 4625
  poll_interval: 10

thresholds:
  max_attempts: 5
  time_window_minutes: 5

api:
  url: http://localhost:3000
```

### 3.3 Run Monitor

```bash
python main.py
```

### 3.4 Install as Windows Service (Optional)

```bash
python service.py install
python service.py start
```

---

## Step 3.5: Multi-VM Collection Setup

### Option A: Windows Event Forwarding (WEF)

#### On Collector Server:

```powershell
# Enable Windows Event Collector service on the COLLECTOR
Start-Service Wecsvc
Set-Service Wecsvc -StartupType Automatic
```

#### On Each Source VM:

```powershell
# Enable WinRM on SOURCE VMs (required for WEF)
Enable-PSRemoting -Force
Set-Service WinRM -StartupType Automatic
Start-Service WinRM

# Allow inbound WinRM traffic
New-NetFirewallRule -DisplayName "WinRM for WEF" -Direction Inbound -Protocol TCP -LocalPort 5985,5986 -Action Allow
```

#### Create Subscription XML (subscription.xml):

> **Note:** This uses `CollectorInitiated` mode because we list explicit
> source VM addresses. For `SourceInitiated` mode (where source VMs
> register themselves via Group Policy), remove the `<EventSources>`
> block and configure source VMs through GPO instead.

```xml
<Subscription xmlns="http://schemas.microsoft.com/2006/03/windows/events/subscription">
    <SubscriptionId>FailedLogins</SubscriptionId>
    <SubscriptionType>CollectorInitiated</SubscriptionType>
    <Description>Forward failed login events from all VMs</Description>
    <Enabled>true</Enabled>
    <EventSources>
        <EventSource>
            <Address>vm1.domain.com</Address>
            <Enabled>true</Enabled>
        </EventSource>
        <EventSource>
            <Address>vm2.domain.com</Address>
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
            <HeartbeatInterval>60</HeartbeatInterval>
        </PushSettings>
    </Delivery>
</Subscription>
```

#### Apply Subscription (on Collector):

```powershell
# Create the subscription from XML file
wecutil cs subscription.xml

# Verify subscription status
wecutil gs FailedLogins
```

### Option B: Agent-Based Collection

#### On Each Source VM:

```bash
cd agent
pip install -r requirements.txt
```

#### Configure Agent (config.yaml):

```yaml
agent:
  vm_id: "vm-001"

collector:
  url: https://collector-server:3000/api/v1/events
  ssl_verify: false

monitoring:
  event_id: 4625
  poll_interval: 10
```

**Note**: Agent authentication is handled by network-level security. Ensure firewall restricts access to only trusted VM IPs.

#### Run Agent:

```bash
cd agent
python main.py
```

#### Install as Windows Service:

```bash
python service.py install
```

---

## Step 4: Frontend Dashboard Setup

### 4.1 Install Dependencies

```bash
cd frontend
npm install
```

### 4.2 Configure API

Edit `.env`:

```
REACT_APP_API_URL=http://localhost:3000/api/v1
```

### 4.3 Start Dashboard

```bash
npm start
```

Access at: http://localhost:3001

---

## Step 5: Firewall Integration

### 5.1 Windows Firewall

Run PowerShell as Administrator:

```powershell
# Allow API server
New-NetFirewallRule -DisplayName "Security Monitor API" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

### 5.2 Auto-Block Script

Create `block_ip.ps1`:

```powershell
param([string]$IPAddress, [int]$Duration = 60)

$ruleName = "Block_$IPAddress"

# Add firewall rule
netsh advfirewall firewall add rule name="$ruleName" dir=in action=block remoteip=$IPAddress

# Schedule removal
$job = Start-Job -ScriptBlock {
    param($name, $duration)
    Start-Sleep -Seconds $duration
    netsh advfirewall firewall delete rule name=$name
} -ArgumentList $ruleName, ($Duration * 60)
```

---

## Step 6: Verify Installation

### Check API

```bash
curl http://localhost:3000/api/v1/statistics
```

### Check Event Log Access

```powershell
Get-WinEvent -FilterHashtable @{LogName='Security'; ID=4625} -MaxEvents 1
```

---

## Troubleshooting

### Issue: Cannot read Event Log

**Solution**: Run log monitor as Administrator

### Issue: Database connection failed

**Solution**: Check SQL Server is running and credentials are correct

### Issue: API not accessible

**Solution**: Check firewall rules allow port 3000
