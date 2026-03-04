import { useEffect, useState, useCallback } from "react";
import { Ban, Plus, Unlock, RefreshCw } from "lucide-react";
import { getBlockedIps, blockIp, unblockIp } from "../services/api";
import { useToast } from "../context/ToastContext";

export default function BlockedIps() {
  const [ips, setIps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ ip: "", reason: "", duration: 120 });
  const [submitting, setSubmitting] = useState(false);
  const { addToast } = useToast();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getBlockedIps();
      setIps(res.data || []);
    } catch (err) {
      console.error("Failed to fetch blocked IPs:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleBlock = async (e) => {
    e.preventDefault();
    if (!form.ip) return;
    setSubmitting(true);
    try {
      await blockIp(
        form.ip,
        form.reason || "Manual block from dashboard",
        form.duration,
      );
      addToast(`Blocked ${form.ip} successfully`, "success");
      setShowModal(false);
      setForm({ ip: "", reason: "", duration: 120 });
      fetchData();
    } catch (err) {
      addToast(`Failed to block IP: ${err.message}`, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnblock = async (ip) => {
    if (!confirm(`Unblock ${ip}?`)) return;
    try {
      await unblockIp(ip);
      addToast(`Unblocked ${ip}`, "success");
      fetchData();
    } catch (err) {
      addToast(`Failed to unblock: ${err.message}`, "error");
    }
  };

  const formatDate = (d) => (d ? new Date(d).toLocaleString() : "—");

  return (
    <>
      <div className="page-header">
        <h2>Blocked IPs</h2>
        <p>Manage blocked IP addresses across your network</p>
      </div>
      <div className="page-body">
        <div className="toolbar">
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setShowModal(true)}
          >
            <Plus size={14} /> Block IP
          </button>
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
                  <th>Blocked At</th>
                  <th>Expires</th>
                  <th>Reason</th>
                  <th>Blocked By</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {ips.map((ip) => (
                  <tr key={`${ip.ip_address}-${ip.blocked_at}`}>
                    <td
                      style={{
                        fontFamily: "monospace",
                        fontWeight: 600,
                        color: "var(--text-primary)",
                      }}
                    >
                      {ip.ip_address}
                    </td>
                    <td>{formatDate(ip.blocked_at)}</td>
                    <td>
                      {ip.block_expires ? (
                        <span
                          style={{
                            color:
                              new Date(ip.block_expires) < new Date()
                                ? "var(--danger)"
                                : "var(--text-secondary)",
                          }}
                        >
                          {formatDate(ip.block_expires)}
                        </span>
                      ) : (
                        <span
                          className="badge"
                          style={{
                            background: "var(--danger-glow)",
                            color: "var(--danger)",
                          }}
                        >
                          Permanent
                        </span>
                      )}
                    </td>
                    <td
                      style={{
                        maxWidth: 200,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {ip.reason || "—"}
                    </td>
                    <td>
                      <span
                        className={`badge ${ip.blocked_by === "auto" ? "auto" : "manual"}`}
                      >
                        {ip.blocked_by || "auto"}
                      </span>
                    </td>
                    <td>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleUnblock(ip.ip_address)}
                        title="Unblock"
                      >
                        <Unlock size={14} /> Unblock
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card">
            <div className="empty-state">
              <Ban />
              <p>No IPs are currently blocked</p>
            </div>
          </div>
        )}
      </div>

      {/* Block IP Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">
              <Ban size={20} color="var(--danger)" /> Block IP Address
            </div>
            <form onSubmit={handleBlock}>
              <div className="input-group" style={{ marginBottom: 16 }}>
                <label htmlFor="block-ip">IP Address</label>
                <input
                  id="block-ip"
                  className="input"
                  placeholder="e.g. 192.168.1.100"
                  value={form.ip}
                  onChange={(e) => setForm({ ...form, ip: e.target.value })}
                  required
                />
              </div>
              <div className="input-group" style={{ marginBottom: 16 }}>
                <label htmlFor="block-reason">Reason</label>
                <input
                  id="block-reason"
                  className="input"
                  placeholder="Suspicious activity"
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                />
              </div>
              <div className="input-group" style={{ marginBottom: 16 }}>
                <label htmlFor="block-duration">Duration (minutes)</label>
                <input
                  id="block-duration"
                  className="input"
                  type="number"
                  min={1}
                  value={form.duration}
                  onChange={(e) =>
                    setForm({ ...form, duration: Number(e.target.value) })
                  }
                />
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-danger"
                  disabled={submitting}
                >
                  {submitting ? "Blocking…" : "Block IP"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
