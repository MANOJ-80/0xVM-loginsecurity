using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using SecurityMonitorApi.Data;
using SecurityMonitorApi.DTOs;
using SecurityMonitorApi.Models;

namespace SecurityMonitorApi.Controllers;

[ApiController]
public class AuthController : ControllerBase
{
    private readonly SecurityMonitorContext _db;
    private readonly IConfiguration _config;

    public AuthController(SecurityMonitorContext db, IConfiguration config)
    {
        _db = db;
        _config = config;
    }

    // =========================================================================
    // POST /api/v1/auth/register
    // =========================================================================
    [HttpPost("api/v1/auth/register")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest req)
    {
        // Validate input
        if (string.IsNullOrWhiteSpace(req.Email) || string.IsNullOrWhiteSpace(req.Password))
            return BadRequest(new AuthResponse { Success = false, Message = "Email and password are required" });

        if (string.IsNullOrWhiteSpace(req.Username))
            return BadRequest(new AuthResponse { Success = false, Message = "Username is required" });

        if (req.Password.Length < 6)
            return BadRequest(new AuthResponse { Success = false, Message = "Password must be at least 6 characters" });

        // Check for existing email/username
        var emailExists = await _db.Users.AnyAsync(u => u.Email == req.Email.ToLower());
        if (emailExists)
            return Conflict(new AuthResponse { Success = false, Message = "Email already registered" });

        var usernameExists = await _db.Users.AnyAsync(u => u.Username == req.Username);
        if (usernameExists)
            return Conflict(new AuthResponse { Success = false, Message = "Username already taken" });

        // Create user
        var user = new User
        {
            Username = req.Username,
            Email = req.Email.ToLower(),
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.Password),
            Role = "analyst",
            CreatedAt = DateTime.UtcNow,
            IsActive = true,
        };

        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        // Generate token
        var token = GenerateJwtToken(user);

        return Ok(new AuthResponse
        {
            Success = true,
            Token = token,
            User = MapUserDto(user),
            Message = "Registration successful"
        });
    }

    // =========================================================================
    // POST /api/v1/auth/login
    // =========================================================================
    [HttpPost("api/v1/auth/login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Email) || string.IsNullOrWhiteSpace(req.Password))
            return BadRequest(new AuthResponse { Success = false, Message = "Email and password are required" });

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == req.Email.ToLower());

        if (user == null || !BCrypt.Net.BCrypt.Verify(req.Password, user.PasswordHash))
            return Unauthorized(new AuthResponse { Success = false, Message = "Invalid email or password" });

        if (!user.IsActive)
            return Unauthorized(new AuthResponse { Success = false, Message = "Account is deactivated" });

        // Update last login
        user.LastLogin = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        var token = GenerateJwtToken(user);

        return Ok(new AuthResponse
        {
            Success = true,
            Token = token,
            User = MapUserDto(user),
            Message = "Login successful"
        });
    }

    // =========================================================================
    // GET /api/v1/auth/me — returns current user from JWT
    // =========================================================================
    [Authorize]
    [HttpGet("api/v1/auth/me")]
    public async Task<IActionResult> GetCurrentUser()
    {
        var userIdClaim = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userIdClaim == null || !int.TryParse(userIdClaim, out var userId))
            return Unauthorized(new AuthResponse { Success = false, Message = "Invalid token" });

        var user = await _db.Users.FindAsync(userId);
        if (user == null || !user.IsActive)
            return Unauthorized(new AuthResponse { Success = false, Message = "User not found" });

        return Ok(new AuthResponse
        {
            Success = true,
            User = MapUserDto(user),
        });
    }

    // ---- Helpers ----

    private string GenerateJwtToken(User user)
    {
        var jwtSettings = _config.GetSection("Jwt");
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSettings["Key"]!));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Email, user.Email),
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(ClaimTypes.Role, user.Role),
        };

        var token = new JwtSecurityToken(
            issuer: jwtSettings["Issuer"],
            audience: jwtSettings["Audience"],
            claims: claims,
            expires: DateTime.UtcNow.AddHours(double.Parse(jwtSettings["ExpiryHours"] ?? "24")),
            signingCredentials: creds
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private static UserDto MapUserDto(User user) => new()
    {
        Id = user.Id,
        Username = user.Username,
        Email = user.Email,
        Role = user.Role,
    };
}
