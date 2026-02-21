# Database Schema (MSSQL)

## Complete Setup Script

Run this script to initialize the database from scratch:

```sql
USE SecurityMonitor;
GO

/* ===============================
   DROP STORED PROCEDURES
================================= */

IF OBJECT_ID('sp_GetVMStats', 'P') IS NOT NULL DROP PROCEDURE sp_GetVMStats;
IF OBJECT_ID('sp_BlockIPPerVM', 'P') IS NOT NULL DROP PROCEDURE sp_BlockIPPerVM;
IF OBJECT_ID('sp_RegisterVM', 'P') IS NOT NULL DROP PROCEDURE sp_RegisterVM;
IF OBJECT_ID('sp_RecordFailedLoginMultiVM', 'P') IS NOT NULL DROP PROCEDURE sp_RecordFailedLoginMultiVM;
IF OBJECT_ID('sp_BlockIP', 'P') IS NOT NULL DROP PROCEDURE sp_BlockIP;
IF OBJECT_ID('sp_GetSuspiciousIPs', 'P') IS NOT NULL DROP PROCEDURE sp_GetSuspiciousIPs;
IF OBJECT_ID('sp_RecordFailedLogin', 'P') IS NOT NULL DROP PROCEDURE sp_RecordFailedLogin;
GO

/* ===============================
   DROP TABLES (order matters)
================================= */

IF OBJECT_ID('PerVMThresholds', 'U') IS NOT NULL DROP TABLE PerVMThresholds;
IF OBJECT_ID('AttackStatistics', 'U') IS NOT NULL DROP TABLE AttackStatistics;
IF OBJECT_ID('BlockedIPs', 'U') IS NOT NULL DROP TABLE BlockedIPs;
IF OBJECT_ID('SuspiciousIPs', 'U') IS NOT NULL DROP TABLE SuspiciousIPs;
IF OBJECT_ID('FailedLoginAttempts', 'U') IS NOT NULL DROP TABLE FailedLoginAttempts;
IF OBJECT_ID('VMSources', 'U') IS NOT NULL DROP TABLE VMSources;
IF OBJECT_ID('Settings', 'U') IS NOT NULL DROP TABLE Settings;
GO

/* ===============================
   CREATE TABLES (FIXED VERSION)
================================= */

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

CREATE INDEX idx_ip_timestamp ON FailedLoginAttempts(ip_address, timestamp);
CREATE INDEX idx_timestamp ON FailedLoginAttempts(timestamp);
CREATE INDEX idx_source_vm ON FailedLoginAttempts(source_vm_id, timestamp);
GO


CREATE TABLE SuspiciousIPs (
    id INT IDENTITY(1,1) PRIMARY KEY,
    ip_address VARCHAR(45) NOT NULL UNIQUE,
    failed_attempts INT DEFAULT 1,
    first_attempt DATETIME2,
    last_attempt DATETIME2,
    target_usernames NVARCHAR(MAX),
    status VARCHAR(20) DEFAULT 'active',
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    updated_at DATETIME2 DEFAULT GETUTCDATE()
);

CREATE INDEX idx_status ON SuspiciousIPs(status);
CREATE INDEX idx_ip ON SuspiciousIPs(ip_address);
GO


CREATE TABLE BlockedIPs (
    id INT IDENTITY(1,1) PRIMARY KEY,
    ip_address VARCHAR(45) NOT NULL,
    blocked_at DATETIME2 DEFAULT GETUTCDATE(),
    block_expires DATETIME2,
    reason NVARCHAR(500),
    blocked_by VARCHAR(50) DEFAULT 'auto',
    is_active BIT DEFAULT 1,
    unblocked_at DATETIME2 NULL,
    unblocked_by VARCHAR(50) NULL,
    scope VARCHAR(20) DEFAULT 'global',
    target_vm_id VARCHAR(100) NULL
);

CREATE INDEX idx_active ON BlockedIPs(is_active);
CREATE INDEX idx_expires ON BlockedIPs(block_expires);
CREATE INDEX idx_scope ON BlockedIPs(scope, is_active);
GO


CREATE TABLE Settings (
    key_name VARCHAR(100) PRIMARY KEY,
    value NVARCHAR(500),
    description NVARCHAR(500),
    updated_at DATETIME2 DEFAULT GETUTCDATE()
);

INSERT INTO Settings (key_name, value, description) VALUES
('THRESHOLD', '5', 'Failed attempts before marking as suspicious'),
('TIME_WINDOW', '5', 'Time window in minutes for threshold'),
('BLOCK_DURATION', '60', 'Auto-block duration in minutes'),
('ENABLE_AUTO_BLOCK', 'true', 'Enable automatic IP blocking'),
('GLOBAL_THRESHOLD', '5', 'Global threshold across all VMs'),
('ENABLE_GLOBAL_AUTO_BLOCK', 'true', 'Enable global auto-blocking');
GO


CREATE TABLE VMSources (
    id INT IDENTITY(1,1) PRIMARY KEY,
    vm_id VARCHAR(100) NOT NULL UNIQUE,
    hostname NVARCHAR(256),
    ip_address VARCHAR(45),
    collection_method VARCHAR(20),
    status VARCHAR(20) DEFAULT 'active',
    last_seen DATETIME2,
    created_at DATETIME2 DEFAULT GETUTCDATE()
);

CREATE INDEX idx_vm_id ON VMSources(vm_id);
CREATE INDEX idx_status ON VMSources(status);
GO


CREATE TABLE PerVMThresholds (
    id INT IDENTITY(1,1) PRIMARY KEY,
    vm_id VARCHAR(100) NOT NULL,
    threshold INT DEFAULT 5,
    time_window_minutes INT DEFAULT 5,
    block_duration_minutes INT DEFAULT 60,
    auto_block_enabled BIT DEFAULT 1,
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    updated_at DATETIME2 DEFAULT GETUTCDATE(),

    FOREIGN KEY (vm_id) REFERENCES VMSources(vm_id),
    UNIQUE (vm_id)
);
GO


/* ===============================
   STORED PROCEDURES (FIXED)
================================= */

CREATE PROCEDURE sp_RecordFailedLoginMultiVM
    @ip_address VARCHAR(45),
    @username NVARCHAR(256),
    @hostname NVARCHAR(256) = NULL,
    @logon_type INT = NULL,
    @failure_reason VARCHAR(20) = NULL,
    @source_port INT = NULL,
    @source_vm_id VARCHAR(100) = NULL,
    @event_timestamp DATETIME2 = NULL
AS
BEGIN
    DECLARE @ts DATETIME2 = ISNULL(@event_timestamp, GETUTCDATE());

    -- Skip if this exact event was already recorded.
    -- The combination of ip + username + port + timestamp + vm uniquely
    -- identifies a single Windows 4625 event.
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

    INSERT INTO FailedLoginAttempts
    (ip_address, username, hostname, logon_type, failure_reason, source_port, source_vm_id, timestamp)
    VALUES
    (@ip_address, @username, @hostname, @logon_type, @failure_reason, @source_port, @source_vm_id, @ts);

    IF EXISTS (SELECT 1 FROM SuspiciousIPs WHERE ip_address = @ip_address)
    BEGIN
        UPDATE SuspiciousIPs
        SET failed_attempts = failed_attempts + 1,
            last_attempt = @ts,
            updated_at = GETUTCDATE()
        WHERE ip_address = @ip_address;
    END
    ELSE
    BEGIN
        INSERT INTO SuspiciousIPs (ip_address, failed_attempts, first_attempt, last_attempt)
        VALUES (@ip_address, 1, @ts, @ts);
    END

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
    @ip_address VARCHAR(45),
    @reason NVARCHAR(500),
    @duration_minutes INT = 60,
    @blocked_by VARCHAR(50) = 'auto'
AS
BEGIN
    INSERT INTO BlockedIPs (ip_address, reason, block_expires, blocked_by)
    VALUES (@ip_address, @reason, DATEADD(MINUTE, @duration_minutes, GETUTCDATE()), @blocked_by);

    UPDATE SuspiciousIPs SET status = 'blocked' WHERE ip_address = @ip_address;
END
GO


CREATE PROCEDURE sp_RegisterVM
    @vm_id VARCHAR(100),
    @hostname NVARCHAR(256),
    @ip_address VARCHAR(45),
    @collection_method VARCHAR(20) = 'agent'
AS
BEGIN
    IF EXISTS (SELECT 1 FROM VMSources WHERE vm_id = @vm_id)
    BEGIN
        UPDATE VMSources
        SET hostname = @hostname,
            ip_address = @ip_address,
            collection_method = @collection_method,
            status = 'active',
            last_seen = GETUTCDATE()
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
    @ip_address VARCHAR(45),
    @target_vm_id VARCHAR(100),
    @reason NVARCHAR(500),
    @duration_minutes INT = 60,
    @blocked_by VARCHAR(50) = 'auto'
AS
BEGIN
    INSERT INTO BlockedIPs (ip_address, reason, block_expires, blocked_by, scope, target_vm_id)
    VALUES (@ip_address, @reason, DATEADD(MINUTE, @duration_minutes, GETUTCDATE()), @blocked_by, 'per-vm', @target_vm_id);

    IF NOT EXISTS (SELECT 1 FROM SuspiciousIPs WHERE ip_address = @ip_address)
    BEGIN
        INSERT INTO SuspiciousIPs (ip_address, failed_attempts, first_attempt, last_attempt, status)
        VALUES (@ip_address, 1, GETUTCDATE(), GETUTCDATE(), 'blocked');
    END
    ELSE
    BEGIN
        UPDATE SuspiciousIPs SET status = 'blocked', updated_at = GETUTCDATE() WHERE ip_address = @ip_address;
    END
END
GO


CREATE PROCEDURE sp_GetVMStats
    @vm_id VARCHAR(100)
AS
BEGIN
    SELECT
        source_vm_id as vm_id,
        COUNT(*) as total_attacks,
        COUNT(DISTINCT ip_address) as unique_attackers,
        (
            SELECT COUNT(*)
            FROM BlockedIPs b
            WHERE b.is_active = 1
              AND (b.scope = 'global' OR (b.scope = 'per-vm' AND b.target_vm_id = @vm_id))
        ) as blocked_count,
        MAX(timestamp) as last_attack
    FROM FailedLoginAttempts
    WHERE source_vm_id = @vm_id
    GROUP BY source_vm_id;
END
GO
```

