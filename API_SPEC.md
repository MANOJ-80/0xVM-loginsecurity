# REST API Specification

## Base URL
```
http://localhost:3000/api/v1
```

## Endpoints

### 1. Get Suspicious IPs

**GET** `/suspicious-ips`

Returns list of IPs with failed login attempts exceeding threshold.

**Note**: Full URLs are relative to Base URL. Example: `/suspicious-ips` = `http://localhost:3000/api/v1/suspicious-ips`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "ip_address": "192.168.1.100",
      "failed_attempts": 10,
      "first_attempt": "2024-01-15T10:30:00Z",
      "last_attempt": "2024-01-15T10:45:00Z",
      "target_usernames": ["admin", "root", "user1"],
      "status": "suspicious"
    }
  ],
  "count": 1
}
```

---

### 2. Get Attack Statistics

**GET** `/statistics`

Returns aggregated attack statistics.

**Response:**
```json
{
  "success": true,
  "data": {
    "total_failed_attempts": 1250,
    "unique_attackers": 45,
    "blocked_ips": 12,
    "attacks_last_24h": 89,
    "attacks_last_hour": 15,
    "top_attacked_usernames": [
      { "username": "admin", "count": 450 },
      { "username": "root", "count": 320 },
      { "username": "guest", "count": 180 }
    ],
    "attacks_by_hour": [
      { "hour": "00:00", "count": 15 },
      { "hour": "01:00", "count": 23 }
    ]
  }
}
```

---

### 3. Get Blocked IPs

**GET** `/blocked-ips`

Returns list of currently blocked IPs.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "ip_address": "192.168.1.100",
      "blocked_at": "2024-01-15T10:45:00Z",
      "block_expires": "2024-01-15T11:45:00Z",
      "reason": "Exceeded threshold (10 attempts)",
      "auto_blocked": true
    }
  ],
  "count": 1
}
```

---

### 4. Manual Block IP

**POST** `/block`

Manually block an IP address.

**Request Body:**
```json
{
  "ip_address": "192.168.1.100",
  "reason": "Manual block - suspicious activity",
  "duration_minutes": 120
}
```

**Response:**
```json
{
  "success": true,
  "message": "IP 192.168.1.100 blocked for 120 minutes"
}
```

---

### 5. Unblock IP

**DELETE** `/block/:ip`

Remove IP from blocked list.

**Response:**
```json
{
  "success": true,
  "message": "IP 192.168.1.100 unblocked"
}
```

---

### 6. Get Real-time Feed

**GET** `/feed`

Server-Sent Events endpoint for real-time attack updates.

**Response:**
```json
{
  "event": "new_attack",
  "data": {
    "ip_address": "192.168.1.100",
    "username": "admin",
    "timestamp": "2024-01-15T10:45:00Z",
    "attempt_number": 6
  }
}
```

---

### 7. Get Geo-location Data

**GET** `/geo-attacks`

Returns attack data with geo-location information.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "ip_address": "192.168.1.100",
      "country": "China",
      "city": "Beijing",
      "lat": 39.9042,
      "lng": 116.4074,
      "attack_count": 45
    }
  ]
}
```

---

### 8. Register VM (Multi-VM)

**POST** `/vms`

Register a new VM to the monitoring system.

**Request Body:**
```json
{
  "vm_id": "vm-001",
  "hostname": "WIN-VM01",
  "ip_address": "192.168.1.10",
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

---

### 9. List VMs (Multi-VM)

**GET** `/vms`

Returns list of all monitored VMs.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "vm_id": "vm-001",
      "hostname": "WIN-VM01",
      "ip_address": "192.168.1.10",
      "collection_method": "agent",
      "status": "active",
      "last_seen": "2024-01-15T10:45:00Z"
    }
  ],
  "count": 1
}
```

---

### 10. Get VM Attacks (Multi-VM)

**GET** `/vms/:vm_id/attacks`

Returns attack statistics for a specific VM.

**Response:**
```json
{
  "success": true,
  "vm_id": "vm-001",
  "hostname": "WIN-VM01",
  "total_attacks": 45,
  "unique_attackers": 12,
  "attacks_last_24h": 23,
  "attacks_last_hour": 5,
  "top_attacked_usernames": [
    { "username": "admin", "count": 30 },
    { "username": "root", "count": 15 }
  ],
  "top_attackers": [
    { "ip_address": "192.168.1.100", "count": 20 }
  ]
}
```

---

### 11. Receive Events (Multi-VM)

**POST** `/events`

Receive failed login events from agents or WEF collector.

**Request Body:**
```json
{
  "vm_id": "vm-001",
  "hostname": "WIN-VM01",
  "events": [
    {
      "timestamp": "2024-01-15T10:30:00Z",
      "ip_address": "192.168.1.100",
      "username": "admin",
      "domain": "WIN-VM01",
      "logon_type": "10",
      "status": "0xc000006d",
      "workstation": "ATTACK-PC",
      "source_port": "54321"
    }
  ]
}
```

**Note**: Authentication is handled at network level. Ensure firewall restricts access to trusted VM IPs only.

**Response:**
```json
{
  "success": true,
  "events_received": 1
}
```

---

### 12. Block IP Per-VM (Multi-VM)

**POST** `/block/per-vm`

Block an IP specifically on one VM (not global).

**Request Body:**
```json
{
  "ip_address": "192.168.1.100",
  "vm_id": "vm-001",
  "reason": "Repeated failed logins on VM vm-001",
  "duration_minutes": 120
}
```

**Response:**
```json
{
  "success": true,
  "message": "IP 192.168.1.100 blocked on VM vm-001 for 120 minutes"
}
```

---

### 13. Global Statistics (Multi-VM)

**GET** `/statistics/global`

Returns global aggregated statistics across all VMs.

**Response:**
```json
{
  "success": true,
  "data": {
    "total_failed_attempts": 1250,
    "unique_attackers": 45,
    "blocked_ips": 12,
    "active_vms": 5,
    "inactive_vms": 1,
    "attacks_last_24h": 89,
    "attacks_last_hour": 15,
    "attacks_by_vm": [
      { "vm_id": "vm-001", "count": 450 },
      { "vm_id": "vm-002", "count": 320 }
    ],
    "top_attacked_usernames": [
      { "username": "admin", "count": 450 },
      { "username": "root", "count": 320 }
    ],
    "attacks_by_hour": [
      { "hour": "00:00", "count": 15 },
      { "hour": "01:00", "count": 23 }
    ]
  }
}
```

---

### 14. Delete VM (Multi-VM)

**DELETE** `/vms/:vm_id`

Unregister a VM from the monitoring system.

**Response:**
```json
{
  "success": true,
  "message": "VM vm-001 unregistered"
}
```

---

### 15. Health Check

**GET** `/health`

Returns service health status. Use this from agents to verify the collector is reachable before sending events.

**Response:**
```json
{
  "success": true,
  "status": "healthy",
  "uptime_seconds": 86400,
  "active_vms": 5,
  "db_connected": true
}
```

---

## Error Responses

### 400 Bad Request
```json
{
  "success": false,
  "error": "Invalid IP address format"
}
```

### 404 Not Found
```json
{
  "success": false,
  "error": "IP not found in blocked list"
}
```

### 500 Internal Server Error
```json
{
  "success": false,
  "error": "Database connection failed"
}
```
