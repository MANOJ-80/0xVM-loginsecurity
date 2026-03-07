import { useEffect, useState, useCallback } from "react";
import Sidebar from "../components/Sidebar";
import StatCard from "../components/StatCard";
import AttackFeed from "../components/AttackFeed";
import { getGlobalStatistics, subscribeToFeed } from "../services/api";
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
];

function Dashboard() {
  const [stats, setStats] = useState({});
  const [recentAttacks, setRecentAttacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const data = await getGlobalStatistics();
      setStats(data);
    } catch (err) {
      console.error("Dashboard fetch failed:", err);
      setError("Failed to load dashboard data. Retrying in 30s...");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + auto-refresh every 30s
  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 30000);
    return () => clearInterval(id);
  }, [fetchData]);

  // SSE subscription for live feed
  useEffect(() => {
    const source = subscribeToFeed((event) => {
      setRecentAttacks((prev) => [event, ...prev].slice(0, 30));
    });
    return () => source.close();
  }, []);

  const usernameData = (stats.top_attacked_usernames || []).slice(0, 6);
  const hourlyData = stats.attacks_by_hour || [];
  const vmData = stats.attacks_by_vm || [];

  return (
    <div className="flex h-screen bg-[#f3f4f6] text-gray-900">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-gray-400">Loading dashboard...</div>
          </div>
        ) : (
          <>
            {/* Error Banner */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl mb-6 text-sm flex justify-between items-center">
                <span>{error}</span>
                <button
                  onClick={() => { setError(null); fetchData(); }}
                  className="text-red-600 hover:text-red-800 font-bold ml-4 text-xs"
                >
                  Retry Now
                </button>
              </div>
            )}

            {/* Stats Row 1 */}
            <div className="grid grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
              <StatCard
                title="Total Failed Attempts"
                value={stats.total_failed_attempts}
              />
              <StatCard
                title="Unique Attackers"
                value={stats.unique_attackers}
              />
              <StatCard title="Blocked IPs" value={stats.blocked_ips} />
              <StatCard title="Active VMs" value={stats.active_vms} color="text-green-600" />
              <StatCard title="Inactive VMs" value={stats.inactive_vms} color="text-gray-400" />
              <StatCard
                title="Attacks (24h)"
                value={stats.attacks_last_24h}
                color="text-red-600"
              />
            </div>

            {/* Stats Row 2 — smaller accent stat */}
            <div className="grid grid-cols-1 gap-4 mb-8">
              <StatCard
                title="Attacks Last Hour"
                value={stats.attacks_last_hour}
              />
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-2 gap-6 mb-8">
              {/* Attacks by Hour */}
              <div className="bg-white border border-gray-200 rounded-xl p-6">
                <h3 className="text-sm font-bold text-gray-700 mb-4">
                  Attacks by Hour (24h)
                </h3>
                {hourlyData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={hourlyData}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#f1f5f9"
                      />
                      <XAxis
                        dataKey="hour"
                        tick={{ fill: "#94a3b8", fontSize: 11 }}
                        axisLine={false}
                      />
                      <YAxis
                        tick={{ fill: "#94a3b8", fontSize: 11 }}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "#fff",
                          border: "1px solid #e2e8f0",
                          borderRadius: "8px",
                          fontSize: "0.8rem",
                        }}
                      />
                      <Bar
                        dataKey="count"
                        fill="#dc2626"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-gray-400 text-sm text-center py-12">
                    No hourly data yet
                  </p>
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
                            <Cell
                              key={idx}
                              fill={CHART_COLORS[idx % CHART_COLORS.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            background: "#fff",
                            border: "1px solid #e2e8f0",
                            borderRadius: "8px",
                            fontSize: "0.8rem",
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-wrap gap-3 mt-2">
                      {usernameData.map((u, i) => (
                        <span
                          key={u.username}
                          className="flex items-center gap-1.5 text-xs text-gray-500"
                        >
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{
                              background:
                                CHART_COLORS[i % CHART_COLORS.length],
                            }}
                          />
                          {u.username} ({u.count})
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-gray-400 text-sm text-center py-12">
                    No username data yet
                  </p>
                )}
              </div>
            </div>

            {/* Attacks by VM Chart */}
            {vmData.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-xl p-6 mb-8">
                <h3 className="text-sm font-bold text-gray-700 mb-4">
                  Attacks by VM
                </h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={vmData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#f1f5f9"
                    />
                    <XAxis
                      dataKey="vm_id"
                      tick={{ fill: "#94a3b8", fontSize: 11 }}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fill: "#94a3b8", fontSize: 11 }}
                      axisLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#fff",
                        border: "1px solid #e2e8f0",
                        borderRadius: "8px",
                        fontSize: "0.8rem",
                      }}
                    />
                    <Bar
                      dataKey="count"
                      fill="#6366f1"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Attack Feed */}
            <AttackFeed logs={recentAttacks} />
          </>
        )}
      </main>
    </div>
  );
}

export default Dashboard;
