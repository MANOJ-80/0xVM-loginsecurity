namespace SecurityMonitorApi.DTOs;

// ---- Request DTOs ----

public class EventDto
{
    public string Timestamp { get; set; } = string.Empty;
    public string IpAddress { get; set; } = string.Empty;
    public string? Username { get; set; }
    public string? Domain { get; set; }
    public string? LogonType { get; set; }
    public string? Status { get; set; }
    public string? Workstation { get; set; }
    public string? SourcePort { get; set; }
}

public class ReceiveEventsRequest
{
    public string VmId { get; set; } = string.Empty;
    public string Hostname { get; set; } = string.Empty;
    public List<EventDto> Events { get; set; } = new();
}

public class RegisterVmRequest
{
    public string VmId { get; set; } = string.Empty;
    public string Hostname { get; set; } = string.Empty;
    public string IpAddress { get; set; } = string.Empty;
    public string CollectionMethod { get; set; } = "agent";
}

public class ManualBlockRequest
{
    public string IpAddress { get; set; } = string.Empty;
    public string Reason { get; set; } = string.Empty;
    public int DurationMinutes { get; set; } = 120;
}

public class PerVmBlockRequest
{
    public string IpAddress { get; set; } = string.Empty;
    public string VmId { get; set; } = string.Empty;
    public string Reason { get; set; } = string.Empty;
    public int DurationMinutes { get; set; } = 120;
}

// ---- Response DTOs ----

public class ApiResponse<T>
{
    public bool Success { get; set; }
    public T? Data { get; set; }
    public int? Count { get; set; }
    public string? Message { get; set; }
    public string? Status { get; set; }
}

public class HealthResponse
{
    public bool Success { get; set; }
    public string Status { get; set; } = "healthy";
    public int UptimeSeconds { get; set; }
    public int ActiveVms { get; set; }
    public bool DbConnected { get; set; }
}

public class EventsReceivedResponse
{
    public bool Success { get; set; }
    public int EventsReceived { get; set; }
}

public class MessageResponse
{
    public bool Success { get; set; }
    public string Message { get; set; } = string.Empty;
}

public class StatisticsData
{
    public int TotalFailedAttempts { get; set; }
    public int UniqueAttackers { get; set; }
    public int BlockedIps { get; set; }
    public int AttacksLast24h { get; set; }
    public int AttacksLastHour { get; set; }
    public List<UsernameCount> TopAttackedUsernames { get; set; } = new();
    public List<HourCount> AttacksByHour { get; set; } = new();
}

public class GlobalStatisticsData : StatisticsData
{
    public int ActiveVms { get; set; }
    public int InactiveVms { get; set; }
    public List<VmCount> AttacksByVm { get; set; } = new();
}

public class UsernameCount
{
    public string Username { get; set; } = string.Empty;
    public int Count { get; set; }
}

public class HourCount
{
    public string Hour { get; set; } = string.Empty;
    public int Count { get; set; }
}

public class VmCount
{
    public string VmId { get; set; } = string.Empty;
    public int Count { get; set; }
}

public class VmAttacksResponse
{
    public bool Success { get; set; }
    public string VmId { get; set; } = string.Empty;
    public int TotalAttacks { get; set; }
    public int UniqueAttackers { get; set; }
    public int? BlockedCount { get; set; }
    public DateTime? LastAttack { get; set; }
}

public class SseEventData
{
    public string IpAddress { get; set; } = string.Empty;
    public string? Username { get; set; }
    public string? Timestamp { get; set; }
    public string? VmId { get; set; }
}

// ---- DTOs for list endpoints (replaces anonymous types) ----

public class BlockedIpDto
{
    public string IpAddress { get; set; } = string.Empty;
    public DateTime BlockedAt { get; set; }
    public DateTime? BlockExpires { get; set; }
    public string? Reason { get; set; }
    public string? BlockedBy { get; set; }
}

public class SuspiciousIpDto
{
    public string IpAddress { get; set; } = string.Empty;
    public int FailedAttempts { get; set; }
    public DateTime? FirstAttempt { get; set; }
    public DateTime? LastAttempt { get; set; }
    public string Status { get; set; } = string.Empty;
}

public class VmListDto
{
    public string VmId { get; set; } = string.Empty;
    public string? Hostname { get; set; }
    public string? IpAddress { get; set; }
    public string? CollectionMethod { get; set; }
    public string? Status { get; set; }
    public DateTime? LastSeen { get; set; }
}

public class ListResponse<T>
{
    public bool Success { get; set; }
    public List<T> Data { get; set; } = new();
    public int Count { get; set; }
}
