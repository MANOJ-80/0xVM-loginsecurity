using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace SecurityMonitorApi.Models;

[Table("Settings")]
public class Setting
{
    [Key]
    [MaxLength(100)]
    public string KeyName { get; set; } = string.Empty;

    [MaxLength(500)]
    public string? Value { get; set; }

    [MaxLength(500)]
    public string? Description { get; set; }

    public DateTime UpdatedAt { get; set; } = DateTime.Now;
}
