using Microsoft.EntityFrameworkCore;
using SecurityMonitorApi.Data;
using SecurityMonitorApi.DTOs;
using SecurityMonitorApi.Models;

namespace SecurityMonitorApi.Services;

/// <summary>
/// Contains the business logic that was previously in SQL Server stored procedures.
/// All logic is now in C# following the Code-First approach.
/// </summary>
public class SecurityMonitorService
{
    private readonly SecurityMonitorContext _db;

    public SecurityMonitorService(SecurityMonitorContext db)
    {
        _db = db;
    }

    // =========================================================================
    // Settings & Threshold Helpers
    // =========================================================================
    
    private async Task<(int Threshold, int TimeWindowMinutes, int BlockDurationMinutes, bool AutoBlockEnabled)> 
        GetThresholdSettingsAsync(string? sourceVmId)
    {
        // First check for per-VM threshold
        if (!string.IsNullOrEmpty(sourceVmId))
        {
            var perVm = await _db.PerVMThresholds
                .FirstOrDefaultAsync(p => p.VmId == sourceVmId);
            
            if (perVm != null)
            {
                return (
                    perVm.Threshold,
                    perVm.TimeWindowMinutes,
                    perVm.BlockDurationMinutes,
                    perVm.AutoBlockEnabled
                );
            }
        }

        // Fall back to global settings
        var settings = await _db.Settings.ToDictionaryAsync(s => s.KeyName, s => s.Value);
        
        int.TryParse(settings.GetValueOrDefault("GLOBAL_THRESHOLD", "5"), out var globalThreshold);
        int.TryParse(settings.GetValueOrDefault("TIME_WINDOW", "5"), out var timeWindow);
        int.TryParse(settings.GetValueOrDefault("BLOCK_DURATION", "60"), out var blockDuration);
        var autoBlockEnabled = settings.GetValueOrDefault("ENABLE_AUTO_BLOCK", "true")?.ToLower() == "true";

        return (globalThreshold, timeWindow, blockDuration, autoBlockEnabled);
    }

    private async Task<bool> IsAutoBlockEnabledAsync()
    {
        var setting = await _db.Settings.FirstOrDefaultAsync(s => s.KeyName == "ENABLE_AUTO_BLOCK");
        return setting?.Value?.ToLower() == "true";
    }

    private async Task<bool> IsIpAlreadyBlockedAsync(string ipAddress, string? targetVmId = null)
    {
        // Check committed DB rows
        bool dbBlocked;
        if (string.IsNullOrEmpty(targetVmId))
        {
            dbBlocked = await _db.BlockedIPs.AnyAsync(b => b.IpAddress == ipAddress && b.IsActive);
        }
        else
        {
            dbBlocked = await _db.BlockedIPs.AnyAsync(b => 
                b.IpAddress == ipAddress && 
                b.IsActive && 
                (b.Scope == "global" || b.TargetVmId == targetVmId));
        }

        if (dbBlocked) return true;

        // Also check staged (uncommitted) blocks in the change tracker.
        // During batch processing, a block may have been staged for this IP
        // by an earlier event in the same batch but not yet saved to DB.
        var stagedBlocked = _db.ChangeTracker.Entries<BlockedIp>()
            .Any(e => e.State == EntityState.Added
                   && e.Entity.IpAddress == ipAddress
                   && e.Entity.IsActive
                   && (string.IsNullOrEmpty(targetVmId) 
                       || e.Entity.Scope == "global" 
                       || e.Entity.TargetVmId == targetVmId));

        return stagedBlocked;
    }

    // =========================================================================
    // Equivalent of sp_RecordFailedLoginMultiVM
    // =========================================================================
    public async Task RecordFailedLoginAsync(
        string ipAddress,
        string? username,
        string? hostname,
        int? logonType,
        string? failureReason,
        int? sourcePort,
        string? sourceVmId,
        DateTime? eventTimestamp)
    {
        await RecordFailedLoginCoreAsync(ipAddress, username, hostname, logonType,
            failureReason, sourcePort, sourceVmId, eventTimestamp);
        await _db.SaveChangesAsync();
    }

