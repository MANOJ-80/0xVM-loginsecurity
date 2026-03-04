# Server & Database Setup Guide

Complete A-Z guide for deploying the ASP.NET Core Web API backend and SQL Server database on the central server VM.

The server receives failed login events from agents, stores them in SQL Server, tracks suspicious/blocked IPs, and provides a REST API + SSE real-time feed for the frontend dashboard.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Step 1: Install SQL Server Express](#step-1-install-sql-server-express)
4. [Step 2: Create the Database](#step-2-create-the-database)
5. [Step 3: Install .NET 10 SDK](#step-3-install-net-10-sdk)
6. [Step 4: Clone and Build the Project](#step-4-clone-and-build-the-project)
7. [Step 5: Configure the Connection String](#step-5-configure-the-connection-string)
8. [Step 6: Run the Server](#step-6-run-the-server)
9. [Step 7: Verify Everything Works](#step-7-verify-everything-works)
10. [Step 8: Windows Firewall](#step-8-windows-firewall)
11. [Step 9: Frontend Dashboard Setup](#step-9-frontend-dashboard-setup)
12. [Configuration Reference](#configuration-reference)
13. [Database Schema](#database-schema)
14. [API Reference](#api-reference)
15. [How the Server Works](#how-the-server-works)
16. [Running as a Background Service (Production)](#running-as-a-background-service-production)
17. [Troubleshooting](#troubleshooting)
18. [File Reference](#file-reference)

---

## Architecture Overview

```
   Agent VMs                         Server VM
┌─────────────┐                ┌──────────────────────────┐
│  vm-001     │──┐             │                          │
├─────────────┤  │  HTTP POST  │  ASP.NET Core Web API    │
│  vm-002     │──┼────────────>│  http://0.0.0.0:3000     │
├─────────────┤  │             │                          │
│  vm-003     │──┘             │        │                 │
└─────────────┘                │        ▼                 │
                               │  SQL Server Express      │
   Frontend                    │  Database: SecurityMonitor│
┌─────────────┐  HTTP GET/SSE  │                          │
│  Dashboard  │<───────────────│                          │
└─────────────┘                └──────────────────────────┘
```

- The server VM is the only machine that needs .NET and SQL Server installed
- Agent VMs only need the Python agent (see `AGENT_SETUP.md`)
- The server listens on all network interfaces (`0.0.0.0:3000`)

---

## Prerequisites

### Server VM Requirements

| Requirement    | Details                                          |
| -------------- | ------------------------------------------------ |
| **OS**         | Windows 10 / Windows Server 2016 or later        |
| **SQL Server** | SQL Server 2019 Express or later (free)          |
| **.NET SDK**   | .NET 10.0 SDK (10.0.100+)                        |
| **RAM**        | 4 GB minimum recommended                         |
| **Disk**       | ~500 MB for SQL Server + .NET SDK + database     |
| **Network**    | Inbound TCP port 3000 open for agent connections |

---

## Step 1: Install SQL Server Express

### Download

Go to: https://www.microsoft.com/en-us/sql-server/sql-server-downloads

Scroll down to **Express** edition (free) and download.

### Install

1. Run the installer
2. Choose **Basic** installation type
3. Accept the license terms
4. Use the default install location
5. Wait for installation to complete

The default instance name is `SQLEXPRESS`, so the server address will be `localhost\SQLEXPRESS`.

### Verify Installation

Open PowerShell and run:

```powershell
sqlcmd -S localhost\SQLEXPRESS -E -Q "SELECT @@VERSION"
```

You should see the SQL Server version info. If `sqlcmd` is not found, it's at:

```
C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\...\Tools\Binn\sqlcmd.exe
```

---

## Step 2: Create the Database

Open PowerShell or Command Prompt and run:

```powershell
sqlcmd -S localhost\SQLEXPRESS -E -Q "CREATE DATABASE SecurityMonitor"
```

That's it. The ASP.NET backend will create all tables automatically on first startup via EF Core migrations.

### If the database already exists (from the Python backend)

No action needed. The server detects existing tables and skips the `InitialCreate` migration. It marks the migration as applied in `__EFMigrationsHistory` and only runs future migrations.

---

## Step 3: Install .NET 10 SDK

### Download

Go to: https://dotnet.microsoft.com/en-us/download/dotnet/10.0

Download the **.NET SDK 10.0** installer for Windows (x64).

### Install

Run the installer with default options.

### Verify Installation

```powershell
dotnet --version
```

Expected output: `10.0.100` or later (e.g., `10.0.103`).

---

## Step 4: Clone and Build the Project

### Clone

```powershell
git clone https://github.com/MANOJ-80/0xVM-loginsecurity.git
cd 0xVM-loginsecurity\aspbackend
```

### Restore Dependencies

```powershell
dotnet restore
```

### Build

```powershell
dotnet build
```

Expected output:

```
Build succeeded.
    0 Warning(s)
    0 Error(s)
```

---

## Step 5: Configure the Connection String

The connection string is in `appsettings.json` (and `appsettings.Development.json` for dev overrides).

### Default Connection String

```json
{
  "ConnectionStrings": {
    "SecurityMonitor": "Server=localhost\\SQLEXPRESS;Database=SecurityMonitor;Trusted_Connection=True;TrustServerCertificate=True;Encrypt=True;"
  }
}
```

### Connection String Parameters

| Parameter                | Value                  | Description                                                             |
| ------------------------ | ---------------------- | ----------------------------------------------------------------------- |
| `Server`                 | `localhost\SQLEXPRESS` | SQL Server instance. Change if using a named instance or remote server. |
| `Database`               | `SecurityMonitor`      | Database name. Must match what you created in Step 2.                   |
| `Trusted_Connection`     | `True`                 | Use Windows Authentication (no username/password needed).               |
| `TrustServerCertificate` | `True`                 | Skip certificate validation (required for local SQLEXPRESS).            |
| `Encrypt`                | `True`                 | Enable encryption (required by modern SQL Server drivers).              |

### If using SQL Server Authentication instead of Windows Auth

```json
{
  "ConnectionStrings": {
    "SecurityMonitor": "Server=localhost\\SQLEXPRESS;Database=SecurityMonitor;User Id=sa;Password=YourPassword;TrustServerCertificate=True;Encrypt=True;"
  }
}
```

---

## Step 6: Run the Server

```powershell
cd aspbackend
dotnet run
```

### Expected Startup Output

```
info: Program[0]
      Existing database detected — marked InitialCreate migration as applied.
info: Microsoft.EntityFrameworkCore.Migrations[20405]
      No migrations were applied. The database is already up to date.
info: Program[0]
      Database migration applied successfully.
info: Microsoft.Hosting.Lifetime[14]
      Now listening on: http://0.0.0.0:3000
info: Microsoft.Hosting.Lifetime[0]
      Application started. Press Ctrl+C to shut down.
```

If this is a **fresh database** (no existing tables), you'll instead see:

```
info: Microsoft.EntityFrameworkCore.Migrations[20402]
      Applying migration '20260304133110_InitialCreate'.
info: Program[0]
      Database migration applied successfully.
```

### The server is now running on `http://0.0.0.0:3000`

This means it accepts connections from:

- `http://localhost:3000` (from the server itself)
- `http://<SERVER_IP>:3000` (from agent VMs and frontend)

---

## Step 7: Verify Everything Works

### Health Check

From the server VM:

```powershell
curl http://localhost:3000/api/v1/health
```

Expected response:

```json
{
  "success": true,
  "status": "healthy",
  "uptime_seconds": 0,
  "active_vms": 0,
  "db_connected": true
}
```

### From an Agent VM

```powershell
curl http://<SERVER_IP>:3000/api/v1/health
```

If this fails, check the firewall (Step 8).

### Verify Database Tables

```powershell
sqlcmd -S localhost\SQLEXPRESS -E -d SecurityMonitor -Q "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES ORDER BY TABLE_NAME"
```

Expected tables:

```
__EFMigrationsHistory
AttackStatistics
BlockedIPs
FailedLoginAttempts
PerVMThresholds
Settings
SuspiciousIPs
VMSources
```

---

## Step 8: Windows Firewall

The server must allow inbound connections on TCP port 3000.

### Create Firewall Rule

```powershell
New-NetFirewallRule -DisplayName "Security Monitor API" `
    -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

### Verify the Rule

```powershell
Get-NetFirewallRule -DisplayName "Security Monitor API"
```

### Remove the Rule (if needed)

```powershell
Remove-NetFirewallRule -DisplayName "Security Monitor API"
```

---

## Step 9: Frontend Dashboard Setup

The frontend is a **Vite + React** single-page application that provides a real-time security monitoring dashboard. It connects to the ASP.NET backend API.

### Prerequisites

| Requirement | Details                                          |
| ----------- | ------------------------------------------------ |
| **Node.js** | v18.0 or later (LTS recommended)                 |
| **npm**     | v9.0+ (bundled with Node.js)                     |
| **Backend** | ASP.NET backend running on port 3000 (Steps 1–8) |

### Install Node.js

Go to: https://nodejs.org/

Download the **LTS** version and install with default options.

Verify:

```powershell
node --version
npm --version
```

### Install Frontend Dependencies

```powershell
cd 0xVM-loginsecurity\frontend
npm install
```

### Configure Backend URL

The backend API URL is configured via the `.env` file in the `frontend/` directory:

```env
VITE_API_BASE=http://localhost:3000/api/v1
```

**If the backend is on a different machine**, update this to point to the server IP:

```env
VITE_API_BASE=http://192.168.56.102:3000/api/v1
```

> **Note:** You must restart the dev server after changing `.env` values.

### Run the Frontend (Development)

```powershell
cd frontend
npm run dev
```

Expected output:

```
VITE v7.3.1  ready in 300 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

Open **http://localhost:5173/** in your browser.

### Run the Frontend (Production Build)

```powershell
cd frontend
npm run build
npm run preview
```

The production build outputs static files to `frontend/dist/`. These can be served by any web server (Nginx, IIS, etc.).

### Frontend Pages

| Route             | Page             | Description                                                        |
| ----------------- | ---------------- | ------------------------------------------------------------------ |
| `/`               | Dashboard        | Stat cards, hourly attack chart, username pie chart, live SSE feed |
| `/suspicious-ips` | Suspicious IPs   | Filterable table with threshold control                            |
| `/blocked-ips`    | Blocked IPs      | Block/unblock IPs with modal form                                  |
| `/vms`            | Virtual Machines | Register/remove VMs, view per-VM attack stats                      |
| `/live-feed`      | Live Feed        | Real-time SSE event stream with pause/resume                       |

### Frontend File Structure

```
frontend/
├── .env                                 # Backend API URL config
├── index.html                           # HTML entry point
├── package.json                         # Dependencies and scripts
├── vite.config.js                       # Vite configuration
└── src/
    ├── main.jsx                         # React entry point
    ├── App.jsx                          # Router and providers
    ├── index.css                        # Global design system (Froze theme)
    ├── services/
    │   └── api.js                       # All API calls + SSE subscription
    ├── context/
    │   └── ToastContext.jsx             # Toast notification system
    ├── components/
    │   ├── Layout.jsx                   # Sidebar + content layout
    │   └── Sidebar.jsx                  # Navigation + health indicator
    └── pages/
        ├── Dashboard.jsx                # Main dashboard with charts
        ├── SuspiciousIps.jsx            # Suspicious IPs table
        ├── BlockedIps.jsx               # Blocked IPs management
        ├── VirtualMachines.jsx          # VM management
        └── LiveFeed.jsx                 # Real-time SSE feed
```

### Frontend Tech Stack

| Component  | Technology                               |
| ---------- | ---------------------------------------- |
| Build Tool | Vite 7                                   |
| UI Library | React 19                                 |
| Routing    | react-router-dom                         |
| Charts     | Recharts                                 |
| Icons      | Lucide React                             |
| Styling    | Vanilla CSS (Froze Communications theme) |

---

## Configuration Reference

### appsettings.json

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning",
      "Microsoft.EntityFrameworkCore": "Warning"
    }
  },
  "AllowedHosts": "*",
  "ConnectionStrings": {
    "SecurityMonitor": "Server=localhost\\SQLEXPRESS;Database=SecurityMonitor;Trusted_Connection=True;TrustServerCertificate=True;Encrypt=True;"
  }
}
```

### appsettings.Development.json

Overrides for development. Sets EF Core logging to `Information` level so you can see SQL queries:

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning",
      "Microsoft.EntityFrameworkCore": "Information"
    }
  },
  "ConnectionStrings": {
    "SecurityMonitor": "Server=localhost\\SQLEXPRESS;Database=SecurityMonitor;Trusted_Connection=True;TrustServerCertificate=True;Encrypt=True;"
  }
}
```

### Port Configuration

The listening port is set in `Properties/launchSettings.json`:

```json
"applicationUrl": "http://0.0.0.0:3000"
```

To change the port, edit this value. For example, to use port 8080:

```json
"applicationUrl": "http://0.0.0.0:8080"
```

You can also override the port at runtime without editing files:

```powershell
dotnet run --urls "http://0.0.0.0:5000"
```

### JSON Response Format

All API responses use **snake_case** naming (e.g., `ip_address`, `blocked_at`) to match the original Python/FastAPI backend. Null values are omitted from responses.

---

## Database Schema

### Overview

7 application tables + 1 EF Core tracking table:

| Table                   | Purpose                                                     |
| ----------------------- | ----------------------------------------------------------- |
| `FailedLoginAttempts`   | Every failed login event received from agents               |
| `SuspiciousIPs`         | IPs with failed attempts above threshold (lifetime counter) |
| `BlockedIPs`            | Manually or auto-blocked IP addresses                       |
| `Settings`              | System configuration (thresholds, auto-block toggle, etc.)  |
| `VMSources`             | Registered agent VMs                                        |
| `PerVMThresholds`       | Per-VM override thresholds                                  |
| `AttackStatistics`      | Daily aggregated statistics                                 |
| `__EFMigrationsHistory` | EF Core migration tracking (internal)                       |

### Table: FailedLoginAttempts

| Column           | Type               | Nullable | Default        | Description                            |
| ---------------- | ------------------ | -------- | -------------- | -------------------------------------- |
| `Id`             | int (PK, identity) | No       | Auto-increment | Primary key                            |
| `ip_address`     | nvarchar(45)       | No       | —              | Attacker's IP address                  |
| `username`       | nvarchar(256)      | Yes      | —              | Targeted username                      |
| `hostname`       | nvarchar(256)      | Yes      | —              | Source hostname                        |
| `logon_type`     | int                | Yes      | —              | Windows logon type (3=network, 10=RDP) |
| `failure_reason` | nvarchar(20)       | Yes      | —              | SubStatus code (e.g., 0xC000006A)      |
| `source_port`    | int                | Yes      | —              | Source TCP port                        |
| `timestamp`      | datetime2          | No       | —              | When the event occurred (local time)   |
| `event_id`       | int                | No       | 4625           | Windows Event ID                       |
| `source_vm_id`   | nvarchar(100)      | Yes      | —              | Which VM reported this event           |

**Indexes:**

- `idx_ip_timestamp` — (ip_address, timestamp)
- `idx_timestamp` — (timestamp)
- `idx_source_vm` — (source_vm_id, timestamp)
- `idx_dedup_check` — (ip_address, username, source_port, timestamp, source_vm_id) — used for server-side dedup

### Table: SuspiciousIPs

| Column             | Type               | Nullable | Default        | Description                       |
| ------------------ | ------------------ | -------- | -------------- | --------------------------------- |
| `Id`               | int (PK, identity) | No       | Auto-increment | Primary key                       |
| `ip_address`       | nvarchar(45)       | No       | —              | Suspicious IP (unique)            |
| `failed_attempts`  | int                | No       | 1              | Lifetime count of failed attempts |
| `first_attempt`    | datetime2          | Yes      | —              | First seen                        |
| `last_attempt`     | datetime2          | Yes      | —              | Most recent attempt               |
| `target_usernames` | nvarchar(max)      | Yes      | —              | JSON array (future use)           |
| `status`           | nvarchar(20)       | No       | 'active'       | active, blocked, or cleared       |
| `created_at`       | datetime2          | No       | GETDATE()      | Row creation time                 |
| `updated_at`       | datetime2          | No       | GETDATE()      | Last update time                  |

**Indexes:**

- `idx_suspicious_ip` — (ip_address) UNIQUE
- `idx_suspicious_status` — (status)

### Table: BlockedIPs

| Column          | Type               | Nullable | Default        | Description                           |
| --------------- | ------------------ | -------- | -------------- | ------------------------------------- |
| `Id`            | int (PK, identity) | No       | Auto-increment | Primary key                           |
| `ip_address`    | nvarchar(45)       | No       | —              | Blocked IP                            |
| `blocked_at`    | datetime2          | No       | GETDATE()      | When blocked                          |
| `block_expires` | datetime2          | Yes      | —              | When the block expires                |
| `reason`        | nvarchar(500)      | Yes      | —              | Reason for blocking                   |
| `blocked_by`    | nvarchar(50)       | No       | 'auto'         | 'auto' or 'manual'                    |
| `is_active`     | bit                | No       | 1 (true)       | Whether the block is currently active |
| `unblocked_at`  | datetime2          | Yes      | —              | When unblocked (if applicable)        |
| `unblocked_by`  | nvarchar(50)       | Yes      | —              | Who unblocked                         |
| `scope`         | nvarchar(20)       | No       | 'global'       | 'global' or 'per-vm'                  |
| `target_vm_id`  | nvarchar(100)      | Yes      | —              | Target VM (for per-vm blocks)         |

**Indexes:**

- `idx_blocked_active` — (is_active)
- `idx_blocked_expires` — (block_expires)
- `idx_blocked_scope` — (scope, is_active)

### Table: Settings

| Column        | Type               | Nullable | Default   | Description                |
| ------------- | ------------------ | -------- | --------- | -------------------------- |
| `key_name`    | nvarchar(100) (PK) | No       | —         | Setting name               |
| `value`       | nvarchar(500)      | Yes      | —         | Setting value              |
| `description` | nvarchar(500)      | Yes      | —         | Human-readable description |
| `updated_at`  | datetime2          | No       | GETDATE() | Last update time           |

**Seed Data** (inserted by InitialCreate migration):

| key_name                   | value  | description                                  |
| -------------------------- | ------ | -------------------------------------------- |
| `THRESHOLD`                | `5`    | Failed attempts before marking as suspicious |
| `TIME_WINDOW`              | `5`    | Time window in minutes for threshold         |
| `BLOCK_DURATION`           | `60`   | Auto-block duration in minutes               |
| `ENABLE_AUTO_BLOCK`        | `true` | Enable automatic IP blocking                 |
| `GLOBAL_THRESHOLD`         | `5`    | Global threshold across all VMs              |
| `ENABLE_GLOBAL_AUTO_BLOCK` | `true` | Enable global auto-blocking                  |

### Table: VMSources

| Column              | Type               | Nullable | Default        | Description               |
| ------------------- | ------------------ | -------- | -------------- | ------------------------- |
| `Id`                | int (PK, identity) | No       | Auto-increment | Primary key               |
| `vm_id`             | nvarchar(100)      | No       | —              | Unique VM identifier      |
| `hostname`          | nvarchar(256)      | Yes      | —              | VM hostname               |
| `ip_address`        | nvarchar(45)       | Yes      | —              | VM IP address             |
| `collection_method` | nvarchar(20)       | Yes      | —              | 'agent' or 'wef'          |
| `status`            | nvarchar(20)       | No       | 'active'       | active, inactive, error   |
| `last_seen`         | datetime2          | Yes      | —              | Last time agent sent data |
| `created_at`        | datetime2          | No       | GETDATE()      | Row creation time         |

**Indexes:**

- `idx_vmsources_vm_id` — (vm_id) UNIQUE
- `idx_vmsources_status` — (status)

### Table: PerVMThresholds

| Column                   | Type               | Nullable | Default        | Description                       |
| ------------------------ | ------------------ | -------- | -------------- | --------------------------------- |
| `Id`                     | int (PK, identity) | No       | Auto-increment | Primary key                       |
| `vm_id`                  | nvarchar(100)      | No       | —              | FK to VMSources.vm_id (unique)    |
| `threshold`              | int                | No       | 5              | Failed attempts before suspicious |
| `time_window_minutes`    | int                | No       | 5              | Time window in minutes            |
| `block_duration_minutes` | int                | No       | 60             | Auto-block duration in minutes    |
| `auto_block_enabled`     | bit                | No       | 1 (true)       | Enable auto-block for this VM     |
| `created_at`             | datetime2          | No       | GETDATE()      | Row creation time                 |
| `updated_at`             | datetime2          | No       | GETDATE()      | Last update time                  |

**Indexes:**

- (vm_id) UNIQUE
- FK relationship: `PerVMThresholds.vm_id` -> `VMSources.vm_id`

### Table: AttackStatistics

| Column             | Type               | Nullable | Default        | Description                 |
| ------------------ | ------------------ | -------- | -------------- | --------------------------- |
| `Id`               | int (PK, identity) | No       | Auto-increment | Primary key                 |
| `stat_date`        | date               | Yes      | —              | The date for this statistic |
| `vm_id`            | nvarchar(100)      | Yes      | —              | NULL = global aggregate     |
| `total_attacks`    | int                | Yes      | —              | Total attacks on this date  |
| `unique_attackers` | int                | Yes      | —              | Distinct attacker IPs       |
| `blocked_count`    | int                | Yes      | —              | IPs blocked                 |
| `top_username`     | nvarchar(256)      | Yes      | —              | Most targeted username      |
| `top_ip`           | nvarchar(45)       | Yes      | —              | Most active attacker IP     |
| `created_at`       | datetime2          | No       | GETDATE()      | Row creation time           |

**Indexes:**

- `IX_AttackStatistics_StatDate_VmId` — (stat_date, vm_id) UNIQUE
- `idx_stats_date` — (stat_date)
- `idx_stats_vm` — (vm_id, stat_date)

---

## API Reference

Base URL: `http://<SERVER_IP>:3000`

All responses are JSON with **snake_case** field names.

### GET /api/v1/health

Health check endpoint.

**Response:**

```json
{
  "success": true,
  "status": "healthy",
  "uptime_seconds": 0,
  "active_vms": 2,
  "db_connected": true
}
```

---

### POST /api/v1/events

Receive failed login events from agents. This is the main data ingestion endpoint.

**Request Body:**

```json
{
  "vm_id": "vm-001",
  "hostname": "DESKTOP-P9H3C6A",
  "events": [
    {
      "timestamp": "2026-03-04T19:34:16.7999016",
      "ip_address": "192.168.56.105",
      "username": "admin",
      "domain": "WORKGROUP",
      "logon_type": "3",
      "status": "0xC000006A",
      "workstation": "ATTACKER-PC",
      "source_port": "49152"
    }
  ]
}
```

**Response:**

```json
{
  "success": true,
  "events_received": 1
}
```

**What happens server-side:**

1. Dedup check (skip if exact event already exists)
2. Insert into `FailedLoginAttempts`
3. Update or insert `SuspiciousIPs` (increment counter)
4. Update `VMSources.last_seen`
5. Publish to SSE feed

---

### GET /api/v1/suspicious-ips?threshold=5

Get IPs with failed attempts >= threshold.

**Query Parameters:**
| Parameter | Type | Default | Description |
|---|---|---|---|
| `threshold` | int | 5 | Minimum failed attempts to include |

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "ip_address": "192.168.56.105",
      "failed_attempts": 12,
      "first_attempt": "2026-03-04T18:00:00",
      "last_attempt": "2026-03-04T19:34:16",
      "status": "active"
    }
  ],
  "count": 1
}
```

---

### GET /api/v1/blocked-ips

Get all currently active blocked IPs.

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "ip_address": "192.168.56.105",
      "blocked_at": "2026-03-04T19:35:00",
      "block_expires": "2026-03-04T21:35:00",
      "reason": "Exceeded threshold",
      "blocked_by": "manual"
    }
  ],
  "count": 1
}
```

---

### POST /api/v1/block

Manually block an IP address (global scope).

**Request Body:**

```json
{
  "ip_address": "192.168.56.105",
  "reason": "Brute force attack",
  "duration_minutes": 120
}
```

**Response:**

```json
{
  "success": true,
  "message": "IP 192.168.56.105 blocked for 120 minutes"
}
```

---

### POST /api/v1/block/per-vm

Block an IP address for a specific VM only.

**Request Body:**

```json
{
  "ip_address": "192.168.56.105",
  "vm_id": "vm-001",
  "reason": "Targeted attack on this VM",
  "duration_minutes": 60
}
```

**Response:**

```json
{
  "success": true,
  "message": "IP 192.168.56.105 blocked on VM vm-001 for 60 minutes"
}
```

---

### DELETE /api/v1/block/{ip}

Unblock an IP address. Deactivates all active blocks for this IP and sets suspicious status to `cleared`.

**Response:**

```json
{
  "success": true,
  "message": "IP 192.168.56.105 unblocked"
}
```

---

### POST /api/v1/vms

Register a VM with the collector. Called automatically by the agent on startup.

**Request Body:**

```json
{
  "vm_id": "vm-001",
  "hostname": "DESKTOP-P9H3C6A",
  "ip_address": "192.168.56.101",
  "collection_method": "agent"
}
```

**Response:**

```json
{
  "success": true,
  "message": "VM vm-001 registered successfully"
}
```

If the VM already exists, its info is updated (hostname, IP, status set to active, last_seen updated).

---

### GET /api/v1/vms

List all registered VMs.

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "vm_id": "vm-001",
      "hostname": "DESKTOP-P9H3C6A",
      "ip_address": "192.168.56.101",
      "collection_method": "agent",
      "status": "active",
      "last_seen": "2026-03-04T19:34:16"
    }
  ],
  "count": 1
}
```

---

### DELETE /api/v1/vms/{vm_id}

Unregister a VM (sets status to `inactive`, does not delete data).

**Response:**

```json
{
  "success": true,
  "message": "VM vm-001 unregistered"
}
```

---

### GET /api/v1/vms/{vm_id}/attacks

Get attack statistics for a specific VM.

**Response:**

```json
{
  "success": true,
  "vm_id": "vm-001",
  "total_attacks": 42,
  "unique_attackers": 5,
  "blocked_count": 2,
  "last_attack": "2026-03-04T19:34:16"
}
```

---

### GET /api/v1/feed

**Server-Sent Events (SSE)** real-time feed. Streams new attack events as they arrive.

**Headers:**

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**Event Format:**

```
event: new_attack
data: {"ip_address":"192.168.56.105","username":"admin","timestamp":"2026-03-04T19:34:16","vm_id":"vm-001"}

event: ping
data: keep-alive
```

- `new_attack` events are sent whenever `POST /api/v1/events` is called
- `ping` events are sent every ~1 second to keep the connection alive
- Each SSE client gets its own channel (multiple clients supported simultaneously)

**Example usage (JavaScript):**

```javascript
const evtSource = new EventSource("http://<SERVER_IP>:3000/api/v1/feed");
evtSource.addEventListener("new_attack", (e) => {
  const data = JSON.parse(e.data);
  console.log(`Attack from ${data.ip_address} targeting ${data.username}`);
});
```

---

### GET /api/v1/statistics

Get overall attack statistics (last 24 hours focus).

**Response:**

```json
{
  "success": true,
  "data": {
    "total_failed_attempts": 150,
    "unique_attackers": 12,
    "blocked_ips": 3,
    "attacks_last_24h": 45,
    "attacks_last_hour": 8,
    "top_attacked_usernames": [
      { "username": "admin", "count": 50 },
      { "username": "administrator", "count": 30 }
    ],
    "attacks_by_hour": [
      { "hour": "14:00", "count": 10 },
      { "hour": "15:00", "count": 15 }
    ]
  }
}
```

---

### GET /api/v1/statistics/global

Get global statistics across all VMs (includes per-VM breakdown).

**Response:**

```json
{
  "success": true,
  "data": {
    "total_failed_attempts": 150,
    "unique_attackers": 12,
    "blocked_ips": 3,
    "active_vms": 2,
    "inactive_vms": 0,
    "attacks_last_24h": 45,
    "attacks_last_hour": 8,
    "attacks_by_vm": [
      { "vm_id": "vm-001", "count": 30 },
      { "vm_id": "vm-002", "count": 15 }
    ],
    "top_attacked_usernames": [{ "username": "admin", "count": 50 }],
    "attacks_by_hour": [{ "hour": "14:00", "count": 10 }]
  }
}
```

---

### GET /api/v1/geo-attacks

Stub endpoint for future geo-IP integration. Currently returns an empty array.

**Response:**

```json
{
  "success": true,
  "data": []
}
```

---

## How the Server Works

### Startup Sequence

1. **Configure services** — EF Core DbContext, SecurityMonitorService, EventBroadcastService, controllers, CORS, snake_case JSON
2. **Build app** — middleware pipeline: CORS -> Controllers
3. **Auto-migrate** —
   - Open DB connection
   - Check if `AttackStatistics` table exists (proxy for "existing database")
   - If tables exist: create `__EFMigrationsHistory` if needed, insert InitialCreate migration record
   - Call `Migrate()` — applies any pending migrations (skips InitialCreate if already recorded)
4. **Start listening** on `http://0.0.0.0:3000`

### Event Processing Flow (POST /api/v1/events)

1. Parse JSON request body
2. For each event in the batch:
   - Check for duplicate in `FailedLoginAttempts` (server-side dedup)
   - Insert into `FailedLoginAttempts`
   - Update or create `SuspiciousIPs` entry (increment counter)
   - Update `VMSources.last_seen`
3. Single `SaveChangesAsync()` for the entire batch (performance optimization)
4. Publish each event to the SSE broadcast service
5. Return `{"success": true, "events_received": N}`

### SSE Broadcast Architecture

- `EventBroadcastService` is a singleton with a subscriber-list pattern
- Each SSE client (`GET /api/v1/feed`) gets its own `Channel<SseEventData>`
- `Publish()` fans out to all subscriber channels (non-blocking `TryWrite`)
- Client disconnection triggers `Unsubscribe()` which removes the channel
- Ping messages sent every ~1 second to keep connections alive

---

## Running as a Background Service (Production)

For production, you don't want to keep a terminal open. Options:

### Option 1: Publish and run as a Windows Service

```powershell
# Publish a self-contained release build
cd aspbackend
dotnet publish -c Release -o C:\SecurityMonitorApi

# Install as a Windows Service
sc.exe create SecurityMonitorApi `
    binPath= "C:\SecurityMonitorApi\SecurityMonitorApi.exe --urls http://0.0.0.0:3000" `
    start= auto `
    DisplayName= "Security Monitor API"

# Start the service
sc.exe start SecurityMonitorApi
```

### Option 2: Use Task Scheduler

1. Open Task Scheduler
2. Create Basic Task -> "Security Monitor API"
3. Trigger: At startup
4. Action: Start a program
5. Program: `dotnet`
6. Arguments: `run --urls http://0.0.0.0:3000`
7. Start in: `C:\path\to\0xVM-loginsecurity\aspbackend`
8. Check "Run whether user is logged on or not"

### Option 3: Use `nssm` (Non-Sucking Service Manager)

```powershell
# Download nssm from https://nssm.cc
nssm install SecurityMonitorApi "C:\SecurityMonitorApi\SecurityMonitorApi.exe"
nssm set SecurityMonitorApi AppParameters "--urls http://0.0.0.0:3000"
nssm set SecurityMonitorApi Start SERVICE_AUTO_START
nssm start SecurityMonitorApi
```

---

## Troubleshooting

### "Database migration failed. Ensure SQL Server is running and the connection string is correct."

- **Check**: Is SQL Server Express running? Open `services.msc` and look for `SQL Server (SQLEXPRESS)`
- **Check**: Is the connection string correct in `appsettings.json`?
- **Check**: Does the `SecurityMonitor` database exist? Run: `sqlcmd -S localhost\SQLEXPRESS -E -Q "SELECT name FROM sys.databases"`
- **Check**: Are you running the app as a user with Windows Auth access to SQL Server?

### "There is already an object named 'X' in the database"

This should not happen with the current code (auto-detection of existing tables). If it does:

- Manually insert the migration record:

```sql
INSERT INTO __EFMigrationsHistory (MigrationId, ProductVersion)
VALUES ('20260304133110_InitialCreate', '10.0.3');
```

### Port 3000 already in use

- **Check**: Is the Python backend still running on port 3000? Stop it first.
- **Check**: `netstat -ano | findstr :3000` to find what's using the port
- **Fix**: Change the port in `Properties/launchSettings.json` or use `--urls` flag

### Agent can't connect (connection refused / timeout)

- **Check**: Is the server running? (`dotnet run`)
- **Check**: Firewall rule for TCP 3000 exists?
- **Check**: Server is binding to `0.0.0.0:3000` (not `localhost:3000`)?
- **Test**: From the agent VM: `curl http://<SERVER_IP>:3000/api/v1/health`

### EF Core "PendingModelChangesWarning"

This means a model property uses a dynamic value (like `DateTime.Now`) in `HasData` seed. All seed data should use static values. This was already fixed — if you see it, make sure you pulled the latest code.

---

## File Reference

### Project Structure

```
aspbackend/
├── Controllers/
│   └── SecurityMonitorController.cs    # All 15 API endpoints
├── Data/
│   └── SecurityMonitorContext.cs        # EF Core DbContext, table config, seed data
├── DTOs/
│   └── Dtos.cs                          # Request/response data transfer objects
├── Migrations/
│   ├── 20260304133110_InitialCreate.cs  # Migration: creates all 7 tables
│   ├── ...Designer.cs                   # Migration metadata
│   └── SecurityMonitorContextModelSnapshot.cs
├── Models/
│   ├── FailedLoginAttempt.cs            # FailedLoginAttempts table entity
│   ├── SuspiciousIp.cs                  # SuspiciousIPs table entity
│   ├── BlockedIp.cs                     # BlockedIPs table entity
│   ├── Setting.cs                       # Settings table entity
│   ├── VmSource.cs                      # VMSources table entity
│   ├── PerVmThreshold.cs               # PerVMThresholds table entity
│   └── AttackStatistic.cs              # AttackStatistics table entity
├── Properties/
│   └── launchSettings.json              # Port and environment config
├── Services/
│   ├── SecurityMonitorService.cs        # Business logic (replaces stored procedures)
│   └── EventBroadcastService.cs         # SSE real-time broadcast
├── appsettings.json                     # Production config + connection string
├── appsettings.Development.json         # Dev config overrides
├── Program.cs                           # App entry point, DI, middleware, auto-migrate
└── SecurityMonitorApi.csproj            # Project file (.NET 10, EF Core 10 packages)
```

### Technology Stack

| Component   | Technology               | Version              |
| ----------- | ------------------------ | -------------------- |
| Runtime     | .NET                     | 10.0 LTS             |
| Framework   | ASP.NET Core Web API     | 10.0                 |
| ORM         | Entity Framework Core    | 10.0                 |
| Database    | SQL Server Express       | 2019+                |
| Auth        | Windows Authentication   | (Trusted_Connection) |
| Real-time   | Server-Sent Events (SSE) | native               |
| JSON        | System.Text.Json         | snake_case           |
| DB Approach | Code-First               | EF Core Migrations   |