## Tables

### 1. FailedLoginAttempts

Stores all failed login attempts captured from Windows Event Log.

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
    source_vm_id VARCHAR(100),  -- NEW: identifies source VM (null for single-VM)

    INDEX idx_ip_timestamp (ip_address, timestamp),
    INDEX idx_timestamp (timestamp),
    INDEX idx_source_vm (source_vm_id, timestamp)  -- NEW: for per-VM queries
);
```

### 2. SuspiciousIPs

Tracks IPs with multiple failed attempts.

```sql
CREATE TABLE SuspiciousIPs (
    id INT IDENTITY(1,1) PRIMARY KEY,
    ip_address VARCHAR(45) NOT NULL UNIQUE,
    failed_attempts INT DEFAULT 1,
    first_attempt DATETIME2,
    last_attempt DATETIME2,
    target_usernames NVARCHAR(MAX),  -- JSON array
    status VARCHAR(20) DEFAULT 'active',  -- active, blocked, cleared
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    updated_at DATETIME2 DEFAULT GETUTCDATE(),

    INDEX idx_status (status),
    INDEX idx_ip (ip_address)
);
```

### 3. BlockedIPs

Stores currently blocked and historical blocked IPs.

```sql
CREATE TABLE BlockedIPs (
    id INT IDENTITY(1,1) PRIMARY KEY,
    ip_address VARCHAR(45) NOT NULL,
    blocked_at DATETIME2 DEFAULT GETUTCDATE(),
    block_expires DATETIME2,
    reason NVARCHAR(500),
    blocked_by VARCHAR(50) DEFAULT 'auto',  -- auto, manual
    is_active BIT DEFAULT 1,
    unblocked_at DATETIME2 NULL,
    unblocked_by VARCHAR(50) NULL,
    scope VARCHAR(20) DEFAULT 'global',  -- NEW: global or per-vm
    target_vm_id VARCHAR(100) NULL,  -- NEW: for per-VM blocks

    INDEX idx_active (is_active),
    INDEX idx_expires (block_expires),
    INDEX idx_scope (scope, is_active)  -- NEW: for scope queries
);
```

### 4. AttackStatistics

Aggregated statistics for dashboard.

```sql
CREATE TABLE AttackStatistics (
    id INT IDENTITY(1,1) PRIMARY KEY,
    stat_date DATE,
    vm_id VARCHAR(100) NULL,  -- NEW: NULL means global aggregate
    total_attacks INT,
    unique_attackers INT,
    blocked_count INT,
    top_username NVARCHAR(256),
    top_ip VARCHAR(45),
    created_at DATETIME2 DEFAULT GETUTCDATE(),

    UNIQUE (stat_date, vm_id),  -- Updated: allow per-VM stats
    INDEX idx_date (stat_date),
    INDEX idx_vm (vm_id, stat_date)  -- NEW: for per-VM queries
);
```

### 5. Settings

Configuration settings.

```sql
CREATE TABLE Settings (
    key_name VARCHAR(100) PRIMARY KEY,
    value NVARCHAR(500),
    description NVARCHAR(500),
    updated_at DATETIME2 DEFAULT GETUTCDATE()
);

