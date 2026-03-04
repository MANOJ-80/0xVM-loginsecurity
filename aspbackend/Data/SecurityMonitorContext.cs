using Microsoft.EntityFrameworkCore;
using SecurityMonitorApi.Models;

namespace SecurityMonitorApi.Data;

public class SecurityMonitorContext : DbContext
{
    public SecurityMonitorContext(DbContextOptions<SecurityMonitorContext> options)
        : base(options)
    {
    }

    public DbSet<FailedLoginAttempt> FailedLoginAttempts => Set<FailedLoginAttempt>();
    public DbSet<SuspiciousIp> SuspiciousIPs => Set<SuspiciousIp>();
    public DbSet<BlockedIp> BlockedIPs => Set<BlockedIp>();
    public DbSet<Setting> Settings => Set<Setting>();
    public DbSet<VmSource> VMSources => Set<VmSource>();
    public DbSet<PerVmThreshold> PerVMThresholds => Set<PerVmThreshold>();
    public DbSet<AttackStatistic> AttackStatistics => Set<AttackStatistic>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // =============================================
        // FailedLoginAttempts
        // =============================================
        modelBuilder.Entity<FailedLoginAttempt>(entity =>
        {
            entity.ToTable("FailedLoginAttempts");

            entity.Property(e => e.IpAddress)
                .HasColumnName("ip_address")
                .HasMaxLength(45)
                .IsRequired();

            entity.Property(e => e.Username)
                .HasColumnName("username")
                .HasMaxLength(256);

            entity.Property(e => e.Hostname)
                .HasColumnName("hostname")
                .HasMaxLength(256);

            entity.Property(e => e.LogonType)
                .HasColumnName("logon_type");

            entity.Property(e => e.FailureReason)
                .HasColumnName("failure_reason")
                .HasMaxLength(20);

            entity.Property(e => e.SourcePort)
                .HasColumnName("source_port");

            entity.Property(e => e.Timestamp)
                .HasColumnName("timestamp")
                .HasColumnType("datetime2")
                .IsRequired();

            entity.Property(e => e.EventId)
                .HasColumnName("event_id")
                .HasDefaultValue(4625);

            entity.Property(e => e.SourceVmId)
                .HasColumnName("source_vm_id")
                .HasMaxLength(100);

            // Indexes matching the original schema
            entity.HasIndex(e => new { e.IpAddress, e.Timestamp })
                .HasDatabaseName("idx_ip_timestamp");

            entity.HasIndex(e => e.Timestamp)
                .HasDatabaseName("idx_timestamp");

            entity.HasIndex(e => new { e.SourceVmId, e.Timestamp })
                .HasDatabaseName("idx_source_vm");

            // Covering index for dedup check
            entity.HasIndex(e => new { e.IpAddress, e.Username, e.SourcePort, e.Timestamp, e.SourceVmId })
                .HasDatabaseName("idx_dedup_check");
        });

        // =============================================
        // SuspiciousIPs
        // =============================================
        modelBuilder.Entity<SuspiciousIp>(entity =>
        {
            entity.ToTable("SuspiciousIPs");

            entity.Property(e => e.IpAddress)
                .HasColumnName("ip_address")
                .HasMaxLength(45)
                .IsRequired();

            entity.HasIndex(e => e.IpAddress)
                .IsUnique()
                .HasDatabaseName("idx_suspicious_ip");

            entity.Property(e => e.FailedAttempts)
                .HasColumnName("failed_attempts")
                .HasDefaultValue(1);

            entity.Property(e => e.FirstAttempt)
                .HasColumnName("first_attempt")
                .HasColumnType("datetime2");

            entity.Property(e => e.LastAttempt)
                .HasColumnName("last_attempt")
                .HasColumnType("datetime2");

            entity.Property(e => e.TargetUsernames)
                .HasColumnName("target_usernames");

            entity.Property(e => e.Status)
                .HasColumnName("status")
                .HasMaxLength(20)
                .HasDefaultValue("active");

            entity.Property(e => e.CreatedAt)
                .HasColumnName("created_at")
                .HasColumnType("datetime2")
                .HasDefaultValueSql("GETUTCDATE()");

            entity.Property(e => e.UpdatedAt)
                .HasColumnName("updated_at")
                .HasColumnType("datetime2")
                .HasDefaultValueSql("GETUTCDATE()");

            entity.HasIndex(e => e.Status)
                .HasDatabaseName("idx_suspicious_status");
        });

