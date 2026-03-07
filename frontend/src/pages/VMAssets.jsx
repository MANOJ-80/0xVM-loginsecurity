import { useEffect, useState, useCallback } from "react";
import { MdAdd, MdRefresh, MdClose, MdCircle } from "react-icons/md";
import Sidebar from "../components/Sidebar";
import { getVMs, getVmAttacks, registerVm, deleteVm } from "../services/api";

function VMAssets() {
  const [vms, setVms] = useState([]);
  const [selectedVM, setSelectedVM] = useState(null);
  const [vmDetail, setVmDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [error, setError] = useState(null);

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

  // When a VM is selected, fetch its attack details
  useEffect(() => {
    if (selectedVM) {
      fetchVmDetail(selectedVM.vm_id);
    } else {
      setVmDetail(null);
    }
  }, [selectedVM, fetchVmDetail]);

  // ---- Deregister a VM ----
  const handleDeleteVm = async (vmId) => {
    if (!window.confirm(`Deregister VM "${vmId}"? This cannot be undone.`)) return;
    try {
      await deleteVm(vmId);
      setVms((prev) => prev.filter((v) => v.vm_id !== vmId));
      if (selectedVM?.vm_id === vmId) {
        setSelectedVM(null);
        setVmDetail(null);
      }
    } catch (err) {
      console.error("Failed to delete VM:", err);
      alert("Failed to deregister VM");
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
            <button
              onClick={() => setShowRegisterModal(true)}
              className="bg-red-600 hover:bg-red-700 text-white px-5 py-2 rounded-lg font-bold flex items-center gap-2"
            >
              <MdAdd /> Register New VM
            </button>
          </div>
        </div>

        {/* STATS */}
        <div className="grid grid-cols-3 gap-6 mb-8">
          <Stat title="Total Assets" value={totalVMs} />
          <Stat title="Active Assets" value={activeVMs} color="text-green-600" />
          <Stat title="Inactive Assets" value={inactiveVMs} color="text-red-600" />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl mb-6">
            {error}
          </div>
        )}

        <div className="flex gap-8">
          {/* VM TABLE */}
          <div className="flex-1 bg-white rounded-xl border border-gray-200">
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
                      <td className="p-4">{vm.hostname || "—"}</td>
                      <td className="p-4 font-mono">{vm.ip_address}</td>
                      <td className="p-4 capitalize">{vm.collection_method || "—"}</td>
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
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteVm(vm.vm_id);
                          }}
                          className="text-red-500 hover:text-red-700 text-xs font-semibold"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* VM DETAILS PANEL */}
          {selectedVM && (
            <div className="w-96 bg-white border border-gray-200 rounded-xl p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-bold">VM Details</h3>
                  <p className="text-gray-500 text-sm">
                    {selectedVM.hostname || selectedVM.vm_id}
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

              {/* VM Info */}
              <div className="space-y-2 mb-6 text-sm">
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
                  <span className="capitalize">{selectedVM.collection_method || "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Status</span>
                  <span className={selectedVM.status === "active" ? "text-green-600" : "text-gray-400"}>
                    {selectedVM.status === "active" ? "Active" : "Inactive"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Last Seen</span>
                  <span className="text-xs">{formatTime(selectedVM.last_seen)}</span>
                </div>
              </div>

              {/* Attack Stats from /vms/{vmId}/attacks */}
              <h4 className="text-sm font-bold text-gray-700 mb-3 border-t border-gray-200 pt-4">
                Attack Statistics
              </h4>

              {detailLoading ? (
                <div className="text-gray-400 text-sm">Loading attack data...</div>
              ) : vmDetail ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Stat title="Total Attacks" value={vmDetail.total_attacks ?? 0} />
                    <Stat title="Unique Attackers" value={vmDetail.unique_attackers ?? 0} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Stat title="Blocked IPs" value={vmDetail.blocked_count ?? 0} color="text-red-600" />
                    <div className="bg-gray-50 border border-gray-200 p-4 rounded-xl">
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
          )}
        </div>
      </main>

      {/* REGISTER VM MODAL */}
      {showRegisterModal && (
        <RegisterVmModal
          onClose={() => setShowRegisterModal(false)}
          onRegistered={(newVm) => {
            fetchVMs();
            setShowRegisterModal(false);
          }}
        />
      )}
    </div>
  );
}

export default VMAssets;

// ---- Stat mini-component ----
function Stat({ title, value, color = "" }) {
  return (
    <div className="bg-white border border-gray-200 p-6 rounded-xl">
      <p className="text-xs text-gray-500">{title}</p>
      <h3 className={`text-2xl font-bold ${color}`}>{value}</h3>
    </div>
  );
}

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
