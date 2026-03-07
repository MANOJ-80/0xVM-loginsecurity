Perfect 🔥
I’ll give you **complete session engineering notes** — clean, structured, production-ready — so you can use this inside Antigravity for further development.

You built a **Windows Failed Login Monitoring System** using:

- Backend API (FastAPI + Uvicorn)
- Microsoft SQL Server 2022 Express
- Windows Event ID 4625 monitoring
- Multi-VM event ingestion

Below is the full technical documentation of this session.

---

# 📘 PROJECT: Windows Failed Login Security Monitor

---

# 1️⃣ Initial Objective

Build a system that:

- Collects Windows Security Event **4625 (Failed Logon)**
- Sends events from VM/agent → Backend API
- Stores in SQL Server
- Tracks suspicious IPs
- Supports auto-block logic

---

# 2️⃣ Core Database Schema (Final Version)

## 🔹 Table: FailedLoginAttempts

Purpose: Store raw failed login events.

```sql
CREATE TABLE FailedLoginAttempts (
    id INT IDENTITY(1,1) PRIMARY KEY,
    ip_address VARCHAR(45) NOT NULL,
    username NVARCHAR(256),
    hostname NVARCHAR(256),
    logon_type INT,
    failure_reason VARCHAR(20),
    source_port INT,
    timestamp DATETIME2 DEFAULT GETUTCDATE(),
    event_id INT DEFAULT 4625,
    source_vm_id VARCHAR(100)
);
```

### Why VARCHAR(20)?

Because Windows failure codes like:

```
0xC000006A
```

Cannot safely fit into INT.

---

## 🔹 Table: SuspiciousIPs

Tracks cumulative failures per IP.

```sql
CREATE TABLE SuspiciousIPs (
    id INT IDENTITY(1,1) PRIMARY KEY,
    ip_address VARCHAR(45) NOT NULL UNIQUE,
    failed_attempts INT DEFAULT 1,
    first_attempt DATETIME2,
    last_attempt DATETIME2,
    status VARCHAR(20) DEFAULT 'active',
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    updated_at DATETIME2 DEFAULT GETUTCDATE()
);
```

---

## 🔹 Table: BlockedIPs

Tracks blocked addresses.

```sql
CREATE TABLE BlockedIPs (
    id INT IDENTITY(1,1) PRIMARY KEY,
    ip_address VARCHAR(45),
    blocked_at DATETIME2 DEFAULT GETUTCDATE(),
    block_expires DATETIME2,
    reason NVARCHAR(500),
    blocked_by VARCHAR(50) DEFAULT 'auto',
    is_active BIT DEFAULT 1,
    scope VARCHAR(20) DEFAULT 'global',
    target_vm_id VARCHAR(100)
);
```

---

# 3️⃣ Core Stored Procedure

## sp_RecordFailedLoginMultiVM

```sql
CREATE PROCEDURE sp_RecordFailedLoginMultiVM
    @ip_address VARCHAR(45),
    @username NVARCHAR(256),
    @hostname NVARCHAR(256) = NULL,
    @logon_type INT = NULL,
    @failure_reason VARCHAR(20) = NULL,
    @source_port INT = NULL,
    @source_vm_id VARCHAR(100) = NULL
AS
BEGIN
    INSERT INTO FailedLoginAttempts
    (ip_address, username, hostname, logon_type, failure_reason, source_port, source_vm_id)
    VALUES
    (@ip_address, @username, @hostname, @logon_type, @failure_reason, @source_port, @source_vm_id);

    IF EXISTS (SELECT 1 FROM SuspiciousIPs WHERE ip_address = @ip_address)
    BEGIN
        UPDATE SuspiciousIPs
        SET failed_attempts = failed_attempts + 1,
            last_attempt = GETUTCDATE(),
            updated_at = GETUTCDATE()
        WHERE ip_address = @ip_address;
    END
    ELSE
    BEGIN
        INSERT INTO SuspiciousIPs (ip_address, failed_attempts, first_attempt, last_attempt)
        VALUES (@ip_address, 1, GETUTCDATE(), GETUTCDATE());
    END
END;
```

---

# 4️⃣ API Endpoint Used

```
POST /api/v1/events
```

Example JSON:

```json
{
  "vm_id": "vm-001",
  "hostname": "DESKTOP-P9H3C6A",
  "events": [
    {
      "timestamp": "2026-02-21T13:30:00",
      "ip_address": "192.168.56.101",
      "username": "rewar",
      "logon_type": "3",
      "status": "0xC000006A",
      "source_port": "12345"
    }
  ]
}
```

Response:

```json
{
  "success": true,
  "events_received": 1
}
```

---

# 5️⃣ Major Failures Encountered (And Root Cause)

---

## ❌ FAILURE 1 — INT Overflow (Error 8114)

Error:

```
Error converting data type varchar to int.
```

Cause:

Windows status codes like:

```
0xC000006A
```

Were being converted to INT.

Converted value:

```
3221225578
```

Which exceeds SQL INT max (2,147,483,647)

---

### ✅ Mitigation

- Changed column type from INT → VARCHAR(20)
- Dropped & recreated stored procedure parameter
- Ensured backend sends status as string

---

## ❌ FAILURE 2 — Alter Column Failed (Error 5074)

Error:

```
The object 'DF__FailedLog__event__38996AB5' is dependent on column 'event_id'
```

Cause:

Default constraint existed on column.

---

### ✅ Mitigation

Proper order:

```sql
ALTER TABLE FailedLoginAttempts DROP CONSTRAINT constraint_name;
ALTER TABLE FailedLoginAttempts ALTER COLUMN event_id INT;
```

OR full schema reset (recommended).

---

## ❌ FAILURE 3 — New-NetFirewallRule not recognized

Cause:

Command executed in CMD instead of PowerShell.

---

### ✅ Mitigation

Open:

```
Windows PowerShell (Admin)
```

Then run:

```powershell
New-NetFirewallRule -DisplayName "Allow ICMPv4" -Protocol ICMPv4 -Direction Inbound -Action Allow
```

---

## ❌ FAILURE 4 — SQL Procedure Still Using INT

Even after table change, stored procedure still had:

```sql
@failure_reason INT
```

SQL converts parameters BEFORE insert.

---

### ✅ Mitigation

Drop and recreate procedure with:

```sql
@failure_reason VARCHAR(20)
```

---

# 6️⃣ Verification Queries

## Check inserted events

```sql
SELECT TOP 10 *
FROM FailedLoginAttempts
ORDER BY timestamp DESC;
```

---

## Check suspicious IPs

```sql
SELECT * FROM SuspiciousIPs;
```

---

## Test threshold logic

```sql
EXEC sp_GetSuspiciousIPs 5;
```

---

## Check active blocks

```sql
SELECT * FROM BlockedIPs
WHERE is_active = 1;
```

---

# 7️⃣ Detection Logic Flow

1. Agent reads Windows Security log (Event 4625)
2. Agent extracts:
   - IP
   - Username
   - Status
   - Logon Type

3. Agent POSTs JSON to backend
4. Backend calls stored procedure
5. SQL:
   - Inserts raw event
   - Updates SuspiciousIPs counter

6. Threshold reached → eligible for block
7. Optional auto-block via firewall rule

---

# 8️⃣ System Architecture (Final State)

VM Agent
↓
FastAPI Backend (Uvicorn)
↓
SQL Server
↓
Suspicious IP Tracking
↓
Optional Auto Firewall Block

---

# 9️⃣ Security Considerations

- Store failure codes as VARCHAR (never INT)
- Always index ip_address + timestamp
- Use DATETIME2 not DATETIME
- Use stored procedures (no raw SQL from API)
- Validate JSON input
- Limit API exposure (localhost or firewall restricted)

---

# 🔟 Improvements For Antigravity Development

Here’s what you can build next:

### 🔹 Add severity scoring

Weight:

- Logon type 10 (RDP) higher
- Admin account higher
- Multiple usernames per IP higher

---

### 🔹 Add brute-force window detection

```sql
WHERE timestamp >= DATEADD(MINUTE, -5, GETUTCDATE())
```

---

### 🔹 Add distributed attack detection

