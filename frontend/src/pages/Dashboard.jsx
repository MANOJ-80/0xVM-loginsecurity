import { useEffect, useState, useCallback } from "react";
import {
  ShieldAlert,
  Ban,
  Server,
  Activity,
  AlertTriangle,
  TrendingUp,
  Clock,
  Users,
} from "lucide-react";
import {
  getStatistics,
  getSuspiciousIps,
  subscribeToFeed,
} from "../services/api";
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
  "#991b1b",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#6366f1",
  "#06b6d4",
];

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [suspiciousIps, setSuspiciousIps] = useState([]);
  const [recentAttacks, setRecentAttacks] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [statsRes, ipsRes] = await Promise.all([
        getStatistics(),
        getSuspiciousIps(3),
      ]);
      setStats(statsRes.data);
      setSuspiciousIps(ipsRes.data?.slice(0, 5) || []);
    } catch (err) {
      console.error("Dashboard fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 30000);
    return () => clearInterval(id);
  }, [fetchData]);

  useEffect(() => {
    const source = subscribeToFeed((event) => {
      setRecentAttacks((prev) => [event, ...prev].slice(0, 20));
    });
    return () => source.close();
  }, []);

  if (loading) {
    return (
      <>
        <div className="page-header">
          <h2>Security Dashboard</h2>
          <p>Real-time overview of your network security posture</p>
        </div>
        <div className="page-body">
          <div className="loading-center">
            <div className="spinner" />
          </div>
        </div>
      </>
    );
  }

  const statCards = [
    {
      label: "Total Failed Attempts",
      value: stats?.total_failed_attempts ?? 0,
      subtitle: "All time",
      icon: <AlertTriangle size={20} />,
      variant: "danger",
    },
    {
      label: "Unique Attackers",
      value: stats?.unique_attackers ?? 0,
      subtitle: "Distinct IPs",
      icon: <Users size={20} />,
      variant: "warning",
    },
    {
      label: "Blocked IPs",
      value: stats?.blocked_ips ?? 0,
      subtitle: "Currently blocked",
      icon: <Ban size={20} />,
      variant: "accent",
    },
    {
      label: "Last 24 Hours",
      value: stats?.attacks_last_24h ?? 0,
      subtitle: `${stats?.attacks_last_hour ?? 0} in last hour`,
      icon: <Clock size={20} />,
      variant: "info",
    },
  ];

  const usernameData = (stats?.top_attacked_usernames || []).slice(0, 6);
  const hourlyData = (stats?.attacks_by_hour || []).slice(-12);

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: "10px",
            padding: "10px 14px",
            fontSize: "0.8rem",
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          }}
        >
          <p style={{ color: "#111827", fontWeight: 600 }}>{label}</p>
          <p style={{ color: "#dc2626" }}>{payload[0].value} attempts</p>
        </div>
      );
    }
    return null;
  };

  return (
    <>
      <div className="page-header">
        <h2>Security Dashboard</h2>
        <p>Real-time overview of your network security posture</p>
      </div>
      <div className="page-body">
        {/* Stat Cards */}
        <div className="stats-grid">
          {statCards.map((s) => (
            <div key={s.label} className={`card stat-card ${s.variant}`}>
              <div className="card-icon">{s.icon}</div>
              <div className="card-title">{s.label}</div>
              <div className="card-value">{s.value.toLocaleString()}</div>
              <div className="card-subtitle">{s.subtitle}</div>
            </div>
          ))}
        </div>

        {/* Charts */}
        <div className="charts-grid">
          {/* Attacks by Hour */}
          <div className="card chart-card">
            <div className="card-title">
              <TrendingUp size={14} /> Attacks by Hour
            </div>
            {hourlyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={hourlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis
                    dataKey="hour"
                    tick={{ fill: "#9ca3af", fontSize: 11 }}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fill: "#9ca3af", fontSize: 11 }}
                    axisLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar
                    dataKey="count"
                    fill="url(#barGrad)"
                    radius={[6, 6, 0, 0]}
                  />
                  <defs>
                    <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#dc2626" />
                      <stop offset="100%" stopColor="#991b1b" />
                    </linearGradient>
                  </defs>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state">
                <Activity />
                <p>No hourly data yet</p>
              </div>
            )}
          </div>

          {/* Top Attacked Usernames */}
          <div className="card chart-card">
            <div className="card-title">
              <ShieldAlert size={14} /> Top Attacked Usernames
            </div>
            {usernameData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={usernameData}
                    dataKey="count"
                    nameKey="username"
                    innerRadius={55}
                    outerRadius={90}
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
                      background: "#ffffff",
                      border: "1px solid #e5e7eb",
                      borderRadius: "10px",
                      fontSize: "0.8rem",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                    }}
                    itemStyle={{ color: "#111827" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state">
                <Users />
                <p>No username data yet</p>
              </div>
            )}
            {usernameData.length > 0 && (
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  flexWrap: "wrap",
                  marginTop: 8,
                }}
              >
                {usernameData.map((u, i) => (
                  <span
                    key={u.username}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: "0.75rem",
                      color: "#6b7280",
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: CHART_COLORS[i % CHART_COLORS.length],
                      }}
                    />
                    {u.username} ({u.count})
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Two-column bottom: Suspicious IPs + Live Feed */}
        <div className="charts-grid">
          {/* Top Suspicious IPs */}
          <div className="card">
            <div className="card-title">
              <ShieldAlert size={14} /> Top Suspicious IPs
            </div>
            {suspiciousIps.length > 0 ? (
              <div className="table-wrapper" style={{ border: "none" }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>IP Address</th>
                      <th>Attempts</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suspiciousIps.map((ip) => (
                      <tr key={ip.ip_address}>
                        <td
                          style={{
                            fontFamily: "monospace",
                            color: "var(--text-primary)",
                          }}
                        >
                          {ip.ip_address}
                        </td>
                        <td>
                          <span
                            style={{
                              fontWeight: 700,
                              color:
                                ip.failed_attempts > 10
                                  ? "var(--danger)"
                                  : "var(--warning)",
                            }}
                          >
                            {ip.failed_attempts}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${ip.status}`}>
                            {ip.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                <ShieldAlert />
                <p>No suspicious IPs detected</p>
              </div>
            )}
          </div>

          {/* Live Feed */}
          <div className="card">
            <div className="card-title">
              <Activity size={14} /> Live Attack Feed
            </div>
            {recentAttacks.length > 0 ? (
              <div className="feed-container">
                {recentAttacks.map((atk, i) => (
                  <div
                    key={`${atk.ip_address}-${atk.timestamp}-${i}`}
                    className="feed-item"
                  >
                    <div className="feed-dot" />
                    <div className="feed-info">
                      <div className="feed-ip">{atk.ip_address}</div>
                      <div className="feed-meta">
                        <span>👤 {atk.username || "unknown"}</span>
                        {atk.vm_id && <span>🖥️ {atk.vm_id}</span>}
                        {atk.timestamp && (
                          <span>
                            🕐 {new Date(atk.timestamp).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state" style={{ padding: "40px 20px" }}>
                <Activity />
                <p>Waiting for live events…</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
