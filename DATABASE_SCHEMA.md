# Database Schema (MSSQL)

## Complete Setup Script

Run this entire script in SSMS against the `SecurityMonitor` database to
initialize (or reset) from scratch. It is safe to re-run — it drops
everything first.

**After running this script:**
1. Delete `vm-001_seen.json` from the agent folder (if it exists)
2. Restart the agent — it will re-scan the Windows event log and
   repopulate the DB with correct local timestamps
3. All dedup (agent-side + server-side) starts fresh

```sql
USE SecurityMonitor;
GO

/* ===============================================================
   DROP STORED PROCEDURES
================================================================ */

IF OBJECT_ID('sp_GetVMStats',                'P') IS NOT NULL DROP PROCEDURE sp_GetVMStats;
IF OBJECT_ID('sp_BlockIPPerVM',              'P') IS NOT NULL DROP PROCEDURE sp_BlockIPPerVM;
IF OBJECT_ID('sp_RegisterVM',               'P') IS NOT NULL DROP PROCEDURE sp_RegisterVM;
IF OBJECT_ID('sp_RecordFailedLoginMultiVM',  'P') IS NOT NULL DROP PROCEDURE sp_RecordFailedLoginMultiVM;
IF OBJECT_ID('sp_BlockIP',                   'P') IS NOT NULL DROP PROCEDURE sp_BlockIP;
IF OBJECT_ID('sp_GetSuspiciousIPs',          'P') IS NOT NULL DROP PROCEDURE sp_GetSuspiciousIPs;
GO

/* ===============================================================
   DROP TABLES (child tables first to satisfy FK constraints)
================================================================ */

IF OBJECT_ID('PerVMThresholds',    'U') IS NOT NULL DROP TABLE PerVMThresholds;
IF OBJECT_ID('AttackStatistics',   'U') IS NOT NULL DROP TABLE AttackStatistics;
IF OBJECT_ID('BlockedIPs',         'U') IS NOT NULL DROP TABLE BlockedIPs;
IF OBJECT_ID('SuspiciousIPs',      'U') IS NOT NULL DROP TABLE SuspiciousIPs;
IF OBJECT_ID('FailedLoginAttempts','U') IS NOT NULL DROP TABLE FailedLoginAttempts;
IF OBJECT_ID('VMSources',         'U') IS NOT NULL DROP TABLE VMSources;
IF OBJECT_ID('Settings',          'U') IS NOT NULL DROP TABLE Settings;
GO

/* ===============================================================
   CREATE TABLES
================================================================ */

-- Core event table: one row per Windows Event ID 4625.
-- Timestamps are LOCAL TIME (agent converts UTC -> local before sending).
CREATE TABLE FailedLoginAttempts (
    id             INT IDENTITY(1,1) PRIMARY KEY,
    ip_address     VARCHAR(45)   NOT NULL,
    username       NVARCHAR(256),
    hostname       NVARCHAR(256),
    logon_type     INT,                        -- 2=Interactive, 3=Network/SMB, 10=RDP
    failure_reason VARCHAR(20),                -- NTSTATUS hex string e.g. '0xC000006A'
    source_port    INT,
    timestamp      DATETIME2     NOT NULL,     -- local time from agent (NOT UTC)
    event_id       INT           DEFAULT 4625,
    source_vm_id   VARCHAR(100)
);

-- Query indexes
CREATE INDEX idx_ip_timestamp ON FailedLoginAttempts(ip_address, timestamp);
CREATE INDEX idx_timestamp    ON FailedLoginAttempts(timestamp);
CREATE INDEX idx_source_vm    ON FailedLoginAttempts(source_vm_id, timestamp);

-- Covering index for the dedup IF EXISTS check in sp_RecordFailedLoginMultiVM.
-- Without this index the SP does a full table scan under burst load.
CREATE INDEX idx_dedup_check  ON FailedLoginAttempts(ip_address, username, source_port, timestamp, source_vm_id);
GO


CREATE TABLE SuspiciousIPs (
    id               INT IDENTITY(1,1) PRIMARY KEY,
    ip_address       VARCHAR(45)   NOT NULL UNIQUE,
    failed_attempts  INT           DEFAULT 1,
    first_attempt    DATETIME2,
    last_attempt     DATETIME2,
    target_usernames NVARCHAR(MAX),             -- JSON array (future use)
    status           VARCHAR(20)   DEFAULT 'active',  -- active, blocked, cleared
    created_at       DATETIME2     DEFAULT GETUTCDATE(),
    updated_at       DATETIME2     DEFAULT GETUTCDATE()
);

CREATE INDEX idx_suspicious_status ON SuspiciousIPs(status);
CREATE INDEX idx_suspicious_ip     ON SuspiciousIPs(ip_address);
GO


CREATE TABLE BlockedIPs (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    ip_address    VARCHAR(45)   NOT NULL,
    blocked_at    DATETIME2     DEFAULT GETUTCDATE(),
    block_expires DATETIME2,
    reason        NVARCHAR(500),
    blocked_by    VARCHAR(50)   DEFAULT 'auto',   -- auto, manual
    is_active     BIT           DEFAULT 1,
    unblocked_at  DATETIME2     NULL,
    unblocked_by  VARCHAR(50)   NULL,
    scope         VARCHAR(20)   DEFAULT 'global', -- global, per-vm
    target_vm_id  VARCHAR(100)  NULL
);

CREATE INDEX idx_blocked_active  ON BlockedIPs(is_active);
CREATE INDEX idx_blocked_expires ON BlockedIPs(block_expires);
CREATE INDEX idx_blocked_scope   ON BlockedIPs(scope, is_active);
GO


CREATE TABLE Settings (
    key_name    VARCHAR(100)  PRIMARY KEY,
    value       NVARCHAR(500),
    description NVARCHAR(500),
    updated_at  DATETIME2     DEFAULT GETUTCDATE()
);

INSERT INTO Settings (key_name, value, description) VALUES
('THRESHOLD',                '5',    'Failed attempts before marking as suspicious'),
('TIME_WINDOW',              '5',    'Time window in minutes for threshold'),
('BLOCK_DURATION',           '60',   'Auto-block duration in minutes'),
('ENABLE_AUTO_BLOCK',        'true', 'Enable automatic IP blocking'),
('GLOBAL_THRESHOLD',         '5',    'Global threshold across all VMs'),
('ENABLE_GLOBAL_AUTO_BLOCK', 'true', 'Enable global auto-blocking');
GO


CREATE TABLE VMSources (
    id                INT IDENTITY(1,1) PRIMARY KEY,
    vm_id             VARCHAR(100)  NOT NULL UNIQUE,
    hostname          NVARCHAR(256),
    ip_address        VARCHAR(45),
    collection_method VARCHAR(20),               -- 'agent', 'wef'
    status            VARCHAR(20)   DEFAULT 'active',  -- active, inactive, error
    last_seen         DATETIME2,
    created_at        DATETIME2     DEFAULT GETUTCDATE()
);

CREATE INDEX idx_vmsources_vm_id  ON VMSources(vm_id);
CREATE INDEX idx_vmsources_status ON VMSources(status);
GO


CREATE TABLE PerVMThresholds (
    id                     INT IDENTITY(1,1) PRIMARY KEY,
    vm_id                  VARCHAR(100) NOT NULL,
    threshold              INT          DEFAULT 5,
    time_window_minutes    INT          DEFAULT 5,
    block_duration_minutes INT          DEFAULT 60,
    auto_block_enabled     BIT          DEFAULT 1,
    created_at             DATETIME2    DEFAULT GETUTCDATE(),
    updated_at             DATETIME2    DEFAULT GETUTCDATE(),

    FOREIGN KEY (vm_id) REFERENCES VMSources(vm_id),
    UNIQUE (vm_id)
);
GO


CREATE TABLE AttackStatistics (
    id               INT IDENTITY(1,1) PRIMARY KEY,
    stat_date        DATE,
    vm_id            VARCHAR(100) NULL,          -- NULL = global aggregate
    total_attacks    INT,
    unique_attackers INT,
    blocked_count    INT,
    top_username     NVARCHAR(256),
    top_ip           VARCHAR(45),
    created_at       DATETIME2    DEFAULT GETUTCDATE(),

    UNIQUE (stat_date, vm_id)
);

CREATE INDEX idx_stats_date ON AttackStatistics(stat_date);
CREATE INDEX idx_stats_vm   ON AttackStatistics(vm_id, stat_date);
GO


/* ===============================================================
   STORED PROCEDURES
================================================================ */

-- Record a failed login event from a multi-VM agent.
-- Includes server-side dedup: if the exact same event (identified by
-- ip + username + port + timestamp + vm) already exists, skip the insert.
-- The agent sends LOCAL timestamps (not UTC).
CREATE PROCEDURE sp_RecordFailedLoginMultiVM
    @ip_address      VARCHAR(45),
    @username        NVARCHAR(256),
    @hostname        NVARCHAR(256)  = NULL,
    @logon_type      INT            = NULL,
    @failure_reason  VARCHAR(20)    = NULL,
    @source_port     INT            = NULL,
    @source_vm_id    VARCHAR(100)   = NULL,
    @event_timestamp DATETIME2      = NULL
AS
BEGIN
    DECLARE @ts DATETIME2 = ISNULL(@event_timestamp, GETUTCDATE());

    -- Dedup: skip if this exact event was already recorded.
    -- Uses idx_dedup_check covering index for fast lookups.
    IF EXISTS (
        SELECT 1 FROM FailedLoginAttempts WITH (NOLOCK)
        WHERE ip_address   = @ip_address
          AND username     = @username
          AND source_port  = @source_port
          AND timestamp    = @ts
          AND source_vm_id = @source_vm_id
    )
    BEGIN
        RETURN;
    END

    INSERT INTO FailedLoginAttempts
        (ip_address, username, hostname, logon_type, failure_reason,
         source_port, source_vm_id, timestamp)
    VALUES
        (@ip_address, @username, @hostname, @logon_type, @failure_reason,
         @source_port, @source_vm_id, @ts);

    -- Update or insert suspicious IP (global lifetime counter)
    IF EXISTS (SELECT 1 FROM SuspiciousIPs WHERE ip_address = @ip_address)
    BEGIN
        UPDATE SuspiciousIPs
        SET failed_attempts = failed_attempts + 1,
            last_attempt    = @ts,
            updated_at      = GETUTCDATE()
        WHERE ip_address = @ip_address;
    END
    ELSE
    BEGIN
        INSERT INTO SuspiciousIPs (ip_address, failed_attempts, first_attempt, last_attempt)
        VALUES (@ip_address, 1, @ts, @ts);
    END

    -- Touch VMSources.last_seen so we know the agent is alive
    IF @source_vm_id IS NOT NULL
    BEGIN
        UPDATE VMSources SET last_seen = GETUTCDATE() WHERE vm_id = @source_vm_id;
    END
END
GO


CREATE PROCEDURE sp_GetSuspiciousIPs
    @threshold INT = 5
AS
BEGIN
    SELECT ip_address, failed_attempts, first_attempt, last_attempt, status
    FROM SuspiciousIPs
    WHERE failed_attempts >= @threshold
      AND status = 'active'
    ORDER BY failed_attempts DESC;
END
GO


CREATE PROCEDURE sp_BlockIP
    @ip_address       VARCHAR(45),
    @reason           NVARCHAR(500),
    @duration_minutes INT         = 60,
    @blocked_by       VARCHAR(50) = 'auto'
AS
BEGIN
    INSERT INTO BlockedIPs (ip_address, reason, block_expires, blocked_by)
    VALUES (@ip_address, @reason,
            DATEADD(MINUTE, @duration_minutes, GETUTCDATE()), @blocked_by);

    UPDATE SuspiciousIPs SET status = 'blocked' WHERE ip_address = @ip_address;
END
GO


CREATE PROCEDURE sp_RegisterVM
    @vm_id             VARCHAR(100),
    @hostname          NVARCHAR(256),
    @ip_address        VARCHAR(45),
    @collection_method VARCHAR(20) = 'agent'
AS
BEGIN
    IF EXISTS (SELECT 1 FROM VMSources WHERE vm_id = @vm_id)
    BEGIN
        UPDATE VMSources
        SET hostname          = @hostname,
            ip_address        = @ip_address,
            collection_method = @collection_method,
            status            = 'active',
            last_seen         = GETUTCDATE()
        WHERE vm_id = @vm_id;
    END
    ELSE
    BEGIN
        INSERT INTO VMSources (vm_id, hostname, ip_address, collection_method, status, last_seen)
        VALUES (@vm_id, @hostname, @ip_address, @collection_method, 'active', GETUTCDATE());
    END
END
GO


CREATE PROCEDURE sp_BlockIPPerVM
    @ip_address       VARCHAR(45),
    @target_vm_id     VARCHAR(100),
    @reason           NVARCHAR(500),
    @duration_minutes INT         = 60,
    @blocked_by       VARCHAR(50) = 'auto'
AS
BEGIN
    INSERT INTO BlockedIPs (ip_address, reason, block_expires, blocked_by, scope, target_vm_id)
    VALUES (@ip_address, @reason,
            DATEADD(MINUTE, @duration_minutes, GETUTCDATE()), @blocked_by,
            'per-vm', @target_vm_id);

    IF NOT EXISTS (SELECT 1 FROM SuspiciousIPs WHERE ip_address = @ip_address)
    BEGIN
        INSERT INTO SuspiciousIPs (ip_address, failed_attempts, first_attempt, last_attempt, status)
        VALUES (@ip_address, 1, GETUTCDATE(), GETUTCDATE(), 'blocked');
    END
    ELSE
    BEGIN
        UPDATE SuspiciousIPs
        SET status     = 'blocked',
            updated_at = GETUTCDATE()
        WHERE ip_address = @ip_address;
    END
END
GO


CREATE PROCEDURE sp_GetVMStats
    @vm_id VARCHAR(100)
AS
BEGIN
    SELECT
        source_vm_id AS vm_id,
        COUNT(*)                    AS total_attacks,
        COUNT(DISTINCT ip_address)  AS unique_attackers,
        (
            SELECT COUNT(*)
            FROM BlockedIPs b
            WHERE b.is_active = 1
              AND (b.scope = 'global'
                   OR (b.scope = 'per-vm' AND b.target_vm_id = @vm_id))
        ) AS blocked_count,
        MAX(timestamp) AS last_attack
    FROM FailedLoginAttempts
    WHERE source_vm_id = @vm_id
    GROUP BY source_vm_id;
END
GO
```

