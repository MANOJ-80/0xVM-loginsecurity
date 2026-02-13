# System Architecture

## Component Diagram

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                    Windows VM                             │
                    │  ┌───────────────────────────────────────────────────┐  │
                    │  │           Windows Event Log (Security)            │  │
                    │  │              Event ID: 4625                       │  │
                    │  └──────────────────────┬────────────────────────────┘  │
                    │                         │                               │
                    │                         ▼                               │
                    │  ┌───────────────────────────────────────────────────┐  │
                    │  │              Log Monitor Service                  │  │
                    │  │         (Python/.NET Background Worker)           │  │
                    │  │  • Reads Event Log entries                         │  │
                    │  │  • Parses XML event data                          │  │
                    │  │  • Extracts IP, username, timestamp                │  │
                    │  └──────────────────────┬────────────────────────────┘  │
                    │                         │                               │
                    │                         ▼                               │
                    └─────────────────────────┼───────────────────────────────┘
                                              │
                                              ▼
                    ┌─────────────────────────────────────────────────────────┐
                    │                   Backend Server                        │
                    │  ┌──────────────────┐    ┌────────────────────────────┐ │
                    │  │  Attack Detector │    │      REST API Server      │ │
                    │  │  • Threshold     │    │  • /api/suspicious-ips    │ │
                    │  │    checking     │    │  • /api/statistics        │ │
                    │  │  • IP tracking  │    │  • /api/blocked-ips       │ │
                    │  │  • Auto-block   │    │  • /api/block/:ip         │ │
                    │  └────────┬─────────┘    └────────────────────────────┘ │
                    │           │                                            │
                    │           ▼                                            │
                    │  ┌──────────────────┐                                  │
                    │  │    MSSQL DB      │                                  │
                    │  │  • FailedLogins  │                                  │
                    │  │  • SuspiciousIPs │                                  │
                    │  │  • BlockedIPs    │                                  │
                    │  │  • Statistics    │                                  │
                    │  └──────────────────┘                                  │
                    └─────────────────────────────────────────────────────────┘
                                              │
                    ┌─────────────────────────┼───────────────────────────────┐
                    │                         ▼                               │
                    │  ┌───────────────────────────────────────────────────┐  │
                    │  │              Firewall Integration                 │  │
                    │  │  • Windows Firewall (netsh)                      │  │
                    │  │  • Hardware Firewall API                         │  │
                    │  │  • PowerShell script automation                 │  │
                    │  └───────────────────────────────────────────────────┘  │
                    │                                                           │
                    │                         ▼                                │
                    │  ┌───────────────────────────────────────────────────┐  │
                    │  │              React Dashboard                      │  │
                    │  │  • Real-time attack map                          │  │
                    │  │  • Geo-location visualization                    │  │
                    │  │  • Attack trends graph                           │  │
                    │  │  • IP management interface                       │  │
                    │  └───────────────────────────────────────────────────┘  │
                    └─────────────────────────────────────────────────────────┘
```

## Technology Stack

### Backend
- **Language**: Python 3.9+ / Node.js / .NET 6
- **Database**: MSSQL Server 2019+
- **API Framework**: FastAPI / Express.js / ASP.NET Core

### Frontend
- **Framework**: React 18+
- **Charts**: Chart.js / Recharts
- **Maps**: Leaflet / react-simple-maps

### Infrastructure
- **OS**: Windows Server 2019+ / Windows 10/11
- **Firewall**: Windows Firewall / Hardware Firewall

## Data Flow

1. **Log Collection**
   ```
   Windows Event Log → Event ID 4625 → Parse XML → Extract Fields
   ```

2. **Attack Detection**
   ```
   Failed Login → Check IP in Database → Increment Counter → Check Threshold
   ```

3. **Blocking Process**
   ```
   Threshold Exceeded → Add to Blocked IPs → Call Firewall API → Notify Dashboard
   ```

4. **API Consumption**
   ```
   Firewall System → Poll /api/blocked-ips → Apply Rules → Confirm Block
   ```
