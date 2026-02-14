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
Execute `DATABASE_SCHEMA.md` queries in MSSQL Management Studio.

### 1.4 Add VMSources Table (Multi-VM)
```sql
CREATE TABLE VMSources (
    id INT IDENTITY(1,1) PRIMARY KEY,
    vm_id VARCHAR(100) NOT NULL UNIQUE,
    hostname NVARCHAR(256),
    ip_address VARCHAR(45),
    collection_method VARCHAR(20),  -- 'wef', 'agent'
    status VARCHAR(20) DEFAULT 'active',  -- active, inactive, error
    last_seen DATETIME2,
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    
    INDEX idx_vm_id (vm_id),
    INDEX idx_status (status)
);
```

### 1.5 Add PerVMThresholds Table (Multi-VM)
```sql
CREATE TABLE PerVMThresholds (
    id INT IDENTITY(1,1) PRIMARY KEY,
    vm_id VARCHAR(100) NOT NULL,
    threshold INT DEFAULT 5,
    time_window_minutes INT DEFAULT 5,
    block_duration_minutes INT DEFAULT 60,
    auto_block_enabled BIT DEFAULT 1,
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    updated_at DATETIME2 DEFAULT GETUTCDATE(),
    
    FOREIGN KEY (vm_id) REFERENCES VMSources(vm_id),
    UNIQUE (vm_id)
);
```

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
DB_SERVER=localhost
DB_NAME=SecurityMonitor
DB_USER=sa
DB_PASSWORD=YourPassword
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
  poll_interval: 2

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

#### On Each Source VM:
```powershell
# Enable Windows Event Collector service
Start-Service Wecsvc
Set-Service Wecsvc -StartupType Automatic

# Configure Security log to forward
wevtutil sl Security /ca:O:BAG:SYD:(A;;0x80100009;;;AU)(A;;0x1;;;S-1-5-20)
```

#### Create Subscription on Collector Server:
```powershell
# Create subscription (run as Admin)
wecutil -cs "SecurityEvents"
```

#### Create Subscription XML (subscription.xml):
```xml
<Subscription xmlns="http://schemas.microsoft.com/2006/03/windows/events/subscription">
    <SubscriptionId>FailedLogins</SubscriptionId>
    <SubscriptionType>SourceInitiated</SubscriptionType>
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
        <Query>
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

#### Apply Subscription:
```powershell
wecutil -c subscription.xml
wecutil -r FailedLogins
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
  poll_interval: 2
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
