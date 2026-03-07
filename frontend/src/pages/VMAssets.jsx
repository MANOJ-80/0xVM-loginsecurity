import { useEffect, useState, useCallback } from "react";
import { MdAdd, MdRefresh, MdClose, MdCircle, MdBlock } from "react-icons/md";
import Sidebar from "../components/Sidebar";
import StatCard from "../components/StatCard";
import { getVMs, getVmAttacks, registerVm, deleteVm, blockIpPerVm } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { isValidIp } from "../utils/validation";

function VMAssets() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [vms, setVms] = useState([]);
  const [selectedVM, setSelectedVM] = useState(null);
  const [vmDetail, setVmDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [error, setError] = useState(null);

  // Per-VM block form state
  const [blockForm, setBlockForm] = useState({ ip: "", reason: "", duration: 120 });
  const [blockSubmitting, setBlockSubmitting] = useState(false);
  const [blockSuccess, setBlockSuccess] = useState(null);
  const [blockError, setBlockError] = useState(null);

  // ---- Fetch VM list ----
  const fetchVMs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getVMs();
      setVms(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to fetch VMs:", err);
      setError("Failed to load VMs");
    } finally {
      setLoading(false);
    }
  }, []);

  // ---- Fetch detail stats for a specific VM ----
  const fetchVmDetail = useCallback(async (vmId) => {
    setDetailLoading(true);
    try {
      const data = await getVmAttacks(vmId);
      setVmDetail(data);
    } catch (err) {
      console.error("Failed to fetch VM detail:", err);
      setVmDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVMs();
  }, [fetchVMs]);

  // When a VM is selected, fetch its attack details + reset block form
  useEffect(() => {
    if (selectedVM) {
      fetchVmDetail(selectedVM.vm_id);
      setBlockForm({ ip: "", reason: "", duration: 120 });
      setBlockSuccess(null);
      setBlockError(null);
    } else {
      setVmDetail(null);
    }
  }, [selectedVM, fetchVmDetail]);

  // Auto-dismiss block success after 3s
  useEffect(() => {
    if (blockSuccess) {
      const t = setTimeout(() => setBlockSuccess(null), 3000);
      return () => clearTimeout(t);
    }
  }, [blockSuccess]);

  // ---- Block IP on specific VM ----
  const handlePerVmBlock = async (e) => {
    e.preventDefault();
    setBlockError(null);
    setBlockSuccess(null);
    const ip = blockForm.ip.trim();
    if (!isValidIp(ip)) {
      setBlockError("Please enter a valid IPv4 or IPv6 address");
      return;
    }
    setBlockSubmitting(true);
    try {
      await blockIpPerVm(ip, selectedVM.vm_id, blockForm.reason || "Manual per-VM block", blockForm.duration);
      setBlockSuccess(`IP ${ip} blocked on ${selectedVM.vm_id}`);
      setBlockForm({ ip: "", reason: "", duration: 120 });
      // Refresh detail stats
      fetchVmDetail(selectedVM.vm_id);
    } catch (err) {
      setBlockError(err.response?.data?.detail || err.response?.data?.message || "Failed to block IP");
    } finally {
      setBlockSubmitting(false);
    }
  };

  // ---- Deregister a VM (backend sets inactive, so update local state to match) ----
  const handleDeleteVm = async (vmId) => {
    if (!window.confirm(`Deregister VM "${vmId}"? It will be marked as inactive.`)) return;
    try {
      await deleteVm(vmId);
      // Backend sets status to "inactive" — update local state to reflect that
      setVms((prev) =>
        prev.map((v) =>
          v.vm_id === vmId ? { ...v, status: "inactive" } : v
        )
      );
      if (selectedVM?.vm_id === vmId) {
        setSelectedVM((prev) => prev ? { ...prev, status: "inactive" } : null);
      }
    } catch (err) {
      console.error("Failed to deregister VM:", err);
      setError("Failed to deregister VM");
    }
  };

  // ---- Computed stats from real data ----
  const totalVMs = vms.length;
  const activeVMs = vms.filter((v) => v.status === "active").length;
  const inactiveVMs = totalVMs - activeVMs;

  // ---- Time formatting helper ----
  const formatTime = (ts) => {
    if (!ts) return "N/A";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleString();
  };

  return (
    <div className="flex h-screen bg-[#f3f4f6] text-gray-900">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto">
        {/* PAGE HEADER */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold">VM Asset Monitoring</h1>
            <p className="text-gray-500 text-sm">
              Centralized view of protected virtual assets
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={fetchVMs}
              className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded-lg font-semibold flex items-center gap-2"
            >
              <MdRefresh /> Refresh
            </button>
            {isAdmin && (
              <button
                onClick={() => setShowRegisterModal(true)}
                className="bg-red-600 hover:bg-red-700 text-white px-5 py-2 rounded-lg font-bold flex items-center gap-2"
              >
                <MdAdd /> Register New VM
              </button>
            )}
          </div>
        </div>

        {/* STATS */}
        <div className="grid grid-cols-3 gap-6 mb-8">
          <StatCard title="Total Assets" value={totalVMs} />
          <StatCard title="Active Assets" value={activeVMs} color="text-green-600" />
          <StatCard title="Inactive Assets" value={inactiveVMs} color="text-red-600" />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl mb-6 flex justify-between items-center">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 font-bold ml-4">Dismiss</button>
          </div>
        )}

        {/* VM TABLE */}
        <div className="bg-white rounded-xl border border-gray-200">
          <h3 className="p-5 font-bold border-b border-gray-200">
            Active Monitors
          </h3>

          {loading ? (
            <div className="p-8 text-center text-gray-400">Loading VMs...</div>
          ) : vms.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              No VMs registered yet.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-gray-500">
                <tr>
                  <th className="p-4 text-left">VM ID</th>
                  <th className="p-4 text-left">Hostname</th>
                  <th className="p-4 text-left">IP Address</th>
                  <th className="p-4 text-left">Method</th>
                  <th className="p-4 text-left">Status</th>
                  <th className="p-4 text-left">Last Seen</th>
                  <th className="p-4 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {vms.map((vm) => (
                  <tr
                    key={vm.vm_id}
                    onClick={() => setSelectedVM(vm)}
                    className={`border-t border-gray-200 hover:bg-gray-50 cursor-pointer ${
                      selectedVM?.vm_id === vm.vm_id ? "bg-blue-50" : ""
                    }`}
                  >
                    <td className="p-4 font-mono text-xs">{vm.vm_id}</td>
                    <td className="p-4">{vm.hostname || "\u2014"}</td>
                    <td className="p-4 font-mono">{vm.ip_address}</td>
                    <td className="p-4 capitalize">{vm.collection_method || "\u2014"}</td>
                    <td className="p-4">
                      {vm.status === "active" ? (
                        <span className="inline-flex items-center gap-1 text-green-600">
                          <MdCircle className="text-[8px]" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-gray-400">
                          <MdCircle className="text-[8px]" /> Inactive
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-xs">{formatTime(vm.last_seen)}</td>
                    <td className="p-4">
                      {vm.status === "active" && isAdmin ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteVm(vm.vm_id);
                          }}
                          className="text-red-500 hover:text-red-700 text-xs font-semibold"
                        >
                          Deregister
                        </button>
                      ) : vm.status === "active" ? (
                        <span className="text-green-600 text-xs">Active</span>
                      ) : (
                        <span className="text-gray-400 text-xs">Inactive</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* VM DETAILS PANEL — full width below the table */}
        {selectedVM && (
          <div className="bg-white border border-gray-200 rounded-xl p-6 mt-6">
            {/* Header */}
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-lg font-bold">
                  VM Details — {selectedVM.hostname || selectedVM.vm_id}
                </h3>
                <p className="text-gray-500 text-sm">
                  Detailed information and attack statistics
                </p>
              </div>
              <button
                onClick={() => {
                  setSelectedVM(null);
                  setVmDetail(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <MdClose size={20} />
              </button>
            </div>

            {/* 3-column grid: VM Info | Attack Stats | Per-VM Block */}
            <div className={`grid gap-6 ${isAdmin && selectedVM.status === "active" ? "grid-cols-1 md:grid-cols-3" : "grid-cols-1 md:grid-cols-2"}`}>
              {/* Column 1: VM Info */}
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
                <h4 className="text-sm font-bold text-gray-700 mb-4">VM Information</h4>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">VM ID</span>
                    <span className="font-mono text-xs">{selectedVM.vm_id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">IP Address</span>
                    <span className="font-mono">{selectedVM.ip_address}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Collection Method</span>
                    <span className="capitalize">{selectedVM.collection_method || "\u2014"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Status</span>
                    <span className={selectedVM.status === "active" ? "text-green-600 font-semibold" : "text-gray-400"}>
                      {selectedVM.status === "active" ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Last Seen</span>
                    <span className="text-xs">{formatTime(selectedVM.last_seen)}</span>
                  </div>
                </div>
              </div>

              {/* Column 2: Attack Stats */}
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
                <h4 className="text-sm font-bold text-gray-700 mb-4">Attack Statistics</h4>

                {detailLoading ? (
                  <div className="text-gray-400 text-sm">Loading attack data...</div>
                ) : vmDetail ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <StatCard title="Total Attacks" value={vmDetail.total_attacks ?? 0} />
                      <StatCard title="Unique Attackers" value={vmDetail.unique_attackers ?? 0} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <StatCard title="Blocked IPs" value={vmDetail.blocked_count ?? 0} color="text-red-600" />
                      <div className="bg-white border border-gray-200 p-4 rounded-xl">
                        <p className="text-xs text-gray-500">Last Attack</p>
                        <p className="text-xs font-semibold mt-1">
                          {formatTime(vmDetail.last_attack)}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-gray-400 text-sm">No attack data available.</div>
                )}
              </div>

              {/* Column 3: Per-VM Block Form (admin only) */}
              {isAdmin && selectedVM.status === "active" && (
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
                  <h4 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2">
                    <MdBlock className="text-red-500" /> Block IP on this VM
                  </h4>

                  {blockSuccess && (
                    <div className="bg-green-50 border border-green-200 text-green-700 p-2 rounded-lg mb-3 text-xs">
                      {blockSuccess}
                    </div>
                  )}
                  {blockError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 p-2 rounded-lg mb-3 text-xs flex justify-between items-center">
                      <span>{blockError}</span>
                      <button onClick={() => setBlockError(null)} className="text-red-400 hover:text-red-600 font-bold ml-2 text-xs">&times;</button>
                    </div>
                  )}

                  <form onSubmit={handlePerVmBlock} className="space-y-3">
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">IP Address</label>
                      <input
                        type="text"
                        placeholder="e.g. 192.168.1.100"
                        value={blockForm.ip}
                        onChange={(e) => setBlockForm({ ...blockForm, ip: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Reason</label>
                      <input
                        type="text"
                        placeholder="Optional"
                        value={blockForm.reason}
                        onChange={(e) => setBlockForm({ ...blockForm, reason: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Duration (minutes)</label>
                      <input
                        type="number"
                        min={1}
                        value={blockForm.duration}
                        onChange={(e) => setBlockForm({ ...blockForm, duration: parseInt(e.target.value) || 120 })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={blockSubmitting}
                      className="w-full bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white py-2.5 rounded-lg text-sm font-bold mt-1"
                    >
                      {blockSubmitting ? "Blocking..." : "Block on this VM"}
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* REGISTER VM MODAL */}
      {showRegisterModal && (
        <RegisterVmModal
          onClose={() => setShowRegisterModal(false)}
          onRegistered={() => {
            fetchVMs();
            setShowRegisterModal(false);
          }}
        />
      )}
    </div>
  );
}

export default VMAssets;

// ---- Register VM Modal ----
function RegisterVmModal({ onClose, onRegistered }) {
  const [vmId, setVmId] = useState("");
  const [hostname, setHostname] = useState("");
  const [ipAddress, setIpAddress] = useState("");
  const [collectionMethod, setCollectionMethod] = useState("agent");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!vmId.trim() || !ipAddress.trim()) {
      setError("VM ID and IP Address are required.");
      return;
    }
    if (!isValidIp(ipAddress.trim())) {
      setError("Please enter a valid IPv4 or IPv6 address.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await registerVm(vmId.trim(), hostname.trim(), ipAddress.trim(), collectionMethod);
      onRegistered();
    } catch (err) {
      console.error("Failed to register VM:", err);
      const msg =
        err.response?.data?.message || err.response?.data?.error || "Failed to register VM";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-8 w-[480px] shadow-xl">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold">Register New VM</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <MdClose size={22} />
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg mb-4 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              VM ID *
            </label>
            <input
              type="text"
              value={vmId}
              onChange={(e) => setVmId(e.target.value)}
              placeholder="e.g. VM-PROD-01"
              className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Hostname
            </label>
            <input
              type="text"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="e.g. prod-server-01"
              className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              IP Address *
            </label>
            <input
              type="text"
              value={ipAddress}
              onChange={(e) => setIpAddress(e.target.value)}
              placeholder="e.g. 192.168.1.100"
              className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Collection Method
            </label>
            <select
              value={collectionMethod}
              onChange={(e) => setCollectionMethod(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
            >
              <option value="agent">Agent</option>
              <option value="wef">WEF (Windows Event Forwarding)</option>
              <option value="api">API</option>
            </select>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 py-3 rounded-lg font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white py-3 rounded-lg font-bold"
            >
              {submitting ? "Registering..." : "Register VM"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
