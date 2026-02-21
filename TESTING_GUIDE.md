# Full End-to-End Testing Guide for Windows VM Security Monitor

This guide will walk you through testing the entire automated system from start to finish on your VirtualBox environment. It focuses completely on the **Python Agent Method** since the workgroup WEF strategy proved to be unusable.

## Pre-requisites

1. VirtualBox installed and running
2. Two Windows 10/11 Virtual Machines (VMs)
3. Python 3.9+ installed on both VMs
4. SQL Server Express installed on the **Collector VM**

---

## Part 1: VM and Network Configuration

### 1. Configure the VirtualBox Network

You need an isolated internal network so the VMs can talk to each other without weird DHCP issues.

1. Open VirtualBox → File → Tools → **Host Network Manager** (or simply go to the Network settings of each VM).
2. Set **Adapter 1** to **NAT** (so both can download Python packages).
3. Set **Adapter 2** to **Host-Only Adapter** (VirtualBox Host-Only Ethernet Adapter).

### 2. Set Static IPs inside the Windows VMs

1. Boot up both VMs.
2. In each VM, open `ncpa.cpl` (Network Connections).
3. Right-click the **Host-Only adapter** → Properties → IPv4.
4. Set **Source VM** (VM 1) to IP `192.168.56.101` / Subnet `255.255.255.0`
5. Set **Collector VM** (VM 2) to IP `192.168.56.102` / Subnet `255.255.255.0`

### 3. Verify Connectivity

- On Source VM, open `cmd` and ping Collector: `ping 192.168.56.102`
- On Collector VM, ping Source: `ping 192.168.56.101`
  _(Note: If pings fail, you may need to temporarily disable the Windows Firewall or enable Core Networking ICMPv4-In rules on both boxes)._

---

## Part 2: Setting up the Collector VM (Backend & Database)

### 1. Database Initialization

1. Ensure **SQL Server Express** is running on `192.168.56.102`.
2. Open SQL Server Management Studio (SSMS).
3. Connect using Windows Authentication or `sa` account.
4. Create a database named `SecurityMonitor`.
5. Open a new query window against `SecurityMonitor`.
6. Paste the **entire contents** of `DATABASE_SCHEMA.md` (the generic SQL syntax block starting with `CREATE TABLE FailedLoginAttempts...` through all the `CREATE PROCEDURE` blocks) and Execute.

### 2. Start the Backend API

You will need to run the Python backend on the Collector VM.

1. Transfer the `backend` folder to the Collector VM (e.g., `C:\SecurityMonitor\backend`).
2. Open `cmd` or PowerShell in the `backend` folder.
3. Install reqs: `pip install -r requirements.txt`
4. Update your `.env` file (create it if needed) in the `backend` folder:
   ```env
   DB_SERVER=localhost\SQLEXPRESS  # Change this to match your SQL Server instance name
   DB_NAME=SecurityMonitor
   ```
5. Run the server: `uvicorn main:app --host 0.0.0.0 --port 3000`
   - The server should say `Application startup complete.`

### 3. Open the Firewall (Crucial Step!)

The Collector VM must allow incoming connections on port 3000.

1. Open PowerShell **as Administrator** on the Collector VM.
2. Run: `New-NetFirewallRule -DisplayName "Security Monitor API" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow`

---

## Part 3: Deploying the Agent on the Source VM

### 1. Configure the Agent

1. Transfer the `agent` folder to the Source VM (`C:\SecurityMonitor\agent`).
2. Open `cmd` or PowerShell in the `agent` folder.
3. Install reqs: `pip install -r requirements.txt`
   - _(If PyWin32 gives you trouble, run: `python -m pip install pywin32` followed by `python Scripts/pywin32_postinstall.py -install`)_
4. Ensure `config.yaml` is pointing exactly to the Collector VM's IP address:
   ```yaml
   vm_id: "vm-001"
   collector_url: "http://192.168.56.102:3000/api/v1/events"
   poll_interval: 10
   event_id: 4625
   ```

### 2. Start the Agent

1. In the `agent` folder, run: `python main.py`
2. You should see logs like:
   ```
    [INFO] Agent started  vm_id=vm-001  hostname=SOURCE-PC
    [INFO] Scanning existing events...
    [INFO] Startup scan: 12 event(s) in log, 0 are new (unseen)
    [INFO] Real-time subscription active (EvtSubscribe)
   ```
   The agent is now listening for events in real-time — no polling delay.

---

## Part 4: The Live Attack Simulation

Now we test if the Source VM detects attacks and if the Collector parses and database stores them.

1. **Keep `main.py` running in a visible console on the Source VM.**
2. **Keep `uvicorn` running in a visible console on the Collector VM.**

### Testing Method A: RDP Bruteforce

If RDP is enabled on your Source VM:

1. From the Collector VM, open Remote Desktop Connection (`mstsc.exe`).
2. Point it to `192.168.56.101`.
3. Try to log in as `Administrator` or `hacker` with the wrong password.
4. Press Enter. It will fail.

### Testing Method B: SMB Share Bruteforce (Easier)

If you don't have RDP enabled, just try mapping a network drive with bad credentials from the Collector VM:

1. Open `cmd` on Collector VM.
2. Run: `net use \\192.168.56.101\C$ /user:badhacker wrongpassword`

### Verification

**Step 1: Watch the Source VM Console**
You should immediately see the Agent catch the 4625 event from the Windows Event Log:

```
[INFO] Failed login: user=badhacker ip=192.168.56.102
[INFO] Sent 1 event(s) to collector
```

**Step 2: Watch the Collector VM Console**
Uvicorn should output a 200 OK HTTP log showing the POST request from the agent:

```
INFO:     192.168.56.101:49231 - "POST /api/v1/events HTTP/1.1" 200 OK
```

---

## Part 5: Verifying the Data in the API

Open a browser locally on the Collector VM (or via Postman from anywhere):

1. **Check if VM Registered:**
   - Go to: `http://localhost:3000/api/v1/vms`
   - _You won't see it until you register it, but data is flowing._
2. **Check Suspicious IPs:**
   - Fail 5 more logins repeatedly via `net use`.
   - Go to: `http://localhost:3000/api/v1/suspicious-ips`
   - You should see `192.168.56.102` flagged as suspicious.
3. **Verify the SSE Feed:**
   - In a new command prompt, use `curl` to watch real-time events:
   - `curl http://localhost:3000/api/v1/feed`
   - Do one more bad login. You should see a JSON payload pushed to the curl output immediately!

If you reach this point, the core monitoring logic is 100% verified.

## Part 6: Automating the Windows Firewall Blocks (Future/Optional)

Once the above is working, the next logical step is to have a script that constantly polls the API using the `/suspicious-ips` endpoint and creates a Windows Firewall rule to block them via PowerShell `New-NetFirewallRule`.

---

## Cleanup Notes

If you are redeploying the agent after upgrading from an older version, delete
these legacy files from the agent folder if they exist (they are no longer used):

- `vm-001_bookmark.xml` (replaced by fingerprint-based dedup)
- `vm-001_last_ts.txt` (replaced by reverse-direction query with early-exit)

The current agent persists dedup state only in `vm-001_seen.json`.

---

And you are done!
