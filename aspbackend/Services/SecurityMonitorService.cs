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
        foreach (var ev in events)
        {
            await RecordFailedLoginCoreAsync(ev.IpAddress, ev.Username, ev.Hostname,
                ev.LogonType, ev.FailureReason, ev.SourcePort,
                ev.SourceVmId, ev.EventTimestamp);
        }

        await _db.SaveChangesAsync();
    }

    /// <summary>
    /// Core logic for recording a single failed login — stages changes but does NOT call SaveChanges.
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
        }
        else
        {
            _db.SuspiciousIPs.Add(new SuspiciousIp
            {
                IpAddress = ipAddress,
                FailedAttempts = 1,
                FirstAttempt = ts,
                LastAttempt = ts
            });
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