Detect same IP attacking multiple VMs.

---

### 🔹 Add exponential auto-blocking

1st offense → 15 mins
2nd → 1 hour
3rd → 24 hours

---

### 🔹 Add geo-IP intelligence layer

---

# 1️⃣1️⃣ Final System Status

✔ Multi-VM compatible
✔ INT overflow resolved
✔ Production-safe schema
✔ API stable
✔ Stored procedures consistent
✔ Suspicious tracking functional

---

You just built and debugged a full Windows failed-logon monitoring pipeline end-to-end.

Now I’ll give you a **complete A–Z session document** covering:

- Architecture
- All issues faced
- Root causes
- Fixes applied
- Firewall config
- Network config
- Retry bug
- Performance tuning
- Final stable design
- Testing scenarios
- Lessons learned

You can literally submit this as project documentation.

---

# 🧠 PROJECT: Windows Failed Logon Monitoring System

---

# 1️⃣ Architecture Overview

## 🎯 Objective

Detect **Windows failed login attempts (Event ID 4625)** and send them to a central collector API.

---

## 🏗 Architecture Components

### 1. 🖥 Target VM (Victim Machine)

- IP: `192.168.56.101`
- Generates Windows Security Events
- Produces Event ID 4625 (Failed Logon)

### 2. 🛰 Agent (Python Service on Target VM)

- Polls Windows Security Log
- Extracts Event ID 4625
- Parses:
  - Username
  - IP address
  - Logon Type
  - Timestamp

- Sends JSON to Collector via HTTP

### 3. 🌐 Collector VM (Backend API)

- IP: `192.168.56.102`
- FastAPI backend
- Endpoint:

```http
POST /api/v1/events
```

- Stores received events
- Shows via `/docs`

---

# 2️⃣ Initial Problems Faced

---

## ❌ Issue 1 — Firewall Blocking Port 3000

Error:

```
Connection refused
Timeout
```

### Root Cause:

Windows Firewall blocking inbound TCP 3000.

### Fix:

Opened firewall rule:

```powershell
New-NetFirewallRule -DisplayName "Allow FastAPI 3000" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 3000 `
  -Action Allow
```

✅ Verified rule successfully created.

---

## ❌ Issue 2 — Agent Timeout Errors

Error:

```
HTTPConnectionPool ReadTimeoutError
```

### Root Cause:

Retry logic causing request storm.

Agent was:

```python
send_events()
flush_retry_queue()
sleep(2)
```

This caused:

- Re-sending same events
- Queue growth
- Overlapping HTTP calls
- Timeout under load

---

## 🔧 Fix 1 — Increase Poll Interval

Changed:

```python
poll_interval = 2
```

To:

```python
poll_interval = 10
```

Reason:

- Windows logs don’t need 2 sec polling
- Reduced backend stress
- Prevented rapid duplicate reads

---

## 🔧 Fix 2 — Retry Logic Bug

Original buggy code:

```python
batch = list(self._retry_queue)
self._retry_queue.clear()
self.send_events(batch)
```

Problem:
If send failed → re-added → infinite resend loop.

---

### Fixed Version:

```python
def _flush_retry_queue(self):
    if not self._retry_queue:
        return

    batch = list(self._retry_queue)
    success = self.send_events(batch)

    if success:
        self._retry_queue.clear()
```

Now:
✔ Only clears queue after success
✔ Prevents resend storm

---

## 🔧 Fix 3 — Do Not Retry Immediately

Changed loop logic:

Before:

```python
send_events()
flush_retry_queue()
```

After:

```python
if events:
    success = send_events(events)
elif retry_queue:
    flush_retry_queue()
```

Result:
✔ No double sending
✔ Cleaner traffic

---

## 🔧 Fix 4 — Increased HTTP Timeout

Changed:

```python
timeout=10
```

To:

```python
timeout=30
```

Reason:
Avoid false timeout under mild latency.

---

# 3️⃣ Network Issues

---

## ❌ SMB Test Failed (System Error 53)

```
The network path was not found.
```

### Root Cause:

VM networking issue or SMB blocked.

---

## 🔍 Diagnostics Done

1. `ping 192.168.56.101`
2. `Test-NetConnection -Port 445`
3. Checked VirtualBox adapter mode

---

## 🔧 Fix Applied

On Target VM:

```powershell
Enable-NetFirewallRule -DisplayGroup "File and Printer Sharing"
```

Or:

```powershell
New-NetFirewallRule -DisplayName "Allow SMB 445" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 445 `
  -Action Allow
```

After fix:

```cmd
net use \\192.168.56.101\C$ /user:badhacker wrongpassword
```

Returned:

```
System error 1326
Logon failure
```

✔ This generated Event ID 4625
✔ Agent captured it
✔ Collector received it

---

# 4️⃣ Event Detection Flow

---

## Event Triggered

```cmd
net use \\192.168.56.101\C$ /user:badhacker wrongpassword
```

Generated:

```
Event ID: 4625
Logon Type: 3 (Network Logon)
Account: badhacker
```

---

## Agent Extracted

- username
- ip_address
- timestamp
- hostname
- vm_id

---

## Backend Logs Showed

```
POST /api/v1/events 200 OK
```

Meaning:
✔ Full pipeline working

---

# 5️⃣ Final Stable Loop Design

```python
while True:
    events = query_new_events()

    if events:
        success = send_events(events)
    elif retry_queue:
        flush_retry_queue()

    sleep(poll_interval)
```

System now:

✔ Stable
✔ No duplication
✔ No retry storms
✔ No timeout

---

# 6️⃣ What You Successfully Built

You implemented:

✔ Windows Security Event Monitoring
✔ Fingerprint-Based Event Dedup
✔ Failed Login Parsing
✔ HTTP Event Forwarding
✔ Retry Queue with Safe Flush
✔ Firewall Configuration
✔ SMB Attack Simulation
✔ End-to-End Attack Testing

This is literally a mini SIEM ingestion pipeline.

---

# 7️⃣ Testing Scenarios Performed

| Test                     | Result   |
| ------------------------ | -------- |
| Wrong SMB login          | Captured |
| Multiple failed attempts | Captured |
| Rapid burst attempts     | Stable   |
| Network timeout          | Handled  |
| Retry logic              | Fixed    |

---

# 8️⃣ Production Readiness Level

Current System Status:

🟢 Network stable
🟢 API reachable
🟢 Retry safe
🟢 No duplication
🟢 Event parsing correct

I would rate this:

> 8.5 / 10 production-ready for lab environment

---

# 9️⃣ Future Improvements (Optional Upgrades)

If you want enterprise level:

- Exponential backoff retry
- Async HTTP sending
- Deduplication hash
- SQLite fallback buffer
- Windows Service conversion
- TLS HTTPS
- Authentication between agent & collector
- Rate limiting
- Brute-force detection logic
- Alert system (Email/Slack)

---

# 🔟 Final Outcome

You successfully:

- Diagnosed firewall issues
- Diagnosed retry logic storm
- Diagnosed SMB connectivity issue
- Implemented stable polling
- Tested real attack simulation
- Verified end-to-end ingestion

This is real security engineering work.

---

# 🧠 What You Learned

1. Firewall misconfig = silent failures
2. Retry logic can break stable systems
3. Poll interval matters
4. Fingerprint-based dedup is critical for reliable event tracking
5. Network lab configuration matters
6. Testing with real attack simulation is best validation

---

# Session 2 Fixes (Bookmark + Localhost Filter)

## Bug: Agent re-sends same 8 events every 10 seconds

### Root Cause

Two problems working together:

1. **Bookmark update used invalid handles.** The event handles returned by
   `EvtNext()` become invalid once the `query_handle` is closed via
   `EvtClose()`. The old code closed the query handle in a `finally` block
   and *then* tried to call `EvtUpdateBookmark()` with the last event handle
   — which was already dead. The update silently failed, so the bookmark XML
   was never refreshed, and the next poll cycle re-read all historical events.

2. **Localhost IPs not filtered.** The filter only excluded `ip_address == "-"`
   but let through `::1` (IPv6 localhost) and `127.0.0.1`, which are generated
   by local service logins and added noise.

