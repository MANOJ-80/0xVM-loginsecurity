import { useEffect, useState } from "react";
import Sidebar from "../components/Sidebar";
import { getSuspiciousIps, blockIp } from "../services/api";

function SuspiciousIPs() {
  const [ips, setIps] = useState([]);
  const [search, setSearch] = useState("");
  const [blocking, setBlocking] = useState(null);

  const fetchIps = async () => {
    try {
      const data = await getSuspiciousIps(3);
      setIps(data || []);
    } catch (err) {
      console.error("Failed to load suspicious IPs:", err);
    }
  };

  useEffect(() => {
    fetchIps();
    const id = setInterval(fetchIps, 30000);
    return () => clearInterval(id);
  }, []);

  const handleBlock = async (ipAddress) => {
    setBlocking(ipAddress);
    try {
      await blockIp(ipAddress, "Blocked from Suspicious IPs page");
      alert(`IP ${ipAddress} blocked`);
      fetchIps();
    } catch (err) {
      alert("Failed to block IP: " + (err.response?.data?.detail || err.message));
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
    if (!d) return "—";
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
                filtered.map((ip, index) => (
                  <tr
                    key={index}
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
                      <button
                        onClick={() => handleBlock(ip.ip_address)}
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
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

export default SuspiciousIPs;
