import { useNavigate, useLocation } from "react-router-dom";
import { MdDashboard, MdWarning, MdBlock, MdDns, MdRssFeed, MdLogout } from "react-icons/md";
import { useAuth } from "../context/AuthContext";

const navItems = [
  { path: "/dashboard", icon: MdDashboard, label: "Dashboard" },
  { path: "/suspicious", icon: MdWarning, label: "Suspicious IPs" },
  { path: "/registry", icon: MdBlock, label: "Blocked IPs" },
  { path: "/assets", icon: MdDns, label: "VM Monitoring" },
  { path: "/live-feed", icon: MdRssFeed, label: "Live Feed" },
];

function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
      <div className="p-6 text-xl font-bold text-red-600">CyberSOC</div>

      <nav className="flex flex-col gap-2 px-4 text-gray-700">
        {navItems.map((item) => {
          const active = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                active
                  ? "bg-red-50 text-red-600 font-semibold"
                  : "hover:bg-gray-100"
              }`}
            >
              <item.icon /> {item.label}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-gray-200">
        {/* User info */}
        {user && (
          <div className="px-4 py-3 text-sm">
            <p className="font-semibold text-gray-800 truncate">{user.username}</p>
            <p className="text-gray-400 text-xs truncate">{user.email}</p>
          </div>
        )}

        <div className="px-4 pb-4">
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-red-600 hover:text-red-700 text-sm font-semibold"
          >
            <MdLogout /> Logout
          </button>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
