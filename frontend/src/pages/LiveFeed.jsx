import { useEffect, useState, useRef } from "react";
import { Activity, Pause, Play, Trash2 } from "lucide-react";
import { subscribeToFeed } from "../services/api";

export default function LiveFeed() {
  const [events, setEvents] = useState([]);
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef(null);
  const pausedRef = useRef(false);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const source = subscribeToFeed(
      (event) => {
        setConnected(true);
        if (!pausedRef.current) {
          setEvents((prev) =>
            [{ ...event, _id: Date.now() + Math.random() }, ...prev].slice(
              0,
              200,
            ),
          );
        }
      },
      () => setConnected(false),
    );
    sourceRef.current = source;
    setConnected(true);
    return () => source.close();
  }, []);

  const formatTime = (t) => {
    if (!t) return "—";
    try {
      return new Date(t).toLocaleString();
    } catch {
      return t;
    }
  };

  return (
    <>
      <div className="page-header">
        <h2>Live Attack Feed</h2>
        <p>Real-time stream of failed login events via Server-Sent Events</p>
      </div>
      <div className="page-body">
        <div className="toolbar">
          <div className="health-indicator" style={{ fontSize: "0.8rem" }}>
            <span className={`health-dot ${connected ? "" : "offline"}`} />
            <span>{connected ? "Connected to SSE feed" : "Disconnected"}</span>
          </div>
          <div className="toolbar-spacer" />
          <button
            className={`btn btn-sm ${paused ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setPaused(!paused)}
          >
            {paused ? (
              <>
                <Play size={14} /> Resume
              </>
            ) : (
              <>
                <Pause size={14} /> Pause
              </>
            )}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setEvents([])}
            disabled={events.length === 0}
          >
            <Trash2 size={14} /> Clear
          </button>
        </div>

        <div className="card" style={{ padding: 0 }}>
          {events.length > 0 ? (
            <div
              className="feed-container"
              style={{ maxHeight: "calc(100vh - 250px)" }}
            >
              {events.map((evt) => (
                <div key={evt._id} className="feed-item">
                  <div className="feed-dot" />
                  <div className="feed-info">
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <span className="feed-ip">{evt.ip_address}</span>
                      {evt.vm_id && (
                        <span
                          className="badge info"
                          style={{
                            background: "var(--info-glow)",
                            color: "var(--info)",
                          }}
                        >
                          {evt.vm_id}
                        </span>
                      )}
                    </div>
                    <div className="feed-meta">
                      <span>👤 {evt.username || "unknown"}</span>
                      <span>🕐 {formatTime(evt.timestamp)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <Activity />
              <p>
                {paused
                  ? "Feed paused — press Resume"
                  : "Waiting for new events…"}
              </p>
              <p
                style={{
                  fontSize: "0.75rem",
                  marginTop: 8,
                  color: "var(--text-muted)",
                }}
              >
                Events appear here as agents send them to the backend
              </p>
            </div>
          )}
        </div>

        <div
          style={{
            marginTop: 12,
            fontSize: "0.75rem",
            color: "var(--text-muted)",
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <span>
            {events.length} event{events.length !== 1 ? "s" : ""} captured
          </span>
          {paused && <span style={{ color: "var(--warning)" }}>⏸ Paused</span>}
        </div>
      </div>
    </>
  );
}
