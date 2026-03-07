import { useEffect, useState, useCallback } from "react";
import { MdRefresh } from "react-icons/md";
import Sidebar from "../components/Sidebar";
import StatCard from "../components/StatCard";
import { getVMs, getVmAttacks, getStatistics } from "../services/api";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const CHART_COLORS = [
  "#dc2626",
  "#f59e0b",
  "#6366f1",
  "#10b981",
  "#8b5cf6",
  "#06b6d4",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#3b82f6",
];

function VMStats() {
  const [stats, setStats] = useState(null);
  const [vmStats, setVmStats] = useState([]); // per-VM attack details
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch aggregate stats and VM list in parallel
      const [aggStats, vms] = await Promise.all([
        getStatistics(),
        getVMs(),
      ]);
      setStats(aggStats);

      // Fetch per-VM attack stats for each VM
      const vmList = Array.isArray(vms) ? vms : [];
      const vmDetails = await Promise.all(
        vmList.map(async (vm) => {
          try {
            const detail = await getVmAttacks(vm.vm_id);
            return {
              vm_id: vm.vm_id,
              hostname: vm.hostname,
              ip_address: vm.ip_address,
              status: vm.status,
              collection_method: vm.collection_method,
              last_seen: vm.last_seen,
              total_attacks: detail.total_attacks ?? 0,
              unique_attackers: detail.unique_attackers ?? 0,
              blocked_count: detail.blocked_count ?? 0,
              last_attack: detail.last_attack,
            };
          } catch {
            return {
              vm_id: vm.vm_id,
              hostname: vm.hostname,
              ip_address: vm.ip_address,
              status: vm.status,
              collection_method: vm.collection_method,
              last_seen: vm.last_seen,
              total_attacks: 0,
              unique_attackers: 0,
              blocked_count: 0,
              last_attack: null,
            };
          }
        })
      );
      setVmStats(vmDetails);
    } catch (err) {
      console.error("Failed to fetch VM statistics:", err);
      setError("Failed to load statistics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 60000); // refresh every 60s
    return () => clearInterval(id);
  }, [fetchData]);

  const formatTime = (ts) => {
    if (!ts) return "N/A";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleString();
  };

  const hourlyData = stats?.attacks_by_hour || [];
  const usernameData = (stats?.top_attacked_usernames || []).slice(0, 8);

  // Prepare chart data: attacks per VM
  const vmChartData = vmStats
    .filter((v) => v.total_attacks > 0)
    .sort((a, b) => b.total_attacks - a.total_attacks);

  // Unique attackers per VM chart
  const vmAttackerData = vmStats
    .filter((v) => v.unique_attackers > 0)
    .sort((a, b) => b.unique_attackers - a.unique_attackers);

  return (
    <div className="flex h-screen bg-[#f3f4f6] text-gray-900">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto">
        {/* HEADER */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold">VM Attack Analytics</h1>
            <p className="text-gray-500 text-sm">
              Comparative attack statistics across all monitored VMs
            </p>
          </div>
          <button
            onClick={fetchData}
            className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded-lg font-semibold flex items-center gap-2"
          >
            <MdRefresh /> Refresh
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl mb-6 text-sm flex justify-between items-center">
            <span>{error}</span>
            <button onClick={() => { setError(null); fetchData(); }} className="text-red-600 hover:text-red-800 font-bold ml-4 text-xs">
              Retry
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-400">Loading VM statistics...</div>
          </div>
        ) : (
          <>
            {/* Aggregate Stats */}
            {stats && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
                <StatCard title="Total Failed Attempts" value={stats.total_failed_attempts} />
                <StatCard title="Unique Attackers" value={stats.unique_attackers} />
                <StatCard title="Blocked IPs" value={stats.blocked_ips} color="text-red-600" />
                <StatCard title="Attacks (24h)" value={stats.attacks_last_24h} color="text-red-600" />
                <StatCard title="Attacks (1h)" value={stats.attacks_last_hour} />
              </div>
            )}

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {/* Attacks Per VM Bar Chart */}
              <div className="bg-white border border-gray-200 rounded-xl p-6">
                <h3 className="text-sm font-bold text-gray-700 mb-4">
                  Total Attacks by VM
                </h3>
                {vmChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={vmChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis
                        dataKey="vm_id"
                        tick={{ fill: "#94a3b8", fontSize: 10 }}
                        axisLine={false}
                        interval={0}
                        angle={-30}
                        textAnchor="end"
                        height={60}
                      />
                      <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} />
                      <Tooltip
                        contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "8px", fontSize: "0.8rem" }}
                        formatter={(value) => [value, "Attacks"]}
                      />
                      <Bar dataKey="total_attacks" fill="#dc2626" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-gray-400 text-sm text-center py-12">No attack data yet</p>
                )}
              </div>

              {/* Unique Attackers Per VM */}
              <div className="bg-white border border-gray-200 rounded-xl p-6">
                <h3 className="text-sm font-bold text-gray-700 mb-4">
                  Unique Attackers by VM
                </h3>
                {vmAttackerData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={vmAttackerData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis
                        dataKey="vm_id"
                        tick={{ fill: "#94a3b8", fontSize: 10 }}
                        axisLine={false}
                        interval={0}
                        angle={-30}
                        textAnchor="end"
                        height={60}
                      />
                      <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} />
                      <Tooltip
                        contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "8px", fontSize: "0.8rem" }}
                        formatter={(value) => [value, "Unique IPs"]}
                      />
                      <Bar dataKey="unique_attackers" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-gray-400 text-sm text-center py-12">No attacker data yet</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {/* Attacks by Hour */}
              <div className="bg-white border border-gray-200 rounded-xl p-6">
                <h3 className="text-sm font-bold text-gray-700 mb-4">
                  Attacks by Hour (24h)
                </h3>
                {hourlyData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={hourlyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="hour" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} />
                      <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} />
                      <Tooltip
                        contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "8px", fontSize: "0.8rem" }}
                      />
                      <Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-gray-400 text-sm text-center py-12">No hourly data yet</p>
                )}
              </div>

              {/* Top Attacked Usernames */}
              <div className="bg-white border border-gray-200 rounded-xl p-6">
                <h3 className="text-sm font-bold text-gray-700 mb-4">
                  Top Attacked Usernames
                </h3>
                {usernameData.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie
                          data={usernameData}
                          dataKey="count"
                          nameKey="username"
                          innerRadius={45}
                          outerRadius={75}
                          paddingAngle={3}
                          strokeWidth={0}
                        >
                          {usernameData.map((_, idx) => (
                            <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "8px", fontSize: "0.8rem" }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-wrap gap-3 mt-2">
                      {usernameData.map((u, i) => (
                        <span key={u.username} className="flex items-center gap-1.5 text-xs text-gray-500">
                          <span className="w-2 h-2 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                          {u.username} ({u.count})
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-gray-400 text-sm text-center py-12">No username data yet</p>
                )}
              </div>
            </div>

            {/* Per-VM Stats Table */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <h3 className="p-5 font-bold border-b border-gray-200">
                Per-VM Attack Statistics
              </h3>
              {vmStats.length === 0 ? (
                <div className="p-8 text-center text-gray-400">
                  No VMs registered yet.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      <th className="p-4 text-left">VM ID</th>
                      <th className="p-4 text-left">Hostname</th>
                      <th className="p-4 text-left">Status</th>
                      <th className="p-4 text-right">Total Attacks</th>
                      <th className="p-4 text-right">Unique Attackers</th>
                      <th className="p-4 text-right">Blocked IPs</th>
                      <th className="p-4 text-left">Last Attack</th>
                      <th className="p-4 text-left">Last Seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vmStats.map((vm) => (
                      <tr key={vm.vm_id} className="border-t border-gray-200 hover:bg-gray-50">
                        <td className="p-4 font-mono text-xs">{vm.vm_id}</td>
                        <td className="p-4">{vm.hostname || "\u2014"}</td>
                        <td className="p-4">
                          <span className={`px-2 py-1 rounded text-xs font-bold ${
                            vm.status === "active"
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-100 text-gray-500"
                          }`}>
                            {vm.status}
                          </span>
                        </td>
                        <td className="p-4 text-right font-bold text-red-600">{vm.total_attacks}</td>
                        <td className="p-4 text-right">{vm.unique_attackers}</td>
                        <td className="p-4 text-right">{vm.blocked_count}</td>
                        <td className="p-4 text-xs">{formatTime(vm.last_attack)}</td>
                        <td className="p-4 text-xs">{formatTime(vm.last_seen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default VMStats;
