# Database Schema (MSSQL)

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
    failure_reason INT,
    source_port INT,
    timestamp DATETIME2 DEFAULT GETUTCDATE(),
    event_id INT DEFAULT 4625,
    
    INDEX idx_ip_timestamp (ip_address, timestamp),
    INDEX idx_timestamp (timestamp)
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
    
    INDEX idx_active (is_active),
    INDEX idx_expires (block_expires)
);
```

### 4. AttackStatistics

Aggregated statistics for dashboard.

```sql
CREATE TABLE AttackStatistics (
    id INT IDENTITY(1,1) PRIMARY KEY,
    stat_date DATE,
    total_attacks INT,
    unique_attackers INT,
    blocked_count INT,
    top_username NVARCHAR(256),
    top_ip VARCHAR(45),
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    
    UNIQUE (stat_date)
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
('ENABLE_AUTO_BLOCK', 'true', 'Enable automatic IP blocking');
```

## Stored Procedures

### sp_RecordFailedLogin
```sql
CREATE PROCEDURE sp_RecordFailedLogin
    @ip_address VARCHAR(45),
    @username NVARCHAR(256),
    @hostname NVARCHAR(256) = NULL,
    @logon_type INT = NULL,
    @failure_reason INT = NULL,
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
