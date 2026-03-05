import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import SuspiciousIPs from "./pages/SuspiciousIPs";
import BlockedIPs from "./pages/BlockedIPs";
import VMAssets from "./pages/VMAssets";
function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/suspicious" element={<SuspiciousIPs />} />
                <Route path="/registry" element={<BlockedIPs />} />
                <Route path="/assets" element={<VMAssets />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;