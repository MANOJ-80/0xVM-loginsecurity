using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace SecurityMonitorApi.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AttackStatistics",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    stat_date = table.Column<DateTime>(type: "date", nullable: true),
                    vm_id = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    total_attacks = table.Column<int>(type: "int", nullable: true),
                    unique_attackers = table.Column<int>(type: "int", nullable: true),
                    blocked_count = table.Column<int>(type: "int", nullable: true),
                    top_username = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: true),
                    top_ip = table.Column<string>(type: "nvarchar(45)", maxLength: 45, nullable: true),
                    created_at = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETDATE()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AttackStatistics", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "BlockedIPs",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ip_address = table.Column<string>(type: "nvarchar(45)", maxLength: 45, nullable: false),
                    blocked_at = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETDATE()"),
                    block_expires = table.Column<DateTime>(type: "datetime2", nullable: true),
                    reason = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    blocked_by = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false, defaultValue: "auto"),
                    is_active = table.Column<bool>(type: "bit", nullable: false, defaultValue: true),
                    unblocked_at = table.Column<DateTime>(type: "datetime2", nullable: true),
                    unblocked_by = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    scope = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false, defaultValue: "global"),
                    target_vm_id = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BlockedIPs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "FailedLoginAttempts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ip_address = table.Column<string>(type: "nvarchar(45)", maxLength: 45, nullable: false),
                    username = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: true),
                    hostname = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: true),
                    logon_type = table.Column<int>(type: "int", nullable: true),
                    failure_reason = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    source_port = table.Column<int>(type: "int", nullable: true),
                    timestamp = table.Column<DateTime>(type: "datetime2", nullable: false),
                    event_id = table.Column<int>(type: "int", nullable: false, defaultValue: 4625),
                    source_vm_id = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FailedLoginAttempts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Settings",
                columns: table => new
                {
                    key_name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    value = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    description = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    updated_at = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETDATE()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Settings", x => x.key_name);
                });

            migrationBuilder.CreateTable(
                name: "SuspiciousIPs",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ip_address = table.Column<string>(type: "nvarchar(45)", maxLength: 45, nullable: false),
                    failed_attempts = table.Column<int>(type: "int", nullable: false, defaultValue: 1),
                    first_attempt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    last_attempt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    target_usernames = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    status = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false, defaultValue: "active"),
                    created_at = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETDATE()"),
                    updated_at = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETDATE()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SuspiciousIPs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Users",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    username = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    email = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    password_hash = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    role = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false, defaultValue: "analyst"),
                    created_at = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()"),
                    last_login = table.Column<DateTime>(type: "datetime2", nullable: true),
                    is_active = table.Column<bool>(type: "bit", nullable: false, defaultValue: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Users", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "VMSources",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    vm_id = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    hostname = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: true),
                    ip_address = table.Column<string>(type: "nvarchar(45)", maxLength: 45, nullable: true),
                    collection_method = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    status = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false, defaultValue: "active"),
                    last_seen = table.Column<DateTime>(type: "datetime2", nullable: true),
                    created_at = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETDATE()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VMSources", x => x.Id);
                    table.UniqueConstraint("AK_VMSources_vm_id", x => x.vm_id);
                });

            migrationBuilder.CreateTable(
                name: "PerVMThresholds",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    vm_id = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    threshold = table.Column<int>(type: "int", nullable: false, defaultValue: 5),
                    time_window_minutes = table.Column<int>(type: "int", nullable: false, defaultValue: 5),
                    block_duration_minutes = table.Column<int>(type: "int", nullable: false, defaultValue: 60),
                    auto_block_enabled = table.Column<bool>(type: "bit", nullable: false, defaultValue: true),
                    created_at = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETDATE()"),
                    updated_at = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETDATE()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PerVMThresholds", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PerVMThresholds_VMSources_vm_id",
                        column: x => x.vm_id,
                        principalTable: "VMSources",
                        principalColumn: "vm_id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.InsertData(
                table: "Settings",
                columns: new[] { "key_name", "description", "updated_at", "value" },
                values: new object[,]
                {
                    { "BLOCK_DURATION", "Auto-block duration in minutes", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), "60" },
                    { "ENABLE_AUTO_BLOCK", "Enable automatic IP blocking", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), "true" },
                    { "ENABLE_GLOBAL_AUTO_BLOCK", "Enable global auto-blocking", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), "true" },
                    { "GLOBAL_THRESHOLD", "Global threshold across all VMs", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), "5" },
                    { "THRESHOLD", "Failed attempts before marking as suspicious", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), "5" },
                    { "TIME_WINDOW", "Time window in minutes for threshold", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), "5" }
                });

            migrationBuilder.CreateIndex(
                name: "idx_stats_date",
                table: "AttackStatistics",
                column: "stat_date");

            migrationBuilder.CreateIndex(
                name: "idx_stats_vm",
                table: "AttackStatistics",
                columns: new[] { "vm_id", "stat_date" });

            migrationBuilder.CreateIndex(
                name: "IX_AttackStatistics_StatDate_VmId",
                table: "AttackStatistics",
                columns: new[] { "stat_date", "vm_id" },
                unique: true,
                filter: "[stat_date] IS NOT NULL AND [vm_id] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "idx_blocked_active",
                table: "BlockedIPs",
                column: "is_active");

            migrationBuilder.CreateIndex(
                name: "idx_blocked_expires",
                table: "BlockedIPs",
                column: "block_expires");

            migrationBuilder.CreateIndex(
                name: "idx_blocked_scope",
                table: "BlockedIPs",
                columns: new[] { "scope", "is_active" });

            migrationBuilder.CreateIndex(
                name: "idx_dedup_check",
                table: "FailedLoginAttempts",
                columns: new[] { "ip_address", "username", "source_port", "timestamp", "source_vm_id" });

            migrationBuilder.CreateIndex(
                name: "idx_ip_timestamp",
                table: "FailedLoginAttempts",
                columns: new[] { "ip_address", "timestamp" });

            migrationBuilder.CreateIndex(
                name: "idx_source_vm",
                table: "FailedLoginAttempts",
                columns: new[] { "source_vm_id", "timestamp" });

            migrationBuilder.CreateIndex(
                name: "idx_timestamp",
                table: "FailedLoginAttempts",
                column: "timestamp");

            migrationBuilder.CreateIndex(
                name: "IX_PerVMThresholds_vm_id",
                table: "PerVMThresholds",
                column: "vm_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_suspicious_ip",
                table: "SuspiciousIPs",
                column: "ip_address",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_suspicious_status",
                table: "SuspiciousIPs",
                column: "status");

            migrationBuilder.CreateIndex(
                name: "idx_users_email",
                table: "Users",
                column: "email",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_users_username",
                table: "Users",
                column: "username",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_vmsources_status",
                table: "VMSources",
                column: "status");

            migrationBuilder.CreateIndex(
                name: "idx_vmsources_vm_id",
                table: "VMSources",
                column: "vm_id",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AttackStatistics");

            migrationBuilder.DropTable(
                name: "BlockedIPs");

            migrationBuilder.DropTable(
                name: "FailedLoginAttempts");

            migrationBuilder.DropTable(
                name: "PerVMThresholds");

            migrationBuilder.DropTable(
                name: "Settings");

            migrationBuilder.DropTable(
                name: "SuspiciousIPs");

            migrationBuilder.DropTable(
                name: "Users");

            migrationBuilder.DropTable(
                name: "VMSources");
        }
    }
}
