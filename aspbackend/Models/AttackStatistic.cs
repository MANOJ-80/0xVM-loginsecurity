using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace SecurityMonitorApi.Models;

[Table("AttackStatistics")]
public class AttackStatistic
{
    [Key]
    [DatabaseGenerated(DatabaseGeneratedOption.Identity)]
    public int Id { get; set; }

    [Column(TypeName = "date")]
    public DateTime? StatDate { get; set; }

    /// <summary>
    /// NULL = global aggregate
    /// </summary>
    [MaxLength(100)]
    public string? VmId { get; set; }

    public int? TotalAttacks { get; set; }

    public int? UniqueAttackers { get; set; }

    public int? BlockedCount { get; set; }

    [MaxLength(256)]
    public string? TopUsername { get; set; }

    [MaxLength(45)]
    public string? TopIp { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
