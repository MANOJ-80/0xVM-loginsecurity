# TODO - Remaining Work Items

## ✅ Completed

### 1. Implement Failed Login Threshold Detection Logic ✅
**Status**: DONE - Committed as `d5673ca`

### 2. Implement Automatic IP Blocking Logic ✅
**Status**: DONE - Committed as `d5673ca`

### 2b. Wire PerVMThresholds Table (Per-VM Custom Thresholds) ✅
**Status**: DONE - Committed as `d5673ca`

---

## Priority 1 - Core Features

### 1. Implement Failed Login Threshold Detection Logic

**What**: Auto-detect when an IP exceeds configured failed attempt threshold and trigger block

**Where**: `aspbackend/Services/SecurityMonitorService.cs` - `RecordFailedLoginBatchAsync()` method

**How**:
- After inserting events, query `Settings` table for `GLOBAL_THRESHOLD` and `TIME_WINDOW`
- Count failed attempts per IP within the time window
- If count >= threshold, call `BlockIpAsync()` automatically
- Check `ENABLE_AUTO_BLOCK` setting first

---

### 2. Implement Automatic IP Blocking Logic

**What**: Actually block IPs when threshold exceeded (currently DB has settings but not wired)

**Where**: `aspbackend/Services/SecurityMonitorService.cs`

**How**:
- Modify `RecordFailedLoginBatchAsync()` to:
  1. Check `ENABLE_AUTO_BLOCK` from Settings
  2. Get threshold from `GLOBAL_THRESHOLD` or `PerVmThreshold`
  3. Calculate windowed count (last N minutes)
  4. If exceeded, call `BlockIpAsync()` with reason "Auto-block: exceeded threshold"
  5. Mark as `blocked_by = "auto"` in BlockedIPs

---

### 2b. Wire PerVMThresholds Table (Per-VM Custom Thresholds)

**What**: Actually use the PerVMThresholds table instead of just global settings

**Where**: `aspbackend/Services/SecurityMonitorService.cs`

**How**:
- When checking threshold for an event, first check if `PerVMThresholds` exists for that `SourceVmId`
- If exists, use that VM's custom threshold, time window, and block duration
- If not exists, fall back to global `Settings` values
- This allows different VMs to have different sensitivity levels

---

### 2c. Wire AttackStatistics Table (Daily Aggregation)

**What**: Populate AttackStatistics table with daily aggregated data for historical trends

**Where**: New `aspbackend/Services/StatisticsAggregationService.cs`

**How**:
- Create a `BackgroundService` that runs once daily (or on demand)
- Query `FailedLoginAttempts` grouped by date and optionally by VM
- Calculate: total_attacks, unique_attackers, blocked_count, top_username, top_ip
- Insert/update `AttackStatistics` table
- This enables "attacks over last 30 days" charts without querying raw events

---

### 2d. Add Per-VM Threshold Configuration API

**What**: Admin API to configure per-VM threshold settings

**Where**: `aspbackend/Controllers/SecurityMonitorController.cs`

**Why**: PerVMThresholds table exists but no way for admin to configure it via API

**How**:

**DTOs** (add to DTOs.cs):
```csharp
public class PerVmThresholdRequest
{
    public string VmId { get; set; } = string.Empty;
    public int Threshold { get; set; } = 5;
    public int TimeWindowMinutes { get; set; } = 5;
    public int BlockDurationMinutes { get; set; } = 60;
    public bool AutoBlockEnabled { get; set; } = true;
}
```

**Controller endpoints**:
- `POST /api/v1/settings/per-vm` - Create/update per-VM threshold
- `GET /api/v1/settings/per-vm/{vmId}` - Get threshold for specific VM
- `GET /api/v1/settings/per-vm` - List all per-VM thresholds
- `DELETE /api/v1/settings/per-vm/{vmId}` - Remove per-VM threshold (fall back to global)

**Service methods** (add to SecurityMonitorService.cs):
- `SetPerVmThresholdAsync()` - Create or update
- `GetPerVmThresholdAsync()` - Get single
- `GetAllPerVmThresholdsAsync()` - List all
- `DeletePerVmThresholdAsync()` - Remove

---

### 3. Add HTTPS Support + Agent Authentication Token

**What**: Secure agent-to-server communication with HTTPS and API tokens

**Where**: `aspbackend/Program.cs`, agent config

**Why**: Currently all communication is plaintext HTTP with no authentication - anyone who can reach the server can send events

**How**:

**Backend (ASP.NET):**
- Configure Kestrel to use HTTPS with SSL certificate
- Add `API_TOKEN` setting in `Settings` table or `appsettings.json`
- Create middleware to validate `Authorization: Bearer <token>` header on:
  - `POST /api/v1/events`
  - `POST /api/v1/vms`
- Return 401 if token missing/invalid
- Keep dashboard endpoints separate (can use different auth later)

**Agent (Python):**
- Add `api_token` field to `config.yaml`
- Add header to all HTTP requests:
  ```python
  headers = {"Authorization": f"Bearer {token}"}
  ```

**Certificate Setup:**
- Use self-signed cert for testing, Let's Encrypt for production
- Or use reverse proxy (nginx/IIS) with TLS termination

**Files to modify:**
- `aspbackend/Program.cs` - HTTPS config + auth middleware
- `aspbackend/appsettings.json` - add API_TOKEN setting
- `agent/config.yaml` - add api_token field
- `agent/main.py` - add Authorization header to requests

---

### 4. Integrate Windows Firewall Rule Creation via PowerShell

**What**: Actually create Windows Firewall rules when IP is blocked

**Where**: New file `aspbackend/Services/FirewallService.cs`

**How**:
```csharp
public async Task CreateFirewallBlockRule(string ipAddress)
{
    var script = $"New-NetFirewallRule -DisplayName 'Block_{ipAddress}' -Direction Inbound -RemoteAddress {ipAddress} -Action Block";
    // Execute via Process.Start or PowerShell SDK
}
```

- Call this in `BlockIpAsync()` after DB insert
- Store rule name in `BlockedIPs` for cleanup later
- Need to handle: run as admin, error handling, logging

---

### 4. Implement Automatic Unblock After Block Duration

**What**: Remove firewall rules and DB entries when block expires

**Where**: New background service or scheduled job

**How**:
- Create `aspbackend/Services/BlockExpirationService.cs`
- Run every minute via `BackgroundService`
- Query `BlockedIPs` where `BlockExpires <= Now` and `IsActive = true`
- Remove firewall rule via PowerShell
- Set `IsActive = false` in DB

---

## Priority 2 - Attack Detection

### 5. Implement Global Attack Detection Across Multiple VMs

**What**: Detect when same IP attacks multiple VMs (distributed attack pattern)

**Where**: `aspbackend/Services/SecurityMonitorService.cs` - new method

**How**:
- Query `FailedLoginAttempts` for same IP across different `SourceVmId`
- If 1 IP targets >= 2 VMs within time window → flag as distributed attack
- Lower threshold for these attacks (e.g., 3 attempts instead of 5)
- Return via new API endpoint or include in statistics

---

### 6. Detect Password Spraying Patterns

**What**: Detect many different usernames from same IP (spray attack)

**Where**: `aspbackend/Services/SecurityMonitorService.cs` - new method

**How**:
- Group `FailedLoginAttempts` by IP
- Count distinct usernames per IP within time window
- If distinct usernames >= 10 within 5 minutes → password spray
- Flag in `SuspiciousIPs` table with new `attack_type` field
- Return in statistics response

---

## Priority 3 - Infrastructure

### 8. Add IP Geo-Location Visualization

**What**: Show attack origins on map with country/city

**Where**: `aspbackend/Controllers/SecurityMonitorController.cs` - `/geo-attacks` endpoint

**How**:
- Install MaxMind GeoIP2 nuget package or use free GeoLite2 DB
- Map each attacker IP to country/city/lat/lng
- Return aggregated data:
```json
{
  "ip_address": "1.2.3.4",
  "country": "China",
  "city": "Beijing", 
  "lat": 39.9042,
  "lng": 116.4074,
  "attack_count": 45
}
```
- Update frontend to show map (Leaflet.js or similar)

---

### 9. Add Agent Authentication Token Mechanism

**What**: Secure API with tokens so random IPs can't send events

**Where**: `aspbackend/Program.cs` and agent config

**How**:
- Add `API_TOKEN` setting in database or config
- Agent includes header: `Authorization: Bearer <token>`
- Add middleware to validate token on `/api/v1/events` and `/api/v1/vms` endpoints
- Return 401 if missing/invalid
- Add token to agent `config.yaml`

---

### 10. Implement API Rate Limiting

**What**: Prevent API abuse/DoS

**Where**: `aspbackend/Program.cs`