    /// <summary>
    /// Batch-record multiple failed logins with a single SaveChangesAsync call.
    /// </summary>
    public async Task RecordFailedLoginBatchAsync(
        IEnumerable<(string IpAddress, string? Username, string? Hostname,
            int? LogonType, string? FailureReason, int? SourcePort,
            string? SourceVmId, DateTime? EventTimestamp)> events)
    {
        var eventsList = events.ToList();
        
        foreach (var ev in eventsList)
        {
            await RecordFailedLoginCoreAsync(ev.IpAddress, ev.Username, ev.Hostname,
                ev.LogonType, ev.FailureReason, ev.SourcePort,
                ev.SourceVmId, ev.EventTimestamp);
        }

        await _db.SaveChangesAsync();
    }

    /// <summary>
    /// Core logic for recording a single failed login — stages changes but does NOT call SaveChanges.
    /// Also handles threshold detection and auto-blocking.
    /// </summary>
    private async Task RecordFailedLoginCoreAsync(
        string ipAddress,
        string? username,
        string? hostname,
        int? logonType,
        string? failureReason,
        int? sourcePort,
        string? sourceVmId,
        DateTime? eventTimestamp)
    {
        var ts = eventTimestamp ?? DateTime.Now;

        // Dedup: skip if this exact event was already recorded
        var exists = await _db.FailedLoginAttempts.AnyAsync(f =>
            f.IpAddress == ipAddress &&
            f.Username == username &&
            f.SourcePort == sourcePort &&
            f.Timestamp == ts &&
            f.SourceVmId == sourceVmId);

        if (exists)
            return;

        // Insert the failed login attempt
        _db.FailedLoginAttempts.Add(new FailedLoginAttempt
        {
            IpAddress = ipAddress,
            Username = username,
            Hostname = hostname,
            LogonType = logonType,
            FailureReason = failureReason,
            SourcePort = sourcePort,
            SourceVmId = sourceVmId,
            Timestamp = ts
        });

        // Update or insert suspicious IP (global lifetime counter)
        var suspicious = await _db.SuspiciousIPs
            .FirstOrDefaultAsync(s => s.IpAddress == ipAddress);

        if (suspicious != null)
        {
            suspicious.FailedAttempts += 1;
            suspicious.LastAttempt = ts;
            suspicious.UpdatedAt = DateTime.Now;
            
            // Update target usernames JSON
            var usernames = string.IsNullOrEmpty(suspicious.TargetUsernames) 
                ? new List<string>() 
                : System.Text.Json.JsonSerializer.Deserialize<List<string>>(suspicious.TargetUsernames) ?? new List<string>();
            
            if (!string.IsNullOrEmpty(username) && !usernames.Contains(username))
            {
                usernames.Add(username);
                if (usernames.Count > 20) usernames.RemoveAt(0); // Keep last 20
                suspicious.TargetUsernames = System.Text.Json.JsonSerializer.Serialize(usernames);
            }
        }
        else
        {
            var newSuspicious = new SuspiciousIp
            {
                IpAddress = ipAddress,
                FailedAttempts = 1,
                FirstAttempt = ts,
                LastAttempt = ts,
                TargetUsernames = username != null 
                    ? System.Text.Json.JsonSerializer.Serialize(new List<string> { username }) 
                    : null
            };
            _db.SuspiciousIPs.Add(newSuspicious);
        }

        // Touch VMSources.last_seen so we know the agent is alive
        if (!string.IsNullOrEmpty(sourceVmId))
        {
            var vm = await _db.VMSources.FirstOrDefaultAsync(v => v.VmId == sourceVmId);
            if (vm != null)
            {
                vm.LastSeen = DateTime.Now;
            }
        }

        // ========================================================
        // THRESHOLD DETECTION & AUTO-BLOCK LOGIC (Tasks 1, 2, 2b)
        // ========================================================
        await CheckThresholdAndAutoBlockAsync(ipAddress, sourceVmId);
    }

