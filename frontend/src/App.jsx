import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ToastProvider } from "./context/ToastContext";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import SuspiciousIps from "./pages/SuspiciousIps";
import BlockedIps from "./pages/BlockedIps";
import VirtualMachines from "./pages/VirtualMachines";
import LiveFeed from "./pages/LiveFeed";

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/suspicious-ips" element={<SuspiciousIps />} />
            <Route path="/blocked-ips" element={<BlockedIps />} />
            <Route path="/vms" element={<VirtualMachines />} />
            <Route path="/live-feed" element={<LiveFeed />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}
