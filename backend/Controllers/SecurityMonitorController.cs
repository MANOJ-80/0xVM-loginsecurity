using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SecurityMonitorApi.Data;
using SecurityMonitorApi.DTOs;
using SecurityMonitorApi.Services;

namespace SecurityMonitorApi.Controllers;

[ApiController]
[Authorize]
public class SecurityMonitorController : ControllerBase
{
    private readonly SecurityMonitorContext _db;
    private readonly SecurityMonitorService _service;
    private readonly EventBroadcastService _broadcast;

    public SecurityMonitorController(
        SecurityMonitorContext db,
        SecurityMonitorService service,
        EventBroadcastService broadcast)
    {
        _db = db;
        _service = service;
        _broadcast = broadcast;
    }

    /// <summary>
    /// Best-effort parse for numeric event fields; returns null on bad input.
    /// </summary>
    private static int? SafeInt(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || value == "-")
            return null;
        return int.TryParse(value.Trim(), out var result) ? result : null;
    }

    // =========================================================================
    // GET /api/v1/health
    // =========================================================================
    [AllowAnonymous]
    [HttpGet("api/v1/health")]
    public async Task<IActionResult> HealthCheck()
    {
        var health = new HealthResponse
        {
            Success = true,
            Status = "healthy",
            UptimeSeconds = 0,
            ActiveVms = 0,
            DbConnected = false
        };

        try
        {
            health.ActiveVms = await _db.VMSources
                .CountAsync(v => v.Status == "active");
            health.DbConnected = true;
        }
        catch
        {
            health.Status = "unhealthy";
            health.DbConnected = false;
        }

        return Ok(health);
    }

    // =========================================================================
    // POST /api/v1/events
    // =========================================================================
    [AllowAnonymous]
    [HttpPost("api/v1/events")]
    public async Task<IActionResult> ReceiveEvents([FromBody] ReceiveEventsRequest req)
    {
        try
        {
            // Build tuples for batch recording (single SaveChanges call)
            var batch = req.Events.Select(ev => (
                IpAddress: ev.IpAddress,
                Username: (string?)ev.Username,
                Hostname: (string?)req.Hostname,
                LogonType: SafeInt(ev.LogonType),
                FailureReason: !string.IsNullOrEmpty(ev.Status) ? ev.Status : (string?)null,
                SourcePort: SafeInt(ev.SourcePort),
                SourceVmId: (string?)req.VmId,
                EventTimestamp: !string.IsNullOrEmpty(ev.Timestamp)
                    ? DateTime.TryParse(ev.Timestamp, out var ts) ? ts : (DateTime?)null
                    : (DateTime?)null
            )).ToList();

            await _service.RecordFailedLoginBatchAsync(batch);

            // Push to SSE feed after successful DB save
            foreach (var ev in req.Events)
            {
                _broadcast.Publish(new SseEventData
                {
                    IpAddress = ev.IpAddress,
                    Username = ev.Username,
                    Timestamp = ev.Timestamp,
                    VmId = req.VmId
                });
            }

            return Ok(new EventsReceivedResponse
            {
                Success = true,
                EventsReceived = req.Events.Count
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { detail = ex.Message });
        }
    }

    // =========================================================================
    // GET /api/v1/suspicious-ips
    // =========================================================================
    [HttpGet("api/v1/suspicious-ips")]
    public async Task<IActionResult> GetSuspiciousIps([FromQuery] int threshold = 5)
    {
        try
        {
            var results = await _service.GetSuspiciousIpsAsync(threshold);
            return Ok(new ListResponse<SuspiciousIpDto> { Success = true, Data = results, Count = results.Count });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { detail = ex.Message });
        }
    }

    // =========================================================================
    // GET /api/v1/blocked-ips
    // =========================================================================
    [HttpGet("api/v1/blocked-ips")]
    public async Task<IActionResult> GetBlockedIps()
    {
        try
        {
            var results = await _db.BlockedIPs
                .Where(b => b.IsActive)
                .Select(b => new BlockedIpDto
                {
                    IpAddress = b.IpAddress,
                    BlockedAt = b.BlockedAt,
                    BlockExpires = b.BlockExpires,
                    Reason = b.Reason,
                    BlockedBy = b.BlockedBy
                })
                .ToListAsync();

            return Ok(new ListResponse<BlockedIpDto> { Success = true, Data = results, Count = results.Count });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { detail = ex.Message });
        }
    }

    // =========================================================================
    // POST /api/v1/block
    // =========================================================================
    [HttpPost("api/v1/block")]
    public async Task<IActionResult> BlockIp([FromBody] ManualBlockRequest req)
    {
        try
        {
            await _service.BlockIpAsync(req.IpAddress, req.Reason, req.DurationMinutes, "manual");
            return Ok(new MessageResponse
            {
                Success = true,
                Message = $"IP {req.IpAddress} blocked for {req.DurationMinutes} minutes"
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { detail = ex.Message });
        }
    }

    // =========================================================================
    // POST /api/v1/block/per-vm
    // =========================================================================
    [HttpPost("api/v1/block/per-vm")]
    public async Task<IActionResult> BlockIpPerVm([FromBody] PerVmBlockRequest req)
    {
        try
        {
            await _service.BlockIpPerVmAsync(req.IpAddress, req.VmId, req.Reason, req.DurationMinutes, "manual");
            return Ok(new MessageResponse
            {
                Success = true,
                Message = $"IP {req.IpAddress} blocked on VM {req.VmId} for {req.DurationMinutes} minutes"
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { detail = ex.Message });
        }
    }

    // =========================================================================
    // DELETE /api/v1/block/{ip}
    // =========================================================================
    [HttpDelete("api/v1/block/{ip}")]
    public async Task<IActionResult> UnblockIp(string ip)
    {
        try
        {
            var blockedEntries = await _db.BlockedIPs
                .Where(b => b.IpAddress == ip && b.IsActive)
                .ToListAsync();

            foreach (var entry in blockedEntries)
            {
                entry.IsActive = false;
                entry.UnblockedAt = DateTime.Now;
                entry.UnblockedBy = "manual";
            }

            var suspiciousEntries = await _db.SuspiciousIPs
                .Where(s => s.IpAddress == ip)
                .ToListAsync();

            foreach (var entry in suspiciousEntries)
            {
                entry.Status = "cleared";
            }

            await _db.SaveChangesAsync();

            return Ok(new MessageResponse
            {
                Success = true,
                Message = $"IP {ip} unblocked"
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { detail = ex.Message });
        }
    }

    // =========================================================================
    // POST /api/v1/vms
    // =========================================================================
    [HttpPost("api/v1/vms")]
    public async Task<IActionResult> RegisterVm([FromBody] RegisterVmRequest req)
    {
        try
        {
            await _service.RegisterVmAsync(req.VmId, req.Hostname, req.IpAddress, req.CollectionMethod);
            return Ok(new MessageResponse
            {
                Success = true,
                Message = $"VM {req.VmId} registered successfully"
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { detail = ex.Message });
        }
    }

    // =========================================================================
    // GET /api/v1/vms
    // =========================================================================
    [HttpGet("api/v1/vms")]
    public async Task<IActionResult> ListVms()
    {
        try
        {
            var results = await _db.VMSources
                .Select(v => new VmListDto
                {
                    VmId = v.VmId,
                    Hostname = v.Hostname,
                    IpAddress = v.IpAddress,
                    CollectionMethod = v.CollectionMethod,
                    Status = v.Status,
                    LastSeen = v.LastSeen
                })
                .ToListAsync();

            return Ok(new ListResponse<VmListDto> { Success = true, Data = results, Count = results.Count });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { detail = ex.Message });
        }
    }

    // =========================================================================
    // DELETE /api/v1/vms/{vm_id}
    // =========================================================================
    [HttpDelete("api/v1/vms/{vmId}")]
    public async Task<IActionResult> DeleteVm(string vmId)
    {
        try
        {
            var vm = await _db.VMSources.FirstOrDefaultAsync(v => v.VmId == vmId);
            if (vm != null)
            {
                vm.Status = "inactive";
                await _db.SaveChangesAsync();
            }

            return Ok(new MessageResponse
            {
                Success = true,
                Message = $"VM {vmId} unregistered"
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { detail = ex.Message });
        }
    }

    // =========================================================================
    // GET /api/v1/vms/{vm_id}/attacks
    // =========================================================================
    [HttpGet("api/v1/vms/{vmId}/attacks")]
    public async Task<IActionResult> GetVmAttacks(string vmId)
    {
        try
        {
            var result = await _service.GetVmStatsAsync(vmId);
            return Ok(result);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { detail = ex.Message });
        }
    }

    // =========================================================================
    // GET /api/v1/feed  (Server-Sent Events)
    // =========================================================================
    [AllowAnonymous]
    [HttpGet("api/v1/feed")]
    public async Task Feed(CancellationToken cancellationToken)
    {
        Response.Headers.Append("Content-Type", "text/event-stream");
        Response.Headers.Append("Cache-Control", "no-cache");
        Response.Headers.Append("Connection", "keep-alive");

        var writer = Response.Body;
        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };

        // Each client gets its own subscriber channel (fixes single-consumer bug)
        var subscription = _broadcast.Subscribe();

        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            var reader = subscription.Reader;

            // Single writer loop: drains events and sends pings without concurrent
            // writes to Response.Body (fixes the race condition bug).
            while (!cts.Token.IsCancellationRequested)
            {
                // Wait up to 1 second for an event; if none arrives, send a ping.
                using var delayCts = CancellationTokenSource.CreateLinkedTokenSource(cts.Token);
                delayCts.CancelAfter(TimeSpan.FromSeconds(1));

                string message;
                try
                {
                    if (reader.TryRead(out var evt))
                    {
                        // Immediately available event
                        var data = JsonSerializer.Serialize(evt, jsonOptions);
                        message = $"event: new_attack\ndata: {data}\n\n";
                    }
                    else if (await reader.WaitToReadAsync(delayCts.Token))
                    {
                        // Event became available within the 1s window
                        if (reader.TryRead(out var evt2))
                        {
                            var data = JsonSerializer.Serialize(evt2, jsonOptions);
                            message = $"event: new_attack\ndata: {data}\n\n";
                        }
                        else
                        {
                            continue;
                        }
                    }
                    else
                    {
                        // Channel completed (service shutting down)
                        break;
                    }
                }
                catch (OperationCanceledException) when (!cts.Token.IsCancellationRequested)
                {
                    // The 1s delay expired — send a ping to keep the connection alive
                    message = "event: ping\ndata: keep-alive\n\n";
                }

                await writer.WriteAsync(System.Text.Encoding.UTF8.GetBytes(message), cts.Token);
                await writer.FlushAsync(cts.Token);
            }
        }
        catch (OperationCanceledException)
        {
            // Client disconnected - normal
        }
        finally
        {
            _broadcast.Unsubscribe(subscription);
        }
    }

    // =========================================================================
    // GET /api/v1/statistics
    // =========================================================================
    [HttpGet("api/v1/statistics")]
    public async Task<IActionResult> GetStatistics()
    {
        try
        {
            var data = await _service.GetStatisticsAsync();
            return Ok(new { success = true, data });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { detail = ex.Message });
        }
    }

    // =========================================================================
    // GET /api/v1/statistics/global
    // =========================================================================
    [HttpGet("api/v1/statistics/global")]
    public async Task<IActionResult> GetGlobalStatistics()
    {
        try
        {
            var data = await _service.GetGlobalStatisticsAsync();
            return Ok(new { success = true, data });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { detail = ex.Message });
        }
    }

}