    /// <summary>
    /// Check if IP exceeds threshold and auto-block if needed.
    /// Returns true if IP was blocked.
    /// </summary>
    private async Task<bool> CheckThresholdAndAutoBlockAsync(string ipAddress, string? sourceVmId)
    {
        // Check if auto-block is enabled
        var autoBlockEnabled = await IsAutoBlockEnabledAsync();
        if (!autoBlockEnabled)
            return false;

        // Check if already blocked
        if (await IsIpAlreadyBlockedAsync(ipAddress, sourceVmId))
            return false;

        // Get threshold settings (global or per-VM)
        var (threshold, timeWindow, blockDuration, vmAutoBlockEnabled) = await GetThresholdSettingsAsync(sourceVmId);
        
        // Check if per-VM auto-block is disabled
        if (!vmAutoBlockEnabled)
            return false;

        // Count attempts within time window.
        // We must count BOTH committed DB rows AND uncommitted (staged) entities
        // in the EF change tracker. During batch processing, SaveChangesAsync is
        // called only once at the end, so newly added events in the same batch
        // won't appear in a DB query yet. Without this, burst attacks that arrive
        // in a single batch can slip past the threshold check.
        var windowStart = DateTime.Now.AddMinutes(-timeWindow);
        var dbCount = await _db.FailedLoginAttempts
            .CountAsync(f => f.IpAddress == ipAddress && f.Timestamp >= windowStart);

        var stagedCount = _db.ChangeTracker.Entries<FailedLoginAttempt>()
            .Count(e => e.State == EntityState.Added
                     && e.Entity.IpAddress == ipAddress
                     && e.Entity.Timestamp >= windowStart);

        var attemptCount = dbCount + stagedCount;

        // If threshold exceeded, stage auto-block (don't save yet - let batch handle it)
        if (attemptCount >= threshold)
        {
            var reason = $"Auto-block: exceeded threshold ({attemptCount} attempts in {timeWindow} minutes)";
            
            if (!string.IsNullOrEmpty(sourceVmId))
            {
                // Stage the block - don't save yet
                _db.BlockedIPs.Add(new BlockedIp
                {
                    IpAddress = ipAddress,
                    Reason = reason,
                    BlockExpires = DateTime.Now.AddMinutes(blockDuration),
                    BlockedBy = "auto",
                    Scope = "per-vm",
                    TargetVmId = sourceVmId
                });
            }
            else
            {
                // Stage the block - don't save yet
                _db.BlockedIPs.Add(new BlockedIp
                {
                    IpAddress = ipAddress,
                    Reason = reason,
                    BlockExpires = DateTime.Now.AddMinutes(blockDuration),
                    BlockedBy = "auto"
                });
            }

            // Update suspicious IP status
            var suspicious = await _db.SuspiciousIPs.FirstOrDefaultAsync(s => s.IpAddress == ipAddress);
            if (suspicious != null)
            {
                suspicious.Status = "blocked";
            }

            return true;
        }

        return false;
    }

    // =========================================================================
    // Equivalent of sp_GetSuspiciousIPs
    // =========================================================================
    public async Task<List<SuspiciousIpDto>> GetSuspiciousIpsAsync(int threshold)
    {
        return await _db.SuspiciousIPs
            .Where(s => s.FailedAttempts >= threshold && s.Status == "active")
            .OrderByDescending(s => s.FailedAttempts)
            .Select(s => new SuspiciousIpDto
            {
                IpAddress = s.IpAddress,
                FailedAttempts = s.FailedAttempts,
                FirstAttempt = s.FirstAttempt,
                LastAttempt = s.LastAttempt,
                Status = s.Status
            })
            .ToListAsync();
    }

    // =========================================================================
    // Equivalent of sp_BlockIP
    // =========================================================================
    public async Task BlockIpAsync(string ipAddress, string reason, int durationMinutes, string blockedBy = "manual")
    {
        _db.BlockedIPs.Add(new BlockedIp
        {
            IpAddress = ipAddress,
            Reason = reason,
            BlockExpires = DateTime.Now.AddMinutes(durationMinutes),
            BlockedBy = blockedBy
        });

        var suspicious = await _db.SuspiciousIPs
            .FirstOrDefaultAsync(s => s.IpAddress == ipAddress);
        if (suspicious != null)
        {
            suspicious.Status = "blocked";
        }

        await _db.SaveChangesAsync();
    }

