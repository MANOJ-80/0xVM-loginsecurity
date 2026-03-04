import { useEffect, useState, useCallback } from "react";
import { ShieldAlert, Search, RefreshCw } from "lucide-react";
import { getSuspiciousIps } from "../services/api";

export default function SuspiciousIps() {
  const [ips, setIps] = useState([]);
  const [threshold, setThreshold] = useState(5);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getSuspiciousIps(threshold);
      setIps(res.data || []);
    } catch (err) {
      console.error("Failed to fetch suspicious IPs:", err);
    } finally {
      setLoading(false);
    }
  }, [threshold]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const formatDate = (d) => (d ? new Date(d).toLocaleString() : "—");

  return (
    <>
      <div className="page-header">
        <h2>Suspicious IPs</h2>
        <p>IP addresses with failed login attempts exceeding the threshold</p>
      </div>
      <div className="page-body">
        <div className="toolbar">
          <div
            className="input-group"
            style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
          >
            <label style={{ whiteSpace: "nowrap" }}>Min Attempts</label>
            <input
              id="threshold-input"
              type="number"
              className="input"
              style={{ width: 80 }}
              value={threshold}
              min={1}
              onChange={(e) =>
                setThreshold(Math.max(1, Number(e.target.value)))
              }
            />
          </div>
          <div className="toolbar-spacer" />
          <button
            className="btn btn-ghost btn-sm"
            onClick={fetchData}
            disabled={loading}
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>

        {loading ? (
          <div className="loading-center">
            <div className="spinner" />
          </div>
        ) : ips.length > 0 ? (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>IP Address</th>
                  <th>Failed Attempts</th>
                  <th>First Attempt</th>
                  <th>Last Attempt</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {ips.map((ip) => (
                  <tr key={ip.ip_address}>
                    <td
                      style={{
                        fontFamily: "monospace",
                        fontWeight: 600,
                        color: "var(--text-primary)",
                      }}
                    >
                      {ip.ip_address}
                    </td>
                    <td>
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: "1.1rem",
                          color:
                            ip.failed_attempts > 20
                              ? "var(--danger)"
                              : ip.failed_attempts > 10
                                ? "var(--warning)"
                                : "var(--text-primary)",
                        }}
                      >
                        {ip.failed_attempts}
                      </span>
                    </td>
                    <td>{formatDate(ip.first_attempt)}</td>
                    <td>{formatDate(ip.last_attempt)}</td>
                    <td>
                      <span className={`badge ${ip.status}`}>{ip.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card">
            <div className="empty-state">
              <ShieldAlert />
              <p>No suspicious IPs found with ≥ {threshold} attempts</p>
            </div>
          </div>
        )}

        <div
          style={{
            marginTop: 16,
            fontSize: "0.8rem",
            color: "var(--text-muted)",
          }}
        >
          Showing {ips.length} result{ips.length !== 1 ? "s" : ""} with ≥{" "}
          {threshold} failed attempts
        </div>
      </div>
    </>
  );
}
