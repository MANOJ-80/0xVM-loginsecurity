# Firewall Integration Guide

## Windows Firewall Integration

### PowerShell Blocking Script

```powershell
# block_ip.ps1
param(
    [Parameter(Mandatory=$true)]
    [string]$IPAddress,
    
    [Parameter(Mandatory=$false)]
    [int]$DurationMinutes = 60,
    
    [switch]$Permanent
)

$ruleName = "SecurityMonitor_Block_$($IPAddress.Replace('.', '_'))"

try {
    # Check if rule already exists
    $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
    
    if ($existing) {
        Write-Host "Rule already exists for $IPAddress"
        exit 0
    }
    
    # Create blocking rule
    if ($Permanent) {
        New-NetFirewallRule -DisplayName $ruleName `
            -Direction Inbound `
            -Action Block `
            -RemoteAddress $IPAddress `
            -Protocol Any `
            -Enabled True
    } else {
        # Temporary block with scheduled removal
        $scriptBlock = {
            param($rule, $duration)
            Start-Sleep -Seconds $duration
            Remove-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue
        }
        
        New-NetFirewallRule -DisplayName $ruleName `
            -Direction Inbound `
            -Action Block `
            -RemoteAddress $IPAddress `
            -Protocol Any `
            -Enabled True
        
        # Schedule removal
        Start-Job -ScriptBlock $scriptBlock -ArgumentList $ruleName, ($DurationMinutes * 60)
    }
    
    Write-Host "IP $IPAddress blocked successfully"
    exit 0
}
catch {
    Write-Error "Failed to block IP: $_"
    exit 1
}
```

### Unblock Script

```powershell
# unblock_ip.ps1
param(
    [Parameter(Mandatory=$true)]
    [string]$IPAddress
)

$ruleName = "SecurityMonitor_Block_$($IPAddress.Replace('.', '_'))"

try {
    Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction Stop
    Write-Host "IP $IPAddress unblocked successfully"
}
catch {
    Write-Warning "Rule not found or already removed"
}
```

---

## Hardware Firewall Integration

### Cisco ASA Example

```python
# firewall/cisco_asa.py
import requests
from requests.auth import HTTPBasicAuth

class CiscoASAIntegration:
    def __init__(self, host, username, password):
        self.host = host
        self.auth = HTTPBasicAuth(username, password)
        self.base_url = f"https://{host}/api"
    
    def block_ip(self, ip_address, duration=60):
        """Block IP on Cisco ASA"""
        endpoint = f"{self.base_url}/objects/networkobjects"
        
        payload = {
            "kind": "object#NetworkObj",
            "name": f"blocked_{ip_address.replace('.', '_')}",
            "host": {
                "kind": "IPv4Address",
                "value": ip_address
            }
        }
        
        response = requests.post(
            endpoint,
            json=payload,
            auth=self.auth,
            verify=False
        )
        
        # Add to block list
        block_endpoint = f"{self.base_url}/accessrules/outside_in"
        block_rule = {
            "sourceAddress": f"blocked_{ip_address.replace('.', '_')}",
            "action": "drop"
        }
        
        return response.status_code == 201
    
    def unblock_ip(self, ip_address):
        """Remove IP block from Cisco ASA"""
        obj_name = f"blocked_{ip_address.replace('.', '_')}"
        endpoint = f"{self.base_url}/objects/networkobjects/{obj_name}"
        
        response = requests.delete(endpoint, auth=self.auth, verify=False)
        return response.status_code == 200
```

---

## Integration with API

### Automated Blocking Flow

```
API Server receives failed login
         │
         ▼
   Check threshold (5 attempts/5 min)
         │
         ▼
   Threshold exceeded?
         │
    ┌────┴────┐
    │         │
   Yes        No
    │         │
    ▼         ▼
 Add to    Update
 BlockedIPs stats
    │
    ▼
Call firewall script
    │
    ▼
  Firewall
 blocks IP
    │
    ▼
 Notify dashboard
  via SSE feed
```

### Polling Integration

For external firewalls that cannot run scripts locally:

```javascript
// Polling service on firewall device
async function pollBlockedIPs() {
    const response = await fetch('http://localhost:3000/api/v1/blocked-ips');
    const { data: blockedIPs } = await response.json();
    
    for (const ip of blockedIPs) {
        await applyFirewallRule(ip.ip_address, 'block');
    }
}

// Poll every 30 seconds
setInterval(pollBlockedIPs, 30000);
```
