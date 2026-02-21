# Session Notes: Windows VM Failed Login Monitoring System

**Date:** February 19, 2026  
**Project:** Windows VM Failed Login Attack Monitoring & Automated IP Blocking System

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Session Goals](#session-goals)
3. [Documentation Review Findings](#documentation-review-findings)
4. [Documentation Fixes Applied](#documentation-fixes-applied)
5. [Event Collection Flow](#event-collection-flow)
6. [Configuration Requirements](#configuration-requirements)
7. [Test Environment Setup](#test-environment-setup)
8. [Next Steps](#next-steps)

---

## Project Overview

This is a **design-phase documentation repository** for a security monitoring solution that:

- Detects failed login attempts (Event ID 4625) on Windows VMs
- Tracks suspicious source IP addresses
- Provides automated IP blocking via firewall integration
- Includes a REST API for management
- Features a React dashboard for real-time visualization

### Technology Stack

| Component      | Technology                    |
| -------------- | ----------------------------- |
| Backend        | Python 3.9+ / FastAPI         |
| Database       | MSSQL Server 2019+            |
| Frontend       | React 18+                     |
| Log Collection | WEF or Python Agent           |
| Firewall       | Windows Firewall (PowerShell) |

### Repository Files

| File                                  | Purpose                                |
| ------------------------------------- | -------------------------------------- |
| `README.md`                           | Project overview, quick start          |
| `ARCHITECTURE.md`                     | System architecture, component diagram |
| `SETUP.md`                            | Step-by-step installation guide        |
| `DATABASE_SCHEMA.md`                  | MSSQL tables, stored procedures        |
| `API_SPEC.md`                         | REST API specification (15 endpoints)  |
| `APPLICATION_FLOW.md`                 | End-to-end data flow                   |
| `MULTI_VM_COLLECTION.md`              | WEF and Agent-based collection         |
| `WINDOWS_LOG_MONITORING_DEEP_DIVE.md` | Event 4625 monitoring methods          |
| `FIREWALL_INTEGRATION.md`             | Firewall blocking scripts              |

---

## Session Goals

User's choices at start of session:

| Decision                   | Choice                                              |
| -------------------------- | --------------------------------------------------- |
| What to do with project    | Build the log monitor agent + Review & improve docs |
| Database                   | Stick with MSSQL                                    |
| Collection method priority | WEF (Windows Event Forwarding)                      |
| Windows VM access          | Will set up VMs for testing                         |

---

## Documentation Review Findings

Reviewed all 9 documentation files and found **17 issues**:

### Critical Issues (Bugs)

| #   | Issue                                                                                                 | Location                                     |
| --- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 1   | Agent code passes `event.StringInserts` (tuple) to XML parser - crashes at runtime                    | `MULTI_VM_COLLECTION.md:141-287`             |
| 2   | Same bug in Method 2 code - `StringInserts` is NOT XML                                                | `WINDOWS_LOG_MONITORING_DEEP_DIVE.md:68-154` |
| 3   | Wrong `wecutil` flags: `-c` should be `cs`, `-r` should be `gr`                                       | `SETUP.md`, `MULTI_VM_COLLECTION.md`         |
| 4   | `Wecsvc` started on source VMs (should be on collector only)                                          | `SETUP.md:146-152`                           |
| 5   | Subscription XML uses `SourceInitiated` but lists explicit addresses (should be `CollectorInitiated`) | `SETUP.md:162-188`                           |

### Moderate Issues (Inconsistencies)

| #   | Issue                                                                   | Location                                                         |
| --- | ----------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 6   | `DELETE /api/v1/vms/:vm_id` missing from API_SPEC.md                    | `MULTI_VM_COLLECTION.md:374`                                     |
| 7   | README missing `/feed` and `/geo-attacks` endpoints                     | `README.md:84-99`                                                |
| 8   | `VMSources` and `PerVMThresholds` tables duplicated                     | `SETUP.md` and `DATABASE_SCHEMA.md`                              |
| 9   | SSE vs WebSocket inconsistency                                          | `API_SPEC.md` says SSE, `FIREWALL_INTEGRATION.md` says WebSocket |
| 10  | Wrong URL in polling example                                            | `FIREWALL_INTEGRATION.md:183`                                    |
| 11  | `sp_RecordFailedLogin` doesn't respect `TIME_WINDOW`                    | `DATABASE_SCHEMA.md:159-188`                                     |
| 12  | `SuspiciousIPs.failed_attempts` is lifetime counter, not sliding window | `DATABASE_SCHEMA.md:28-47`                                       |

### Suggestions (Missing Features)

| #   | Issue                                 | Impact                                                                    |
| --- | ------------------------------------- | ------------------------------------------------------------------------- |
| 13  | No `requirements.txt` at project root | Setup guide references non-existent files                                 |
| 14  | No health check endpoint              | Agents can't verify collector is up                                       |
| 15  | No retry/queue logic in agent         | Events silently dropped if collector down                                 |
| 16  | No logging framework in agent         | Uses `print()` everywhere                                                 |
| 17  | WEF collector service undocumented    | Docs show WEF setup but not the Python service that reads ForwardedEvents |

---

## Documentation Fixes Applied

All 17 issues were fixed. Summary of changes:

### Files Modified

| File                                  | Changes                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MULTI_VM_COLLECTION.md`              | Rewrote agent code to use `EvtQuery` API, added retry queue + logging, added WEF Collector Service code, fixed `wecutil` commands, changed to `CollectorInitiated` |
| `WINDOWS_LOG_MONITORING_DEEP_DIVE.md` | Rewrote Method 2 to use `EvtQuery` API with proper XML parsing                                                                                                     |
| `SETUP.md`                            | Fixed WEF setup (moved `Wecsvc` to collector, fixed source VM config), removed duplicate schema, referenced `DATABASE_SCHEMA.md`                                   |
| `API_SPEC.md`                         | Added `DELETE /vms/:vm_id` and `GET /health` endpoints                                                                                                             |
| `README.md`                           | Added missing endpoints (`/feed`, `/geo-attacks`, `/health`, `DELETE /vms/:vm_id`)                                                                                 |
| `ARCHITECTURE.md`                     | Added missing endpoints to API surface list                                                                                                                        |
| `DATABASE_SCHEMA.md`                  | Added design notes about using `FailedLoginAttempts` with time filter for threshold checks                                                                         |
| `FIREWALL_INTEGRATION.md`             | Fixed SSE vs WebSocket (standardized on SSE), fixed polling URL                                                                                                    |

### Key Code Fixes

**Agent Code (MULTI_VM_COLLECTION.md):**

- Changed from `ReadEventLog` API (returns tuple) to `EvtQuery`/`EvtNext`/`EvtRender` API (returns XML)
- Added `EvtBookmark` persistence for restart resilience
- Added retry queue (max 5000 events) for failed sends
- Added Python `logging` module instead of `print()`

**WEF Collector Service (NEW - MULTI_VM_COLLECTION.md):**

- Complete Python service that reads `ForwardedEvents` log
- Extracts source VM from `<Computer>` element
- Groups events by VM and POSTs to backend API
- Includes bookmark persistence and retry logic

---

## Event Collection Flow

### High-Level Pipeline

```
SOURCE VM                           COLLECTOR                    BACKEND
─────────                           ─────────                    ───────
User fails login
      │
      ▼
Windows logs Event 4625
      │
      ├─── WEF ──────────────────► ForwardedEvents log
      │    (push via WinRM)              │
      │                                  ▼
      │                         WEFCollectorService
      │                         (Python script)
      │                                  │
      ├─── Agent ────────────────────────┤
      │    (Python on each VM)           │
      │                                  ▼
      │                         POST /api/v1/events
      │                                  │
      │                                  ▼
      │                         FastAPI Backend
      │                                  │
      │                                  ▼
      │                              MSSQL DB
      │                                  │
      │                                  ▼
      │                         Detection Engine
      │                         (threshold check)
      │                                  │
      │                                  ▼
      │                         Block IP if threshold exceeded
```

### Step-by-Step

1. **Login Failure:** User/attacker fails authentication on Windows VM
2. **Windows Logs:** Event ID 4625 written to Security Event Log
3. **Collection (WEF):**
   - Source VM forwards event via WinRM to collector
   - Event lands in `ForwardedEvents` log on collector
   - `WEFCollectorService` reads log, extracts source VM from `<Computer>` element
4. **Collection (Agent):**
   - Python agent polls local Security log using `EvtQuery` API
   - Agent parses event XML, extracts IP/username/etc.
5. **API POST:** Event sent to `POST /api/v1/events` with VM identifier
6. **Database:** Event stored in `FailedLoginAttempts` table
7. **Detection:** Engine counts attempts in `TIME_WINDOW` from `FailedLoginAttempts`
8. **Blocking:** If threshold exceeded, IP added to `BlockedIPs` and firewall rule created

### Event 4625 Fields Collected

| Field       | XML Path                        | Example                     |
| ----------- | ------------------------------- | --------------------------- |
| IP Address  | `EventData/IpAddress`           | `192.168.1.100`             |
| Username    | `EventData/TargetUserName`      | `admin`                     |
| Domain      | `EventData/TargetDomainName`    | `WIN-VM01`                  |
| Logon Type  | `EventData/LogonType`           | `10` (RDP)                  |
| Status      | `EventData/Status`              | `0xc000006a` (bad username) |
| Workstation | `EventData/WorkstationName`     | `ATTACK-PC`                 |
| Source Port | `EventData/IpPort`              | `54321`                     |
| Timestamp   | `System/TimeCreated@SystemTime` | `2024-01-15T10:30:00Z`      |

---

## Configuration Requirements

### WEF Method

#### Source VM Configuration

| #   | Configuration                | Command                                                                                                                |
| --- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | Enable WinRM                 | `Enable-PSRemoting -Force`                                                                                             |
| 2   | Auto-start WinRM             | `Set-Service WinRM -StartupType Automatic`                                                                             |
| 3   | Start WinRM                  | `Start-Service WinRM`                                                                                                  |
| 4   | Firewall allow WinRM         | `New-NetFirewallRule -DisplayName "WinRM for WEF" -Direction Inbound -Protocol TCP -LocalPort 5985,5986 -Action Allow` |
| 5   | Trust collector (workgroup)  | `Set-Item WSMan:\localhost\Client\TrustedHosts -Value "collector-ip" -Force`                                           |
| 6   | Allow basic auth (workgroup) | `winrm set winrm/config/service '@{AllowUnencrypted="true"}'`                                                          |

#### Collector Configuration

| #   | Configuration                | Command                                                                                                                  |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | Enable Event Collector       | `dism /online /enable-feature /featurename:EventCollectorFeature /all`                                                   |
| 2   | Configure WinRM              | `winrm quickconfig -force`                                                                                               |
| 3   | Start Wecsvc                 | `Set-Service Wecsvc -StartupType Automatic; Start-Service Wecsvc`                                                        |
| 4   | Trust source VMs (workgroup) | `Set-Item WSMan:\localhost\Client\TrustedHosts -Value "source-ip" -Force`                                                |
| 5   | Allow basic auth (workgroup) | `winrm set winrm/config/client '@{AllowUnencrypted="true"}'`                                                             |
| 6   | Firewall allow API           | `New-NetFirewallRule -DisplayName "Security Monitor API" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow` |
| 7   | Create subscription          | `wecutil cs subscription.xml`                                                                                            |
| 8   | Verify subscription          | `wecutil gs FailedLogins`                                                                                                |

#### Subscription XML (CollectorInitiated for workgroup)

```xml
<Subscription xmlns="http://schemas.microsoft.com/2006/03/windows/events/subscription">
    <SubscriptionId>FailedLogins</SubscriptionId>
    <SubscriptionType>CollectorInitiated</SubscriptionType>
    <Description>Collect Event 4625 from source VMs</Description>
    <Enabled>true</Enabled>
    <ReadExistingEvents>false</ReadExistingEvents>

    <EventSources>
        <EventSource>
            <Address>192.168.56.101</Address>
            <UserName>SourceVMUsername</UserName>
            <Password>SourceVMPassword</Password>
            <Enabled>true</Enabled>
        </EventSource>
    </EventSources>

    <Query>
        <QueryList>
            <Query Path="Security">
                <Select>*[System[EventID=4625]]</Select>
            </Query>
        </QueryList>
    </Query>

    <CredentialsType>Basic</CredentialsType>

    <Delivery Mode="Push">
        <PushSettings>
            <HeartbeatInterval>60000</HeartbeatInterval>
        </PushSettings>
    </Delivery>
</Subscription>
```

### Agent Method

#### Source VM Configuration

| #   | Configuration       | Details                                       |
| --- | ------------------- | --------------------------------------------- |
| 1   | Install Python 3.9+ | From python.org                               |
| 2   | Install packages    | `pip install pywin32 requests pyyaml urllib3` |
| 3   | Create config.yaml  | VM ID, collector URL, poll interval           |
| 4   | Run agent           | `python main.py`                              |

#### Agent config.yaml

```yaml
vm_id: "vm-001"
collector_url: "http://192.168.56.102:3000/api/v1/events"
poll_interval: 10
event_id: 4625
```

### Collector/Backend (Both Methods)

| #   | Software        | Purpose                                                      |
| --- | --------------- | ------------------------------------------------------------ |
| 1   | Python 3.9+     | Backend + Collector service                                  |
| 2   | MSSQL Express   | Database                                                     |
| 3   | Python packages | `pip install pywin32 requests pyyaml fastapi uvicorn pyodbc` |

#### Backend .env

```env
DB_SERVER=localhost\SQLEXPRESS
DB_NAME=SecurityMonitor
API_PORT=3000
THRESHOLD=5
TIME_WINDOW=5
BLOCK_DURATION=60
ENABLE_AUTO_BLOCK=true
```

#### WEF Collector config.yaml

```yaml
api_url: http://localhost:3000/api/v1/events
poll_interval: 10
event_id: 4625
log_channel: ForwardedEvents
```

---

## Test Environment Setup

### VirtualBox Configuration

User will create two Windows 10/11 VMs in VirtualBox:

| VM   | Role                             | IP             | RAM  | Disk  |
| ---- | -------------------------------- | -------------- | ---- | ----- |
| VM 1 | Source (generates failed logins) | 192.168.56.101 | 2 GB | 40 GB |
| VM 2 | Collector + Backend + MSSQL      | 192.168.56.102 | 4 GB | 60 GB |

### Network Setup

| Adapter   | Type                 | Purpose                |
| --------- | -------------------- | ---------------------- |
| Adapter 1 | NAT                  | Internet access        |
| Adapter 2 | Host-Only (vboxnet0) | VM-to-VM communication |

### Host-Only Network

```
VirtualBox → File → Host Network Manager → Create
  - IPv4 Address: 192.168.56.1
  - IPv4 Mask: 255.255.255.0
  - DHCP: Enable or use static IPs
```

### Testing Failed Logins

Generate Event 4625 on source VM:

```powershell
# Method 1: From collector, try bad RDP login to source
# Method 2: From collector, run:
net use \\192.168.56.101\C$ /user:baduser wrongpassword

# Verify on source VM:
Get-WinEvent -FilterHashtable @{LogName='Security'; ID=4625} -MaxEvents 1
```

### Verification Commands

**Source VM:**

```powershell
Get-Service WinRM                    # Check WinRM running
winrm enumerate winrm/config/listener # Check WinRM config
Get-WinEvent -FilterHashtable @{LogName='Security'; ID=4625} -MaxEvents 5
```

**Collector VM:**

```powershell
Get-Service Wecsvc                   # Check Event Collector running
wecutil gs FailedLogins              # Check subscription status
wecutil gr FailedLogins              # Check runtime status
Get-WinEvent -LogName ForwardedEvents -MaxEvents 5  # Check forwarded events
curl http://localhost:3000/api/v1/health  # Check API running
```

---

## Next Steps

### Immediate (User to do)

1. Create two Windows 10/11 VMs in VirtualBox
2. Configure networking (NAT + Host-Only)
3. Set static IPs (192.168.56.101 and 192.168.56.102)
4. Test ping between VMs

### Once VMs Ready (Claude to help)

1. Create actual Python implementation files:
   - `collector/wef_reader.py` - WEF Collector Service
   - `backend/main.py` - FastAPI backend
   - `agent/main.py` - Source VM agent
2. Set up MSSQL Express database
3. Run schema scripts from `DATABASE_SCHEMA.md`
4. Configure WEF subscription
5. Test complete event flow
6. (Optional) Build React dashboard

### Implementation Status

| Component             | Documentation           | Implementation  |
| --------------------- | ----------------------- | --------------- |
| WEF Collector Service | Complete                | Not yet created |
| Agent                 | Complete                | Not yet created |
| FastAPI Backend       | Partial (API spec only) | Not yet created |
| Database Schema       | Complete                | Not yet created |
| Firewall Scripts      | Complete                | Not yet created |
| React Dashboard       | Minimal                 | Not yet created |

---

## API Endpoints Summary

| Method | Endpoint                   | Description                 |
| ------ | -------------------------- | --------------------------- |
| GET    | /api/v1/suspicious-ips     | Get suspicious IP list      |
| GET    | /api/v1/statistics         | Get attack statistics       |
| GET    | /api/v1/blocked-ips        | Get currently blocked IPs   |
| POST   | /api/v1/block              | Manually block an IP        |
| DELETE | /api/v1/block/:ip          | Unblock an IP               |
| GET    | /api/v1/feed               | Real-time attack feed (SSE) |
| GET    | /api/v1/geo-attacks        | Geo-location attack data    |
| GET    | /api/v1/vms                | List all monitored VMs      |
| POST   | /api/v1/vms                | Register a new VM           |
| DELETE | /api/v1/vms/:vm_id         | Unregister a VM             |
| GET    | /api/v1/vms/:vm_id/attacks | Get attacks per VM          |
| POST   | /api/v1/events             | Receive events (agent/WEF)  |
| POST   | /api/v1/block/per-vm       | Block IP on specific VM     |
| GET    | /api/v1/statistics/global  | Global stats across VMs     |
| GET    | /api/v1/health             | Health check                |

---

## Database Tables Summary

| Table                 | Purpose                                  |
| --------------------- | ---------------------------------------- |
| `FailedLoginAttempts` | Immutable event history                  |
| `SuspiciousIPs`       | Per-IP state tracking (lifetime counter) |
| `BlockedIPs`          | Active and historical blocks             |
| `AttackStatistics`    | Pre-aggregated dashboard metrics         |
| `Settings`            | Runtime configuration                    |
| `VMSources`           | Registry of monitored VMs                |
| `PerVMThresholds`     | Per-VM threshold overrides               |

---

## Key Design Notes

1. **Threshold Detection:** Must query `FailedLoginAttempts` with `TIME_WINDOW` filter, NOT use `SuspiciousIPs.failed_attempts` (which is a lifetime counter)

2. **WEF vs Agent:**
   - WEF: No agent on source, uses built-in Windows, requires WinRM
   - Agent: More control, works in workgroups, requires Python on each VM

3. **Collection Method Chosen:** WEF first (user's choice)

4. **Block Scope:**
   - Global: Blocks IP at network perimeter (all VMs protected)
   - Per-VM: Blocks IP only on specific VM (local firewall)

5. **Auth Model (MVP):** Network-level access control (firewall restricts to trusted IPs)

---

_End of Session Notes_