## Rebuild Steps

After running the setup script above:

1. **Stop the agent** on the Source VM (`Ctrl+C`)
2. **Run the full script** in SSMS on the Collector VM
3. **Delete `vm-001_seen.json`** from the agent folder:
   ```cmd
   del vm-001_seen.json
   ```
4. **Restart the agent**: `python main.py`
5. The agent will scan the Windows event log and send all events with
   correct local timestamps. The DB starts fresh with zero duplicates.

## Verification

After the agent repopulates the DB, run this to confirm zero duplicates:

```sql
SELECT ip_address, username, source_port, timestamp, source_vm_id,
       COUNT(*) AS copies
FROM FailedLoginAttempts
GROUP BY ip_address, username, source_port, timestamp, source_vm_id
HAVING COUNT(*) > 1;
```

This must return **zero rows**.

---

## Table Reference

### 1. FailedLoginAttempts

One row per Windows Event ID 4625. Timestamps are **local time** (the agent
converts UTC SystemTime to local before sending).

| Column | Type | Notes |
|--------|------|-------|
| id | INT IDENTITY | PK |
| ip_address | VARCHAR(45) | Attacker IP (NOT NULL) |
| username | NVARCHAR(256) | Target account name |
| hostname | NVARCHAR(256) | Source VM hostname |
| logon_type | INT | 2=Interactive, 3=Network/SMB, 10=RDP |
| failure_reason | VARCHAR(20) | NTSTATUS hex string (e.g. `0xC000006A`) |
| source_port | INT | Attacker source port |
| timestamp | DATETIME2 | Local time (NOT NULL) |
| event_id | INT | Default 4625 |
| source_vm_id | VARCHAR(100) | Agent's vm_id from config |