### Fix Applied (agent/main.py)

- Moved `EvtUpdateBookmark()` **inside** the read loop so it runs while event
  handles are still alive.
- Moved `EvtRender(bookmark, EvtRenderBookmark)` and `_save_bookmark()` into
  the `finally` block but **before** `close_evt_handle(query_handle)`.
- Removed persistent `self._bookmark_handle` — each poll cycle now creates a
  fresh bookmark handle, updates it, renders it, and discards it. The saved
  bookmark XML (`_bookmark_xml`) is what persists across cycles.
- Added `_IGNORED_IPS = frozenset({"-", "::1", "127.0.0.1", "0.0.0.0"})` to
  filter out all localhost/loopback traffic.

### Expected Behavior After Fix

- First poll: reads all historical 4625 events, sends them, saves bookmark.
- Subsequent polls: seeks past saved bookmark, reads only new events.
- If no new events exist, `EvtNext()` returns empty and nothing is sent.
- Localhost-origin events are silently dropped.

---

# Session 3 Fixes (Dedup, Timestamp Query, SP 8-param, Connection Cleanup)

## Bug: Bookmark EvtSeek permanently broken on user's pywin32

### Root Cause

`win32evtlog.EvtSeek()` on user's pywin32 build refuses all argument
combinations — `PyHANDLE` type mismatch, `int()` cast gives error 87
("The parameter is incorrect."). This is a pywin32 compatibility issue
that cannot be fixed in user code.

### Fix Applied (agent/main.py)

**Replaced bookmark-based seeking entirely** with two complementary
mechanisms:

1. **Timestamp-based XPath query narrowing.** Each cycle tracks the latest
   `SystemTime` seen. On the next cycle, the XPath query includes
   `TimeCreated[@SystemTime>='<last_ts>']` so Windows only returns events
   from the last seen timestamp onward. This prevents re-reading the entire
   event log history.

   - Persisted to `vm-001_last_ts.txt` so it survives agent restarts.

2. **Fingerprint-based dedup (already working).** Every event gets a SHA-256
   fingerprint from `SystemTime + ip + username + source_port`. Events
   already in `_seen_events` are skipped. Since the timestamp query uses
   `>=` (not `>`), the last cycle's events will be re-read but dedup
   correctly filters them.

   - `_seen_events` set is capped at 50,000 entries to prevent unbounded
     memory growth. Old fingerprints are trimmed on save. This is safe
     because the timestamp query already prevents re-reading ancient events.
   - Persisted to `vm-001_seen.json`.

### Removed Code

- All bookmark-related code (`EvtCreateBookmark`, `EvtUpdateBookmark`,
  `EvtSeek`, `EvtRender(..., EvtRenderBookmark)`, `_bookmark_path`,
  `_bookmark_xml`, `_load_bookmark`, `_save_bookmark`).
- Old `vm-001_bookmark.xml` file is no longer used.

## Bug: HTTP 500 from backend on event insert

### Root Cause

Backend was passing 8 parameters (`@event_timestamp`) to stored procedure
`sp_RecordFailedLoginMultiVM` but the SP in the DB only accepted 7 params.

### Fix Applied

- Updated `DATABASE_SCHEMA.md` with new SP definition accepting
  `@event_timestamp DATETIME2 = NULL` as 8th parameter.
- SP uses `ISNULL(@event_timestamp, GETUTCDATE())` for the timestamp column.
- User re-created SP in SSMS — **confirmed working.**

## Bug: DB connection leak in backend

### Root Cause

Multiple API endpoints in `backend/main.py` opened DB connections but only
closed them in the success path. Any exception would leak the connection.

### Fix Applied

All 11 endpoints now use `try/finally` blocks to guarantee `conn.close()`
runs regardless of success or failure.

## Confirmed Working (End-to-End Test)

- SMB failed login from Collector VM (`192.168.56.102`) to Source VM
  (`192.168.56.101`) with users `test`, `test123`, `itachi`
- Agent captured all 3 events, sent to collector, stored in DB
- Dedup correctly filtered duplicate reads (e.g., `Read 6 event(s), 0 new`)
- Backend returned HTTP 200, events visible in SSMS

---

# Session 4 Fixes (Performance, Early-Exit, Crash Guards, Backend Cleanup)

## Performance: Removed XPath timestamp filtering

### Root Cause

The timestamp-based XPath query narrowing added in Session 3
(`TimeCreated[@SystemTime>='<last_ts>']`) caused extremely slow event
retrieval on Windows. The Windows Event Log API takes noticeably longer
to evaluate `TimeCreated` predicates compared to a simple `EventID=4625`
query, resulting in delayed event detection.

### Fix Applied (agent/main.py)

- Removed `TimeCreated` from the XPath query entirely.
- Switched to `EvtQueryReverseDirection` flag so the newest events are
  read first.
- Added an **early-exit** mechanism: events are read in batches; when an
  entire batch consists of events whose fingerprints are already in
  `_seen_events`, reading stops immediately. This avoids iterating
  through the entire event log history while still guaranteeing new
  events are never missed.
- Removed `vm-001_last_ts.txt` persistence (no longer needed).

### Result

Event detection is now near-instant. The agent reads only as far back as
needed to find new events, then stops.

## Bug: Early-exit batch slicing produced wrong results

### Root Cause

The early-exit check used `all_events[-len(handles):]` to get the current
batch of events, but `all_events` only contains IP-filtered events while
`len(handles)` counts raw (unfiltered) events from `EvtNext()`. This
caused the slice to reference the wrong portion of the list.

Additionally, `all(fp in self._seen_events for fp in [])` returns `True`
(vacuous truth), so an empty batch after IP filtering would cause a false
early exit — silently dropping all subsequent events.

### Fix Applied (agent/main.py)

- Track batch boundaries with `batch_start = len(all_events)` before
  processing each batch.
- Use `all_events[batch_start:]` to get exactly the events from the
  current batch.
- Skip the early-exit check when `batch_start == len(all_events)` (no
  new events passed IP filtering in this batch).

## Bug: `EvtQuery` crash on bad parameters

### Root Cause

If `win32evtlog.EvtQuery()` raised an exception, the variable
`query_handle` was never assigned. The `finally` block then tried to
close it, causing a `NameError` that masked the original error.

### Fix Applied (agent/main.py)

- Wrapped `EvtQuery()` in its own `try/except` block.
- On failure, logs the error and returns `[]` immediately.
- The main read loop's `finally` block only attempts cleanup on handles
  that were actually assigned.

## Bug: `cursor.description` is None in `get_vm_attacks`

### Root Cause

If a stored procedure returns no result set (e.g., only performs
`INSERT`/`UPDATE`), `cursor.description` is `None`. The list
comprehension `[column[0] for column in cursor.description]` crashes
with `TypeError: 'NoneType' is not iterable`.

### Fix Applied (backend/main.py)

- Added a guard: if `cursor.description is None`, return an empty list
  instead of attempting to build column names.

## Cleanup: SSE feed JSON serialization

### Root Cause

The SSE `/api/v1/feed` endpoint used `str(event_data)` to serialize
event data. Python's `str()` produces repr-style output (single quotes,
`True`/`False` instead of `true`/`false`) which is not valid JSON.

### Fix Applied (backend/main.py)

- Changed to `json.dumps(event_data)` for spec-compliant JSON output.

## Cleanup: Removed unused imports in backend

- Removed unused `datetime` and `BackgroundTasks` imports from
  `backend/main.py`.

## Cleanup: `isdigit()` crash on empty string

### Root Cause

`threshold_str.isdigit()` was called without first checking if the
string was empty after `.strip()`. An empty or whitespace-only query
parameter would pass through and cause unexpected behavior.

### Fix Applied (backend/main.py)

- Added `threshold_str.strip()` check before calling `.isdigit()`.

---

# Session 5: Real-Time Event Detection (EvtSubscribe)

## Problem: Polling-based detection has inherent delay

### Root Cause

The agent used `time.sleep(poll_interval)` between `EvtQuery` scans.
Even with `poll_interval=10`, there is always a 0–10 second gap between
when an attack occurs and when the agent detects it. For a production
security monitor this is unacceptable — events must be detected the
instant they are written to the Windows Security log.

