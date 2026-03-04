import { useEffect, useState, useCallback } from "react";
import { Server, Plus, Trash2, Activity, RefreshCw } from "lucide-react";
import { listVms, registerVm, deleteVm, getVmAttacks } from "../services/api";
import { useToast } from "../context/ToastContext";

export default function VirtualMachines() {
  const [vms, setVms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showStats, setShowStats] = useState(null); // vmId string or null
  const [vmStats, setVmStats] = useState(null);
  const [form, setForm] = useState({
    vmId: "",
    hostname: "",
    ip: "",
    method: "agent",
  });
  const [submitting, setSubmitting] = useState(false);
  const { addToast } = useToast();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listVms();
      setVms(res.data || []);
    } catch (err) {
      console.error("Failed to fetch VMs:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!form.vmId || !form.hostname || !form.ip) return;
    setSubmitting(true);
    try {
      await registerVm(form.vmId, form.hostname, form.ip, form.method);
      addToast(`VM ${form.vmId} registered`, "success");
      setShowModal(false);
      setForm({ vmId: "", hostname: "", ip: "", method: "agent" });
      fetchData();
    } catch (err) {
      addToast(`Failed: ${err.message}`, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (vmId) => {
    if (!confirm(`Unregister VM ${vmId}?`)) return;
    try {
      await deleteVm(vmId);
      addToast(`VM ${vmId} unregistered`, "success");
      fetchData();
    } catch (err) {
      addToast(`Failed: ${err.message}`, "error");
    }
  };

  const handleViewStats = async (vmId) => {
    setShowStats(vmId);
    setVmStats(null);
    try {
      const res = await getVmAttacks(vmId);
      setVmStats(res);
    } catch (err) {
      addToast(`Failed to load stats: ${err.message}`, "error");
      setShowStats(null);
    }
  };

  const formatDate = (d) => (d ? new Date(d).toLocaleString() : "—");

  return (
    <>
      <div className="page-header">
        <h2>Virtual Machines</h2>
        <p>Manage monitored VMs and view per-VM attack statistics</p>
      </div>
      <div className="page-body">
        <div className="toolbar">
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setShowModal(true)}
          >
            <Plus size={14} /> Register VM
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
        ) : vms.length > 0 ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: 20,
            }}
          >
            {vms.map((vm) => (
              <div
                key={vm.vm_id}
                className="card"
                style={{ position: "relative" }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    marginBottom: 16,
                  }}
                >
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: "var(--radius-md)",
                      background:
                        vm.status === "active"
                          ? "var(--success-glow)"
                          : "rgba(100,116,139,0.15)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color:
                        vm.status === "active"
                          ? "var(--success)"
                          : "var(--text-muted)",
                    }}
                  >
                    <Server size={22} />
                  </div>
                  <div>
                    <div
                      style={{
                        fontWeight: 700,
                        color: "var(--text-primary)",
                        fontSize: "1rem",
                      }}
                    >
                      {vm.vm_id}
                    </div>
                    <div
                      style={{
                        fontSize: "0.75rem",
                        color: "var(--text-muted)",
                      }}
                    >
                      {vm.hostname || "—"}
                    </div>
                  </div>
                  <span
                    className={`badge ${vm.status}`}
                    style={{ marginLeft: "auto" }}
                  >
                    {vm.status}
                  </span>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 10,
                    fontSize: "0.8rem",
                    color: "var(--text-secondary)",
                  }}
                >
                  <div>
                    <div
                      style={{
                        color: "var(--text-muted)",
                        fontSize: "0.65rem",
                        textTransform: "uppercase",
                        letterSpacing: "1px",
                        marginBottom: 2,
                      }}
                    >
                      IP Address
                    </div>
                    <span style={{ fontFamily: "monospace" }}>
                      {vm.ip_address || "—"}
                    </span>
                  </div>
                  <div>
                    <div
                      style={{
                        color: "var(--text-muted)",
                        fontSize: "0.65rem",
                        textTransform: "uppercase",
                        letterSpacing: "1px",
                        marginBottom: 2,
                      }}
                    >
                      Method
                    </div>
                    {vm.collection_method || "agent"}
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div
                      style={{
                        color: "var(--text-muted)",
                        fontSize: "0.65rem",
                        textTransform: "uppercase",
                        letterSpacing: "1px",
                        marginBottom: 2,
                      }}
                    >
                      Last Seen
                    </div>
                    {formatDate(vm.last_seen)}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleViewStats(vm.vm_id)}
                  >
                    <Activity size={14} /> Stats
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ color: "var(--danger)" }}
                    onClick={() => handleDelete(vm.vm_id)}
                  >
                    <Trash2 size={14} /> Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card">
            <div className="empty-state">
              <Server />
              <p>No VMs registered yet</p>
            </div>
          </div>
        )}
      </div>

      {/* Register VM Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">
              <Server size={20} color="var(--accent-primary)" /> Register VM
            </div>
            <form onSubmit={handleRegister}>
              <div className="input-group" style={{ marginBottom: 16 }}>
                <label htmlFor="vm-id">VM ID</label>
                <input
                  id="vm-id"
                  className="input"
                  placeholder="e.g. vm-001"
                  value={form.vmId}
                  onChange={(e) => setForm({ ...form, vmId: e.target.value })}
                  required
                />
              </div>
              <div className="input-group" style={{ marginBottom: 16 }}>
                <label htmlFor="vm-hostname">Hostname</label>
                <input
                  id="vm-hostname"
                  className="input"
                  placeholder="e.g. WIN-VM01"
                  value={form.hostname}
                  onChange={(e) =>
                    setForm({ ...form, hostname: e.target.value })
                  }
                  required
                />
              </div>
              <div className="input-group" style={{ marginBottom: 16 }}>
                <label htmlFor="vm-ip">IP Address</label>
                <input
                  id="vm-ip"
                  className="input"
                  placeholder="e.g. 192.168.1.10"
                  value={form.ip}
                  onChange={(e) => setForm({ ...form, ip: e.target.value })}
                  required
                />
              </div>
              <div className="input-group" style={{ marginBottom: 16 }}>
                <label htmlFor="vm-method">Collection Method</label>
                <select
                  id="vm-method"
                  className="input"
                  value={form.method}
                  onChange={(e) => setForm({ ...form, method: e.target.value })}
                >
                  <option value="agent">Agent</option>
                  <option value="wmi">WMI</option>
                  <option value="syslog">Syslog</option>
                </select>
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
                  className="btn btn-primary"
                  disabled={submitting}
                >
                  {submitting ? "Registering…" : "Register"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VM Stats Modal */}
      {showStats && (
        <div className="modal-overlay" onClick={() => setShowStats(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">
              <Activity size={20} color="var(--info)" /> Stats: {showStats}
            </div>
            {vmStats ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 16,
                }}
              >
                <div
                  className="card"
                  style={{ textAlign: "center", padding: 16 }}
                >
                  <div
                    className="card-title"
                    style={{ justifyContent: "center" }}
                  >
                    Total Attacks
                  </div>
                  <div
                    className="card-value"
                    style={{ color: "var(--danger)" }}
                  >
                    {vmStats.total_attacks ?? 0}
                  </div>
                </div>
                <div
                  className="card"
                  style={{ textAlign: "center", padding: 16 }}
                >
                  <div
                    className="card-title"
                    style={{ justifyContent: "center" }}
                  >
                    Unique Attackers
                  </div>
                  <div
                    className="card-value"
                    style={{ color: "var(--warning)" }}
                  >
                    {vmStats.unique_attackers ?? 0}
                  </div>
                </div>
                <div
                  className="card"
                  style={{ textAlign: "center", padding: 16 }}
                >
                  <div
                    className="card-title"
                    style={{ justifyContent: "center" }}
                  >
                    Blocked
                  </div>
                  <div
                    className="card-value"
                    style={{ color: "var(--accent-primary)" }}
                  >
                    {vmStats.blocked_count ?? 0}
                  </div>
                </div>
                <div
                  className="card"
                  style={{ textAlign: "center", padding: 16 }}
                >
                  <div
                    className="card-title"
                    style={{ justifyContent: "center" }}
                  >
                    Last Attack
                  </div>
                  <div
                    style={{
                      fontSize: "0.8rem",
                      color: "var(--text-secondary)",
                      marginTop: 4,
                    }}
                  >
                    {formatDate(vmStats.last_attack)}
                  </div>
                </div>
              </div>
            ) : (
              <div className="loading-center">
                <div className="spinner" />
              </div>
            )}
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                onClick={() => setShowStats(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
