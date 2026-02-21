from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from pydantic import BaseModel
from typing import List, Optional
import datetime
from sse_starlette.sse import EventSourceResponse
import asyncio

from database import get_db_connection

app = FastAPI(title="Security Monitor API", version="1.0")

# --- Models ---
class EventModel(BaseModel):
    timestamp: str
    ip_address: str
    username: Optional[str] = None
    domain: Optional[str] = None
    logon_type: Optional[str] = None
    status: Optional[str] = None
    workstation: Optional[str] = None
    source_port: Optional[str] = None

class ReceiveEventsRequest(BaseModel):
    vm_id: str
    hostname: str
    events: List[EventModel]

class RegisterVMRequest(BaseModel):
    vm_id: str
    hostname: str
    ip_address: str
    collection_method: str = "agent"

class ManualBlockRequest(BaseModel):
    ip_address: str
    reason: str
    duration_minutes: int = 120

class PerVMBlockRequest(BaseModel):
    ip_address: str
    vm_id: str
    reason: str
    duration_minutes: int = 120

# Global event queue for SSE
new_events_queue = asyncio.Queue()

# --- Endpoints ---

@app.get("/api/v1/health")
def health_check():
    health = {"success": True, "status": "healthy", "uptime_seconds": 0, "active_vms": 0, "db_connected": False}
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM VMSources WHERE status='active'")
        row = cursor.fetchone()
        if row:
            health["active_vms"] = row[0]
        health["db_connected"] = True
        conn.close()
    except Exception as e:
        health["status"] = "unhealthy"
        health["db_connected"] = False
    return health

@app.post("/api/v1/events")
async def receive_events(req: ReceiveEventsRequest):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        for ev in req.events:
            # Note: sp_RecordFailedLoginMultiVM relies on specific parameter order/names
            cursor.execute("{CALL sp_RecordFailedLoginMultiVM(?, ?, ?, ?, ?, ?, ?)}", 
                (ev.ip_address, ev.username, req.hostname, 
                 int(ev.logon_type) if ev.logon_type and ev.logon_type.isdigit() else None, 
                 int(ev.status, 16) if ev.status and ev.status.startswith('0x') else None,
                 int(ev.source_port) if ev.source_port and ev.source_port.isdigit() else None,
                 req.vm_id)
            )
            await new_events_queue.put({
                "ip_address": ev.ip_address,
                "username": ev.username,
                "timestamp": ev.timestamp,
                "vm_id": req.vm_id
            })
        conn.commit()
        conn.close()
        return {"success": True, "events_received": len(req.events)}
    except Exception as e:
        if 'conn' in locals() and hasattr(conn, "close"):
            conn.close()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/suspicious-ips")
def get_suspicious_ips(threshold: int = 5):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("{CALL sp_GetSuspiciousIPs(?)}", (threshold,))
        columns = [column[0] for column in cursor.description]
        results = [dict(zip(columns, row)) for row in cursor.fetchall()]
        conn.close()
        return {"success": True, "data": results, "count": len(results)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/blocked-ips")
def get_blocked_ips():
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT ip_address, blocked_at, block_expires, reason, blocked_by FROM BlockedIPs WHERE is_active=1")
        columns = [column[0] for column in cursor.description]
        results = [dict(zip(columns, row)) for row in cursor.fetchall()]
        conn.close()
        return {"success": True, "data": results, "count": len(results)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/block")
def block_ip(req: ManualBlockRequest):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("{CALL sp_BlockIP(?, ?, ?, ?)}", 
            (req.ip_address, req.reason, req.duration_minutes, "manual")
        )
        conn.commit()
        conn.close()
        return {"success": True, "message": f"IP {req.ip_address} blocked for {req.duration_minutes} minutes"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/block/per-vm")
def block_ip_per_vm(req: PerVMBlockRequest):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("{CALL sp_BlockIPPerVM(?, ?, ?, ?, ?)}", 
            (req.ip_address, req.vm_id, req.reason, req.duration_minutes, "manual")
        )
        conn.commit()
        conn.close()
        return {"success": True, "message": f"IP {req.ip_address} blocked on VM {req.vm_id} for {req.duration_minutes} minutes"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/v1/block/{ip}")
def unblock_ip(ip: str):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE BlockedIPs SET is_active=0, unblocked_at=GETUTCDATE(), unblocked_by='manual' WHERE ip_address=? AND is_active=1", (ip,))
        cursor.execute("UPDATE SuspiciousIPs SET status='cleared' WHERE ip_address=?", (ip,))
        conn.commit()
        conn.close()
        return {"success": True, "message": f"IP {ip} unblocked"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/vms")
def register_vm(req: RegisterVMRequest):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("{CALL sp_RegisterVM(?, ?, ?, ?)}", 
            (req.vm_id, req.hostname, req.ip_address, req.collection_method)
        )
        conn.commit()
        conn.close()
        return {"success": True, "message": f"VM {req.vm_id} registered successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/vms")
def list_vms():
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT vm_id, hostname, ip_address, collection_method, status, last_seen FROM VMSources")
        columns = [column[0] for column in cursor.description]
        results = [dict(zip(columns, row)) for row in cursor.fetchall()]
        conn.close()
        return {"success": True, "data": results, "count": len(results)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/v1/vms/{vm_id}")
def delete_vm(vm_id: str):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE VMSources SET status='inactive' WHERE vm_id=?", (vm_id,))
        conn.commit()
        conn.close()
        return {"success": True, "message": f"VM {vm_id} unregistered"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/vms/{vm_id}/attacks")
def get_vm_attacks(vm_id: str):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("{CALL sp_GetVMStats(?)}", (vm_id,))
        columns = [column[0] for column in cursor.description]
        row = cursor.fetchone()
        conn.close()
        
        if row:
            data = dict(zip(columns, row))
            data["success"] = True
            return data
        else:
            return {"success": True, "vm_id": vm_id, "total_attacks": 0, "unique_attackers": 0}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/feed")
async def feed(request: Request):
    async def event_generator():
        while True:
            if await request.is_disconnected():
                break
            
            try:
                # Wait for a new event from the queue
                event_data = await asyncio.wait_for(new_events_queue.get(), timeout=1.0)
                yield {
                    "event": "new_attack",
                    "data": str(event_data)
                }
            except asyncio.TimeoutError:
                yield {
                    "event": "ping",
                    "data": "keep-alive"
                }

    return EventSourceResponse(event_generator())

# Placeholder endpoints for Statistics
@app.get("/api/v1/statistics")
def get_statistics():
    return {"success": True, "data": {"total_failed_attempts": 0, "unique_attackers": 0, "blocked_ips": 0}}

@app.get("/api/v1/statistics/global")
def get_global_statistics():
    return {"success": True, "data": {"total_failed_attempts": 0, "unique_attackers": 0, "blocked_ips": 0}}

@app.get("/api/v1/geo-attacks")
def get_geo_attacks():
    return {"success": True, "data": []}
