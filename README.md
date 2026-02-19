# Windows VM Failed Login Attack Monitoring & Automated IP Blocking System

## Overview

A security monitoring solution that detects failed login attempts on Windows Virtual Machines, captures source IP addresses, and provides automated blocking capabilities via a REST API.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Multi-VM Security Monitoring System                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐     ┌──────────────────────┐  │
│  │ Windows  │   │ Windows  │   │ Windows  │     │   Event Collector    │  │
│  │   VM #1  │   │   VM #2  │   │   VM #3  │────▶│  (WEF or Agent API)  │  │
│  │ Event    │   │ Event    │   │ Event    │     └──────────┬───────────┘  │
│  │  4625    │   │  4625    │   │  4625    │                │             │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘                ▼             │
│       │              │              │           ┌──────────────────────┐  │
│       │ WEF/Agent    │ WEF/Agent    │ WEF/Agent │   Detection Engine   │  │
│       └──────────────┴──────────────┴───────────┤   + REST API Server   │  │
│                                                   └──────────┬───────────┘  │
│                                                              │              │
│                                            ┌─────────────────┼───────────┐  │
│                                            ▼                 ▼           ▼  │
│                                      ┌──────────┐   ┌───────────┐  ┌──────┐ │
│                                      │  MSSQL   │   │ Firewall  │  │React │ │
│                                      │ Database │   │ Blocking  │  │ Dash │ │
│                                      └──────────┘   └───────────┘  └──────┘ │
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
| GLOBAL_THRESHOLD | 5 | Threshold across all VMs |
| ENABLE_GLOBAL_AUTO_BLOCK | true | Enable global IP blocking |
| ENABLE_PER_VM_BLOCK | true | Enable per-VM blocking |

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Run backend
uvicorn main:app --reload

# Run frontend
npm run dashboard
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/v1/suspicious-ips | Get suspicious IP list |
| GET | /api/v1/statistics | Get attack statistics |
| GET | /api/v1/blocked-ips | Get currently blocked IPs |
| POST | /api/v1/block | Manually block an IP |
| DELETE | /api/v1/block/:ip | Unblock an IP |
| GET | /api/v1/feed | Real-time attack feed (SSE) |
| GET | /api/v1/geo-attacks | Geo-location attack data |
| GET | /api/v1/vms | List all monitored VMs |
| POST | /api/v1/vms | Register a new VM |
| DELETE | /api/v1/vms/:vm_id | Unregister a VM |
| GET | /api/v1/vms/:vm_id/attacks | Get attacks per VM |
| POST | /api/v1/events | Receive events (agent/WEF) |
| POST | /api/v1/block/per-vm | Block IP on specific VM |
| GET | /api/v1/statistics/global | Global stats across VMs |
| GET | /api/v1/health | Health check |

## Multi-VM Support

This system supports centralized monitoring from multiple Windows VMs using either:
- **WEF (Windows Event Forwarding)**: Agentless collection from source VMs
- **Agent-based**: Lightweight Python agent on each VM

See `MULTI_VM_COLLECTION.md` for detailed setup instructions.

## License

MIT
