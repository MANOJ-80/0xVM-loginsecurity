using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace SecurityMonitorApi.Models;

[Table("VMSources")]
public class VmSource
{
    [Key]
    [DatabaseGenerated(DatabaseGeneratedOption.Identity)]
    public int Id { get; set; }

    [Required]
    [MaxLength(100)]
    public string VmId { get; set; } = string.Empty;

    [MaxLength(256)]
    public string? Hostname { get; set; }

    [MaxLength(45)]
    public string? IpAddress { get; set; }

    /// <summary>
    /// agent, wef
    /// </summary>
    [MaxLength(20)]
    public string? CollectionMethod { get; set; }

    /// <summary>
    /// active, inactive, error
    /// </summary>
    [MaxLength(20)]
    public string Status { get; set; } = "active";

    public DateTime? LastSeen { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.Now;

    // Navigation property
    public PerVmThreshold? PerVmThreshold { get; set; }
}
