# Agent Setup Guide

Complete A-Z guide for deploying the Security Monitor Agent on Windows VMs.

The agent monitors Windows Security Event Log for **Event ID 4625** (failed logon attempts) and sends them in real-time to the central collector server API.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Installation — From Source (Development)](#installation--from-source-development)
4. [Installation — PyInstaller Binary (Production)](#installation--pyinstaller-binary-production)
5. [Configuration Reference](#configuration-reference)
6. [Running the Agent](#running-the-agent)
7. [Installing as a Windows Service](#installing-as-a-windows-service)
8. [How the Agent Works](#how-the-agent-works)
9. [Logging](#logging)
10. [Deduplication](#deduplication)
11. [Retry Queue](#retry-queue)
12. [Firewall Requirements](#firewall-requirements)
13. [Troubleshooting](#troubleshooting)
14. [File Reference](#file-reference)

---

## Architecture Overview

```
┌──────────────────────┐         HTTP POST          ┌───────────────────────┐
│  Windows VM (Agent)  │  ────────────────────────>  │  Server VM (Backend)  │
│                      │   /api/v1/events            │  ASP.NET Core API     │
│  Monitors Event Log  │   /api/v1/vms               │  SQL Server Database  │
│  Event ID 4625       │                             │  Port 3000            │
└──────────────────────┘                             └───────────────────────┘
```

- **Agent** runs on every Windows VM you want to monitor
- **Server** runs only on the central collector VM (see `SERVER_SETUP.md`)
- Communication is one-way: agent pushes events to the server over HTTP
- No software needs to be installed on the server for the agent to work — the agent is self-contained

---

## Prerequisites

### On the Agent VM (Windows)

| Requirement | Details |
|---|---|
| **OS** | Windows 10 / Windows Server 2016 or later |
| **Python** | 3.10+ (only if running from source; not needed for PyInstaller binary) |
| **Admin rights** | Required to read the Security Event Log |
| **Network** | Agent must be able to reach the server on TCP port 3000 |

### Python Dependencies (source install only)

```
pywin32>=306
requests>=2.28.0
pyyaml>=6.0
urllib3>=1.26.0
```

These are listed in `agent/requirements.txt`.

---

## Installation — From Source (Development)

Use this method during development or testing.

### Step 1: Clone the repository

```powershell
git clone https://github.com/MANOJ-80/0xVM-loginsecurity.git
cd 0xVM-loginsecurity\agent
```

### Step 2: Create a Python virtual environment

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

### Step 3: Install dependencies

```powershell
pip install -r requirements.txt
```

### Step 4: Edit the configuration

Open `config.yaml` in a text editor and set:

```yaml
vm_id: "vm-001"
collector_url: "http://<SERVER_IP>:3000/api/v1/events"
poll_interval: 10
event_id: 4625
```

Replace `<SERVER_IP>` with the actual IP address of your server VM (e.g., `192.168.56.102`).

### Step 5: Run the agent

```powershell
python main.py
```

> **Important**: Run the terminal as **Administrator**. The Security Event Log requires admin privileges to read.

---

## Installation — PyInstaller Binary (Production)

Use this method for production deployment. Produces standalone `.exe` files that don't require Python to be installed.

### Step 1: Build the binaries

On a development machine with Python and the venv set up:

```powershell
cd agent
.\venv\Scripts\Activate.ps1
pip install pyinstaller
.\build.bat
```

This produces two files in `dist\`:

| File | Purpose |
|---|---|
| `SecurityMonitorAgent.exe` | Console application (for manual/dev runs) |
| `SecurityMonitorService.exe` | Windows Service binary (for production) |

### Step 2: Deploy to the target VM

Create a directory on the target VM and copy the required files:

```powershell
mkdir C:\SecurityAgent
```

Copy these files to `C:\SecurityAgent\`:
- `SecurityMonitorService.exe` (or `SecurityMonitorAgent.exe` for console mode)
- `config.yaml`

### Step 3: Edit config.yaml

```yaml
vm_id: "vm-001"
collector_url: "http://<SERVER_IP>:3000/api/v1/events"
poll_interval: 10
event_id: 4625
```

Each VM must have a **unique `vm_id`**. Examples: `vm-001`, `vm-002`, `dc-prod-01`, etc.

---

## Configuration Reference

All configuration is in `config.yaml`, located in the same directory as the agent executable.

### Required Settings

| Key | Type | Description | Example |
|---|---|---|---|
| `vm_id` | string | Unique identifier for this VM. Used to track which VM sent each event. | `"vm-001"` |
| `collector_url` | string | Full URL to the server's events endpoint. | `"http://192.168.56.102:3000/api/v1/events"` |

### Optional Settings

| Key | Type | Default | Description |
|---|---|---|---|
| `poll_interval` | int | `10` | Seconds between retry-queue flushes and the EvtSubscribe wait timeout. Also used as the polling interval if EvtSubscribe is unavailable. |
| `event_id` | int | `4625` | Windows Event ID to monitor. 4625 = failed logon. You should not change this unless you know what you're doing. |

### Logging Settings (Optional)

Nested under a `logging:` key:

```yaml
logging:
  file: "agent.log"
  max_bytes: 5242880
  backup_count: 3
```

| Key | Type | Default | Description |
|---|---|---|---|
| `logging.file` | string | `"agent.log"` | Log file path (relative to agent directory or absolute). |
| `logging.max_bytes` | int | `5242880` (5 MB) | Maximum size per log file before rotation. |
| `logging.backup_count` | int | `3` | Number of rotated log files to keep (e.g., `agent.log.1`, `.2`, `.3`). Total max disk usage = `max_bytes * (backup_count + 1)`. |

### Example Full config.yaml

```yaml
vm_id: "dc-prod-01"
collector_url: "http://192.168.56.102:3000/api/v1/events"
poll_interval: 10
event_id: 4625

logging:
  file: "agent.log"
  max_bytes: 5242880    # 5 MB
  backup_count: 3       # Keep 3 rotated files
```

---

## Running the Agent

### Console Mode (Development/Testing)

```powershell
# From source
python main.py

# From PyInstaller binary
.\SecurityMonitorAgent.exe
```

The agent will:
1. Print startup info and begin monitoring
2. Log all events to the console AND to `agent.log`
3. Stop cleanly on `Ctrl+C`

### Expected Startup Output

```
2026-03-04 19:27:11,382 [INFO] Agent started  vm_id=vm-001  hostname=DESKTOP-P9H3C6A
2026-03-04 19:27:11,500 [INFO] Registered with collector: vm_id=vm-001  ip=192.168.56.101
2026-03-04 19:27:11,650 [INFO] Scanning existing events...
2026-03-04 19:27:11,800 [INFO] Startup scan: 42 event(s) in log, 0 are new (unseen)
2026-03-04 19:27:11,810 [INFO] EvtSubscribe created: signal_event=<handle>, subscription=<handle>
2026-03-04 19:27:11,810 [INFO] Real-time subscription active (EvtSubscribe)
2026-03-04 19:27:11,811 [INFO] DIAG: Manual SetEvent -> WaitForSingleObject works (handle plumbing OK)
```

### When a Failed Login is Detected

```
2026-03-04 19:34:16,553 [INFO] Signal received - pulling events from subscription
2026-03-04 19:34:16,562 [INFO] Read 1 event(s) from log, 1 are new (unseen)
2026-03-04 19:34:16,589 [INFO] Failed login: user=admin  ip=192.168.56.105
2026-03-04 19:34:16,650 [INFO] Sent 1 event(s) to collector
```

---

## Installing as a Windows Service

The Windows Service mode allows the agent to:
- Start automatically on boot
- Run in the background without a logged-in user
- Survive logoffs

### Install the Service

Open an **Administrator** PowerShell prompt:

```powershell
sc.exe create SecurityMonitorAgent `
    binPath= "C:\SecurityAgent\SecurityMonitorService.exe" `
    start= auto `
    DisplayName= "Security Monitor Agent"
```

> **Note**: The spaces after `binPath=`, `start=`, and `DisplayName=` are required by `sc.exe` syntax.

### Start the Service

```powershell
sc.exe start SecurityMonitorAgent
```

### Verify the Service is Running

```powershell
sc.exe query SecurityMonitorAgent
```

Expected output:
```
STATE          : 4  RUNNING
```

You can also check in `services.msc` (Windows Services GUI).

### Stop the Service

```powershell
sc.exe stop SecurityMonitorAgent
```

### Remove the Service

```powershell
sc.exe stop SecurityMonitorAgent
sc.exe delete SecurityMonitorAgent
```

### Service Log Location

When running as a service, logs are written to `agent.log` in the same directory as the executable (e.g., `C:\SecurityAgent\agent.log`). Windows Event Viewer also shows service start/stop messages under **Windows Logs > Application** with source `SecurityMonitorAgent`.

---

## How the Agent Works

### Startup Sequence

1. **Load config** — reads `config.yaml` from the same directory as the executable
2. **Set up logging** — console + rotating file handler
3. **Register with collector** — sends `POST /api/v1/vms` with `vm_id`, hostname, IP, collection method. Best-effort (warning on failure, doesn't block).
4. **Startup scan** — queries the Security Event Log for existing 4625 events using `EvtQuery` with reverse direction. Deduplicates against the `_seen.json` file. Sends any new (unseen) events to the collector.
5. **Create subscription** — calls `EvtSubscribe` with `EvtSubscribeToFutureEvents` flag. Uses a pull-model with a `SignalEvent` handle.
6. **Diagnostic check** — manually signals and waits on the event handle to verify the Win32 plumbing works.
7. **Main loop** — `WaitForSingleObject` on the signal event with `poll_interval` timeout:
   - **Signal fired**: pull events from subscription, dedup, send to collector
   - **Timeout**: try pulling anyway (workaround for some pywin32 builds where the signal doesn't fire), flush retry queue

### Event Processing

For each raw Windows event:
1. **XML parsing** — extracts IP address, username, domain, logon type, failure reason (SubStatus), source port, timestamp
2. **IP filtering** — drops `::1`, `127.0.0.1`, `0.0.0.0` (loopback noise). Keeps `-` (local GUI failures).
3. **Timestamp conversion** — converts Windows UTC `SystemTime` to local time
4. **Fingerprinting** — SHA-256 hash of `raw_utc + ip + username + source_port` (truncated to 16 chars)
5. **Dedup** — skip if fingerprint already in `_seen_events` set
6. **Send** — HTTP POST to `collector_url` with JSON payload

### Payload Format

The agent sends events as a JSON POST body:

```json
{
  "vm_id": "vm-001",
  "hostname": "DESKTOP-P9H3C6A",
  "events": [
    {
      "timestamp": "2026-03-04T19:34:16.7999016",
      "ip_address": "192.168.56.105",
      "username": "admin",
      "domain": "WORKGROUP",
      "logon_type": "3",
      "status": "0xC000006A",
      "workstation": "ATTACKER-PC",
      "source_port": "49152"
    }
  ]
}
```

### Graceful Shutdown

On `Ctrl+C`, `SIGTERM`, `SIGBREAK`, or Windows Service stop:
1. Sets the `_stop_event` flag
2. Wakes the `WaitForSingleObject` call
3. Cleans up subscription and signal event handles
4. Exits cleanly

---

## Logging

### Output Destinations

| Destination | Always Active | Purpose |
|---|---|---|
| Console (stdout) | Yes | Live monitoring during development |
| Rotating file (`agent.log`) | Yes (unless path error) | Persistent log for debugging |

### Log Levels Used

| Level | When |
|---|---|
| `INFO` | Agent started, events detected, events sent, registration |
| `WARNING` | Could not reach collector, could not register, signal not firing |
| `ERROR` | EvtQuery/EvtSubscribe failure, unexpected WaitForSingleObject result |

### Log Format

```
2026-03-04 19:34:16,553 [INFO] Signal received - pulling events from subscription
```

Format: `%(asctime)s [%(levelname)s] %(message)s`

### Log Rotation

Default: 5 MB per file, 3 backups = max ~20 MB disk usage. Configurable via `config.yaml`.

Files created: `agent.log`, `agent.log.1`, `agent.log.2`, `agent.log.3`

---

## Deduplication

The agent prevents duplicate event delivery using two layers:

### Layer 1: Agent-Side Fingerprinting

- Each event gets a SHA-256 fingerprint from: `raw_utc_timestamp + ip_address + username + source_port`
- Fingerprints are stored in memory (`_seen_events` set) and persisted to `<vm_id>_seen.json`
- Maximum 50,000 fingerprints kept (oldest trimmed when exceeded)
- On restart, the agent loads the seen file so it doesn't re-send old events

### Layer 2: Server-Side Dedup

- The server checks for duplicate `(ip_address, username, source_port, timestamp, source_vm_id)` before inserting
- This handles edge cases like agent retry after a network timeout where the server actually received the event

### Seen File Location

File: `<vm_id>_seen.json` in the same directory as the agent executable.
Example: `vm-001_seen.json`

If this file is deleted, the agent will re-scan existing events on next startup but the server-side dedup will prevent duplicate database entries.

---

## Retry Queue

If the agent cannot reach the collector:

1. Failed events are added to an in-memory retry queue (max 5,000 events)
2. Every `poll_interval` seconds (or when a new event arrives), the agent retries the entire queue
3. On success, the queue is cleared
4. The queue is **not persisted to disk** — if the agent restarts, queued events are lost (but the startup scan will recapture them from the Event Log)

---

## Firewall Requirements

### On the Agent VM

| Direction | Port | Protocol | Destination | Purpose |
|---|---|---|---|---|
| Outbound | 3000 | TCP | Server VM IP | HTTP API calls to collector |

### On the Server VM

| Direction | Port | Protocol | Source | Purpose |
|---|---|---|---|---|
| Inbound | 3000 | TCP | Agent VM IPs | Accept HTTP API calls from agents |

### Windows Firewall Rule (Server VM)

```powershell
New-NetFirewallRule -DisplayName "Security Monitor API" `
    -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

---

## Troubleshooting

### "Could not register with collector" / "Failed to reach collector"

- **Check**: Is the server running? (`dotnet run` on server VM)
- **Check**: Can you reach the server from the agent VM? `curl http://<SERVER_IP>:3000/api/v1/health`
- **Check**: Is Windows Firewall on the server allowing inbound TCP 3000?
- **Check**: Is the `collector_url` in `config.yaml` correct?

### "win32evtlog is not available"

- **Cause**: The `pywin32` package is not installed or you're running on a non-Windows system
- **Fix**: `pip install pywin32>=306`

### Agent re-sends old events after restart

- **Check**: Is `<vm_id>_seen.json` present in the agent directory? If deleted, the agent will re-scan.
- **Note**: Server-side dedup will prevent duplicate database entries even if the agent re-sends.

### Service fails to start (Error 1053)

- **Check**: Make sure you deployed `SecurityMonitorService.exe` (NOT `SecurityMonitorAgent.exe`) as the service binary
- **Check**: Is `config.yaml` in the same directory as the exe?
- **Check**: Check Windows Event Viewer > Application for `SecurityMonitorAgent` error messages

### "DIAG: Signal did NOT fire, but N event(s) found by direct pull"

- This is a known issue with some pywin32 builds where `EvtSubscribe`'s `SignalEvent` never fires
- The agent automatically works around this by pulling directly from the subscription on every timeout
- Events are still captured, just with up to `poll_interval` seconds delay instead of instant

---

## File Reference

| File | Description |
|---|---|
| `main.py` | Main agent source code (743 lines). Entry point for console mode. |
| `config.yaml` | Configuration file. Must be in same directory as executable. |
| `windows_service.py` | Windows Service wrapper. Entry point for SCM-managed service. |
| `build.bat` | PyInstaller build script. Run from agent directory with venv activated. |
| `requirements.txt` | Python dependencies (4 packages). |
| `<vm_id>_seen.json` | Dedup fingerprint cache (auto-generated at runtime). |
| `agent.log` | Log file (auto-generated at runtime). |