**How**:
- Add `AspNetCoreRateLimit` nuget package
- Configure in `appsettings.json`:
```json
"IpRateLimiting": {
  "EnableEndpointRateLimiting": true,
  "Rules": [
    { "Endpoint": "POST:/api/v1/events", "Limit": 1000, "Period": "1m" }
  ]
}
```
- Or implement simple in-memory limiter in controller

---

### 11. Add Structured Backend Logging

**What**: Proper logging for debugging/monitoring

**Where**: Throughout `aspbackend/` 

**How**:
- Use Serilog with file sink
- Add to `Program.cs`:
```csharp
Log.Logger = new LoggerConfiguration()
    .WriteTo.File("logs/app.log", rollingInterval: RollingInterval.Day)
    .CreateLogger();
```
- Log: incoming requests, block events, errors, suspicious activity
- Add correlation IDs for request tracing

---

### 12. Implement Data Retention / Cleanup Policy

**What**: Auto-delete old records to prevent DB bloat

**Where**: New `aspbackend/Services/DataRetentionService.cs`

**How**:
- Add `DATA_RETENTION_DAYS` setting (default 90)
- Run daily via `BackgroundService`
- Delete from `FailedLoginAttempts` where timestamp < NOW - retention
- Optionally archive to separate table before delete
- Log cleanup stats

---

## Summary - Files to Modify

| Task | Status | Complexity | Files to Modify |
|------|--------|-----------|-----------------|
| Threshold detection | ✅ Done | Medium | SecurityMonitorService.cs |
| Auto-blocking logic | ✅ Done | Medium | SecurityMonitorService.cs |
| PerVMThresholds wiring | ✅ Done | Low | SecurityMonitorService.cs |
| PerVMThreshold config API | ⏳ Pending | Low | Controller, DTOs.cs, Service |
| AttackStatistics aggregation | ⏳ Pending | Medium | new StatisticsAggregationService.cs |
| HTTPS + Auth tokens | ⏳ Pending | Low | Program.cs, agent/main.py, config.yaml |
| Firewall integration | ⏳ Pending | High | new FirewallService.cs |
| Auto-unblock | ⏳ Pending | Medium | new BlockExpirationService.cs |
| Global attack detection | ⏳ Pending | Medium | SecurityMonitorService.cs, new DTO |
| Password spray detection | ⏳ Pending | Medium | SecurityMonitorService.cs, Model update |
| Geo-location | ⏳ Pending | Medium | Controller, new Service, frontend |
| Rate limiting | ⏳ Pending | Low | Program.cs, appsettings |
| Logging | ⏳ Pending | Low | Program.cs, existing services |
| Data retention | ⏳ Pending | Low | new DataRetentionService.cs |
| Logging | Low | Program.cs, existing services |
| Data retention | Low | new DataRetentionService.cs |

---

## Future Improvements (Post-MVP)

### Agent-Side Improvements

- **Exponential backoff retry** — Agent retry logic should use exponential backoff instead of fixed interval
- **Async HTTP sending** — Agent should send events asynchronously to avoid blocking
- **SQLite fallback buffer** — If backend is unreachable for extended period, buffer events in local SQLite
- **TLS HTTPS** — Agent should communicate with backend over HTTPS in production
- **`_seen.json` age-based pruning** — Remove fingerprints older than N days instead of only count-based 50k cap
- **Log rotation** — Agent logs grow forever, need rotation or size cap
- **Config validation** — Agent should fail fast on bad `config.yaml` with clear error messages

### Backend-Side Improvements

- **Alert system (Email/Slack)** — Send notifications when IPs are blocked or suspicious activity detected
- **OAuth2/OIDC for dashboard** — Secure dashboard with proper authentication
- **Role-based access control (RBAC)** — Different permission levels for users
- **Audit logging** — Log all admin actions (block/unblock, settings changes)
- **Interactive failure detection** — Detect non-RDP/non-network logon failures (Session 10 scope decision)

### Security Hardening

- **Brute-force detection logic** — More sophisticated pattern detection
- **Deduplication hash** — Use SHA-256 hash for better dedup performance

### Testing

- **Test 8** — Verify RDP (logon type 10) events are captured correctly alongside SMB (logon type 3)
- **Test 9** — Verify `failure_reason` codes differ for non-existent user (`0xC0000064`) vs wrong password (`0xC000006A`)

### Automation

- **Windows Firewall automation** — Script that polls `/suspicious-ips` and creates firewall rules automatically (referenced in TESTING_GUIDE.md Part 9)
