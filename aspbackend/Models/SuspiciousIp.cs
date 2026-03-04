using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace SecurityMonitorApi.Models;

[Table("SuspiciousIPs")]
public class SuspiciousIp
{
    [Key]
    [DatabaseGenerated(DatabaseGeneratedOption.Identity)]
    public int Id { get; set; }

    [Required]
    [MaxLength(45)]
    public string IpAddress { get; set; } = string.Empty;

    public int FailedAttempts { get; set; } = 1;

    public DateTime? FirstAttempt { get; set; }

    public DateTime? LastAttempt { get; set; }

    /// <summary>
    /// JSON array (future use)
    /// </summary>
    public string? TargetUsernames { get; set; }

    /// <summary>
    /// active, blocked, cleared
    /// </summary>
    [MaxLength(20)]
    public string Status { get; set; } = "active";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