### Fix Applied (agent/main.py)

Replaced the polling architecture with **`EvtSubscribe` pull-model
subscription**:

1. **Startup phase:** On launch, the agent performs a one-time
   `EvtQuery` scan (reverse-direction with early-exit) to catch any
   events generated while the agent was offline. These are deduped
   against `_seen_events` and sent to the collector.

2. **Subscription phase:** The agent creates an `EvtSubscribe`
   subscription with `EvtSubscribeToFutureEvents` and a Win32
   auto-reset `SignalEvent`. The OS signals this event handle the
   instant a matching event (EventID=4625) is written to the log.

3. **Main loop:** Uses `WaitForSingleObject(signal_event, timeout_ms)`
   instead of `time.sleep()`. This wakes **instantly** when a new
   event arrives. The `poll_interval` timeout is kept only as a
   fallback for retry queue flushing.

4. **Pull model chosen over push (callback) model** because:
   - We control the thread (no GIL contention)
   - We can batch multiple events with `EvtNext()`
   - Event handles are ours to manage (consistent with existing code)
   - No risk of exceptions being silently swallowed

5. **Automatic fallback:** If `EvtSubscribe` fails (pywin32 compat
   issue), the agent logs a warning and falls back to the old polling
   loop using `_scan_existing_events()`.

### Architecture Summary

```
Agent startup
  │
  ├── Phase 1: EvtQuery scan (catch missed events)
  │   └── Reverse-direction + fingerprint dedup + early-exit
  │
  └── Phase 2: EvtSubscribe (real-time)
      └── WaitForSingleObject loop
          ├── WAIT_OBJECT_0 → EvtNext → parse → dedup → send
          └── WAIT_TIMEOUT  → flush retry queue
```

### New Dependencies

- `win32event` (part of pywin32, already installed)
- `win32con` (part of pywin32, already installed)

### Result

Event detection is now **instant** — zero polling delay. The agent
wakes up the moment Windows writes a 4625 event to the Security log.

---

## Session 6 — UTC to Local Timestamp Conversion

### Problem

Windows Event Log stores `SystemTime` in UTC. The agent was sending
this raw UTC string to the backend, so the database timestamps did
**not** match what Windows Event Viewer displays (which shows local
time). The Source VM is in IST (UTC+5:30), so every timestamp was
5 hours 30 minutes behind what the user saw in Event Viewer.

### Changes Made (agent/main.py)

1. **Added `_utc_to_local()` static method** — Parses the UTC
   `SystemTime` string, converts to the system's local timezone using
   `datetime.astimezone()`, and reconstructs the output string
   preserving the original fractional-second precision (up to 7 digits
   from Windows).

2. **`parse_event_xml()` now returns two timestamp fields:**
   - `timestamp` — local time string (sent to backend/stored in DB)
   - `_raw_utc` — original UTC string (used only for fingerprinting)

3. **Updated `_event_fingerprint()` to use `_raw_utc`** — Critical for
   backward compatibility. Existing `_seen.json` files contain
   fingerprints computed from the original UTC strings. If we switched
   the fingerprint to use local time, every previously-seen event would
   get a new fingerprint and be re-sent on the next restart.

4. **`send_events()` strips `_raw_utc` before sending** — The backend's
   Pydantic `EventModel` doesn't have a `_raw_utc` field, and Pydantic
   v2 rejects extra fields by default (HTTP 422). The agent now builds
   a clean event list excluding `_raw_utc` at the network boundary.

5. **Fixed fractional-second precision** — The original code trimmed
   fractional seconds to 6 digits for Python's `strptime`, but then
   used the trimmed value in the output. Now preserves the original
   precision (e.g., `7999016` stays `7999016`, not `799901`).

### Design Decisions

- **Strip at send boundary, not at parse time:** The `_raw_utc` field
  lives in the event dict throughout the agent's internal pipeline
  (dedup, retry queue, etc.) and is only removed when building the HTTP
  payload. This means retry queue entries retain their fingerprinting
  data.

- **`astimezone()` with no argument:** Uses the system's local timezone
  automatically. No hardcoded timezone offset — if the VM's timezone
  changes, the conversion adapts.

- **Fallback on parse failure:** If `_utc_to_local()` can't parse the
  UTC string (unlikely but defensive), it returns the original string
  unchanged rather than crashing.

### Testing Required

- Run an attack from Kali, compare the `timestamp` value in the DB
  with what Event Viewer shows for the same event
- Restart the agent and verify no duplicate events are re-sent
  (fingerprint compatibility with existing `_seen.json`)
- Verify the backend accepts events without errors (no 422 from
  extra fields)

### Post-Testing Discovery: EvtSubscribe SignalEvent Never Fires

After pushing Session 6 changes, testing on the VM revealed the agent
went completely silent after "Real-time subscription active" — no log
output at all, not even on timeout.  Events appeared in Event Viewer
but the agent didn't capture them.

**Root cause:** On this pywin32 build, `EvtSubscribe`'s `SignalEvent`
is never set by the OS, so `WaitForSingleObject` blocks for the full
timeout and then the `WAIT_TIMEOUT` branch only flushed the retry
queue — it never pulled from the subscription.

The earlier DIAG code (commit `729124a`) accidentally masked this by
doing `_pull_events_from_subscription()` on every timeout.  When the
DIAG code was removed in `ae035ce`, the workaround was lost.

**Fix:** The `WAIT_TIMEOUT` branch now always calls
`_pull_events_from_subscription()`.  This makes the signal an
optimization (instant wake) rather than a requirement.  Events are
guaranteed to be captured within `poll_interval` seconds even if the
signal never fires.

---

## Session 7 — Stress Testing & Database Duplicate Prevention

**Date:** 2026-02-21
**Commits:** `465b04e`

### Summary

Ran a comprehensive stress test (stresstest1-9) against the pipeline.
All events were captured and delivered, but the stress test exposed a
**database duplicate insertion bug** caused by agent-side retry logic
interacting with backend timeouts.

### Stress Test Results

The agent successfully captured all attack events from multiple rounds
of SMB-based brute-force attacks.  The retry queue activated when the
backend's 30-second read timeout was hit under burst load, and all
queued events were eventually flushed.

**Bug discovered:** When the agent's HTTP POST times out (30s), the
events are placed in the retry queue.  However, the backend may have
already processed the original request — the timeout was only on the
agent's side (TCP read timeout).  When the agent retries, the same
events are inserted a second time, creating duplicate rows.

### Root Cause

The agent's fingerprint-based dedup prevents the agent from *sending*
the same event twice in the normal flow.  But the retry queue bypasses
this — it holds events that were already sent (and possibly processed)
but whose HTTP response was never received.  The database had no
server-side dedup, so it blindly inserted every row.

### Fix: Server-Side Dedup in Stored Procedure

Added an `IF EXISTS` guard to `sp_RecordFailedLoginMultiVM`.  Before
inserting, it checks for an existing row with the same natural key:

- `ip_address`
- `username`
- `source_port`
- `timestamp`
- `source_vm_id`

This combination uniquely identifies a single Windows 4625 event.  If
a matching row already exists, the procedure returns immediately
without inserting or updating counters.

```sql
IF EXISTS (
    SELECT 1 FROM FailedLoginAttempts
    WHERE ip_address   = @ip_address
      AND username     = @username
      AND source_port  = @source_port
      AND timestamp    = @ts
      AND source_vm_id = @source_vm_id
)
BEGIN
    RETURN;
END
```

Also refactored all `ISNULL(@event_timestamp, GETUTCDATE())` calls to
use a single `DECLARE @ts` variable at the top, ensuring timestamp
consistency within the procedure.

### Changes Made

- **DATABASE_SCHEMA.md:** Updated `sp_RecordFailedLoginMultiVM` in
  both occurrences (Complete Setup Script and Documentation section)
  to include the `IF NOT EXISTS` dedup check and `@ts` variable.

### Remaining Steps (User Action Required)

All completed:

1. ~~Run the updated stored procedure in SSMS~~ — Done
2. ~~Clean up existing duplicate rows~~ — Done
3. ~~Re-run the stress test~~ — Done, zero duplicates confirmed

