using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace SecurityMonitorApi.Models;

[Table("BlockedIPs")]
public class BlockedIp
{
    [Key]
    [DatabaseGenerated(DatabaseGeneratedOption.Identity)]
    public int Id { get; set; }

    [Required]
    [MaxLength(45)]
    public string IpAddress { get; set; } = string.Empty;

    public DateTime BlockedAt { get; set; } = DateTime.UtcNow;

    public DateTime? BlockExpires { get; set; }

    [MaxLength(500)]
    public string? Reason { get; set; }

    /// <summary>
    /// auto, manual
    /// </summary>
    [MaxLength(50)]
    public string BlockedBy { get; set; } = "auto";

    public bool IsActive { get; set; } = true;

    public DateTime? UnblockedAt { get; set; }

    [MaxLength(50)]
    public string? UnblockedBy { get; set; }

    /// <summary>
    /// global, per-vm
    /// </summary>
    [MaxLength(20)]
    public string Scope { get; set; } = "global";

    [MaxLength(100)]
    public string? TargetVmId { get; set; }
}
