# REST API Specification

## Base URL
```
http://localhost:3000/api
```

## Endpoints

### 1. Get Suspicious IPs

**GET** `/suspicious-ips`

Returns list of IPs with failed login attempts exceeding threshold.

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
