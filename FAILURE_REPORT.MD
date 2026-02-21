# 📘 Detailed Failure Analysis Report

### Scenario:

- VM1: 192.168.56.101 (Source)
- VM2: 192.168.56.102 (Collector)
- Workgroup environment
- Windows 10
- Attempted both Collector-Initiated and Source-Initiated

---

# 🔴 Root Cause Category 1: Workgroup + Collector-Initiated = Authentication Complexity

Collector-Initiated mode assumes:

- Kerberos authentication (Domain environment)
- Or properly configured NTLM with matching local accounts

In your case:

- ❌ No domain
- ❌ No Kerberos
- ⚠ NTLM fallback required
- ⚠ NTLM requires identical local accounts
- ⚠ NTLM requires Remote UAC token filtering disabled
- ⚠ Basic auth required for non-domain
- ⚠ AllowUnencrypted must be true over HTTP
- ⚠ Credentials must match exactly
- ⚠ Firewall profile must not be Public

That’s a lot of moving parts.

One small mismatch = silent failure.

That is why:

```
Status: Active
```

never appeared.

---

# 🔴 Root Cause Category 2: WinRM + Public Network Profile

Both VMs initially had:

```
NetworkCategory : Public
```

WinRM refuses to:

- Open firewall exceptions
- Fully configure listeners

Result:

- Partial configuration
- Hidden authentication failures

---

# 🔴 Root Cause Category 3: Remote UAC Token Filtering

Even though:

```
rewar ∈ Administrators
```

Windows does this in workgroup mode:

- Strips admin token for remote logons
- Causes Access Denied
- Breaks WinRM authentication silently

Fix requires:

```
LocalAccountTokenFilterPolicy = 1
```

This is undocumented in most beginner guides.

---

# 🔴 Root Cause Category 4: Basic Authentication over HTTP

When using:

```
CredentialsType: Basic
```

You must also enable:

On Source:

```
Basic = true
AllowUnencrypted = true
```

On Collector:

```
Client Basic = true
AllowUnencrypted = true
```

If even one is false → silent rejection.

---

# 🔴 Root Cause Category 5: Source-Initiated Without SubscriptionManager

Source-Initiated requires:

Registry:

```
HKLM\SOFTWARE\Policies\Microsoft\Windows\EventLog\EventForwarding\SubscriptionManager
```

Without that:

- Collector waits
- Source never connects
- Error 0x3ae8 appears

---

# 🔴 Root Cause Category 6: Windows 10 Limitations

On Windows 10 (non-domain):

- WEF is supported but not designed for enterprise collector scenarios
- `wecutil grs` not supported on some builds
- Runtime diagnostics limited
- Many failures are silent

WEF was designed primarily for:

- Domain-joined environments
- Kerberos-based authentication

---

# 🧠 Why This Lab Was So Fragile

You combined:

- Workgroup
- Windows 10
- HTTP (not HTTPS)
- Basic auth
- NTLM fallback
- No domain
- Virtual lab networking

This is literally the hardest possible WEF scenario.

Even experienced Windows engineers avoid Collector-Initiated in workgroup.

---

# 🏆 Best Strategy For Next Time

## ✅ OPTION 1 (RECOMMENDED)

Create a small Active Directory domain:

- Windows Server (Domain Controller)
- Join both VMs to domain
- Use Collector-Initiated
- Kerberos handles everything
- No Basic auth
- No TrustedHosts
- No TokenFilterPolicy
- No AllowUnencrypted

It works immediately.

---

## ✅ OPTION 2 (Simple Lab Strategy)

Use Source-Initiated + HTTPS listener:

- Create self-signed cert
- Configure WinRM HTTPS (5986)
- Avoid AllowUnencrypted
- Avoid Basic over HTTP
- More stable

---

## ❌ Avoid in Workgroup:

Collector-Initiated + Basic over HTTP

This is operationally unstable.

---

# 📊 Failure Summary Table

| Component    | Status   | Impact |
| ------------ | -------- | ------ |
| WinRM        | Working  | ✅     |
| Firewall     | Fixed    | ✅     |
| Account      | Correct  | ✅     |
| NTLM         | Fragile  | ⚠      |
| Remote UAC   | Blocking | ❌     |
| Basic Auth   | Complex  | ⚠      |
| Subscription | Created  | ✅     |
| Activation   | Failed   | ❌     |

---

# 🎯 Final Recommendation For Your Next Strategy

If this is for:

### 🔹 SOC / Blue Team Lab

Build:

- 1 Domain Controller
- 1 Source
- 1 Collector
- Domain join all

That reflects real enterprise architecture.

---

### 🔹 Quick Demo Lab

Use:

- Source-Initiated
- Single machine collector
- Minimal auth tweaking

---

# 💡 Why Enterprises Rarely Use Workgroup WEF

Because:

- Kerberos eliminates 90% of these problems.
- Authentication becomes seamless.
- Collector-Initiated becomes reliable.

---