        // =============================================
        // BlockedIPs
        // =============================================
        modelBuilder.Entity<BlockedIp>(entity =>
        {
            entity.ToTable("BlockedIPs");

            entity.Property(e => e.IpAddress)
                .HasColumnName("ip_address")
                .HasMaxLength(45)
                .IsRequired();

            entity.Property(e => e.BlockedAt)
                .HasColumnName("blocked_at")
                .HasColumnType("datetime2")
                .HasDefaultValueSql("GETUTCDATE()");

            entity.Property(e => e.BlockExpires)
                .HasColumnName("block_expires")
                .HasColumnType("datetime2");

            entity.Property(e => e.Reason)
                .HasColumnName("reason")
                .HasMaxLength(500);

            entity.Property(e => e.BlockedBy)
                .HasColumnName("blocked_by")
                .HasMaxLength(50)
                .HasDefaultValue("auto");

            entity.Property(e => e.IsActive)
                .HasColumnName("is_active")
                .HasDefaultValue(true);

            entity.Property(e => e.UnblockedAt)
                .HasColumnName("unblocked_at")
                .HasColumnType("datetime2");

            entity.Property(e => e.UnblockedBy)
                .HasColumnName("unblocked_by")
                .HasMaxLength(50);

            entity.Property(e => e.Scope)
                .HasColumnName("scope")
                .HasMaxLength(20)
                .HasDefaultValue("global");

            entity.Property(e => e.TargetVmId)
                .HasColumnName("target_vm_id")
                .HasMaxLength(100);

            entity.HasIndex(e => e.IsActive)
                .HasDatabaseName("idx_blocked_active");

            entity.HasIndex(e => e.BlockExpires)
                .HasDatabaseName("idx_blocked_expires");

            entity.HasIndex(e => new { e.Scope, e.IsActive })
                .HasDatabaseName("idx_blocked_scope");
        });

        // =============================================
        // Settings
        // =============================================
        modelBuilder.Entity<Setting>(entity =>
        {
            entity.ToTable("Settings");

            entity.HasKey(e => e.KeyName);

            entity.Property(e => e.KeyName)
                .HasColumnName("key_name")
                .HasMaxLength(100);

            entity.Property(e => e.Value)
                .HasColumnName("value")
                .HasMaxLength(500);

            entity.Property(e => e.Description)
                .HasColumnName("description")
                .HasMaxLength(500);

            entity.Property(e => e.UpdatedAt)
                .HasColumnName("updated_at")
                .HasColumnType("datetime2")
                .HasDefaultValueSql("GETUTCDATE()");

            // Seed default settings
            entity.HasData(
                new Setting { KeyName = "THRESHOLD", Value = "5", Description = "Failed attempts before marking as suspicious" },
                new Setting { KeyName = "TIME_WINDOW", Value = "5", Description = "Time window in minutes for threshold" },
                new Setting { KeyName = "BLOCK_DURATION", Value = "60", Description = "Auto-block duration in minutes" },
                new Setting { KeyName = "ENABLE_AUTO_BLOCK", Value = "true", Description = "Enable automatic IP blocking" },
                new Setting { KeyName = "GLOBAL_THRESHOLD", Value = "5", Description = "Global threshold across all VMs" },
                new Setting { KeyName = "ENABLE_GLOBAL_AUTO_BLOCK", Value = "true", Description = "Enable global auto-blocking" }
            );
        });

