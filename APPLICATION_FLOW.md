# Application Flow: Windows Failed Login Monitoring and Automated IP Blocking

## Purpose

This document describes the complete end-to-end flow of the system:

1. where data originates,
2. how data is collected (single or multi-VM),
3. where data is stored,
4. how data is processed and decisions are made,
5. how blocking is executed,
6. how results are exposed to operators and dashboards.

---

## High-Level Pipeline

### Single VM
`User login attempt -> Windows Security Event Log (4625) -> Log Monitor Service -> Backend API/Detection Engine -> MSSQL -> Firewall Block/Unblock -> API Feed -> React Dashboard`

### Multi-VM
`Multiple VMs -> Event Collector (WEF/Agent) -> Central Backend -> MSSQL -> Firewall Block (applied globally or per-VM) -> Unified Dashboard`

---

## End-to-End Flow (Detailed)

### 1. Login Attempt Happens on Windows VM
- A user or attacker attempts authentication (RDP, SMB, local, etc.).
- If authentication fails, Windows writes **Event ID 4625** in the Security log.

### 2. Event Is Written by Windows
- Event source: `Microsoft-Windows-Security-Auditing`.
- Event is stored in local Windows Security Event Log.
- Important fields are available in event XML under `EventData`.

### 3. Multi-VM Collection Methods

#### Option A: Windows Event Forwarding (WEF)
- Each source VM configures **Event Log forwarding** to the collector server
- The collector subscribes to Security logs from all VMs
- Each event includes source VM identification via subscription
- No agent required on source VMs

#### Option B: Agent-Based Collection
- Lightweight Python/agent runs on each Windows VM
- Agent polls Event ID 4625 locally
- Sends events via HTTPS to central API endpoint
- Includes VM identifier (hostname or config ID) in payload
- Agent requires network access to collector server

### 4. Event Collector Processes Events
- Receives events from WEF subscription or agent POST
- Adds `source_vm_id` / `source_hostname` to each event
- Normalizes data structure (same as single-VM)
- Optionally enriches with VM metadata
- Forwards to detection engine via internal queue or API

### 5. Event Data Is Normalized
- The collector converts raw event XML into a normalized event object.
- Minimum normalized payload includes:
  - `ip_address`
  - `username`
  - `timestamp`
  - `logon_type`
  - `failure_reason`
  - `source_port`
  - `hostname/workstation`
  - `source_vm_id` (NEW: identifies which VM)
- Internal or unusable addresses are ignored or flagged.

### 6. Data Is Sent to Core Processing Layer
- The collector forwards normalized event data to the backend
- Backend maintains centralized detection logic

### 7. Data Is Persisted in MSSQL
- Raw event-level record is stored in `FailedLoginAttempts` (now includes `source_vm_id`)
- Per-IP rolling state is upserted in `SuspiciousIPs` (global, not per-VM)
- Per-VM attack statistics tracked separately
- If threshold is exceeded and blocking occurs, block record is inserted in `BlockedIPs`
- Periodic aggregates for dashboards are stored in `AttackStatistics` (with VM breakdown)
- Config values are read from `Settings`
- **New**: `VMSources` table tracks all monitored VMs

### 8. Detection Logic Evaluates Threat Level

#### Global Detection (all VMs combined)
- Detection engine checks failed attempts by IP across ALL VMs
- Example: `5 attempts from same IP across any VM in 5 minutes`
- If condition is met: IP is flagged as suspicious globally

#### Per-VM Detection (individual VM)
- Detection engine tracks failed attempts per IP per VM
- Example: `10 attempts on VM #1 in 5 minutes`
- Each VM can have different thresholds
- Allows granular blocking (block only attacks targeting specific VM)

#### Decision Outcomes
- Below threshold: record only
- Reaches global threshold: mark suspicious (global)
- Reaches per-VM threshold: mark suspicious (VM-specific)
- Auto-block enabled: create block action (global or per-VM)

### 9. Blocking Action Is Executed
- Backend triggers firewall integration adapter
- **Global blocking**: blocks IP at network perimeter (all VMs protected)
- **Per-VM blocking**: blocks IP only on specific VM (local firewall)
- First implementation: Windows Firewall command/script
- External hardware firewall: applies globally

### 10. Block State and Real-Time Updates Are Published
- Backend exposes current state via REST:
  - `/api/v1/suspicious-ips`
  - `/api/v1/blocked-ips`
  - `/api/v1/statistics`
  - `/api/v1/vms` - list of monitored VMs
  - `/api/v1/vms/:vm_id/attacks` - attacks per VM
  - `/api/v1/feed` (SSE) - real-time updates including VM source
- Dashboard consumes these APIs for operator visibility

### 11. Unblock Lifecycle Runs
- Manual unblock via API (`DELETE /api/v1/block/:ip`) or automatic expiry
- For per-VM blocks: remove firewall rule only on specific VM
- For global blocks: remove at network perimeter
- `BlockedIPs` is updated (`is_active=0`, `unblocked_at`, `unblocked_by`)
- Suspicious status may be reset/retained based on policy

---

## Data Collected from Event ID 4625

Typical fields extracted from `EventData`:
- `TargetUserName` (target account)
- `TargetDomainName`
- `IpAddress` (source IP)
- `IpPort` (source port)
- `LogonType` (interactive/network/RDP/etc.)
- `Status` (NTSTATUS code)
- `FailureReason`
- `WorkstationName`
- `TimeCreated` (event timestamp)

### Additional Fields for Multi-VM

- `source_vm_id` - Unique identifier of source VM (added by collector)
- `source_hostname` - Hostname of source VM (added by collector)
- `collector_timestamp` - When collector received the event