-- Default settings
INSERT INTO Settings (key_name, value, description) VALUES
('THRESHOLD', '5', 'Failed attempts before marking as suspicious'),
('TIME_WINDOW', '5', 'Time window in minutes for threshold'),
('BLOCK_DURATION', '60', 'Auto-block duration in minutes'),
('ENABLE_AUTO_BLOCK', 'true', 'Enable automatic IP blocking'),
('GLOBAL_THRESHOLD', '5', 'Global threshold across all VMs'),
('ENABLE_GLOBAL_AUTO_BLOCK', 'true', 'Enable global auto-blocking');
```

### 6. VMSources (NEW - Multi-VM)

Registry of all monitored VMs.

```sql
CREATE TABLE VMSources (
    id INT IDENTITY(1,1) PRIMARY KEY,
    vm_id VARCHAR(100) NOT NULL UNIQUE,
    hostname NVARCHAR(256),
    ip_address VARCHAR(45),
    collection_method VARCHAR(20),  -- 'wef', 'agent'
    status VARCHAR(20) DEFAULT 'active',  -- active, inactive, error
    last_seen DATETIME2,
    created_at DATETIME2 DEFAULT GETUTCDATE(),

    INDEX idx_vm_id (vm_id),
    INDEX idx_status (status)
);
```

### 7. PerVMThresholds (NEW - Multi-VM)

Override thresholds per VM.

```sql
CREATE TABLE PerVMThresholds (
    id INT IDENTITY(1,1) PRIMARY KEY,
    vm_id VARCHAR(100) NOT NULL,
    threshold INT DEFAULT 5,
    time_window_minutes INT DEFAULT 5,
    block_duration_minutes INT DEFAULT 60,
    auto_block_enabled BIT DEFAULT 1,
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    updated_at DATETIME2 DEFAULT GETUTCDATE(),

    FOREIGN KEY (vm_id) REFERENCES VMSources(vm_id),
    UNIQUE (vm_id)
);
```

## Stored Procedures

### sp_RecordFailedLogin

```sql
CREATE PROCEDURE sp_RecordFailedLogin
    @ip_address VARCHAR(45),
    @username NVARCHAR(256),
    @hostname NVARCHAR(256) = NULL,
    @logon_type INT = NULL,
    @failure_reason VARCHAR(20) = NULL,
    @source_port INT = NULL