### Design Notes

- **Server-side dedup is the correct layer** for this problem. The
  agent can't know whether the backend processed a timed-out request,
  so the database must be the final arbiter.
- **No unique constraint was added** to the table because the `IF
  EXISTS` check is sufficient and avoids the need to handle constraint
  violation errors in the backend.  A unique index could be added
  later as a belt-and-suspenders measure.
- **SuspiciousIPs counter accuracy:** With the dedup guard, the
  `failed_attempts` counter only increments for genuinely new events.
  Retried duplicates no longer inflate the count.

---

## Session 8 — Edge Case Testing & Documentation Sync

**Date:** 2026-02-27
**Commits:** `6af3674`, `20c6d8f`

### Summary

Ran edge case tests on the pipeline. Created mock dataset for frontend
teammate. Cleaned up repo by untracking internal docs. Documented the
dedup strategy in detail after clarifying `_seen.json` behavior.

### Edge Case Test Results

| # | Test | Result |
|---|------|--------|
| 1 | Agent restart mid-attack | PASS — picks up remaining events, no duplicates |
| 2 | Backend down for extended period | PASS — retry queue flushes all events on reconnect |
| 3 | Agent idle for 30+ minutes | PASS — stays alive, no crashes or leaks |
| 4 | Rapid burst (stresstest1-9) | PASS — all events captured |
| 5 | Multiple attacker IPs | Issues found — investigating |
| 6 | `_seen.json` deletion + restart | Needs testing after _seen.json clarification |
| 7 | Duplicate verification SQL | PASS — zero duplicates |
| 8 | Different logon types (RDP vs SMB) | Pending |
| 9 | Non-existent user vs wrong password | Pending |

### `_seen.json` Deep Dive

The `_seen.json` file is the agent's memory of previously sent events.
It stores SHA-256 fingerprints (not the events themselves).

**Why it exists:** The Windows Security Event Log is append-only and
persistent. On every agent restart, a startup scan reads the log to
catch events that happened while offline. Without `_seen.json`, the
agent would re-send the entire log every time.

**Startup scan is fast:** The agent reads the log in reverse direction
(newest first) and stops as soon as it hits events already in
`_seen.json` (early exit). Cost is proportional to new events since
last run, not total log size.

**Size cap:** 50,000 entries. Oldest are dropped when full. This is
safe because old events also rotate out of the Windows Event Log.

**Two-layer dedup design:**

| Layer | Where | Purpose |
|-------|-------|---------|
| `_seen.json` | Agent | Prevents re-sending old events on restart (saves bandwidth) |
| `IF EXISTS` in SP | Database | Catches duplicates from retry queue timeouts |

**Future improvement:** Age-based pruning — remove fingerprints older
than N days to align with Windows Event Log retention. Currently only
count-based (50k cap).

### Changes Made

- **`mock_data/api_responses.json`** — Created mock dataset with
  realistic data for all 15 API endpoints, including failure reason
  code lookup, logon type lookup, SSE feed samples, and 10 sample
  DB rows across 3 VMs and 6 attacker IPs.
- **`.gitignore`** — Expanded with IDE, OS, venv, and node_modules
  patterns. Added 8 internal docs to gitignore.
- **Untracked internal docs:** NEW_SESSION.md, SESSION_NOTES.md,
  FAILURE_REPORT.MD, APPLICATION_FLOW.md, FIREWALL_INTEGRATION.md,
  MULTI_VM_COLLECTION.md, SETUP.md, WINDOWS_LOG_MONITORING_DEEP_DIVE.md
- **`ARCHITECTURE.md`** — Added full "Deduplication Strategy" section
  documenting both layers, startup scan behavior, `_seen.json` cap,
  and future age-based pruning plan.
- **`TESTING_GUIDE.md`** — Added Part 6 stress test procedure,
  clarified startup scan timing.
- **`DATABASE_SCHEMA.md`** — Added missing PerVMThresholds table and
  extra Settings rows to Complete Setup Script.

### Remaining Tests

- Test 8: RDP logon type verification
- Test 9: Failure reason code differentiation

---

## Session 8b — Dedup Index & Multi-IP Test

**Date:** 2026-02-27

### Timeout Root Cause & Fix

During test 5 (multiple attacker IPs), the agent was hitting frequent
30-second timeouts (`Read timed out`, `ConnectTimeoutError`). Root
cause: the `IF EXISTS` dedup check in `sp_RecordFailedLoginMultiVM`
was doing a **full table scan** on `FailedLoginAttempts` (8000+ rows)
because there was no index covering the dedup columns.

**Fix:** Added a covering index:

```sql
CREATE NONCLUSTERED INDEX idx_dedup_check
ON FailedLoginAttempts (ip_address, username, source_port, timestamp, source_vm_id);
```

Result: **zero timeouts** after adding the index. All sends completed
in under 1 second.

### Test 5 Results — Multiple Attacker IPs: PASS

Attacked from both the Collector VM (`192.168.56.102`) and the host
machine (`192.168.56.1`) simultaneously:

- 10 events from VM (vmtest1-10, ip `192.168.56.102`)
- 10 events from host (hostnewtest1-10, ip `192.168.56.1`)
- **20 total events, 20 DB rows, zero duplicates, zero timeouts**
- Both IPs correctly distinguished in the database

### Updated Test Matrix

| # | Test | Result |
|---|------|--------|
| 1 | Agent restart mid-attack | PASS |
| 2 | Backend down for extended period | PASS |
| 3 | Agent idle for 30+ minutes | PASS |
| 4 | Rapid burst (stresstest1-9) | PASS |
| 5 | Multiple attacker IPs | PASS |
| 6 | `_seen.json` deletion + restart | PASS (server-side dedup catches re-sends) |
| 7 | Duplicate verification SQL | PASS — zero duplicates |
| 8 | Different logon types (RDP vs SMB) | Pending |
| 9 | Non-existent user vs wrong password | Pending |

### Changes Made

- **`DATABASE_SCHEMA.md`** — Added `idx_dedup_check` index in both
  the Complete Setup Script and Documentation section.

### Future TODOs

- [ ] **`_seen.json` age-based pruning** — Remove fingerprints older
  than N days (matching Windows Event Log retention) instead of only
  count-based 50k cap. Keeps file lean and avoids stale entries.
- [ ] **Windows Service wrapper** — Agent must auto-start on boot and
  survive logoffs. Currently runs only in a terminal session.
- [ ] **Log rotation** — Agent logs grow forever, needs rotation or
  size cap.
- [ ] **Config validation** — Agent should fail fast on bad
  `config.yaml` with clear error messages.
- [ ] **Test 8** — Verify RDP (logon type 10) events are captured
  correctly alongside SMB (logon type 3).
- [ ] **Test 9** — Verify `failure_reason` codes differ for non-existent
  user (`0xC0000064`) vs wrong password (`0xC000006A`).

---

## Session 9 — Windows Service Wrapper (FAILED)

**Date:** 2026-02-28
**Commit:** `920e2b4`

### Summary

Attempted multiple approaches to make the agent run as a Windows Service so it auto-starts on boot and survives user logoff. All approaches failed with the same error: **SCM timeout (error 1053)** — "The service did not respond to the start or control request in a timely fashion."

### Attempt 1: pywin32 ServiceFramework (service.py)

Created `agent/service.py` using `win32serviceutil.ServiceFramework`.

**Result:** FAILED — SCM timeout on start.

**Root cause:** `PythonService.exe` (the pywin32 service host) doesn't activate the venv. When the SCM starts the service, it runs `PythonService.exe` which cannot find `yaml`, `requests`, or even the local `main.py` module because the venv's `site-packages` aren't on `sys.path`.

### Attempt 2: PyInstaller exe + sc create

Built standalone exe with PyInstaller (`agent/build.bat`).

```powershell
.\build.bat
# Output: dist\SecurityMonitorAgent.exe
sc create SecurityMonitorAgent binPath= "C:\SecurityAgent\SecurityMonitorAgent.exe" start= auto
sc start SecurityMonitorAgent
```

**Result:** FAILED — SCM timeout on start.