These fields drive both:
- operational detection decisions, and
- forensic/audit visibility.

---

## Storage Model by Responsibility

### `FailedLoginAttempts`
- Purpose: immutable event history (raw attempts).
- Used for: forensic review, analytics, reprocessing.
- **Multi-VM**: includes `source_vm_id` column.

### `SuspiciousIPs`
- Purpose: mutable per-IP state and counters (global).
- Used for: threshold checks, active suspicious list.
- Note: tracks attacks across ALL VMs combined.

### `VMSources` (NEW)
- Purpose: registry of all monitored VMs.
- Used for: VM management, per-VM statistics.
- Fields: `vm_id`, `hostname`, `ip_address`, `status`, `last_seen`.

### `BlockedIPs`
- Purpose: active + historical block actions.
- Used for: firewall sync, unblock workflow, audit trail.
- **Multi-VM**: includes `scope` field (global/per-vm), `target_vm_id`.

### `AttackStatistics`
- Purpose: pre-aggregated dashboard metrics.
- Used for: fast dashboard queries and trend charts.
- **Multi-VM**: includes `vm_id` for per-VM stats, `global_` prefix for aggregated.

### `Settings`
- Purpose: runtime policy configuration.
- Used for: global threshold/window/block duration/feature flags.
- **Multi-VM**: per-VM overrides are stored in `PerVMThresholds`.

---

## How Data Moves Between Components

### Multi-VM Collection

1. **Windows VM -> Event Collector**
   - WEF subscription: forward Security log events
   - Agent: poll and POST events via HTTPS

2. **Event Collector -> Central Backend**
   - Normalize events, add source VM identifier
   - Forward to detection engine

3. **Backend -> MSSQL**
   - Persist raw event + update IP state + write block records
   - Update VM source registry

4. **Backend -> Firewall (Global)**
   - Block at network perimeter (all VMs protected)

5. **Backend -> Firewall (Per-VM)**
   - Send block command to specific VM
   - Each VM applies local firewall rule

6. **Backend -> Dashboard**
   - Unified view with VM filtering
   - Per-VM and global statistics

7. **Operator -> Backend**
   - Manual actions (block/unblock, investigate IP)
   - VM management (add/remove VMs)

---

## Decision Rules (Policy Layer)

### Global Rules (all VMs combined)
- `GLOBAL_THRESHOLD = 5` - Failed attempts from same IP across any VM
- `TIME_WINDOW = 5 minutes`
- `BLOCK_DURATION = 60 minutes`
- `ENABLE_GLOBAL_AUTO_BLOCK = true`

### Per-VM Rules (individual VM)
- Stored in `PerVMThresholds` table by `vm_id`
- Example override: `threshold = 10`, `time_window_minutes = 5`, `block_duration_minutes = 60`
- `auto_block_enabled = 1` controls per-VM blocking behavior

### Decision Outcomes
- Below global threshold: record only (global)
- Below per-VM threshold: record only (VM-specific)
- Reaches global threshold: mark suspicious (global)
- Reaches per-VM threshold: mark suspicious (VM-specific)
- Global auto-block enabled: create global block (protects all VMs)
- Per-VM auto-block enabled: create VM-specific block (protects only that VM)

### Block Precedence
When both global and per-VM thresholds trigger:
- Single block record created with `scope = 'global'`
- IP is blocked at network perimeter (protects all VMs)
- Per-VM blocks are not created if global block exists
- This prevents duplicate blocks and ensures maximum protection

### Per-VM Config Source of Truth
Per-VM threshold configuration is stored in `PerVMThresholds` table:
- NULL values = inherit from global settings
- Allows granular control per VM
- Query: `SELECT * FROM PerVMThresholds WHERE vm_id = 'vm-001'`

---

## Authentication & Authorization

### Auth Model (MVP)

For MVP, authentication is handled at **network level**:

- **Event ingestion (`/api/v1/events`)**:
  - Firewall restricts access to trusted VM IP addresses only
  - VM identified by `vm_id` in request body
  - No API keys needed

- **Admin endpoints** (block/unblock/VM management):
  - Protected by network isolation for MVP
  - Only accessible from admin network/IP

### How It Works

```
[VM1] ──IP: 192.168.1.10──► [Firewall] ──► [API Server]
                                    │           │
                              Allow only    Validate vm_id
                              trusted IPs   in request body
```

### Revoking VM Access

To revoke a VM's access:
```sql
-- Option 1: Remove from registry
DELETE FROM VMSources WHERE vm_id = 'vm-001';

-- Option 2: Mark as inactive
UPDATE VMSources SET status = 'inactive' WHERE vm_id = 'vm-001';

-- Option 3: Block at firewall
-- Remove VM IP from firewall allow rules
```

### Future Enhancements (Post-MVP)
- API key authentication if network-level auth insufficient
- OAuth2/OIDC for dashboard access
- Role-based access control (RBAC)
- Audit logging for admin actions

---

## Example Attack Timeline

1. IP `203.0.113.10` fails login 1 time at 10:00.
2. Four more failed logins occur by 10:04.
3. Detector computes 5 failures in 5-minute window.
4. IP is marked suspicious and inserted/updated in `SuspiciousIPs`.
5. Auto-block action inserts active row in `BlockedIPs` with expiry at 11:04.
6. Firewall rule is created for `203.0.113.10`.
7. Dashboard immediately shows the new blocked IP.
8. At expiry (or manual unblock), rule is removed and DB active flag is cleared.

---

## Operational Outcomes

The system provides:
- Early detection of brute-force behavior,
- Automated containment (IP blocking),
- Centralized investigation data,
- Real-time operational visibility,
- Full audit trail for security operations.
