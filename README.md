# Windows VM Failed Login Attack Monitoring & Automated IP Blocking System

## Overview

A security monitoring solution that detects failed login attempts on Windows Virtual Machines, captures source IP addresses, and provides automated blocking capabilities via a REST API.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Multi-VM Security Monitoring System                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐     ┌──────────────────────┐  │
│  │ Windows  │   │ Windows  │   │ Windows  │     │   Event Collector    │  │
│  │   VM #1  │   │   VM #2  │   │   VM #3  │────▶│   (Agent API Only)   │  │
│  │ Event    │   │ Event    │   │ Event    │     └──────────┬───────────┘  │
│  │  4625    │   │  4625    │   │  4625    │                │             │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘                ▼             │
│       │              │              │           ┌──────────────────────┐  │
│       │   Agent      │   Agent      │   Agent   │   Detection Engine   │  │
│       └──────────────┴──────────────┴───────────┤   + REST API Server   │  │
│                                                   └──────────┬───────────┘  │
│                                                              │              │
│                                            ┌─────────────────┼───────────┐  │
│                                            ▼                 ▼           ▼  │
│                                      ┌──────────┐   ┌───────────┐  ┌──────┐ │
│                                      │  MSSQL   │   │ Firewall  │  │React │ │
│                                      │ Database │   │ Blocking  │  │ Dash │ │
│                                      └──────────┘   └───────────┘  └──────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Log Monitor Service
- Monitors Windows Event Log for Event ID 4625 (Failed Login)
- Extracts source IP, username, timestamp
- Low resource footprint background service

### 2. Attack Detection Engine
- Tracks failed attempts per IP
- Applies threshold rules (configurable)
- Flags suspicious IPs

### 3. REST API
- Provides suspicious IP list
- Exposes attack statistics
- Real-time blocked IP feed

### 4. Database (MSSQL)
- Stores IP addresses, attempt counts, timestamps
- Maintains attack history

### 5. Dashboard (React)
- Real-time attack visualization
- Geo-location mapping
- Attack trends

## Technology Stack

### Backend
- Python 3.9+ with FastAPI
- MSSQL Server 2019+

### Frontend
- React 18+
- Chart.js / Recharts
- Leaflet / react-simple-maps

### Infrastructure
- Windows Server 2019+ / Windows 10/11
- Windows Firewall or hardware firewall integration

## Collection Mode

### Agent-Based
- Lightweight Python agent on each VM monitors Event ID 4625
- Uses EvtSubscribe for real-time event detection with SHA-256 fingerprint deduplication
- On startup, performs one-time scan to catch missed events
- Converts UTC timestamps to local time before sending
- Failed sends are queued and retried on next poll cycle
- Server-side deduplication prevents duplicate inserts

See [MULTI_VM_COLLECTION.md](MULTI_VM_COLLECTION.md) for detailed setup instructions.

## Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| DB_SERVER | localhost\SQLEXPRESS | MSSQL server address |
| DB_NAME | SecurityMonitor | Database name |
| API_PORT | 3000 | API server port |
| THRESHOLD | 5 | Failed attempts before blocking |
| TIME_WINDOW | 5 | Time window in minutes |
| BLOCK_DURATION | 60 | Block duration in minutes |
| GLOBAL_THRESHOLD | 5 | Threshold across all VMs |
| ENABLE_GLOBAL_AUTO_BLOCK | true | Enable global IP blocking |
| ENABLE_PER_VM_BLOCK | true | Enable per-VM blocking |

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your database and API settings

# Run backend
uvicorn main:app --reload --host 0.0.0.0 --port 3000

# Run frontend
cd frontend
npm install
npm start
```

Frontend runs on http://localhost:3001

## Agent Deployment

### Build the exe (one-time, on dev machine)

```bash
cd agent
pip install -r requirements.txt pyinstaller
build.bat
# Output:
#   dist\SecurityMonitorAgent.exe   (console/dev)
#   dist\SecurityMonitorService.exe (Windows Service)
```

### Deploy to each VM

No Python needed on the target VM — copy these files:

```
mkdir C:\SecurityAgent
copy dist\SecurityMonitorAgent.exe  C:\SecurityAgent\
copy dist\SecurityMonitorService.exe C:\SecurityAgent\
copy config.yaml                    C:\SecurityAgent\
```

Edit `C:\SecurityAgent\config.yaml` on each VM:
```yaml
vm_id: "vm-003"          # unique per VM
collector_url: "http://192.168.56.102:3000/api/v1/events"
poll_interval: 10
event_id: 4625
```

### Run as a Windows Service

Use the dedicated service binary with `sc`:
```
sc create SecurityMonitorAgent binPath= "C:\SecurityAgent\SecurityMonitorService.exe" start= auto
sc description SecurityMonitorAgent "Security Monitor Agent (Windows Event 4625 collector)"
sc start SecurityMonitorAgent
```

Optional hardening:
```
sc failure SecurityMonitorAgent reset= 86400 actions= restart/5000/restart/10000/restart/30000
sc config SecurityMonitorAgent start= delayed-auto
```

Manage:
```
sc stop SecurityMonitorAgent       # Stop
sc start SecurityMonitorAgent      # Start
sc delete SecurityMonitorAgent     # Uninstall
```

### Development mode

```bash
cd agent
pip install -r requirements.txt
python main.py                     # Ctrl+C to stop
# Or run dist\SecurityMonitorAgent.exe directly for console logs
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for shutdown flow and internals.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v1/suspicious-ips | Get suspicious IP list |
| GET | /api/v1/statistics | Get attack statistics |
| GET | /api/v1/blocked-ips | Get currently blocked IPs |
| POST | /api/v1/block | Manually block an IP |
| DELETE | /api/v1/block/:ip | Unblock an IP |
| GET | /api/v1/feed | Real-time attack feed (SSE) |
| GET | /api/v1/geo-attacks | Geo-location attack data |
| GET | /api/v1/vms | List all monitored VMs |
| POST | /api/v1/vms | Register a new VM |
| DELETE | /api/v1/vms/:vm_id | Unregister a VM |
| GET | /api/v1/vms/:vm_id/attacks | Get attacks per VM |
| POST | /api/v1/events | Receive events (agent only) |
| POST | /api/v1/block/per-vm | Block IP on specific VM |
| GET | /api/v1/statistics/global | Global stats across VMs |
| GET | /api/v1/health | Health check |

## Multi-VM Support

This system supports centralized monitoring from multiple Windows VMs using:
- **Agent-based collection only**: Lightweight Python agent on each VM

## License

MIT
