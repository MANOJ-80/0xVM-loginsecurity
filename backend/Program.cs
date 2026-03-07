using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using SecurityMonitorApi.Data;
using SecurityMonitorApi.Services;

var builder = WebApplication.CreateBuilder(args);

// ---- Database (EF Core - Code First) ----
builder.Services.AddDbContext<SecurityMonitorContext>(options =>
    options.UseSqlServer(
        builder.Configuration.GetConnectionString("SecurityMonitor")));

// ---- Services ----
builder.Services.AddScoped<SecurityMonitorService>();
builder.Services.AddSingleton<EventBroadcastService>();

// ---- JWT Authentication ----
var jwtSettings = builder.Configuration.GetSection("Jwt");
var jwtKey = Encoding.UTF8.GetBytes(jwtSettings["Key"]!);

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
})
.AddJwtBearer(options =>
{
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        ValidIssuer = jwtSettings["Issuer"],
        ValidAudience = jwtSettings["Audience"],
        IssuerSigningKey = new SymmetricSecurityKey(jwtKey),
        ClockSkew = TimeSpan.FromMinutes(1),
    };
});

builder.Services.AddAuthorization();

// ---- Controllers + JSON options ----
builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        // Use snake_case to match the Python/FastAPI response format
        options.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower;
        options.JsonSerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
    });

// ---- CORS (allow all for development, matching FastAPI default) ----
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyMethod()
              .AllowAnyHeader();
    });
});

var app = builder.Build();

// ---- Middleware pipeline ----
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

// ---- Auto-migrate on startup (development convenience) ----
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<SecurityMonitorContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
    try
    {
        // If the database already has tables (created by the original Python/SQL scripts)
        // but no __EFMigrationsHistory, EF Core's Migrate() will try to CREATE TABLE
        // and fail with "object already exists". Detect this case and mark InitialCreate
        // as already applied so Migrate() skips it.
        var conn = db.Database.GetDbConnection();
        await conn.OpenAsync();
        using (var cmd = conn.CreateCommand())
        {
            // Check if one of our tables already exists
            cmd.CommandText = "SELECT OBJECT_ID(N'FailedLoginAttempts')";
            var result = await cmd.ExecuteScalarAsync();
            bool tablesExist = result != null && result != DBNull.Value;

            if (tablesExist)
            {
                // Ensure __EFMigrationsHistory table exists
                using var ensureCmd = conn.CreateCommand();
                ensureCmd.CommandText = @"
                    IF OBJECT_ID(N'[__EFMigrationsHistory]') IS NULL
                    BEGIN
                        CREATE TABLE [__EFMigrationsHistory] (
                            [MigrationId] nvarchar(150) NOT NULL,
                            [ProductVersion] nvarchar(32) NOT NULL,
                            CONSTRAINT [PK___EFMigrationsHistory] PRIMARY KEY ([MigrationId])
                        );
                    END;";
                await ensureCmd.ExecuteNonQueryAsync();

                // Mark InitialCreate as applied if not already recorded
                using var checkCmd = conn.CreateCommand();
                checkCmd.CommandText = @"
                    IF NOT EXISTS (
                        SELECT 1 FROM [__EFMigrationsHistory]
                        WHERE [MigrationId] = N'20260304133110_InitialCreate'
                    )
                    BEGIN
                        INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
                        VALUES (N'20260304133110_InitialCreate', N'10.0.3');
                    END;";
                await checkCmd.ExecuteNonQueryAsync();

                logger.LogInformation("Existing database detected — marked InitialCreate migration as applied.");
            }
        }
        await conn.CloseAsync();

        // Now Migrate() will skip InitialCreate (already recorded) and only apply future migrations
        db.Database.Migrate();
        logger.LogInformation("Database migration applied successfully.");
    }
    catch (Exception ex)
    {
        logger.LogWarning(ex, "Database migration failed. Ensure SQL Server is running and the connection string is correct.");
    }
}

app.Run();