**Indexes:** `idx_ip_timestamp`, `idx_timestamp`, `idx_source_vm`, `idx_dedup_check`

### 2. SuspiciousIPs

Lifetime counter per attacker IP. Used for quick dashboard display.

> **Design note:** The detection engine must **not** rely on
> `failed_attempts` for threshold decisions. Instead, count rows in
> `FailedLoginAttempts` within the configured `TIME_WINDOW`:
> ```sql
> SELECT COUNT(*) FROM FailedLoginAttempts
> WHERE ip_address = @ip AND timestamp >= DATEADD(MINUTE, -@window, GETUTCDATE());
> ```

| Column | Type | Notes |
|--------|------|-------|
| id | INT IDENTITY | PK |
| ip_address | VARCHAR(45) | UNIQUE |
| failed_attempts | INT | Lifetime counter |
| first_attempt | DATETIME2 | |
| last_attempt | DATETIME2 | |
| target_usernames | NVARCHAR(MAX) | JSON array (future use) |
| status | VARCHAR(20) | active, blocked, cleared |
| created_at | DATETIME2 | |
| updated_at | DATETIME2 | |

### 3. BlockedIPs

Active and historical IP blocks.

| Column | Type | Notes |
|--------|------|-------|
| id | INT IDENTITY | PK |
| ip_address | VARCHAR(45) | |
| blocked_at | DATETIME2 | |
| block_expires | DATETIME2 | |
| reason | NVARCHAR(500) | |
| blocked_by | VARCHAR(50) | auto, manual |
| is_active | BIT | |
| unblocked_at | DATETIME2 | NULL until unblocked |
| unblocked_by | VARCHAR(50) | NULL until unblocked |
| scope | VARCHAR(20) | global, per-vm |
| target_vm_id | VARCHAR(100) | NULL for global scope |

