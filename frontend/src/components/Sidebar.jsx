import { NavLink } from "react-router-dom";
import { useEffect, useState } from "react";
import { getHealth } from "../services/api";
import {
  LayoutDashboard,
  ShieldAlert,
  Ban,
  Server,
  Activity,
  Shield,
} from "lucide-react";

export default function Sidebar() {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    const check = () =>
      getHealth()
        .then(setHealth)
        .catch(() => setHealth({ status: "offline", db_connected: false }));
    check();
    const id = setInterval(check, 15000);
    return () => clearInterval(id);
  }, []);

  const navItems = [
    { to: "/", icon: <LayoutDashboard />, label: "Dashboard" },
    { to: "/suspicious-ips", icon: <ShieldAlert />, label: "Suspicious IPs" },
    { to: "/blocked-ips", icon: <Ban />, label: "Blocked IPs" },
    { to: "/vms", icon: <Server />, label: "Virtual Machines" },
    { to: "/live-feed", icon: <Activity />, label: "Live Feed" },
  ];

  const isOnline = health && health.status === "healthy";

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-icon">
          <Shield size={22} color="white" />
        </div>
        <div className="brand-text">
          <h1>0xVM Guard</h1>
          <span>Security Monitor</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section-label">Navigation</div>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="health-indicator">
          <span className={`health-dot ${isOnline ? "" : "offline"}`} />
          <span>
            {isOnline
              ? `Online · ${health?.active_vms ?? 0} VM${health?.active_vms !== 1 ? "s" : ""}`
              : "Backend Offline"}
          </span>
        </div>
      </div>
    </aside>
  );
}