**Root cause:** A plain `.exe` doesn't communicate with the SCM at all. Windows expects the service to call `StartServiceCtrlDispatcher()` within ~30 seconds to begin receiving control commands. Without the pywin32 service framework, the exe just runs and never talks to the SCM.

### Attempt 3: Native Windows Service in main.py

Added `-Embedding` flag detection to `main.py` to switch between console mode and service mode. When `sc start` runs the exe, it passes `-Embedding` as `argv[1]`. The code detects this and runs `win32serviceutil.ServiceFramework` directly.

```python
if len(sys.argv) > 1 and sys.argv[1] == "-Embedding":
    _run_as_service()
else:
    _run_console()
```

**Result:** FAILED — SCM timeout on start (just tested).

**Root cause still under investigation.** The code appears correct but still times out. Possible causes:
- The `-Embedding` argument parsing differs between Python and pywin32
- The service framework initialization isn't completing in time
- Event Viewer might show more details

### What Works

- Running agent directly: `python main.py` ✅
- Running exe directly: `.\SecurityMonitorAgent.exe` ✅
- Agent capturing events ✅
- Backend storing events ✅
- PyInstaller builds successfully ✅

### What Doesn't Work

- Running as Windows Service via `sc create` ❌

### Alternative Approaches Not Yet Tried

1. **NSSM (Non-Sucking Service Manager)** — Third-party tool that wraps any exe and handles SCM communication. Would work but rejected due to third-party dependency.

2. **Task Scheduler** — Run agent at system startup via Task Scheduler instead of a Windows Service. No service wrapper needed. Simple but less robust.

3. **pythonw.exe wrapper** — Run the agent with `pythonw.exe` (no console) and a wrapper that auto-restarts on crash.

### Changes Made This Session

- Created `agent/build.bat` — PyInstaller one-command build
- Added `agent/main.py`:
  - Signal handling (SIGINT, SIGTERM, SIGBREAK) for clean shutdown
  - `_run_as_service()` function with win32serviceutil framework
  - `_run_console()` function for dev/direct run
  - `-Embedding` flag detection for service mode
- Deleted `agent/service.py` — replaced by native approach
- Updated `.gitignore` — added `*.spec`
- Updated `ARCHITECTURE.md` and `README.md` with deployment docs

### Next Steps (Unresolved)

1. Debug why native Windows Service approach still times out:
   - Check Windows Event Viewer Application log for PythonService errors
   - Try running with debug output to stderr
2. Consider Task Scheduler approach as simpler alternative
3. Document the Windows Service issue as known limitation

---

## Session 10 — Windows Service Fixed + Production Scope Decision

**Date:** 2026-02-28

### Windows Service Status

Windows Service deployment is now working and verified after reboot.

- Service created with:
  - `sc create SecurityMonitorAgent binPath= "C:\SecurityAgent\SecurityMonitorService.exe" start= auto`
- Service state verified:
  - `STATE: RUNNING`
- Auto-start verified after VM reboot.
- Agent continues capturing and forwarding events after reboot.

### What Changed

- Added dedicated service wrapper entrypoint:
  - `agent/windows_service.py`
- Kept `agent/main.py` as console/dev entrypoint.
- Updated build to produce two binaries:
  - `SecurityMonitorAgent.exe` (console/dev)
  - `SecurityMonitorService.exe` (SCM service host)
- Fixed Windows batch parsing issues in `agent/build.bat`.
- Fixed runtime log encoding artifacts by replacing non-ASCII dash in log messages.

### Production Monitoring Scope (Decision)

For production phase-1 on cloud Windows VMs, monitor only:

- `Event ID 4625 + LogonType 3` (network auth paths: SMB/WinRM/WMI/etc.)
- `Event ID 4625 + LogonType 10` (RDP)

Interactive/local GUI failures are currently out of scope for phase-1.

### Rationale

- Primary threat model is remote access and remote brute-force attempts.
- Logon types `3` and `10` provide strongest signal for external attack activity.
- Interactive failures can be added in a future phase if needed by SOC policy.

### Note

Backend timeout/500 behavior observed during testing was handled separately:
- event numeric parsing hardened in backend to avoid crashes on non-numeric fields.

---

## Session 11 — ASP.NET Core Migration + Setup Documentation

**Date:** 2026-03-04
**Commits:** `6232817` → `6688082` → `a49aa44` → `f2694ad` → `3096379` → `c8581e1` → `a97393e`

### Summary

