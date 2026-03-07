import { useEffect, useState, useRef, useCallback } from "react";
import { MdPlayArrow, MdPause, MdDelete, MdCircle, MdRssFeed } from "react-icons/md";
import Sidebar from "../components/Sidebar";
import { subscribeToFeed } from "../services/api";

const MAX_EVENTS = 500; // keep last N events in memory

function LiveFeed() {
  const [events, setEvents] = useState([]);
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("");
  const sourceRef = useRef(null);
  const bufferRef = useRef(null); // null = not paused, [] = paused
  const checkOpenRef = useRef(null); // track interval for cleanup

  // ---- SSE connection ----
  const connect = useCallback(() => {
    // Clean up any existing connection
    if (sourceRef.current) {
      sourceRef.current.close();
    }

    setError(null);
    setConnected(false);

    const source = subscribeToFeed(
      (event) => {
        const enriched = {
          ...event,
          _id: Date.now() + Math.random(),
          _received: new Date().toISOString(),
        };

        if (bufferRef.current !== null) {
          // If paused, buffer
          bufferRef.current.push(enriched);
        } else {
          setEvents((prev) => [enriched, ...prev].slice(0, MAX_EVENTS));
        }
      },
      () => {
        setConnected(false);
        setError("Connection lost. Reconnecting...");
      }
    );

    // EventSource fires 'open' inherently — check readyState
    const checkOpen = setInterval(() => {
      if (source.readyState === EventSource.OPEN) {
        setConnected(true);
        setError(null);
        clearInterval(checkOpen);
        checkOpenRef.current = null;
      } else if (source.readyState === EventSource.CLOSED) {
        clearInterval(checkOpen);
        checkOpenRef.current = null;
      }
    }, 500);

    checkOpenRef.current = checkOpen;
    sourceRef.current = source;
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (checkOpenRef.current) {
        clearInterval(checkOpenRef.current);
        checkOpenRef.current = null;
      }
      if (sourceRef.current) {
        sourceRef.current.close();
      }
    };
  }, [connect]);

  // ---- Pause / Resume ----
  useEffect(() => {
    if (paused) {
      bufferRef.current = [];
    } else {
      // Flush buffer
      if (bufferRef.current && bufferRef.current.length > 0) {
        setEvents((prev) =>
          [...bufferRef.current.reverse(), ...prev].slice(0, MAX_EVENTS)
        );
      }
      bufferRef.current = null;
    }
  }, [paused]);

  // ---- Filter events ----
  const filteredEvents = filter.trim()
    ? events.filter((e) => {
        const q = filter.toLowerCase();
        return (
          (e.ip_address || "").toLowerCase().includes(q) ||
          (e.username || "").toLowerCase().includes(q) ||
          (e.vm_id || "").toLowerCase().includes(q)
        );
      })
    : events;

  // ---- Time formatting ----
  const formatTime = (ts) => {
    if (!ts) return "";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleTimeString();
  };

  return (
    <div className="flex h-screen bg-[#f3f4f6] text-gray-900">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto">
        {/* HEADER */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <MdRssFeed className="text-red-600" /> Live Attack Feed
            </h1>
            <p className="text-gray-500 text-sm">
              Real-time failed login attempts via SSE
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Connection status */}
            <span className={`inline-flex items-center gap-1 text-sm ${connected ? "text-green-600" : "text-gray-400"}`}>
              <MdCircle className="text-[8px]" />
              {connected ? "Connected" : "Disconnected"}
            </span>

            {/* Pause / Resume */}
            <button
              onClick={() => setPaused((p) => !p)}
              className={`px-4 py-2 rounded-lg font-semibold flex items-center gap-2 ${
                paused
                  ? "bg-green-600 hover:bg-green-700 text-white"
                  : "bg-yellow-500 hover:bg-yellow-600 text-white"
              }`}
            >
              {paused ? <MdPlayArrow /> : <MdPause />}
              {paused ? "Resume" : "Pause"}
            </button>

            {/* Clear */}
            <button
              onClick={() => setEvents([])}
              className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded-lg font-semibold flex items-center gap-2"
            >
              <MdDelete /> Clear
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 p-3 rounded-xl mb-4 text-sm">
            {error}
          </div>
        )}

        {/* FILTER + STATS BAR */}
        <div className="flex items-center gap-6 mb-6">
          <input
            type="text"
            placeholder="Filter by IP, username, or VM ID..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="flex-1 max-w-md border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
          />
          <span className="text-sm text-gray-500">
            {filteredEvents.length} event{filteredEvents.length !== 1 ? "s" : ""}
            {filter && ` (filtered from ${events.length})`}
            {paused && bufferRef.current && bufferRef.current.length > 0 && (
              <span className="text-yellow-600 ml-2">
                +{bufferRef.current.length} buffered
              </span>
            )}
          </span>
        </div>

        {/* EVENT LIST */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {filteredEvents.length === 0 ? (
            <div className="p-12 text-center text-gray-400">
              {events.length === 0
                ? "Waiting for attack events..."
                : "No events match your filter."}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-gray-500 bg-gray-50">
                <tr>
                  <th className="p-4 text-left">Time</th>
                  <th className="p-4 text-left">Attacker IP</th>
                  <th className="p-4 text-left">Target Username</th>
                  <th className="p-4 text-left">VM ID</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((evt) => (
                  <tr
                    key={evt._id}
                    className="border-t border-gray-100 hover:bg-red-50 transition-colors"
                  >
                    <td className="p-4 text-xs text-gray-500 font-mono">
                      {formatTime(evt._received)}
                    </td>
                    <td className="p-4 font-mono font-semibold text-red-600">
                      {evt.ip_address || "—"}
                    </td>
                    <td className="p-4 font-mono">
                      {evt.username || "—"}
                    </td>
                    <td className="p-4 font-mono text-xs text-gray-500">
                      {evt.vm_id || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}

export default LiveFeed;
