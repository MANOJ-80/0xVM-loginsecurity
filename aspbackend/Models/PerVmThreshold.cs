using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace SecurityMonitorApi.Models;

[Table("PerVMThresholds")]
public class PerVmThreshold
{
    [Key]
    [DatabaseGenerated(DatabaseGeneratedOption.Identity)]
    public int Id { get; set; }

    [Required]
    [MaxLength(100)]
    public string VmId { get; set; } = string.Empty;

    public int Threshold { get; set; } = 5;

    public int TimeWindowMinutes { get; set; } = 5;

    public int BlockDurationMinutes { get; set; } = 60;

    public bool AutoBlockEnabled { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation property
    [ForeignKey("VmId")]
    public VmSource? VmSource { get; set; }
}
