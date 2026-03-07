using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace SecurityMonitorApi.Models;

[Table("FailedLoginAttempts")]
public class FailedLoginAttempt
{
    [Key]
    [DatabaseGenerated(DatabaseGeneratedOption.Identity)]
    public int Id { get; set; }

    [Required]
    [MaxLength(45)]
    public string IpAddress { get; set; } = string.Empty;

    [MaxLength(256)]
    public string? Username { get; set; }

    [MaxLength(256)]
    public string? Hostname { get; set; }

    /// <summary>
    /// 2=Interactive, 3=Network/SMB, 10=RDP
    /// </summary>
    public int? LogonType { get; set; }

    /// <summary>
    /// NTSTATUS hex string e.g. '0xC000006A'
    /// </summary>
    [MaxLength(20)]
    [Column("failure_reason")]
    public string? FailureReason { get; set; }

    public int? SourcePort { get; set; }

    [Required]
    public DateTime Timestamp { get; set; }

    public int EventId { get; set; } = 4625;

    [MaxLength(100)]
    public string? SourceVmId { get; set; }
}