    // =========================================================================
    // Equivalent of sp_BlockIPPerVM
    // =========================================================================
    public async Task BlockIpPerVmAsync(string ipAddress, string targetVmId, string reason, int durationMinutes, string blockedBy = "manual")
    {
        _db.BlockedIPs.Add(new BlockedIp
        {
            IpAddress = ipAddress,
            Reason = reason,
            BlockExpires = DateTime.Now.AddMinutes(durationMinutes),
            BlockedBy = blockedBy,
            Scope = "per-vm",
            TargetVmId = targetVmId
        });

        var suspicious = await _db.SuspiciousIPs
            .FirstOrDefaultAsync(s => s.IpAddress == ipAddress);

        if (suspicious != null)
        {
            suspicious.Status = "blocked";
            suspicious.UpdatedAt = DateTime.Now;
        }
        else
        {
            _db.SuspiciousIPs.Add(new SuspiciousIp
            {
                IpAddress = ipAddress,
                FailedAttempts = 1,
                FirstAttempt = DateTime.Now,
                LastAttempt = DateTime.Now,
                Status = "blocked"
            });
        }

        await _db.SaveChangesAsync();
    }

    // =========================================================================
    // Equivalent of sp_RegisterVM
    // =========================================================================
    public async Task RegisterVmAsync(string vmId, string hostname, string ipAddress, string collectionMethod)
    {
        var existing = await _db.VMSources.FirstOrDefaultAsync(v => v.VmId == vmId);

        if (existing != null)
        {
            existing.Hostname = hostname;
            existing.IpAddress = ipAddress;
            existing.CollectionMethod = collectionMethod;
            existing.Status = "active";
            existing.LastSeen = DateTime.Now;
        }
        else
        {
            _db.VMSources.Add(new VmSource
            {
                VmId = vmId,
                Hostname = hostname,
                IpAddress = ipAddress,
                CollectionMethod = collectionMethod,
                Status = "active",
                LastSeen = DateTime.Now
            });
        }

        await _db.SaveChangesAsync();
    }

    // =========================================================================
    // Equivalent of sp_GetVMStats
    // =========================================================================
    public async Task<VmAttacksResponse> GetVmStatsAsync(string vmId)
    {
        var stats = await _db.FailedLoginAttempts
            .Where(f => f.SourceVmId == vmId)
            .GroupBy(f => f.SourceVmId)
            .Select(g => new
            {
                TotalAttacks = g.Count(),
                UniqueAttackers = g.Select(f => f.IpAddress).Distinct().Count(),
                LastAttack = g.Max(f => f.Timestamp)
            })
            .FirstOrDefaultAsync();

        var blockedCount = await _db.BlockedIPs
            .CountAsync(b => b.IsActive &&
                (b.Scope == "global" || (b.Scope == "per-vm" && b.TargetVmId == vmId)));

        if (stats == null)
        {
            return new VmAttacksResponse
            {
                Success = true,
                VmId = vmId,
                TotalAttacks = 0,
                UniqueAttackers = 0
            };
        }

        return new VmAttacksResponse
        {
            Success = true,
            VmId = vmId,
            TotalAttacks = stats.TotalAttacks,
            UniqueAttackers = stats.UniqueAttackers,
            BlockedCount = blockedCount,
            LastAttack = stats.LastAttack
        };
    }

