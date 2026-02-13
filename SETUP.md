# Setup Guide

## Prerequisites

### Software Requirements
- Windows Server 2019+ or Windows 10/11
- MSSQL Server 2019+
- Node.js 18+
- Python 3.9+ (for log monitor)
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

---

## Step 2: Backend Setup

### 2.1 Clone/Setup Project
```bash
cd backend
npm install
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
npm run dev
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

## Step 4: Frontend Dashboard Setup

### 4.1 Install Dependencies
```bash
cd frontend
npm install
```

### 4.2 Configure API
Edit `.env`:
```
REACT_APP_API_URL=http://localhost:3000/api
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
curl http://localhost:3000/api/statistics
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
