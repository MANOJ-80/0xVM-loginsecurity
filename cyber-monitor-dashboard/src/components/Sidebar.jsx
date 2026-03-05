import { useNavigate } from "react-router-dom";
import { MdDashboard, MdWarning, MdBlock, MdDns, MdMonitor } from "react-icons/md";

function Sidebar() {

    const navigate = useNavigate();

    return (
        <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">

            <div className="p-6 text-xl font-bold text-red-600">
                CyberSOC
            </div>

            <nav className="flex flex-col gap-2 px-4 text-gray-700">

                <button
                    onClick={() => navigate("/dashboard")}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100"
                >
                    <MdDashboard /> Dashboard
                </button>

                <button
                    onClick={() => navigate("/suspicious")}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100"
                >
                    <MdWarning /> Suspicious IPs
                </button>

                <button
                    onClick={() => navigate("/registry")}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100"
                >
                    <MdBlock /> Blocked IPs
                </button>

                <button
                    onClick={() => navigate("/assets")}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100"
                >
                    <MdDns /> VM Monitoring
                </button>

                <button
                    onClick={() => navigate("/monitor")}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100"
                >
                    <MdMonitor /> Monitor
                </button>

            </nav>

            <div className="mt-auto p-4 border-t border-gray-200">
                <button
                    onClick={() => navigate("/")}
                    className="text-red-600 hover:text-red-700"
                >
                    Logout
                </button>
            </div>

        </aside>
    );
}

export default Sidebar;