    // =========================================================================
    // Statistics
    // =========================================================================
    public async Task<StatisticsData> GetStatisticsAsync()
    {
        var totalFailed = await _db.FailedLoginAttempts.CountAsync();
        var uniqueAttackers = await _db.FailedLoginAttempts
            .Select(f => f.IpAddress).Distinct().CountAsync();
        var blockedIps = await _db.BlockedIPs.CountAsync(b => b.IsActive);

        var now = DateTime.Now;
        var last24h = now.AddHours(-24);
        var lastHour = now.AddHours(-1);

        var attacksLast24h = await _db.FailedLoginAttempts
            .CountAsync(f => f.Timestamp >= last24h);
        var attacksLastHour = await _db.FailedLoginAttempts
            .CountAsync(f => f.Timestamp >= lastHour);

        var topUsernames = await _db.FailedLoginAttempts
            .Where(f => f.Username != null)
            .GroupBy(f => f.Username!)
            .OrderByDescending(g => g.Count())
            .Take(10)
            .Select(g => new UsernameCount
            {
                Username = g.Key,
                Count = g.Count()
            })
            .ToListAsync();

        // Fetch raw hour (int) from DB, then format client-side.
        // ToString("D2") does not translate to SQL Server via EF Core.
        var attacksByHourRaw = await _db.FailedLoginAttempts
            .Where(f => f.Timestamp >= last24h)
            .GroupBy(f => f.Timestamp.Hour)
            .OrderBy(g => g.Key)
            .Select(g => new { Hour = g.Key, Count = g.Count() })
            .ToListAsync();

        var attacksByHour = attacksByHourRaw
            .Select(x => new HourCount
            {
                Hour = x.Hour.ToString("D2") + ":00",
                Count = x.Count
            })
            .ToList();

        return new StatisticsData
        {
            TotalFailedAttempts = totalFailed,
            UniqueAttackers = uniqueAttackers,
            BlockedIps = blockedIps,
            AttacksLast24h = attacksLast24h,
            AttacksLastHour = attacksLastHour,
            TopAttackedUsernames = topUsernames,
            AttacksByHour = attacksByHour
        };
    }

    public async Task<GlobalStatisticsData> GetGlobalStatisticsAsync()
    {
        var totalFailed = await _db.FailedLoginAttempts.CountAsync();
        var uniqueAttackers = await _db.FailedLoginAttempts
            .Select(f => f.IpAddress).Distinct().CountAsync();
        var blockedIps = await _db.BlockedIPs.CountAsync(b => b.IsActive);

        var activeVms = await _db.VMSources.CountAsync(v => v.Status == "active");
        var inactiveVms = await _db.VMSources.CountAsync(v => v.Status == "inactive");

        var now = DateTime.Now;
        var last24h = now.AddHours(-24);
        var lastHour = now.AddHours(-1);

        var attacksLast24h = await _db.FailedLoginAttempts
            .CountAsync(f => f.Timestamp >= last24h);
        var attacksLastHour = await _db.FailedLoginAttempts
            .CountAsync(f => f.Timestamp >= lastHour);

        var attacksByVm = await _db.FailedLoginAttempts
            .Where(f => f.SourceVmId != null)
            .GroupBy(f => f.SourceVmId!)
            .OrderByDescending(g => g.Count())
            .Select(g => new VmCount
            {
                VmId = g.Key,
                Count = g.Count()
            })
            .ToListAsync();

        var topUsernames = await _db.FailedLoginAttempts
            .Where(f => f.Username != null)
            .GroupBy(f => f.Username!)
            .OrderByDescending(g => g.Count())
            .Take(10)
            .Select(g => new UsernameCount
            {
                Username = g.Key,
                Count = g.Count()
            })
            .ToListAsync();

        // Fetch raw hour (int) from DB, then format client-side.
        var attacksByHourRaw = await _db.FailedLoginAttempts
            .Where(f => f.Timestamp >= last24h)
            .GroupBy(f => f.Timestamp.Hour)
            .OrderBy(g => g.Key)
            .Select(g => new { Hour = g.Key, Count = g.Count() })
            .ToListAsync();

        var attacksByHour = attacksByHourRaw
            .Select(x => new HourCount
            {
                Hour = x.Hour.ToString("D2") + ":00",
                Count = x.Count
            })
            .ToList();

        return new GlobalStatisticsData
        {
            TotalFailedAttempts = totalFailed,
            UniqueAttackers = uniqueAttackers,
            BlockedIps = blockedIps,
            ActiveVms = activeVms,
            InactiveVms = inactiveVms,
            AttacksLast24h = attacksLast24h,
            AttacksLastHour = attacksLastHour,
            AttacksByVm = attacksByVm,
            TopAttackedUsernames = topUsernames,
            AttacksByHour = attacksByHour
        };
    }
}