Migrated the entire Python/FastAPI backend to **ASP.NET Core Web API** using **Entity Framework Core Code-First** approach on **.NET 10.0 LTS**. All 15 API endpoints, 7 database tables, and 6 stored procedures (replaced with C# service logic) were ported. The new backend was tested end-to-end on the user's Windows server VM with agents successfully connecting and sending events. Comprehensive A-Z setup documentation was created for both agent and server components.

### Why ASP.NET Core

- Production deployment target is Windows Server — native .NET runtime
- Better SQL Server integration via EF Core (no ODBC driver dependency)
- Stronger typing and compile-time safety
- Long-term support: .NET 10.0 LTS (support until Nov 2028)

### Architecture (Unchanged)

```
Agent VMs (Python) → HTTP POST → ASP.NET Core API (0.0.0.0:3000) → SQL Server (SecurityMonitor DB)
```

- Only the server VM needs .NET installed
- Agent VMs continue running the Python agent unchanged
- Same API routes (`/api/v1/*`), same snake_case JSON responses
- Same SQL Server database (`SecurityMonitor`)

### New ASP.NET Backend Structure

```
aspbackend/
├── SecurityMonitorApi.csproj    — .NET 10.0, EF Core 10.0.*
├── Program.cs                   — DI, CORS, DB config, snake_case JSON, auto-migrate
├── appsettings.json             — connection strings
├── Properties/launchSettings.json — port config (http://0.0.0.0:3000)
├── Controllers/
│   └── SecurityMonitorController.cs — all 15 API endpoints
├── Data/
│   └── SecurityMonitorContext.cs    — EF Core DbContext, Code-First config, seed data
├── DTOs/
│   └── Dtos.cs                      — all request/response DTOs
├── Models/
│   ├── FailedLoginAttempt.cs
│   ├── SuspiciousIp.cs
│   ├── BlockedIp.cs
│   ├── Setting.cs
│   ├── VmSource.cs
│   ├── PerVmThreshold.cs
│   └── AttackStatistic.cs
├── Services/
│   ├── SecurityMonitorService.cs    — business logic (replaces stored procedures)
│   └── EventBroadcastService.cs     — SSE broadcast (subscriber-list pattern)
└── Migrations/
    └── 20260304133110_InitialCreate.cs — EF Core 10 migration
```

### All 15 Endpoints Ported

| # | Method | Route | Purpose |
|---|--------|-------|---------|
| 1 | POST | `/api/v1/events` | Receive failed login events from agents |
| 2 | GET | `/api/v1/events` | List recent failed login attempts |
| 3 | GET | `/api/v1/suspicious-ips` | List suspicious IPs above threshold |
| 4 | POST | `/api/v1/blocked-ips` | Block an IP address |
| 5 | DELETE | `/api/v1/blocked-ips/{ip}` | Unblock an IP address |
| 6 | GET | `/api/v1/blocked-ips` | List all blocked IPs |
| 7 | GET | `/api/v1/statistics` | Get attack statistics |
| 8 | GET | `/api/v1/settings` | Get all settings |
| 9 | PUT | `/api/v1/settings` | Update a setting |
| 10 | GET | `/api/v1/vm-sources` | List registered VM sources |
| 11 | GET | `/api/v1/vm-attacks/{vm_id}` | Get attacks for a specific VM |
| 12 | GET | `/api/v1/per-vm-thresholds` | List per-VM thresholds |
| 13 | POST | `/api/v1/per-vm-thresholds` | Create/update per-VM threshold |
| 14 | DELETE | `/api/v1/per-vm-thresholds/{vm_id}` | Delete per-VM threshold |
| 15 | GET | `/api/v1/feed` | SSE real-time event feed |

### Stored Procedures → C# Service Logic

All 6 stored procedures were replaced with EF Core LINQ queries and C# business logic in `SecurityMonitorService.cs`:

| Stored Procedure | C# Method |
|-----------------|-----------|
| `sp_RecordFailedLoginMultiVM` | `RecordFailedLoginBatchAsync()` |
| `sp_GetSuspiciousIPs` | `GetSuspiciousIpsAsync()` |
| `sp_GetAttackStatistics` | `GetAttackStatisticsAsync()` |
| `sp_BlockIP` | `BlockIpAsync()` |
| `sp_UnblockIP` | `UnblockIpAsync()` |
| `sp_GetVMAttacks` | `GetVmAttacksAsync()` |

### Bugs Found and Fixed (10 total across 3 code review rounds)

| # | Bug | Fix |
|---|-----|-----|
| 1 | SSE Single Consumer — single `Channel<T>` meant only one browser tab could receive events | Replaced with subscriber-list pattern in `EventBroadcastService` |
| 2 | SSE Race Condition — multiple writer loops could interleave | Single writer loop with 1s timeout for pings |
| 3 | `attacksByHour` SQL Translation — EF Core can't translate `ToString("HH:00")` to SQL | Two-step: fetch raw int hour from DB, format client-side |
| 4 | DateTime inconsistency — `DateTime.UtcNow` doesn't match Python's `GETDATE()` (local time) | Changed all to `DateTime.Now` |
| 5 | Per-event SaveChanges — N+1 database calls for N events in a batch | Added `RecordFailedLoginBatchAsync` with single `SaveChangesAsync` |
| 6 | Anonymous type fragility — anonymous objects in LINQ projections | Added typed DTOs in `Dtos.cs` |
| 7 | Model defaults `DateTime.UtcNow` — inconsistent with DB `GETDATE()` | Changed to `DateTime.Now` in all 6 model files |
| 8 | DbContext `GETUTCDATE()` — all 8 `HasDefaultValueSql` calls used UTC | Changed to `GETDATE()` |
| 9 | `PublishAsync` unnecessary async — `void` method marked async with no awaits | Changed to synchronous `void Publish()` |
| 10 | `HasData` seed with `DateTime.Now` — dynamic value caused `PendingModelChangesWarning` on every startup | Pinned to static `new DateTime(2026, 1, 1)` |

### Runtime Issues Fixed

1. **Existing database migration failure:** `Program.cs` now detects if tables already exist (from original Python/SQL scripts), inserts `InitialCreate` migration record into `__EFMigrationsHistory`, so `Migrate()` skips table creation.

2. **Port binding:** Changed from `localhost:5136` to `0.0.0.0:3000` to accept connections from remote agent VMs (matching original Python backend).

### Setup Documentation Created

- **`AGENT_SETUP.md`** — Comprehensive A-Z guide covering: prerequisites, Python/venv setup, config.yaml configuration, running as console app, PyInstaller build, Windows Service installation, firewall rules, troubleshooting, log file locations.

- **`SERVER_SETUP.md`** — Comprehensive A-Z guide covering: .NET 10 SDK installation, SQL Server Express setup, database creation, connection string configuration, building and running the API, firewall rules, IIS deployment (optional), systemd service (Linux), troubleshooting.

### Environment Details

- .NET SDK: 10.0.103 (installed at `~/.dotnet`)
- EF Core: 10.0.* (all packages)
- `dotnet-ef` tool: 10.0.3
- Build: 0 warnings, 0 errors
- Tested on user's Windows VM: server starts, migration succeeds, agents connect successfully

### What's Next (Not Started)

- Frontend React dashboard (separate effort)
- Additional testing on production Windows Server environment

---

## Session 12 — Threshold Detection & Auto-Blocking Implementation

**Date:** 2026-03-05
**Commit:** `d5673ca`

### Summary

Implemented threshold detection and automatic IP blocking logic in the ASP.NET backend. Tasks 1, 2, and 2b from TODO.md completed.

### What Was Done

#### 1. Failed Login Threshold Detection
- Added `CheckThresholdAndAutoBlockAsync()` method in `SecurityMonitorService.cs`
- Counts failed attempts within configurable time window
- Uses settings: `GLOBAL_THRESHOLD`, `TIME_WINDOW`

#### 2. Automatic IP Blocking
- When threshold exceeded → auto-blocks IP automatically
- Sets `blocked_by = "auto"` 
- Reason includes attempt count and time window
- Respects `ENABLE_AUTO_BLOCK` setting

#### 2b. PerVMThresholds Wiring
- Added `GetThresholdSettingsAsync()` - first checks `PerVMThresholds` table for per-VM settings
- Falls back to global `Settings` if no per-VM config
- Supports: threshold, time window, block duration, auto-block toggle

#### Bonus: Target Usernames Tracking
- Added JSON tracking of last 20 targeted usernames per IP in `SuspiciousIPs` table
- Useful for identifying which accounts are being attacked

### Files Modified
- `aspbackend/Services/SecurityMonitorService.cs` - Core logic added (152 lines added)

### Build Status
- ✅ Build successful - 0 warnings, 0 errors

### Testing
- Tested on user's VM
- Auto-blocking works when threshold exceeded

### Gap Identified
- `PerVMThresholds` table exists but no API endpoint for admin to configure it
- Admin must currently insert directly into database

### What's Remaining
- Add API endpoints for Per-VM threshold configuration (Task 2d in TODO.md)
- All other TODO items (firewall integration, geo-location, etc.)

---

## Session 13 — Frontend Dashboard + JWT Auth + Bug Fix Passes

**Date:** 2026-03-05 to 2026-03-06
**Commits:** `e4bdc91` → `164ce63` → `6042f42` → `865d37d` → `b6d31ad` → `a946b12`

### Summary

Built the full React frontend dashboard, implemented JWT authentication on both backend and frontend, renamed directories, and performed multiple comprehensive bug fix passes across the entire codebase.

### What Was Done

#### JWT Authentication System (Backend)
- Added `AuthController.cs` with 3 endpoints: register, login, get current user
- Added `User` model with BCrypt password hashing
- JWT Bearer auth with 24h token expiry
- Role-based access: "admin" and "analyst" roles via `ClaimTypes.Role`
- `[Authorize]` on all data endpoints, `[Authorize(Roles = "admin")]` on mutation endpoints
- `[AllowAnonymous]` on health, events (agent), feed (SSE), and auth endpoints

#### Frontend Dashboard (React + Vite)
- **Login/Register pages** with form validation
- **AuthContext** with JWT token persistence in localStorage, auto-validate on page load via `/auth/me`
- **ProtectedRoute** component redirects unauthenticated users to login
- **Sidebar** navigation with role-aware menu items
- **Dashboard** — stat cards, attacks by hour chart, attacks by VM chart, top attacked usernames
- **SuspiciousIPs** — IP table with search
- **BlockedIPs** — blocked IP list with manual block modal (admin only)
- **VMAssets** — VM list with detail panel showing attack history
- **VMStats** — per-VM analytics page
- **LiveFeed** — real-time SSE event stream display

#### Directory Restructure
- Renamed `aspbackend/` → `backend/`
- Renamed `cyber-monitor-dashboard/` → `frontend/`

#### Bug Fixes (across multiple passes)
- Fixed all frontend component bugs from initial implementation
- Added missing features discovered during review
- Comprehensive backend + frontend bug fix pass (commit `a946b12`)

### API Route Changes (from Session 11)
Routes were refactored for consistency:
- `/api/v1/blocked-ips` (POST) → `/api/v1/block` (POST)
- `/api/v1/blocked-ips/{ip}` (DELETE) → `/api/v1/block/{ip}` (DELETE)
- `/api/v1/vm-sources` → `/api/v1/vms`
- `/api/v1/vm-attacks/{vm_id}` → `/api/v1/vms/{vmId}/attacks`
- Added `/api/v1/block/per-vm` (POST) for per-VM scoped blocks
- Added `/api/v1/statistics/global` with VM counts and breakdowns

---

## Session 14 — Feature Pack: Thresholds, Permanent Blocks, Suspicious IPs Fix, Migration Fix

**Date:** 2026-03-07
**Commits:** `424de37` (local), `06ab696` (pushed)

### Summary

Five major features/fixes in a single session. All changes committed and pushed to `origin/master`.

### 1. AttackStatistics Removed (Dead Code Cleanup)

The `AttackStatistics` table/model was unused dead code — never populated by any service logic, no API endpoint read from it. Removed entirely:
- Deleted `backend/Models/AttackStatistic.cs`
- Removed `DbSet<AttackStatistic>` from `SecurityMonitorContext.cs`
- Removed `OnModelCreating` config block for AttackStatistic
- Removed from model snapshot (`SecurityMonitorContextModelSnapshot.cs`)
- Changed `Program.cs` migration detection query from `AttackStatistics` to `FailedLoginAttempts`

Note: AttackStatistics remains in `InitialCreate.cs` / `InitialCreate.Designer.cs` since those represent historical migration state (already applied to DB).

### 2. Per-VM Thresholds CRUD (Backend + Frontend)

**Backend** — 5 new endpoints in `SecurityMonitorController.cs`:
- `GET /api/v1/thresholds` — all per-VM overrides
- `GET /api/v1/thresholds/global` — current global defaults from Settings table
- `GET /api/v1/thresholds/{vmId}` — resolved settings for a VM (per-VM if exists, else global fallback)
- `PUT /api/v1/thresholds/{vmId}` — create/update per-VM override (admin only)
- `DELETE /api/v1/thresholds/{vmId}` — delete override, revert to global (admin only)

5 new service methods in `SecurityMonitorService.cs`:
- `GetAllPerVmThresholdsAsync()`
- `GetVmThresholdAsync(vmId)`
- `UpsertPerVmThresholdAsync(dto)`
- `DeletePerVmThresholdAsync(vmId)`
- `GetGlobalThresholdAsync()`

New DTOs: `PerVmThresholdDto`, `PerVmThresholdResponse`

**Frontend** — Threshold config panel added to VMAssets detail view:
- Form fields: threshold, time window, block duration, auto-block toggle
- "Save Override" button → `PUT /api/v1/thresholds/{vmId}`
- "Reset to Global" button → `DELETE /api/v1/thresholds/{vmId}`
- Loads current settings on VM detail open (per-VM or global fallback)
- Admin-only controls (hidden for analyst role)

New API functions in `api.js`: `getVmThreshold`, `getGlobalThreshold`, `upsertVmThreshold`, `deleteVmThreshold`

### 3. Permanent Block Support

**Backend:**
- `BlockIpAsync()` and `BlockIpPerVmAsync()` now treat `duration_minutes = 0` as permanent (`BlockExpires = null`)
- Controller response messages: "blocked permanently" vs "blocked for N minutes"
- XML doc comments added to `ManualBlockRequest.DurationMinutes` and `PerVmBlockRequest.DurationMinutes`

**Frontend** — Duration preset dropdowns replace raw minute inputs:
- BlockedIPs modal: `<select>` with options: 1h, 2h, 6h, 24h, 7d, 30d, Permanent
- VMAssets per-VM block form: same dropdown (1h, 6h, 24h, 7d, 30d, Permanent)
- SuspiciousIPs block action: same dropdown for admin users

### 4. SuspiciousIPs Logic Fix

**Problem:** The old logic filtered `failed_attempts >= threshold AND status == "active"`, but auto-block immediately sets status to "blocked". So the page was always empty after auto-block triggered — the exact IPs you want to see were hidden.

**Backend fix** (`GetSuspiciousIpsAsync`):
- Now returns ALL IPs with `failed_attempts >= 2` regardless of status
- Added `RiskLevel` field (computed): "blocked", "cleared", "critical" (>= threshold), "high" (>= 70%), "medium" (>= 40%), "low"
- Added `TargetUsernames` field: parsed from JSON string to `List<string>`
- Threshold parameter still accepted but only used for risk level computation, not filtering

**Frontend rewrite** (`SuspiciousIPs.jsx`):
- Risk level color-coded badges (critical=red, high=orange, medium=yellow, low=green, blocked=gray, cleared=blue)
- Target usernames column with expand/collapse for long lists
- Status filter tabs: All / Active / Blocked / Cleared (with counts)
- Blocked rows dimmed with "Already blocked" label
- Block duration preset dropdown for admin users
- Search now matches risk level and usernames

### 5. EF Core Migration Snapshot Fix (Pre-existing Bug)

**Discovery:** The `User` entity was completely missing from both `SecurityMonitorContextModelSnapshot.cs` and `20260304133110_InitialCreate.Designer.cs`. This was a pre-existing bug from Session 11 — the User model was added to DbContext but never included in the migration artifacts.

**Impact:** Without this fix, `dotnet ef migrations add` would detect the User entity as a new model change and try to generate a new migration to create the Users table (which already exists in the DB).

**Fix:**
- Added full User entity block to `SecurityMonitorContextModelSnapshot.cs`
- Added full User entity block to `20260304133110_InitialCreate.Designer.cs`
- Added Users `CreateTable` + indexes (`idx_users_email`, `idx_users_username`) to `20260304133110_InitialCreate.cs` `Up()` method
- Added `DropTable("Users")` to `Down()` method

### Files Changed (13 files, +889 -269)

**Backend:**
- `backend/Models/AttackStatistic.cs` — DELETED
- `backend/Data/SecurityMonitorContext.cs` — removed AttackStatistics DbSet and config
- `backend/DTOs/Dtos.cs` — added SuspiciousIpDto fields, threshold DTOs, XML comments
- `backend/Services/SecurityMonitorService.cs` — threshold CRUD, permanent blocks, suspicious IPs rewrite
- `backend/Controllers/SecurityMonitorController.cs` — 5 threshold endpoints, permanent block messages
- `backend/Program.cs` — migration detection query fix
- `backend/Migrations/SecurityMonitorContextModelSnapshot.cs` — removed AttackStatistic, added User
- `backend/Migrations/20260304133110_InitialCreate.Designer.cs` — added User entity
- `backend/Migrations/20260304133110_InitialCreate.cs` — added Users CreateTable + indexes + DropTable

**Frontend:**
- `frontend/src/pages/SuspiciousIPs.jsx` — complete rewrite
- `frontend/src/pages/VMAssets.jsx` — threshold config panel, duration dropdown
- `frontend/src/pages/BlockedIPs.jsx` — duration preset dropdown
- `frontend/src/services/api.js` — threshold API functions, simplified getSuspiciousIps

### Current API Endpoint Map

**Auth (AllowAnonymous):**
| Method | Route | Access |
|--------|-------|--------|
| POST | `/api/v1/auth/register` | public |
| POST | `/api/v1/auth/login` | public |
| GET | `/api/v1/auth/me` | authenticated |

**Data (Authorize):**
| Method | Route | Access |
|--------|-------|--------|
| GET | `/api/v1/statistics` | authenticated |
| GET | `/api/v1/statistics/global` | authenticated |
| GET | `/api/v1/suspicious-ips` | authenticated |
| GET | `/api/v1/blocked-ips` | authenticated |
| POST | `/api/v1/block` | admin |
| POST | `/api/v1/block/per-vm` | admin |
| DELETE | `/api/v1/block/{ip}` | admin |
| GET | `/api/v1/vms` | authenticated |
| POST | `/api/v1/vms` | admin |
| DELETE | `/api/v1/vms/{vmId}` | admin |
| GET | `/api/v1/vms/{vmId}/attacks` | authenticated |
| GET | `/api/v1/thresholds` | authenticated |
| GET | `/api/v1/thresholds/global` | authenticated |
| GET | `/api/v1/thresholds/{vmId}` | authenticated |
| PUT | `/api/v1/thresholds/{vmId}` | admin |
| DELETE | `/api/v1/thresholds/{vmId}` | admin |

**Open (AllowAnonymous):**
| Method | Route | Access |
|--------|-------|--------|
| GET | `/api/v1/health` | public |
| POST | `/api/v1/events` | public (agent) |
| GET | `/api/v1/feed` | public (SSE) |

### What's Remaining
- Manual E2E testing (test plan prepared, not yet executed)
- Future: firewall integration, geo-IP, exponential backoff blocking, alert system
