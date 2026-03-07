import { useEffect, useState } from "react";
import Sidebar from "../components/Sidebar";
import StatCard from "../components/StatCard";
import { getBlockedIps, unblockIp, blockIp } from "../services/api";

// Simple IPv4/IPv6 validation
function isValidIp(ip) {
  // IPv4
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4.test(ip)) {
    return ip.split(".").every((octet) => {
      const n = parseInt(octet, 10);
      return n >= 0 && n <= 255;
    });
  }
  // IPv6 (loose check)
  const ipv6 = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  return ipv6.test(ip);
}

function BlockedIPs() {
  const [ips, setIps] = useState([]);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [blockForm, setBlockForm] = useState({
    ip_address: "",
    reason: "",
    duration_minutes: 120,
  });
  const [unblocking, setUnblocking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [blockError, setBlockError] = useState(null);

  const fetchBlockedIps = async () => {
    try {
      setError(null);
      const data = await getBlockedIps();
      setIps(data || []);
    } catch (err) {
      console.error("Failed to load blocked IPs:", err);
      setError("Failed to load blocked IPs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBlockedIps();
    const id = setInterval(fetchBlockedIps, 30000);
    return () => clearInterval(id);
  }, []);

  // Auto-dismiss success messages after 3s
  useEffect(() => {
    if (success) {
      const t = setTimeout(() => setSuccess(null), 3000);
      return () => clearTimeout(t);
    }
  }, [success]);

  const handleUnblock = async (ipAddress) => {
    setUnblocking(ipAddress);
    setError(null);
    try {
      await unblockIp(ipAddress);
      setSuccess(`IP ${ipAddress} unblocked`);
      fetchBlockedIps();
    } catch (err) {
      setError(
        "Failed to unblock IP: " +
          (err.response?.data?.detail || err.message)
      );
    } finally {
      setUnblocking(null);
    }
  };

  const handleManualBlock = async (e) => {
    e.preventDefault();
    setBlockError(null);

    if (!isValidIp(blockForm.ip_address.trim())) {
      setBlockError("Please enter a valid IPv4 or IPv6 address");
      return;
    }

    try {
      await blockIp(
        blockForm.ip_address.trim(),
        blockForm.reason || "Manual block",
        blockForm.duration_minutes
      );
      setSuccess(`IP ${blockForm.ip_address} blocked`);
      setShowBlockModal(false);
      setBlockForm({ ip_address: "", reason: "", duration_minutes: 120 });
      setBlockError(null);
      fetchBlockedIps();
    } catch (err) {
      setBlockError(
        "Failed to block IP: " +
          (err.response?.data?.detail || err.message)
      );
    }
  };

  const formatDate = (d) => {
    if (!d) return "\u2014";
    try {
      return new Date(d).toLocaleString();
    } catch {
      return d;
    }
  };

  return (
    <div className="flex h-screen bg-[#f3f4f6] text-gray-900">
      <Sidebar />

      <main className="flex-1 overflow-y-auto p-8">
        {/* PAGE HEADER */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold">
              Security Registry — Blocked IPs
            </h1>
            <p className="text-gray-500 text-sm">
              Real-time repository of restricted network entities
            </p>
          </div>
          <button
            onClick={() => { setShowBlockModal(true); setBlockError(null); }}
            className="bg-red-600 hover:bg-red-700 px-5 py-2 rounded text-white font-bold"
          >
            Manual Block
          </button>
        </div>

        {/* FEEDBACK BANNERS */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl mb-4 text-sm flex justify-between items-center">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 font-bold ml-4">Dismiss</button>
          </div>
        )}
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 p-3 rounded-xl mb-4 text-sm">
            {success}
          </div>
        )}

        {/* STATS */}
        <div className="grid grid-cols-3 gap-6 mb-8">
          <StatCard title="Currently Blocked" value={ips.length} />
          <StatCard
            title="Auto-blocked"
            value={ips.filter((ip) => ip.blocked_by === "auto").length}
          />
          <StatCard
            title="Manual Blocks"
            value={ips.filter((ip) => ip.blocked_by === "manual").length}
          />
        </div>

        {/* TABLE */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-gray-400">Loading blocked IPs...</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="p-5 text-left">IP Address</th>
                  <th className="p-5 text-left">Blocked At</th>
                  <th className="p-5 text-left">Expires</th>
                  <th className="p-5 text-left">Reason</th>
                  <th className="p-5 text-left">Blocked By</th>
                  <th className="p-5 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {ips.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="p-8 text-center text-gray-400"
                    >
                      No blocked IPs
                    </td>
                  </tr>
                ) : (
                  ips.map((ip, index) => (
                    <tr
                      key={index}
                      className="border-t border-gray-200 hover:bg-gray-50"
                    >
                      <td className="p-5 font-mono text-red-600">
                        {ip.ip_address}
                      </td>
                      <td className="p-5">
                        {formatDate(ip.blocked_at)}
                      </td>
                      <td className="p-5">
                        {ip.block_expires ? (
                          formatDate(ip.block_expires)
                        ) : (
                          <span className="text-red-600 font-bold">
                            Permanent
                          </span>
                        )}
                      </td>
                      <td className="p-5">
                        <span className="bg-red-100 text-red-600 px-2 py-1 rounded text-xs">
                          {ip.reason || "No reason"}
                        </span>
                      </td>
                      <td className="p-5">
                        <span
                          className={`px-2 py-1 rounded text-xs font-bold ${
                            ip.blocked_by === "auto"
                              ? "bg-orange-100 text-orange-700"
                              : "bg-blue-100 text-blue-700"
                          }`}
                        >
                          {ip.blocked_by}
                        </span>
                      </td>
                      <td className="p-5 text-right">
                        <button
                          onClick={() => handleUnblock(ip.ip_address)}
                          disabled={unblocking === ip.ip_address}
                          className="border border-gray-300 px-4 py-1 rounded hover:bg-red-600 hover:text-white disabled:opacity-50"
                        >
                          {unblocking === ip.ip_address
                            ? "Unblocking..."
                            : "Unblock"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* MANUAL BLOCK MODAL */}
        {showBlockModal && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-8 w-full max-w-md shadow-2xl">
              <h2 className="text-xl font-bold mb-4">Block IP Address</h2>

              {blockError && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg mb-4 text-sm">
                  {blockError}
                </div>
              )}

              <form onSubmit={handleManualBlock} className="space-y-4">
                <div>
                  <label className="text-sm text-gray-700">IP Address</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 192.168.1.100"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1"
                    value={blockForm.ip_address}
                    onChange={(e) =>
                      setBlockForm({ ...blockForm, ip_address: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-700">Reason</label>
                  <input
                    type="text"
                    placeholder="e.g. Brute force attack"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1"
                    value={blockForm.reason}
                    onChange={(e) =>
                      setBlockForm({ ...blockForm, reason: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-700">
                    Duration (minutes)
                  </label>
                  <input
                    type="number"
                    min={1}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1"
                    value={blockForm.duration_minutes}
                    onChange={(e) =>
                      setBlockForm({
                        ...blockForm,
                        duration_minutes: parseInt(e.target.value) || 120,
                      })
                    }
                  />
                </div>
                <div className="flex gap-3 justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setShowBlockModal(false)}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold"
                  >
                    Block
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default BlockedIPs;
