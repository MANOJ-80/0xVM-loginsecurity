import { useEffect, useState } from "react";
import Sidebar from "../components/Sidebar";
import API from "../services/api";

function VMAssets() {

    const [vms, setVms] = useState([]);
    const [selectedVM, setSelectedVM] = useState(null);

    const fetchVMs = async () => {

        try {

            const res = await API.get("/vms");

            setVms(res.data);

            setSelectedVM(res.data[0]);

        } catch (err) {

            console.log(err);

        }

    };

    useEffect(() => {
        fetchVMs();
    }, []);

    return (

        <div className="flex h-screen bg-[#f3f4f6] text-gray-900">

            <Sidebar />

            <main className="flex-1 p-8 overflow-y-auto">

                {/* PAGE HEADER */}

                <div className="flex justify-between items-center mb-8">

                    <div>

                        <h1 className="text-3xl font-bold">
                            VM Asset Monitoring
                        </h1>

                        <p className="text-gray-500 text-sm">
                            Centralized view of protected virtual assets
                        </p>

                    </div>

                    <button className="bg-red-600 hover:bg-red-700 text-white px-5 py-2 rounded-lg font-bold">
                        Register New VM
                    </button>

                </div>

                {/* STATS */}

                <div className="grid grid-cols-3 gap-6 mb-8">

                    <Stat title="Total Assets" value="128" />

                    <Stat title="Online Assets" value="122" color="text-green-600" />

                    <Stat title="Detected Incidents (24h)" value="14" color="text-red-600" />

                </div>

                <div className="flex gap-8">

                    {/* VM TABLE */}

                    <div className="flex-1 bg-white rounded-xl border border-gray-200">

                        <h3 className="p-5 font-bold border-b border-gray-200">
                            Active Monitors
                        </h3>

                        <table className="w-full text-sm">

                            <thead className="text-gray-500">

                            <tr>

                                <th className="p-4 text-left">VM ID</th>
                                <th className="p-4 text-left">Hostname</th>
                                <th className="p-4 text-left">IP Address</th>
                                <th className="p-4 text-left">Status</th>
                                <th className="p-4 text-left">Last Seen</th>

                            </tr>

                            </thead>

                            <tbody>

                            {vms.map((vm, i) => (

                                <tr
                                    key={i}
                                    onClick={() => setSelectedVM(vm)}
                                    className="border-t border-gray-200 hover:bg-gray-50 cursor-pointer"
                                >

                                    <td className="p-4 font-mono">
                                        {vm.id}
                                    </td>

                                    <td className="p-4">
                                        {vm.hostname}
                                    </td>

                                    <td className="p-4 font-mono">
                                        {vm.ip}
                                    </td>

                                    <td className="p-4">

                                        {vm.status === "online" ? (

                                            <span className="text-green-600">
                          ● Online
                        </span>

                                        ) : (

                                            <span className="text-gray-500">
                          ● Offline
                        </span>

                                        )}

                                    </td>

                                    <td className="p-4">
                                        {vm.last_seen}
                                    </td>

                                </tr>

                            ))}

                            </tbody>

                        </table>

                    </div>

                    {/* VM DETAILS */}

                    {selectedVM && (

                        <div className="w-96 bg-white border border-gray-200 rounded-xl p-6">

                            <h3 className="text-lg font-bold mb-4">
                                VM Details
                            </h3>

                            <p className="text-gray-500 mb-4">
                                {selectedVM.hostname}
                            </p>

                            <div className="grid grid-cols-2 gap-4 mb-6">

                                <Stat title="Total Attacks" value={selectedVM.attacks} />

                                <Stat title="Unique Attackers" value={selectedVM.attackers} />

                            </div>

                            {/* TOP USERS */}

                            <div className="mb-6">

                                <h4 className="text-sm text-gray-500 mb-3">
                                    Top Attacked Users
                                </h4>

                                {selectedVM.users?.map((u, i) => (

                                    <div key={i} className="flex justify-between mb-2">

                                        <span className="font-mono">{u.name}</span>

                                        <span>{u.count}</span>

                                    </div>

                                ))}

                            </div>

                            {/* ATTACKER IPS */}

                            <div>

                                <h4 className="text-sm text-gray-500 mb-3">
                                    Top Attacker IPs
                                </h4>

                                {selectedVM.attack_ips?.map((ip, i) => (

                                    <div
                                        key={i}
                                        className="flex justify-between bg-gray-100 p-2 rounded mb-2"
                                    >

                                        <span className="font-mono">{ip.ip}</span>

                                        <span className="text-gray-500">
                      {ip.hits} hits
                    </span>

                                    </div>

                                ))}

                            </div>

                        </div>

                    )}

                </div>

            </main>

        </div>

    );

}

export default VMAssets;



function Stat({ title, value, color = "" }) {

    return (

        <div className="bg-white border border-gray-200 p-6 rounded-xl">

            <p className="text-xs text-gray-500">
                {title}
            </p>

            <h3 className={`text-2xl font-bold ${color}`}>
                {value}
            </h3>

        </div>

    );

}