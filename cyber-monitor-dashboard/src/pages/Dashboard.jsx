import { useEffect, useState } from "react";
import Sidebar from "../components/Sidebar";
import StatCard from "../components/StatCard";
import AttackFeed from "../components/AttackFeed";

import { getStatistics, getFeed } from "../services/api";

function Dashboard() {

    const [stats, setStats] = useState({});
    const [logs, setLogs] = useState([]);

    useEffect(() => {

        async function loadData() {

            try {

                const statRes = await getStatistics();
                const feedRes = await getFeed();

                setStats(statRes.data);
                setLogs(feedRes.data);

            } catch (err) {

                console.log(err);

            }

        }

        loadData();

    }, []);

    return (

        <div className="flex h-screen bg-[#f3f4f6] text-gray-900">

            <Sidebar />

            <main className="flex-1 p-8 overflow-y-auto">

                {/* Stats */}

                <div className="grid grid-cols-5 gap-4 mb-8">

                    <StatCard
                        title="Total Failed Attempts"
                        value={stats.failed_attempts}
                    />

                    <StatCard
                        title="Unique Attackers"
                        value={stats.unique_attackers}
                    />

                    <StatCard
                        title="Blocked IPs"
                        value={stats.blocked_ips}
                    />

                    <StatCard
                        title="Active VMs"
                        value={stats.active_vms}
                    />

                    <StatCard
                        title="Attacks Last Hour"
                        value={stats.last_hour}
                    />

                </div>

                {/* Attack Feed */}

                <AttackFeed logs={logs} />

            </main>

        </div>

    );
}

export default Dashboard;