import { useEffect, useState } from "react";
import Sidebar from "../components/Sidebar";
import API from "../services/api";

function BlockedIPs() {

    const [ips, setIps] = useState([]);

    const fetchBlockedIps = async () => {
        try {
            const res = await API.get("/blocked-ips");
            setIps(res.data);
        } catch (err) {
            console.log(err);
        }
    };

    useEffect(() => {
        fetchBlockedIps();
    }, []);

    const unblockIP = async (ip) => {

        try {

            await API.post("/unblock-ip", { ip });

            alert("IP Unblocked");

            fetchBlockedIps();

        } catch (err) {

            console.log(err);

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

                    <button className="bg-red-600 hover:bg-red-700 px-5 py-2 rounded text-white font-bold">
                        Manual Block
                    </button>

                </div>

                {/* STATS */}

                <div className="grid grid-cols-4 gap-6 mb-8">

                    <Stat title="Currently Blocked" value="856" change="+5.2%" />

                    <Stat title="Automated Actions" value="1,284" change="+12%" />

                    <Stat title="Failed Logins (24h)" value="42.8k" change="+28%" />

                    <Stat title="Avg Mitigation Time" value="142ms" change="-4ms" />

                </div>

                {/* TABLE */}

                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">

                    <table className="w-full text-sm">

                        <thead className="bg-gray-50 text-gray-500">

                        <tr>

                            <th className="p-5 text-left">IP Address</th>
                            <th className="p-5 text-left">Blocked Time</th>
                            <th className="p-5 text-left">Expiry</th>
                            <th className="p-5 text-left">Threat Type</th>
                            <th className="p-5 text-right">Action</th>

                        </tr>

                        </thead>

                        <tbody>

                        {ips.map((ip, index) => (

                            <tr
                                key={index}
                                className="border-t border-gray-200 hover:bg-gray-50"
                            >

                                <td className="p-5 font-mono text-red-600">
                                    {ip.ip}
                                </td>

                                <td className="p-5">
                                    {ip.blocked_time}
                                </td>

                                <td className="p-5">

                                    {ip.expiry === "permanent" ? (

                                        <span className="text-red-600 font-bold">
                        Permanent
                      </span>

                                    ) : (

                                        ip.expiry

                                    )}

                                </td>

                                <td className="p-5">

                    <span className="bg-red-100 text-red-600 px-2 py-1 rounded text-xs">
                      {ip.reason}
                    </span>

                                </td>

                                <td className="p-5 text-right">

                                    <button
                                        onClick={() => unblockIP(ip.ip)}
                                        className="border border-gray-300 px-4 py-1 rounded hover:bg-red-600 hover:text-white"
                                    >
                                        Unblock
                                    </button>

                                </td>

                            </tr>

                        ))}

                        </tbody>

                    </table>

                </div>

            </main>

        </div>

    );

}

export default BlockedIPs;



function Stat({ title, value, change }) {

    return (

        <div className="bg-white border border-gray-200 p-6 rounded-xl">

            <p className="text-xs text-gray-500 uppercase">
                {title}
            </p>

            <div className="flex items-end gap-3">

                <h3 className="text-2xl font-bold text-gray-900">
                    {value}
                </h3>

                <span className="text-red-600 text-sm">
                    {change}
                </span>

            </div>

        </div>

    );

}