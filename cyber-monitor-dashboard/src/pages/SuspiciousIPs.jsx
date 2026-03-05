import { useEffect, useState } from "react";
import Sidebar from "../components/Sidebar";
import API from "../services/api";

function SuspiciousIPs() {

    const [ips, setIps] = useState([]);

    const fetchIps = async () => {
        try {
            const res = await API.get("/suspicious-ips");
            setIps(res.data);
        } catch (err) {
            console.log(err);
        }
    };

    useEffect(() => {
        fetchIps();
    }, []);

    const blockIp = async (ip) => {

        try {

            await API.post("/block-ip", { ip });

            alert("IP Blocked");

            fetchIps();

        } catch (err) {

            console.log(err);

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
                        placeholder="Search IP, subnet, username..."
                        className="bg-white border border-gray-300 rounded-lg px-4 py-2 w-96"
                    />

                    <button className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg">
                        Export
                    </button>

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

                            <th className="p-4 text-left">Target Users</th>

                            <th className="p-4 text-right">Action</th>

                        </tr>

                        </thead>

                        <tbody>

                        {ips.map((ip, index) => (

                            <tr
                                key={index}
                                className="border-t border-gray-200 hover:bg-gray-50"
                            >

                                <td className="p-4 font-mono text-red-600">
                                    {ip.ip}
                                </td>

                                <td className="p-4 text-red-600 font-bold">
                                    {ip.failed_attempts}
                                </td>

                                <td className="p-4">
                                    {ip.first_attempt}
                                </td>

                                <td className="p-4">
                                    {ip.last_attempt}
                                </td>

                                <td className="p-4">

                                    <div className="flex flex-wrap gap-2">

                                        {ip.users?.map((user, i) => (

                                            <span
                                                key={i}
                                                className="bg-gray-200 px-2 py-1 text-xs rounded"
                                            >
                                                {user}
                                            </span>

                                        ))}

                                    </div>

                                </td>

                                <td className="p-4 text-right">

                                    <button
                                        onClick={() => blockIp(ip.ip)}
                                        className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg text-xs font-bold text-white"
                                    >
                                        Block IP
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

export default SuspiciousIPs;