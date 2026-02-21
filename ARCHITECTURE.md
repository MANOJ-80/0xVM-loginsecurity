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