AS
BEGIN
    INSERT INTO FailedLoginAttempts (ip_address, username, hostname, logon_type, failure_reason, source_port)
    VALUES (@ip_address, @username, @hostname, @logon_type, @failure_reason, @source_port);

    -- Update or insert suspicious IP
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
END
```

> **Design note:** `SuspiciousIPs.failed_attempts` is a lifetime counter
> for quick dashboard display. The detection engine must **not** rely on
> this counter for threshold decisions. Instead, it should count rows in
> `FailedLoginAttempts` within the configured `TIME_WINDOW`:
>
> ```sql
> -- Example: count attempts in the last N minutes for threshold check
> SELECT COUNT(*)
> FROM FailedLoginAttempts
> WHERE ip_address = @ip_address
>   AND timestamp >= DATEADD(MINUTE, -@time_window, GETUTCDATE());
> ```
>
> This prevents stale old attempts from inflating the threshold check.

### sp_GetSuspiciousIPs

```sql
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
```

### sp_BlockIP

```sql
CREATE PROCEDURE sp_BlockIP
    @ip_address VARCHAR(45),
    @reason NVARCHAR(500),
    @duration_minutes INT = 60,
    @blocked_by VARCHAR(50) = 'auto'
AS
BEGIN
    INSERT INTO BlockedIPs (ip_address, reason, block_expires, blocked_by)
    VALUES (@ip_address, @reason, DATEADD(MINUTE, @duration_minutes, GETUTCDATE()), @blocked_by);

    UPDATE SuspiciousIPs SET status = 'blocked' WHERE ip_address = @ip_address;
END
```

### sp_RecordFailedLoginMultiVM (NEW - Multi-VM)

```sql
CREATE PROCEDURE sp_RecordFailedLoginMultiVM
    @ip_address VARCHAR(45),
    @username NVARCHAR(256),
    @hostname NVARCHAR(256) = NULL,
    @logon_type INT = NULL,
    @failure_reason VARCHAR(20) = NULL,
    @source_port INT = NULL,
    @source_vm_id VARCHAR(100) = NULL,
    @event_timestamp DATETIME2 = NULL
