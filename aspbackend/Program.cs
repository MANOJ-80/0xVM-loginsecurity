using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
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

app.MapControllers();

// ---- Auto-migrate on startup (development convenience) ----
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<SecurityMonitorContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
    try
    {
        db.Database.Migrate();
        logger.LogInformation("Database migration applied successfully.");
    }
    catch (Exception ex)
    {
        logger.LogWarning(ex, "Database migration failed. Ensure SQL Server is running and the connection string is correct.");
    }
}

app.Run();
