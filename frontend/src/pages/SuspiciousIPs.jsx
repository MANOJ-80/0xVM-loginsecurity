import { useEffect, useState, useCallback } from "react";
import Sidebar from "../components/Sidebar";
import { getSuspiciousIps, blockIp } from "../services/api";
import { useAuth } from "../context/AuthContext";

const RISK_STYLES = {
  critical: "bg-red-100 text-red-700 border border-red-300",
  high: "bg-orange-100 text-orange-700 border border-orange-300",
  medium: "bg-yellow-100 text-yellow-700 border border-yellow-300",
  low: "bg-green-100 text-green-700 border border-green-300",
  blocked: "bg-gray-200 text-gray-600 border border-gray-300",
  cleared: "bg-blue-100 text-blue-600 border border-blue-300",
};

const STATUS_TABS = ["all", "active", "blocked", "cleared"];

const DURATION_OPTIONS = [
  { label: "1 hour", value: 60 },
  { label: "6 hours", value: 360 },
  { label: "24 hours", value: 1440 },
  { label: "7 days", value: 10080 },
  { label: "30 days", value: 43200 },
  { label: "Permanent", value: 0 },
];

function SuspiciousIPs() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [ips, setIps] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [blocking, setBlocking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirmBlock, setConfirmBlock] = useState(null);
  const [blockDuration, setBlockDuration] = useState(1440); // default 24h
  const [expandedUsernames, setExpandedUsernames] = useState(null);

  const fetchIps = useCallback(async () => {
    try {
      setError(null);
      const data = await getSuspiciousIps();
      setIps(data || []);
      setConfirmBlock(null);
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
      await blockIp(ipAddress, "Blocked from Suspicious IPs page", blockDuration);
      fetchIps();
    } catch (err) {
      setError("Failed to block IP: " + (err.response?.data?.detail || err.message));
    } finally {
      setBlocking(null);
    }
  };

  const filtered = ips.filter((ip) => {
    const matchesStatus =
      statusFilter === "all" || ip.status === statusFilter;
    const matchesSearch =
      !search ||
      ip.ip_address?.toLowerCase().includes(search.toLowerCase()) ||
      ip.risk_level?.toLowerCase().includes(search.toLowerCase()) ||
      ip.target_usernames?.some((u) =>
        u.toLowerCase().includes(search.toLowerCase())
      );
    return matchesStatus && matchesSearch;
  });

  const statusCounts = ips.reduce(
    (acc, ip) => {
      acc.all++;
      if (ip.status === "active") acc.active++;
      else if (ip.status === "blocked") acc.blocked++;
      else if (ip.status === "cleared") acc.cleared++;
      return acc;
    },
    { all: 0, active: 0, blocked: 0, cleared: 0 }
  );

  const formatDate = (d) => {
    if (!d) return "\u2014";
    try {
      return new Date(d).toLocaleString();
    } catch {
      return d;
    }
  };

  const renderUsernames = (usernames, ipAddress) => {
    if (!usernames || usernames.length === 0) return <span className="text-gray-400">\u2014</span>;

    const isExpanded = expandedUsernames === ipAddress;
    const shown = isExpanded ? usernames : usernames.slice(0, 2);
    const remaining = usernames.length - 2;

    return (
      <div className="flex flex-wrap gap-1 items-center">
        {shown.map((u, i) => (
          <span
            key={i}
            className="bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded text-xs font-mono"
          >
            {u}
          </span>
        ))}
        {remaining > 0 && !isExpanded && (
          <button
            onClick={() => setExpandedUsernames(ipAddress)}
            className="text-blue-500 hover:text-blue-700 text-xs font-medium"
          >
            +{remaining} more
          </button>
        )}
        {isExpanded && usernames.length > 2 && (
          <button
            onClick={() => setExpandedUsernames(null)}
            className="text-blue-500 hover:text-blue-700 text-xs font-medium"
          >
            show less
          </button>
        )}
      </div>
    );
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

        {/* STATUS FILTER TABS */}
        <div className="flex gap-1 mb-4 bg-white border border-gray-200 rounded-lg p-1 w-fit">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium capitalize transition-colors ${
                statusFilter === tab
                  ? "bg-gray-900 text-white"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
              }`}
            >
              {tab}
              <span className="ml-1.5 text-xs opacity-70">
                ({statusCounts[tab] || 0})
              </span>
            </button>
          ))}
        </div>

        {/* SEARCH BAR + BLOCK DURATION */}
        <div className="flex gap-4 mb-6 items-center">
          <input
            type="text"
            placeholder="Search IP, risk level, or username..."
            className="bg-white border border-gray-300 rounded-lg px-4 py-2 w-96"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {isAdmin && (
            <select
              value={blockDuration}
              onChange={(e) => setBlockDuration(Number(e.target.value))}
              className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              {DURATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  Block: {opt.label}
                </option>
              ))}
            </select>
          )}
          <span className="text-sm text-gray-500">
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
                  <th className="p-4 text-left">Risk Level</th>
                  <th className="p-4 text-left">Target Usernames</th>
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
                      colSpan={8}
                      className="p-8 text-center text-gray-400"
                    >
                      No suspicious IPs found
                    </td>
                  </tr>
                ) : (
                  filtered.map((ip) => {
                    const riskStyle =
                      RISK_STYLES[ip.risk_level] || RISK_STYLES.low;
                    const isBlocked = ip.status === "blocked";

                    return (
                      <tr
                        key={ip.ip_address}
                        className={`border-t border-gray-200 hover:bg-gray-50 ${
                          isBlocked ? "opacity-60" : ""
                        }`}
                      >
                        <td className="p-4 font-mono text-red-600">
                          {ip.ip_address}
                        </td>
                        <td className="p-4 text-red-600 font-bold">
                          {ip.failed_attempts}
                        </td>
                        <td className="p-4">
                          <span
                            className={`px-2 py-1 rounded text-xs font-bold uppercase ${riskStyle}`}
                          >
                            {ip.risk_level || "unknown"}
                          </span>
                        </td>
                        <td className="p-4 max-w-[200px]">
                          {renderUsernames(ip.target_usernames, ip.ip_address)}
                        </td>
                        <td className="p-4 text-gray-600 text-xs">
                          {formatDate(ip.first_attempt)}
                        </td>
                        <td className="p-4 text-gray-600 text-xs">
                          {formatDate(ip.last_attempt)}
                        </td>
                        <td className="p-4">
                          <span
                            className={`px-2 py-1 rounded text-xs font-bold ${
                              isBlocked
                                ? "bg-red-100 text-red-600"
                                : ip.status === "active"
                                ? "bg-yellow-100 text-yellow-700"
                                : ip.status === "cleared"
                                ? "bg-blue-100 text-blue-600"
                                : "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {ip.status}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          {!isAdmin ? (
                            <span className="text-gray-400 text-xs">
                              View only
                            </span>
                          ) : isBlocked ? (
                            <span className="text-gray-400 text-xs font-medium">
                              Already blocked
                            </span>
                          ) : confirmBlock === ip.ip_address ? (
                            <span className="inline-flex gap-2 items-center">
                              <span className="text-xs text-gray-500">
                                Confirm?
                              </span>
                              <button
                                onClick={() => handleBlock(ip.ip_address)}
                                disabled={blocking === ip.ip_address}
                                className="bg-red-600 hover:bg-red-700 disabled:bg-gray-300 px-3 py-1 rounded text-xs font-bold text-white"
                              >
                                {blocking === ip.ip_address
                                  ? "Blocking..."
                                  : "Yes"}
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
                              disabled={blocking === ip.ip_address}
                              className="bg-red-600 hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed px-4 py-2 rounded-lg text-xs font-bold text-white"
                            >
                              {blocking === ip.ip_address
                                ? "Blocking..."
                                : "Block IP"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
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
