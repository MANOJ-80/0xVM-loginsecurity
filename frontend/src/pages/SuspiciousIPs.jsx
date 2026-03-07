import { useEffect, useState, useCallback } from "react";
import Sidebar from "../components/Sidebar";
import { getSuspiciousIps, blockIp } from "../services/api";
import { useAuth } from "../context/AuthContext";

function SuspiciousIPs() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [ips, setIps] = useState([]);
  const [search, setSearch] = useState("");
  const [blocking, setBlocking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirmBlock, setConfirmBlock] = useState(null); // IP awaiting confirmation

  const fetchIps = useCallback(async () => {
    try {
      setError(null);
      const data = await getSuspiciousIps(3);
      setIps(data || []);
      setConfirmBlock(null); // reset stale confirmation on refresh
    } catch (err) {
      console.error("Failed to load suspicious IPs:", err);
      setError("Failed to load suspicious IPs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIps();
    const id = setInterval(fetchIps, 30000);
    return () => clearInterval(id);
  }, [fetchIps]);

  const handleBlock = async (ipAddress) => {
    setBlocking(ipAddress);
    setConfirmBlock(null);
    try {
      await blockIp(ipAddress, "Blocked from Suspicious IPs page");
      fetchIps();
    } catch (err) {
      setError("Failed to block IP: " + (err.response?.data?.detail || err.message));
    } finally {
      setBlocking(null);
    }
  };

  const filtered = search
    ? ips.filter(
        (ip) =>
          ip.ip_address?.toLowerCase().includes(search.toLowerCase()) ||
          ip.status?.toLowerCase().includes(search.toLowerCase())
      )
    : ips;

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
        <h1 className="text-2xl font-bold mb-6">
          Suspicious IP Intelligence
        </h1>

        {/* ERROR BANNER */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl mb-4 text-sm flex justify-between items-center">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-red-400 hover:text-red-600 font-bold ml-4"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* SEARCH BAR */}
        <div className="flex gap-4 mb-6">
          <input
            type="text"
            placeholder="Search IP address or status..."
            className="bg-white border border-gray-300 rounded-lg px-4 py-2 w-96"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="text-sm text-gray-500 self-center">
            {filtered.length} result{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* TABLE */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-gray-400">
              Loading suspicious IPs...
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="p-4 text-left">IP Address</th>
                  <th className="p-4 text-left">Failed Attempts</th>
                  <th className="p-4 text-left">First Attempt</th>
                  <th className="p-4 text-left">Last Attempt</th>
                  <th className="p-4 text-left">Status</th>
                  <th className="p-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="p-8 text-center text-gray-400"
                    >
                      No suspicious IPs found
                    </td>
                  </tr>
                ) : (
                  filtered.map((ip) => (
                    <tr
                      key={ip.ip_address}
                      className="border-t border-gray-200 hover:bg-gray-50"
                    >
                      <td className="p-4 font-mono text-red-600">
                        {ip.ip_address}
                      </td>
                      <td className="p-4 text-red-600 font-bold">
                        {ip.failed_attempts}
                      </td>
                      <td className="p-4">{formatDate(ip.first_attempt)}</td>
                      <td className="p-4">{formatDate(ip.last_attempt)}</td>
                      <td className="p-4">
                        <span
                          className={`px-2 py-1 rounded text-xs font-bold ${
                            ip.status === "blocked"
                              ? "bg-red-100 text-red-600"
                              : ip.status === "active"
                              ? "bg-yellow-100 text-yellow-700"
                              : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {ip.status}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        {!isAdmin ? (
                          <span className="text-gray-400 text-xs">View only</span>
                        ) : confirmBlock === ip.ip_address ? (
                          <span className="inline-flex gap-2 items-center">
                            <span className="text-xs text-gray-500">Confirm?</span>
                            <button
                              onClick={() => handleBlock(ip.ip_address)}
                              disabled={blocking === ip.ip_address}
                              className="bg-red-600 hover:bg-red-700 disabled:bg-gray-300 px-3 py-1 rounded text-xs font-bold text-white"
                            >
                              {blocking === ip.ip_address ? "Blocking..." : "Yes"}
                            </button>
                            <button
                              onClick={() => setConfirmBlock(null)}
                              className="border border-gray-300 px-3 py-1 rounded text-xs font-bold hover:bg-gray-100"
                            >
                              No
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setConfirmBlock(ip.ip_address)}
                            disabled={
                              blocking === ip.ip_address ||
                              ip.status === "blocked"
                            }
                            className="bg-red-600 hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed px-4 py-2 rounded-lg text-xs font-bold text-white"
                          >
                            {blocking === ip.ip_address
                              ? "Blocking..."
                              : ip.status === "blocked"
                              ? "Blocked"
                              : "Block IP"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}

export default SuspiciousIPs;