AS
BEGIN
    DECLARE @ts DATETIME2 = ISNULL(@event_timestamp, GETUTCDATE());

    -- Skip if this exact event was already recorded.
    -- The combination of ip + username + port + timestamp + vm uniquely
    -- identifies a single Windows 4625 event.
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

    INSERT INTO FailedLoginAttempts
    (ip_address, username, hostname, logon_type, failure_reason, source_port, source_vm_id, timestamp)
    VALUES
    (@ip_address, @username, @hostname, @logon_type, @failure_reason, @source_port, @source_vm_id, @ts);

    -- Update or insert suspicious IP (global tracking)
    IF EXISTS (SELECT 1 FROM SuspiciousIPs WHERE ip_address = @ip_address)
    BEGIN
        UPDATE SuspiciousIPs
        SET failed_attempts = failed_attempts + 1,
            last_attempt = @ts,
            updated_at = GETUTCDATE()
        WHERE ip_address = @ip_address;
    END
    ELSE
    BEGIN
        INSERT INTO SuspiciousIPs (ip_address, failed_attempts, first_attempt, last_attempt)
        VALUES (@ip_address, 1, @ts, @ts);
    END

    IF @source_vm_id IS NOT NULL
    BEGIN
        UPDATE VMSources SET last_seen = GETUTCDATE() WHERE vm_id = @source_vm_id;
    END
END
```

> **Design note:** As with `sp_RecordFailedLogin`, threshold decisions
> should query `FailedLoginAttempts` with a `TIME_WINDOW` filter rather
> than relying on the `SuspiciousIPs.failed_attempts` lifetime counter.
> For per-VM thresholds, also filter by `source_vm_id`.

### sp_RegisterVM (NEW - Multi-VM)

```sql
CREATE PROCEDURE sp_RegisterVM
    @vm_id VARCHAR(100),
    @hostname NVARCHAR(256),
    @ip_address VARCHAR(45),
    @collection_method VARCHAR(20) = 'agent'
AS
BEGIN
    IF EXISTS (SELECT 1 FROM VMSources WHERE vm_id = @vm_id)
    BEGIN
        UPDATE VMSources
        SET hostname = @hostname,
            ip_address = @ip_address,
            collection_method = @collection_method,
            status = 'active',
            last_seen = GETUTCDATE()
        WHERE vm_id = @vm_id;
    END
    ELSE
    BEGIN
        INSERT INTO VMSources (vm_id, hostname, ip_address, collection_method, status, last_seen)
        VALUES (@vm_id, @hostname, @ip_address, @collection_method, 'active', GETUTCDATE());
    END
END
```

### sp_BlockIPPerVM (NEW - Multi-VM)

```sql
CREATE PROCEDURE sp_BlockIPPerVM
    @ip_address VARCHAR(45),
    @target_vm_id VARCHAR(100),
    @reason NVARCHAR(500),
    @duration_minutes INT = 60,
    @blocked_by VARCHAR(50) = 'auto'
AS
BEGIN
    INSERT INTO BlockedIPs (ip_address, reason, block_expires, blocked_by, scope, target_vm_id)
    VALUES (@ip_address, @reason, DATEADD(MINUTE, @duration_minutes, GETUTCDATE()), @blocked_by, 'per-vm', @target_vm_id);

    -- Check if also update global suspicious
    IF NOT EXISTS (SELECT 1 FROM SuspiciousIPs WHERE ip_address = @ip_address)
    BEGIN
        INSERT INTO SuspiciousIPs (ip_address, failed_attempts, first_attempt, last_attempt, status)
        VALUES (@ip_address, 1, GETUTCDATE(), GETUTCDATE(), 'blocked');
    END
    ELSE
    BEGIN
        UPDATE SuspiciousIPs SET status = 'blocked', updated_at = GETUTCDATE() WHERE ip_address = @ip_address;
    END
END
```

### sp_GetVMStats (NEW - Multi-VM)

```sql
CREATE PROCEDURE sp_GetVMStats
    @vm_id VARCHAR(100)
AS
BEGIN
    SELECT
        source_vm_id as vm_id,
        COUNT(*) as total_attacks,
        COUNT(DISTINCT ip_address) as unique_attackers,
        (
            SELECT COUNT(*)
            FROM BlockedIPs b
            WHERE b.is_active = 1
              AND (b.scope = 'global' OR (b.scope = 'per-vm' AND b.target_vm_id = @vm_id))
        ) as blocked_count,
        MAX(timestamp) as last_attack
    FROM FailedLoginAttempts
    WHERE source_vm_id = @vm_id
    GROUP BY source_vm_id;
END
```
