import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { MdSecurity, MdEmail, MdLock, MdLogin } from "react-icons/md";
import { useAuth } from "../context/AuthContext";
import { loginUser } from "../services/api";

function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("Email and password are required");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await loginUser(email, password);
      if (data.success && data.token) {
        login(data); // stores token + user in context
        navigate("/dashboard");
      } else {
        setError(data.message || "Login failed");
      }
    } catch (err) {
      const msg =
        err.response?.data?.message || "Invalid email or password";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#f3f4f6] text-gray-900 flex flex-col">
      {/* Header */}
      <header className="flex justify-between items-center px-10 py-4 border-b border-gray-200">
        <div className="flex items-center gap-2 text-red-600 font-bold text-xl">
          <MdSecurity size={28} />
          CyberSOC
        </div>

        <div className="flex gap-6 text-sm text-gray-500">
          <a href="#">System Status</a>
          <a href="#">Documentation</a>
          <a href="#">Support</a>
        </div>
      </header>

      {/* Main */}
      <main className="flex flex-1 items-center justify-between px-20">
        <div className="grid lg:grid-cols-2 gap-12 w-full px-10">
          {/* Left Panel */}
          <div className="hidden lg:flex flex-col justify-center">
            <div className="bg-red-50 border border-red-200 rounded-xl p-8">
              <div className="bg-red-600 text-white p-4 rounded-xl w-fit mb-6">
                <MdSecurity size={36} />
              </div>

              <h1 className="text-4xl font-bold mb-4">
                Enterprise Grade Security Operations
              </h1>

              <p className="text-gray-500">
                Access advanced threat detection and incident response platform
                with real-time monitoring.
              </p>

              <div className="grid grid-cols-2 gap-4 mt-10">
                <div className="bg-white border border-gray-200 p-4 rounded-lg">
                  <p className="text-sm font-bold">Threat Matrix</p>
                  <p className="text-xs text-gray-500">Live feed active</p>
                </div>

                <div className="bg-white border border-gray-200 p-4 rounded-lg">
                  <p className="text-sm font-bold">Server Health</p>
                  <p className="text-xs text-gray-500">99.9% uptime</p>
                </div>
              </div>
            </div>
          </div>

          {/* Login Card */}
          <div className="bg-white p-8 rounded-xl border border-gray-200 shadow-xl w-full max-w-md mx-auto">
            <h2 className="text-2xl font-bold mb-2">Secure Portal Login</h2>
            <p className="text-gray-500 mb-6">
              Enter your credentials to access the SOC
            </p>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg mb-4 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Email */}
              <div>
                <label className="text-sm text-gray-700">Email</label>
                <div className="flex items-center bg-gray-100 border border-gray-300 rounded-lg px-3 mt-1 focus-within:border-red-600">
                  <MdEmail className="text-gray-500" />
                  <input
                    type="email"
                    placeholder="name@company.com"
                    className="bg-transparent text-gray-900 placeholder-gray-400 p-3 outline-none w-full"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label className="text-sm text-gray-700">Password</label>
                <div className="flex items-center bg-gray-100 border border-gray-300 rounded-lg px-3 mt-1 focus-within:border-red-600">
                  <MdLock className="text-gray-500" />
                  <input
                    type="password"
                    placeholder="••••••••"
                    className="bg-transparent text-gray-900 placeholder-gray-400 p-3 outline-none w-full"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>

              {/* Remember */}
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <input type="checkbox" />
                Remember this device
              </div>

              {/* Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-red-600 hover:bg-red-700 disabled:bg-red-400 transition py-3 rounded-lg font-bold text-white flex justify-center items-center gap-2"
              >
                {loading ? "Signing in..." : "Sign In"}
                {!loading && <MdLogin />}
              </button>
            </form>

            <p className="text-sm text-gray-500 text-center mt-6">
              Need access?{" "}
              <span className="text-red-600 cursor-pointer">
                Contact Admin
              </span>
              <button
                onClick={() => navigate("/register")}
                className="text-red-600 font-bold ml-1"
              >
                Register
              </button>
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="text-xs text-gray-500 text-center py-6 border-t border-gray-200"></footer>
    </div>
  );
}

export default Login;
