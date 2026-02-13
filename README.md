# Windows VM Failed Login Attack Monitoring & Automated IP Blocking System

## Overview

A security monitoring solution that detects failed login attempts on Windows Virtual Machines, captures source IP addresses, and provides automated blocking capabilities via a REST API.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Security Monitoring System                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌───────────┐ │
│  │   Windows    │───▶│   Log        │───▶│   Attack     │───▶│   REST    │ │
│  │   Event Log  │    │   Monitor    │    │   Detector   │    │   API     │ │
│  │   (4625)     │    │   Service    │    │   Engine     │    │   Server  │ │
│  └──────────────┘    └──────────────┘    └──────────────┘    └───────────┘ │
│                                                      │            │         │
│                                                      ▼            ▼         │
│                                            ┌──────────────┐  ┌───────────┐ │
│                                            │   MSSQL      │  │ Firewall  │ │
│                                            │   Database   │  │ Blocking  │ │
│                                            └──────────────┘  └───────────┘ │
│                                                                           │
│                                                      ▼                     │
│                                            ┌──────────────┐               │
│                                            │   React      │               │
│                                            │   Dashboard  │               │
│                                            └──────────────┘               │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Log Monitor Service
- Monitors Windows Event Log for Event ID 4625 (Failed Login)
- Extracts source IP, username, timestamp
- Low resource footprint background service

### 2. Attack Detection Engine
- Tracks failed attempts per IP
- Applies threshold rules (configurable)
- Flags suspicious IPs

### 3. REST API
- Provides suspicious IP list
- Exposes attack statistics
- Real-time blocked IP feed

### 4. Database (MSSQL)
- Stores IP addresses, attempt counts, timestamps
- Maintains attack history

### 5. Dashboard (React)
- Real-time attack visualization
- Geo-location mapping
- Attack trends

## Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| THRESHOLD | 5 | Failed attempts before blocking |
| TIME_WINDOW | 5 | Time window in minutes |
| BLOCK_DURATION | 60 | Block duration in minutes |

## Quick Start

```bash
# Install dependencies
npm install

# Run backend
npm run server

# Run frontend
npm run dashboard
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/suspicious-ips | Get suspicious IP list |
| GET | /api/statistics | Get attack statistics |
| GET | /api/blocked-ips | Get currently blocked IPs |
| POST | /api/block | Manually block an IP |
| DELETE | /api/block/:ip | Unblock an IP |

## License

MIT
