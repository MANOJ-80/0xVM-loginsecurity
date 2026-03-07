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

    // =========================================================================
    // PerVmThreshold CRUD
    // =========================================================================

    /// <summary>
    /// Get all per-VM thresholds with their resolved global fallback values.
    /// </summary>
    public async Task<List<PerVmThresholdDto>> GetAllPerVmThresholdsAsync()
    {
        return await _db.PerVMThresholds
            .OrderBy(p => p.VmId)
            .Select(p => new PerVmThresholdDto
            {
                VmId = p.VmId,
                Threshold = p.Threshold,
                TimeWindowMinutes = p.TimeWindowMinutes,
                BlockDurationMinutes = p.BlockDurationMinutes,
                AutoBlockEnabled = p.AutoBlockEnabled
            })
            .ToListAsync();
    }

    /// <summary>
    /// Get threshold settings for a specific VM (per-VM override or global fallback).
    /// </summary>
    public async Task<PerVmThresholdDto> GetVmThresholdAsync(string vmId)
    {
        var (threshold, timeWindow, blockDuration, autoBlock) = await GetThresholdSettingsAsync(vmId);
        return new PerVmThresholdDto
        {
            VmId = vmId,
            Threshold = threshold,
            TimeWindowMinutes = timeWindow,
            BlockDurationMinutes = blockDuration,
            AutoBlockEnabled = autoBlock
        };
    }

    /// <summary>
    /// Create or update a per-VM threshold override.
    /// </summary>
    public async Task<PerVmThresholdDto> UpsertPerVmThresholdAsync(PerVmThresholdDto dto)
    {
        // Validate VM exists
        var vmExists = await _db.VMSources.AnyAsync(v => v.VmId == dto.VmId);
        if (!vmExists)
            throw new InvalidOperationException($"VM '{dto.VmId}' does not exist");

        var existing = await _db.PerVMThresholds.FirstOrDefaultAsync(p => p.VmId == dto.VmId);

        if (existing != null)
        {
            existing.Threshold = dto.Threshold;
            existing.TimeWindowMinutes = dto.TimeWindowMinutes;
            existing.BlockDurationMinutes = dto.BlockDurationMinutes;
            existing.AutoBlockEnabled = dto.AutoBlockEnabled;
            existing.UpdatedAt = DateTime.Now;
        }
        else
        {
            _db.PerVMThresholds.Add(new PerVmThreshold
            {
                VmId = dto.VmId,
                Threshold = dto.Threshold,
                TimeWindowMinutes = dto.TimeWindowMinutes,
                BlockDurationMinutes = dto.BlockDurationMinutes,
                AutoBlockEnabled = dto.AutoBlockEnabled
            });
        }

        await _db.SaveChangesAsync();
        return dto;
    }

    /// <summary>
    /// Delete a per-VM threshold override (VM reverts to global settings).
    /// </summary>
    public async Task<bool> DeletePerVmThresholdAsync(string vmId)
    {
        var existing = await _db.PerVMThresholds.FirstOrDefaultAsync(p => p.VmId == vmId);
        if (existing == null)
            return false;

        _db.PerVMThresholds.Remove(existing);
        await _db.SaveChangesAsync();
        return true;
    }

    /// <summary>
    /// Get the current global threshold settings from the Settings table.
    /// </summary>
    public async Task<PerVmThresholdDto> GetGlobalThresholdAsync()
    {
        var settings = await _db.Settings.ToDictionaryAsync(s => s.KeyName, s => s.Value);
        int.TryParse(settings.GetValueOrDefault("GLOBAL_THRESHOLD", "5"), out var threshold);
        int.TryParse(settings.GetValueOrDefault("TIME_WINDOW", "5"), out var timeWindow);
        int.TryParse(settings.GetValueOrDefault("BLOCK_DURATION", "60"), out var blockDuration);
        var autoBlock = settings.GetValueOrDefault("ENABLE_AUTO_BLOCK", "true")?.ToLower() == "true";

        return new PerVmThresholdDto
        {
            VmId = "GLOBAL",
            Threshold = threshold,
            TimeWindowMinutes = timeWindow,
            BlockDurationMinutes = blockDuration,
            AutoBlockEnabled = autoBlock
        };
    }

    private async Task<bool> IsAutoBlockEnabledAsync()
    {
        var setting = await _db.Settings.FirstOrDefaultAsync(s => s.KeyName == "ENABLE_AUTO_BLOCK");
        return setting?.Value?.ToLower() == "true";
    }

    private async Task<bool> IsIpAlreadyBlockedAsync(string ipAddress, string? targetVmId = null)
    {
        var now = DateTime.Now;

        // Check committed DB rows — must be active AND not expired
        bool dbBlocked;
        if (string.IsNullOrEmpty(targetVmId))
        {
            dbBlocked = await _db.BlockedIPs.AnyAsync(b =>
                b.IpAddress == ipAddress &&
                b.IsActive &&
                (b.BlockExpires == null || b.BlockExpires > now));
        }
        else
        {
            dbBlocked = await _db.BlockedIPs.AnyAsync(b => 
                b.IpAddress == ipAddress && 
                b.IsActive && 
                (b.BlockExpires == null || b.BlockExpires > now) &&
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
                   && (e.Entity.BlockExpires == null || e.Entity.BlockExpires > now)
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

        // Dedup: skip if this exact event was already recorded (check DB + change tracker)
        var exists = await _db.FailedLoginAttempts.AnyAsync(f =>
            f.IpAddress == ipAddress &&
            f.Username == username &&
            f.SourcePort == sourcePort &&
            f.Timestamp == ts &&
            f.SourceVmId == sourceVmId);

        if (exists)
            return;

        // Also check staged (uncommitted) entities in the same batch
        var stagedExists = _db.ChangeTracker.Entries<FailedLoginAttempt>()
            .Any(e => e.State == EntityState.Added
                   && e.Entity.IpAddress == ipAddress
                   && e.Entity.Username == username
                   && e.Entity.SourcePort == sourcePort
                   && e.Entity.Timestamp == ts
                   && e.Entity.SourceVmId == sourceVmId);

        if (stagedExists)
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
            suspicious = new SuspiciousIp
            {
                IpAddress = ipAddress,
                FailedAttempts = 1,
                FirstAttempt = ts,
                LastAttempt = ts,
                TargetUsernames = username != null 
                    ? System.Text.Json.JsonSerializer.Serialize(new List<string> { username }) 
                    : null
            };
            _db.SuspiciousIPs.Add(suspicious);
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
        await CheckThresholdAndAutoBlockAsync(ipAddress, sourceVmId, suspicious);
    }

    /// <summary>
    /// Check if IP exceeds threshold and auto-block if needed.
    /// Returns true if IP was blocked.
    /// </summary>
    private async Task<bool> CheckThresholdAndAutoBlockAsync(string ipAddress, string? sourceVmId, SuspiciousIp? suspiciousEntity)
    {
        // Get threshold settings (per-VM if available, otherwise global).
        // This already contains the correct auto-block enabled flag — either
        // per-VM override or the global ENABLE_AUTO_BLOCK setting.
        var (threshold, timeWindow, blockDuration, autoBlockEnabled) = await GetThresholdSettingsAsync(sourceVmId);
        
        if (!autoBlockEnabled)
            return false;

        // Check if already blocked
        if (await IsIpAlreadyBlockedAsync(ipAddress, sourceVmId))
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

            // Update suspicious IP status — use passed entity to avoid double-fetch
            if (suspiciousEntity != null)
            {
                suspiciousEntity.Status = "blocked";
            }
            else
            {
                var suspicious = await _db.SuspiciousIPs.FirstOrDefaultAsync(s => s.IpAddress == ipAddress);
                if (suspicious != null)
                {
                    suspicious.Status = "blocked";
                }
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
        // Return all IPs with meaningful activity (>= 2 attempts).
        // Include ALL statuses — this is an intelligence/monitoring view.
        // Compute risk_level based on how close they are to the threshold.
        var ips = await _db.SuspiciousIPs
            .Where(s => s.FailedAttempts >= 2)
            .OrderByDescending(s => s.FailedAttempts)
            .ToListAsync();

        return ips.Select(s =>
        {
            string riskLevel;
            if (s.Status == "blocked")
                riskLevel = "blocked";
            else if (s.Status == "cleared")
                riskLevel = "cleared";
            else if (s.FailedAttempts >= threshold)
                riskLevel = "critical";
            else if (s.FailedAttempts >= threshold * 0.7)
                riskLevel = "high";
            else if (s.FailedAttempts >= threshold * 0.4)
                riskLevel = "medium";
            else
                riskLevel = "low";

            List<string> usernames;
            try
            {
                usernames = string.IsNullOrEmpty(s.TargetUsernames)
                    ? new List<string>()
                    : System.Text.Json.JsonSerializer.Deserialize<List<string>>(s.TargetUsernames) ?? new List<string>();
            }
            catch
            {
                usernames = new List<string>();
            }

            return new SuspiciousIpDto
            {
                IpAddress = s.IpAddress,
                FailedAttempts = s.FailedAttempts,
                FirstAttempt = s.FirstAttempt,
                LastAttempt = s.LastAttempt,
                Status = s.Status,
                RiskLevel = riskLevel,
                TargetUsernames = usernames
            };
        }).ToList();
    }

    // =========================================================================
    // Equivalent of sp_BlockIP
    // =========================================================================
    public async Task BlockIpAsync(string ipAddress, string reason, int durationMinutes, string blockedBy = "manual")
    {
        // Prevent duplicate blocks — check if already actively blocked (and not expired)
        if (await IsIpAlreadyBlockedAsync(ipAddress))
            throw new InvalidOperationException($"IP {ipAddress} is already blocked");

        _db.BlockedIPs.Add(new BlockedIp
        {
            IpAddress = ipAddress,
            Reason = reason,
            BlockExpires = durationMinutes > 0 ? DateTime.Now.AddMinutes(durationMinutes) : null,
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
        // Prevent duplicate blocks — check if already actively blocked for this VM (or globally)
        if (await IsIpAlreadyBlockedAsync(ipAddress, targetVmId))
            throw new InvalidOperationException($"IP {ipAddress} is already blocked on VM {targetVmId}");

        _db.BlockedIPs.Add(new BlockedIp
        {
            IpAddress = ipAddress,
            Reason = reason,
            BlockExpires = durationMinutes > 0 ? DateTime.Now.AddMinutes(durationMinutes) : null,
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
                (b.BlockExpires == null || b.BlockExpires > DateTime.Now) &&
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
        var blockedIps = await _db.BlockedIPs
            .CountAsync(b => b.IsActive && (b.BlockExpires == null || b.BlockExpires > DateTime.Now));

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
        var blockedIps = await _db.BlockedIPs
            .CountAsync(b => b.IsActive && (b.BlockExpires == null || b.BlockExpires > DateTime.Now));

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