### 4. Settings

Key-value configuration.

| Column | Type | Notes |
|--------|------|-------|
| key_name | VARCHAR(100) | PK |
| value | NVARCHAR(500) | |
| description | NVARCHAR(500) | |
| updated_at | DATETIME2 | |

**Default keys:** THRESHOLD, TIME_WINDOW, BLOCK_DURATION, ENABLE_AUTO_BLOCK, GLOBAL_THRESHOLD, ENABLE_GLOBAL_AUTO_BLOCK

### 5. VMSources

Registry of monitored VMs.

| Column | Type | Notes |
|--------|------|-------|
| id | INT IDENTITY | PK |
| vm_id | VARCHAR(100) | UNIQUE |
| hostname | NVARCHAR(256) | |
| ip_address | VARCHAR(45) | |
| collection_method | VARCHAR(20) | agent, wef |
| status | VARCHAR(20) | active, inactive, error |
| last_seen | DATETIME2 | Updated by SP on each event |
| created_at | DATETIME2 | |

### 6. PerVMThresholds

Per-VM threshold overrides. FK to VMSources.

| Column | Type | Notes |
|--------|------|-------|
| id | INT IDENTITY | PK |
| vm_id | VARCHAR(100) | UNIQUE, FK -> VMSources |
| threshold | INT | Default 5 |
| time_window_minutes | INT | Default 5 |
| block_duration_minutes | INT | Default 60 |
| auto_block_enabled | BIT | Default 1 |
| created_at | DATETIME2 | |
| updated_at | DATETIME2 | |

