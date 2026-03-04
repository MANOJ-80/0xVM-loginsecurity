using System.Threading.Channels;
using SecurityMonitorApi.DTOs;

namespace SecurityMonitorApi.Services;

/// <summary>
/// In-memory event bus for SSE real-time feed.
/// Uses a subscriber-list pattern so every connected SSE client receives every event.
/// Each subscriber gets its own unbounded channel; PublishAsync fans out to all of them.
/// </summary>
public class EventBroadcastService
{
    private readonly object _lock = new();
    private readonly List<Channel<SseEventData>> _subscribers = new();

    /// <summary>
    /// Publish an event to ALL connected SSE clients.
    /// </summary>
    public async Task PublishAsync(SseEventData data)
    {
        List<Channel<SseEventData>> snapshot;
        lock (_lock)
        {
            snapshot = new List<Channel<SseEventData>>(_subscribers);
        }

        foreach (var ch in snapshot)
        {
            // TryWrite on unbounded channel will always succeed unless the channel is closed
            ch.Writer.TryWrite(data);
        }

        await Task.CompletedTask;
    }

    /// <summary>
    /// Create a new per-client subscription channel.
    /// Returns the channel so the caller can read from it.
    /// The caller MUST call Unsubscribe when the SSE client disconnects.
    /// </summary>
    public Channel<SseEventData> Subscribe()
    {
        var ch = Channel.CreateUnbounded<SseEventData>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false
        });

        lock (_lock)
        {
            _subscribers.Add(ch);
        }

        return ch;
    }

    /// <summary>
    /// Remove a subscriber channel (called when SSE client disconnects).
    /// Also completes the channel writer so the reader loop exits cleanly.
    /// </summary>
    public void Unsubscribe(Channel<SseEventData> ch)
    {
        lock (_lock)
        {
            _subscribers.Remove(ch);
        }

        ch.Writer.TryComplete();
    }
}
