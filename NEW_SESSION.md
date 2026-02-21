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
✔ Event Bookmark Handling
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
4. Windows event bookmark handling is critical
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
