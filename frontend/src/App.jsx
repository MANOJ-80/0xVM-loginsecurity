import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import SuspiciousIPs from "./pages/SuspiciousIPs";
import BlockedIPs from "./pages/BlockedIPs";
import VMAssets from "./pages/VMAssets";
import LiveFeed from "./pages/LiveFeed";

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* Protected routes */}
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/suspicious" element={<ProtectedRoute><SuspiciousIPs /></ProtectedRoute>} />
          <Route path="/registry" element={<ProtectedRoute><BlockedIPs /></ProtectedRoute>} />
          <Route path="/assets" element={<ProtectedRoute><VMAssets /></ProtectedRoute>} />
          <Route path="/live-feed" element={<ProtectedRoute><LiveFeed /></ProtectedRoute>} />

          {/* 404 catch-all */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
