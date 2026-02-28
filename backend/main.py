from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
from typing import List, Optional
import json
from sse_starlette.sse import EventSourceResponse
import asyncio

from database import get_db_connection

app = FastAPI(title="Security Monitor API", version="1.0")


def _safe_int(value: Optional[str]) -> Optional[int]:
    """Best-effort parse for numeric event fields; returns None on bad input."""
    if value is None:
        return None
    s = str(value).strip()
    if not s or s == "-":
        return None
    try:
        return int(s)
    except (TypeError, ValueError):
        return None


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
    health = {
        "success": True,
        "status": "healthy",
        "uptime_seconds": 0,
        "active_vms": 0,
        "db_connected": False,
    }
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM VMSources WHERE status='active'")
        row = cursor.fetchone()
        if row:
            health["active_vms"] = row[0]
        health["db_connected"] = True
    except Exception as e:
        health["status"] = "unhealthy"
        health["db_connected"] = False
    finally:
        if conn:
            conn.close()
    return health


@app.post("/api/v1/events")
async def receive_events(req: ReceiveEventsRequest):
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        for ev in req.events:
            cursor.execute(
                "{CALL sp_RecordFailedLoginMultiVM(?, ?, ?, ?, ?, ?, ?, ?)}",
                (
                    ev.ip_address,
                    ev.username,
                    req.hostname,
                    _safe_int(ev.logon_type),
                    ev.status if ev.status else None,
                    _safe_int(ev.source_port),
                    req.vm_id,
                    ev.timestamp if ev.timestamp else None,
                ),
            )
            await new_events_queue.put(
                {
                    "ip_address": ev.ip_address,
                    "username": ev.username,
                    "timestamp": ev.timestamp,
                    "vm_id": req.vm_id,
                }
            )
        conn.commit()
        return {"success": True, "events_received": len(req.events)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            conn.close()


@app.get("/api/v1/suspicious-ips")
def get_suspicious_ips(threshold: int = 5):
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("{CALL sp_GetSuspiciousIPs(?)}", (threshold,))
        if cursor.description is None:
            return {"success": True, "data": [], "count": 0}
        columns = [column[0] for column in cursor.description]
        results = [dict(zip(columns, row)) for row in cursor.fetchall()]
        return {"success": True, "data": results, "count": len(results)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            conn.close()


@app.get("/api/v1/blocked-ips")
def get_blocked_ips():
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT ip_address, blocked_at, block_expires, reason, blocked_by FROM BlockedIPs WHERE is_active=1"
        )
        if cursor.description is None:
            return {"success": True, "data": [], "count": 0}
        columns = [column[0] for column in cursor.description]
        results = [dict(zip(columns, row)) for row in cursor.fetchall()]
        return {"success": True, "data": results, "count": len(results)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            conn.close()


@app.post("/api/v1/block")
def block_ip(req: ManualBlockRequest):
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            "{CALL sp_BlockIP(?, ?, ?, ?)}",
            (req.ip_address, req.reason, req.duration_minutes, "manual"),
        )
        conn.commit()
        return {
            "success": True,
            "message": f"IP {req.ip_address} blocked for {req.duration_minutes} minutes",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            conn.close()


@app.post("/api/v1/block/per-vm")
def block_ip_per_vm(req: PerVMBlockRequest):
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            "{CALL sp_BlockIPPerVM(?, ?, ?, ?, ?)}",
            (req.ip_address, req.vm_id, req.reason, req.duration_minutes, "manual"),
        )
        conn.commit()
        return {
            "success": True,
            "message": f"IP {req.ip_address} blocked on VM {req.vm_id} for {req.duration_minutes} minutes",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            conn.close()


@app.delete("/api/v1/block/{ip}")
def unblock_ip(ip: str):
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE BlockedIPs SET is_active=0, unblocked_at=GETUTCDATE(), unblocked_by='manual' WHERE ip_address=? AND is_active=1",
            (ip,),
        )
        cursor.execute(
            "UPDATE SuspiciousIPs SET status='cleared' WHERE ip_address=?", (ip,)
        )
        conn.commit()
        return {"success": True, "message": f"IP {ip} unblocked"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            conn.close()


@app.post("/api/v1/vms")
def register_vm(req: RegisterVMRequest):
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            "{CALL sp_RegisterVM(?, ?, ?, ?)}",
            (req.vm_id, req.hostname, req.ip_address, req.collection_method),
        )
        conn.commit()
        return {"success": True, "message": f"VM {req.vm_id} registered successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            conn.close()


@app.get("/api/v1/vms")
def list_vms():
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT vm_id, hostname, ip_address, collection_method, status, last_seen FROM VMSources"
        )
        if cursor.description is None:
            return {"success": True, "data": [], "count": 0}
        columns = [column[0] for column in cursor.description]
        results = [dict(zip(columns, row)) for row in cursor.fetchall()]
        return {"success": True, "data": results, "count": len(results)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            conn.close()


@app.delete("/api/v1/vms/{vm_id}")
def delete_vm(vm_id: str):
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE VMSources SET status='inactive' WHERE vm_id=?", (vm_id,))
        conn.commit()
        return {"success": True, "message": f"VM {vm_id} unregistered"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            conn.close()


@app.get("/api/v1/vms/{vm_id}/attacks")
def get_vm_attacks(vm_id: str):
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("{CALL sp_GetVMStats(?)}", (vm_id,))

        if cursor.description is None:
            return {
                "success": True,
                "vm_id": vm_id,
                "total_attacks": 0,
                "unique_attackers": 0,
            }

        columns = [column[0] for column in cursor.description]
        row = cursor.fetchone()

        if row:
            data = dict(zip(columns, row))
            data["success"] = True
            return data
        else:
            return {
                "success": True,
                "vm_id": vm_id,
                "total_attacks": 0,
                "unique_attackers": 0,
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            conn.close()


@app.get("/api/v1/feed")
async def feed(request: Request):
    async def event_generator():
        while True:
            if await request.is_disconnected():
                break

            try:
                # Wait for a new event from the queue
                event_data = await asyncio.wait_for(new_events_queue.get(), timeout=1.0)
                yield {"event": "new_attack", "data": json.dumps(event_data)}
            except asyncio.TimeoutError:
                yield {"event": "ping", "data": "keep-alive"}

    return EventSourceResponse(event_generator())


@app.get("/api/v1/statistics")
def get_statistics():
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Core counts
        cursor.execute("SELECT COUNT(*) FROM FailedLoginAttempts")
        total_failed = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(DISTINCT ip_address) FROM FailedLoginAttempts")
        unique_attackers = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM BlockedIPs WHERE is_active = 1")
        blocked_ips = cursor.fetchone()[0]

        # Time-window counts
        cursor.execute(
            "SELECT COUNT(*) FROM FailedLoginAttempts WHERE timestamp >= DATEADD(HOUR, -24, GETDATE())"
        )
        attacks_last_24h = cursor.fetchone()[0]

        cursor.execute(
            "SELECT COUNT(*) FROM FailedLoginAttempts WHERE timestamp >= DATEADD(HOUR, -1, GETDATE())"
        )
        attacks_last_hour = cursor.fetchone()[0]

        # Top attacked usernames (top 10)
        cursor.execute(
            "SELECT TOP 10 username, COUNT(*) AS count FROM FailedLoginAttempts "
            "WHERE username IS NOT NULL GROUP BY username ORDER BY count DESC"
        )
        top_usernames = [
            {"username": row[0], "count": row[1]} for row in cursor.fetchall()
        ]

        # Attacks by hour (last 24 hours)
        cursor.execute(
            "SELECT DATEPART(HOUR, timestamp) AS hr, COUNT(*) AS count "
            "FROM FailedLoginAttempts "
            "WHERE timestamp >= DATEADD(HOUR, -24, GETDATE()) "
            "GROUP BY DATEPART(HOUR, timestamp) ORDER BY hr"
        )
        attacks_by_hour = [
            {"hour": f"{row[0]:02d}:00", "count": row[1]} for row in cursor.fetchall()
        ]

        return {
            "success": True,
            "data": {
                "total_failed_attempts": total_failed,
                "unique_attackers": unique_attackers,
                "blocked_ips": blocked_ips,
                "attacks_last_24h": attacks_last_24h,
                "attacks_last_hour": attacks_last_hour,
                "top_attacked_usernames": top_usernames,
                "attacks_by_hour": attacks_by_hour,
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            conn.close()


@app.get("/api/v1/statistics/global")
def get_global_statistics():
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Core counts
        cursor.execute("SELECT COUNT(*) FROM FailedLoginAttempts")
        total_failed = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(DISTINCT ip_address) FROM FailedLoginAttempts")
        unique_attackers = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM BlockedIPs WHERE is_active = 1")
        blocked_ips = cursor.fetchone()[0]

        # VM counts
        cursor.execute("SELECT COUNT(*) FROM VMSources WHERE status = 'active'")
        active_vms = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM VMSources WHERE status = 'inactive'")
        inactive_vms = cursor.fetchone()[0]

        # Time-window counts
        cursor.execute(
            "SELECT COUNT(*) FROM FailedLoginAttempts WHERE timestamp >= DATEADD(HOUR, -24, GETDATE())"
        )
        attacks_last_24h = cursor.fetchone()[0]

        cursor.execute(
            "SELECT COUNT(*) FROM FailedLoginAttempts WHERE timestamp >= DATEADD(HOUR, -1, GETDATE())"
        )
        attacks_last_hour = cursor.fetchone()[0]

        # Attacks by VM
        cursor.execute(
            "SELECT source_vm_id, COUNT(*) AS count FROM FailedLoginAttempts "
            "WHERE source_vm_id IS NOT NULL GROUP BY source_vm_id ORDER BY count DESC"
        )
        attacks_by_vm = [
            {"vm_id": row[0], "count": row[1]} for row in cursor.fetchall()
        ]

        # Top attacked usernames (top 10)
        cursor.execute(
            "SELECT TOP 10 username, COUNT(*) AS count FROM FailedLoginAttempts "
            "WHERE username IS NOT NULL GROUP BY username ORDER BY count DESC"
        )
        top_usernames = [
            {"username": row[0], "count": row[1]} for row in cursor.fetchall()
        ]

        # Attacks by hour (last 24 hours)
        cursor.execute(
            "SELECT DATEPART(HOUR, timestamp) AS hr, COUNT(*) AS count "
            "FROM FailedLoginAttempts "
            "WHERE timestamp >= DATEADD(HOUR, -24, GETDATE()) "
            "GROUP BY DATEPART(HOUR, timestamp) ORDER BY hr"
        )
        attacks_by_hour = [
            {"hour": f"{row[0]:02d}:00", "count": row[1]} for row in cursor.fetchall()
        ]

        return {
            "success": True,
            "data": {
                "total_failed_attempts": total_failed,
                "unique_attackers": unique_attackers,
                "blocked_ips": blocked_ips,
                "active_vms": active_vms,
                "inactive_vms": inactive_vms,
                "attacks_last_24h": attacks_last_24h,
                "attacks_last_hour": attacks_last_hour,
                "attacks_by_vm": attacks_by_vm,
                "top_attacked_usernames": top_usernames,
                "attacks_by_hour": attacks_by_hour,
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            conn.close()


@app.get("/api/v1/geo-attacks")
def get_geo_attacks():
    """Geo-location attack data. Requires a GeoIP database (not yet integrated).
    Returns empty data until a GeoIP provider is configured."""
    return {"success": True, "data": []}
