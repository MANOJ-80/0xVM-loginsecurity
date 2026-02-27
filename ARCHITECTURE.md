# System Architecture

## Component Diagram

```
                    ┌─────────────────────────────────────────────────────────────────────┐
                    │                    Multi-VM Security Monitoring                     │
                    └─────────────────────────────────────────────────────────────────────┘
                                      │
      ┌───────────────────────────────┼───────────────────────────────┐
      ▼                               ▼                               ▼
┌──────────────┐                ┌──────────────┐                ┌──────────────┐
│ Windows VM 1 │                │ Windows VM 2 │                │ Windows VM N │
│ Event 4625   │                │ Event 4625   │                │ Event 4625   │
└──────┬───────┘                └──────┬───────┘                └──────┬───────┘
       │                                │                               │
       └──────────────── Agent Collection (HTTP POST) ─────────────────────┘
                                      │
                                      ▼
                    ┌───────────────────────────────────────────────────────┐
                    │ Event Collector / Ingestion API                      │
                    │ POST /api/v1/events                                  │
                    │ - Normalizes event payload                            │
                    │ - Tags source_vm_id                                   │
                    │ - Forwards to detection engine                        │
                    └───────────────────────────┬───────────────────────────┘
                                                │
                                                ▼
                    ┌───────────────────────────────────────────────────────┐
                    │ Detection Engine + REST API                           │
                    │ - Global threshold logic                              │
                    │ - Per-VM threshold logic                              │
                    │ - Global/per-VM block decisions                       │
                    └───────────────┬──────────────────────┬────────────────┘
                                    │                      │
                                    ▼                      ▼
                         ┌──────────────────┐      ┌──────────────────┐
                         │ MSSQL Database   │      │ Firewall Adapter │
                         │ - FailedLogins   │      │ - Global block   │
                         │ - SuspiciousIPs  │      │ - Per-VM block   │
                         │ - BlockedIPs     │      └──────────────────┘
                         │ - VMSources      │
                         │ - PerVMThresholds│
                         └─────────┬────────┘
                                   │
                                   ▼
                         ┌──────────────────┐
                         │ React Dashboard  │
                         │ /api/v1/*        │
                         │ - Global view    │
                         │ - VM-filter view │
                         └──────────────────┘
```

## Collection Mode

### Agent-Based (Current Implementation)
- Lightweight Python agent on each VM monitors Event ID 4625 using
  `EvtSubscribe` (pull-model subscription with `SignalEvent`). The OS
  signals the agent when a matching event is written to the log.
  A direct-pull-on-timeout safety net guarantees events are captured
  within `poll_interval` seconds even if the signal never fires.
- On startup, performs a one-time `EvtQuery` scan to catch events
  generated while the agent was offline.
- Uses SHA-256 fingerprint-based dedup (`SystemTime(UTC) + ip + username + source_port`)
  to guarantee each event is sent exactly once, persisted to `<vm_id>_seen.json`.
- Converts UTC timestamps from Windows Event XML to local time before
  sending, so database values match Windows Event Viewer display.
- Agent sends normalized events to `/api/v1/events` via HTTP POST.
  Failed sends are queued and retried on the next poll cycle.
- Server-side dedup in `sp_RecordFailedLoginMultiVM` prevents duplicate
  inserts when retried events were already processed by the backend.
- Best for workgroup or mixed environments.

## Deduplication Strategy

The system uses **two layers of dedup** to guarantee no duplicate events
are stored, even across agent restarts and network failures.

### Layer 1: Agent-Side — `_seen.json`

The agent maintains a file (`<vm_id>_seen.json`) containing SHA-256
fingerprints of every event it has already sent.

**How it works:**
1. Agent reads event from Windows Event Log.
2. Builds fingerprint: `SHA-256(utc_timestamp + ip + username + source_port)`.
3. If fingerprint exists in `_seen.json` → skip (already sent).
4. If new → send to backend, add fingerprint to `_seen.json`.

**Startup scan:** On every restart, the agent scans the event log in
**reverse direction** (newest first). It reads backwards until it hits
events that are already in `_seen.json`, then stops (early exit). This
means restart cost is proportional to **new events since last run**, not
the total log size.

**Size cap:** `_seen.json` is capped at 50,000 entries. When full, the
oldest entries are dropped. This is safe because old events are also
rotated out of the Windows Event Log (default 20MB max).

**Future improvement:** Age-based pruning — remove entries older than N
days to keep `_seen.json` aligned with the Windows Event Log retention
window.

### Layer 2: Database-Side — Stored Procedure

`sp_RecordFailedLoginMultiVM` checks `IF EXISTS` before inserting,
using the natural key: `(ip_address, username, source_port, timestamp,
source_vm_id)`.

This catches duplicates that slip past the agent — specifically when
the agent's HTTP POST times out but the backend already processed the
request. The agent queues the events for retry, and the retry sends
them again. The stored procedure silently drops the duplicate.

| Layer | Where | Prevents | Cost |
|-------|-------|----------|------|
| `_seen.json` | Agent | Re-sending old events on restart | Saves bandwidth and API load |
| `IF EXISTS` | Database | Duplicate inserts from retry timeouts | One extra SELECT per insert |

## Data Flow

1. Failed login occurs on a source VM (Event ID 4625).
2. Agent on the VM detects the event via EvtSubscribe subscription
   (signal or direct-pull-on-timeout).
3. Agent deduplicates using fingerprint set, converts timestamp to
   local time, and sends new events to collector.
4. Collector normalizes payload and adds `source_vm_id`.
5. Stored procedure checks for duplicate before inserting (server-side dedup).
6. Backend writes event/state records to MSSQL via stored procedure.
7. If thresholds are exceeded, backend inserts block record(s) and calls firewall adapter.
8. Dashboard reads `/api/v1` endpoints for global and VM-specific insights.

## API Surface (v1)

- `POST /api/v1/events`
- `GET /api/v1/suspicious-ips`
- `GET /api/v1/blocked-ips`
- `GET /api/v1/statistics`
- `GET /api/v1/statistics/global`
- `GET /api/v1/feed`
- `GET /api/v1/geo-attacks`
- `GET /api/v1/vms`
- `POST /api/v1/vms`
- `DELETE /api/v1/vms/:vm_id`
- `GET /api/v1/vms/:vm_id/attacks`
- `POST /api/v1/block`
- `DELETE /api/v1/block/:ip`
- `POST /api/v1/block/per-vm`
- `GET /api/v1/health`

## Auth Model

- Network-level access control is used for the current deployment.
- Trusted VM IPs are allowed to reach ingestion endpoint.
- Admin endpoints are reachable only from trusted admin network.

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