### 7. AttackStatistics

Aggregated daily statistics for dashboard.

| Column | Type | Notes |
|--------|------|-------|
| id | INT IDENTITY | PK |
| stat_date | DATE | UNIQUE with vm_id |
| vm_id | VARCHAR(100) | NULL = global aggregate |
| total_attacks | INT | |
| unique_attackers | INT | |
| blocked_count | INT | |
| top_username | NVARCHAR(256) | |
| top_ip | VARCHAR(45) | |
| created_at | DATETIME2 | |

## Stored Procedures

### sp_RecordFailedLoginMultiVM

Primary insert procedure. Called by the backend for every event from every agent.

**Server-side dedup:** Uses `IF EXISTS` with `idx_dedup_check` covering index
to skip duplicate inserts. This catches:
- Agent retry queue re-sends (timeout on agent side, backend already processed)
- `_seen.json` deletion + restart (agent re-sends all events from Windows log)

**Parameters:**
| Param | Type | Default | Notes |
|-------|------|---------|-------|
| @ip_address | VARCHAR(45) | required | |
| @username | NVARCHAR(256) | required | |
| @hostname | NVARCHAR(256) | NULL | |
| @logon_type | INT | NULL | |
| @failure_reason | VARCHAR(20) | NULL | NTSTATUS hex string |
| @source_port | INT | NULL | |
| @source_vm_id | VARCHAR(100) | NULL | |
| @event_timestamp | DATETIME2 | NULL | Falls back to GETUTCDATE() |

### sp_GetSuspiciousIPs

Returns IPs with `failed_attempts >= @threshold` and `status = 'active'`.

### sp_BlockIP

Inserts a global block. Updates SuspiciousIPs status to `blocked`.

### sp_RegisterVM

Upserts a VM into VMSources.

### sp_BlockIPPerVM

Inserts a per-VM block. Updates/inserts SuspiciousIPs status to `blocked`.

### sp_GetVMStats

Returns attack summary for a single VM: total attacks, unique attackers,
active block count, last attack timestamp.