        // =============================================
        // VMSources
        // =============================================
        modelBuilder.Entity<VmSource>(entity =>
        {
            entity.ToTable("VMSources");

            entity.Property(e => e.VmId)
                .HasColumnName("vm_id")
                .HasMaxLength(100)
                .IsRequired();

            entity.HasIndex(e => e.VmId)
                .IsUnique()
                .HasDatabaseName("idx_vmsources_vm_id");

            entity.Property(e => e.Hostname)
                .HasColumnName("hostname")
                .HasMaxLength(256);

            entity.Property(e => e.IpAddress)
                .HasColumnName("ip_address")
                .HasMaxLength(45);

            entity.Property(e => e.CollectionMethod)
                .HasColumnName("collection_method")
                .HasMaxLength(20);

            entity.Property(e => e.Status)
                .HasColumnName("status")
                .HasMaxLength(20)
                .HasDefaultValue("active");

            entity.Property(e => e.LastSeen)
                .HasColumnName("last_seen")
                .HasColumnType("datetime2");

            entity.Property(e => e.CreatedAt)
                .HasColumnName("created_at")
                .HasColumnType("datetime2")
                .HasDefaultValueSql("GETUTCDATE()");

            entity.HasIndex(e => e.Status)
                .HasDatabaseName("idx_vmsources_status");
        });

        // =============================================
        // PerVMThresholds
        // =============================================
        modelBuilder.Entity<PerVmThreshold>(entity =>
        {
            entity.ToTable("PerVMThresholds");

            entity.Property(e => e.VmId)
                .HasColumnName("vm_id")
                .HasMaxLength(100)
                .IsRequired();

            entity.HasIndex(e => e.VmId)
                .IsUnique();

            entity.Property(e => e.Threshold)
                .HasColumnName("threshold")
                .HasDefaultValue(5);

            entity.Property(e => e.TimeWindowMinutes)
                .HasColumnName("time_window_minutes")
                .HasDefaultValue(5);

            entity.Property(e => e.BlockDurationMinutes)
                .HasColumnName("block_duration_minutes")
                .HasDefaultValue(60);

            entity.Property(e => e.AutoBlockEnabled)
                .HasColumnName("auto_block_enabled")
                .HasDefaultValue(true);

            entity.Property(e => e.CreatedAt)
                .HasColumnName("created_at")
                .HasColumnType("datetime2")
                .HasDefaultValueSql("GETUTCDATE()");

            entity.Property(e => e.UpdatedAt)
                .HasColumnName("updated_at")
                .HasColumnType("datetime2")
                .HasDefaultValueSql("GETUTCDATE()");

            // FK to VMSources.vm_id
            entity.HasOne(e => e.VmSource)
                .WithOne(v => v.PerVmThreshold)
                .HasForeignKey<PerVmThreshold>(e => e.VmId)
                .HasPrincipalKey<VmSource>(v => v.VmId);
        });

        // =============================================
        // AttackStatistics
        // =============================================
        modelBuilder.Entity<AttackStatistic>(entity =>
        {
            entity.ToTable("AttackStatistics");

            entity.Property(e => e.StatDate)
                .HasColumnName("stat_date")
                .HasColumnType("date");

            entity.Property(e => e.VmId)
                .HasColumnName("vm_id")
                .HasMaxLength(100);

            entity.Property(e => e.TotalAttacks)
                .HasColumnName("total_attacks");

            entity.Property(e => e.UniqueAttackers)
                .HasColumnName("unique_attackers");

            entity.Property(e => e.BlockedCount)
                .HasColumnName("blocked_count");

            entity.Property(e => e.TopUsername)
                .HasColumnName("top_username")
                .HasMaxLength(256);

            entity.Property(e => e.TopIp)
                .HasColumnName("top_ip")
                .HasMaxLength(45);

            entity.Property(e => e.CreatedAt)
                .HasColumnName("created_at")
                .HasColumnType("datetime2")
                .HasDefaultValueSql("GETUTCDATE()");

            // Unique constraint on (stat_date, vm_id)
            entity.HasIndex(e => new { e.StatDate, e.VmId })
                .IsUnique()
                .HasDatabaseName("IX_AttackStatistics_StatDate_VmId");

            entity.HasIndex(e => e.StatDate)
                .HasDatabaseName("idx_stats_date");

            entity.HasIndex(e => new { e.VmId, e.StatDate })
                .HasDatabaseName("idx_stats_vm");
        });
    }
}
