import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { MdSecurity, MdPerson, MdEmail, MdLock } from "react-icons/md";
import { useAuth } from "../context/AuthContext";
import { registerUser } from "../services/api";

function Register() {
  const navigate = useNavigate();
  const { login, isAuthenticated, loading: authLoading } = useAuth();

  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    confirm: "",
  });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // Redirect authenticated users to dashboard
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate("/dashboard", { replace: true });
    }
  }, [authLoading, isAuthenticated, navigate]);

  const handleChange = (e) => {
    setForm({
      ...form,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!form.username.trim() || !form.email.trim() || !form.password.trim()) {
      setError("All fields are required");
      return;
    }

    if (form.password !== form.confirm) {
      setError("Passwords do not match");
      return;
    }

    if (form.password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setLoading(true);

    try {
      const data = await registerUser(form.username, form.email, form.password);
      if (data.success && data.token) {
        login(data); // stores token + user in context
        navigate("/dashboard");
      } else {
        setError(data.message || "Registration failed");
      }
    } catch (err) {
      const msg =
        err.response?.data?.message || "Registration failed. Please try again.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col bg-[#f3f4f6] text-gray-900">
      {/* HEADER */}
      <header className="flex justify-between items-center px-10 py-4 border-b border-gray-200">
        <div className="flex items-center gap-2 text-red-600 text-xl font-bold">
          <MdSecurity size={26} />
          CyberSOC
        </div>

        <nav className="flex gap-8 text-sm text-gray-600">
          <button
            onClick={() => navigate("/")}
            className="bg-red-600 hover:bg-red-700 text-white px-5 py-2 rounded-full font-bold"
          >
            Log In
          </button>
        </nav>
      </header>

      {/* MAIN */}
      <main className="flex flex-1 items-center justify-center w-full px-6 relative overflow-hidden">
        <div className="bg-white border border-gray-200 rounded-xl p-10 w-full max-w-md shadow-xl">
          <div className="text-center mb-8">
            <div className="bg-red-100 p-3 rounded-full w-fit mx-auto mb-4">
              <MdSecurity className="text-red-600 text-3xl" />
            </div>

            <h2 className="text-3xl font-bold">Create Account</h2>

            <p className="text-gray-500 text-sm mt-2">
              Initialize your secure SOC management profile
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg mb-4 text-sm">
              {error}
            </div>
          )}

          {/* FORM */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* USERNAME */}
            <div>
              <label className="text-sm text-gray-700">Username</label>
              <div className="flex items-center bg-white border border-gray-300 rounded-lg px-3 mt-1 focus-within:border-red-600">
                <MdPerson className="text-gray-500" />
                <input
                  name="username"
                  value={form.username}
                  onChange={handleChange}
                  type="text"
                  placeholder="sys_admin_01"
                  className="bg-transparent text-gray-900 placeholder-gray-400 p-3 outline-none w-full"
                  disabled={loading}
                />
              </div>
            </div>

            {/* EMAIL */}
            <div>
              <label className="text-sm text-gray-700">Work Email</label>
              <div className="flex items-center bg-white border border-gray-300 rounded-lg px-3 mt-1 focus-within:border-red-600">
                <MdEmail className="text-gray-500" />
                <input
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                  type="email"
                  placeholder="admin@security.agency"
                  className="bg-transparent text-gray-900 placeholder-gray-400 p-3 outline-none w-full"
                  disabled={loading}
                />
              </div>
            </div>

            {/* PASSWORD ROW */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-gray-700">Password</label>
                <div className="flex items-center bg-white border border-gray-300 rounded-lg px-3 mt-1 focus-within:border-red-600">
                  <MdLock className="text-gray-500" />
                  <input
                    name="password"
                    value={form.password}
                    onChange={handleChange}
                    type="password"
                    className="bg-transparent text-gray-900 placeholder-gray-400 p-3 outline-none w-full"
                    disabled={loading}
                  />
                </div>
              </div>

              <div>
                <label className="text-sm text-gray-700">Confirm</label>
                <div className="flex items-center bg-white border border-gray-300 rounded-lg px-3 mt-1 focus-within:border-red-600">
                  <MdLock className="text-gray-500" />
                  <input
                    name="confirm"
                    value={form.confirm}
                    onChange={handleChange}
                    type="password"
                    className="bg-transparent text-gray-900 placeholder-gray-400 p-3 outline-none w-full"
                    disabled={loading}
                  />
                </div>
              </div>
            </div>

            {/* REGISTER BUTTON */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-bold py-3 rounded-lg transition"
            >
              {loading ? "Registering..." : "Complete Registration"}
            </button>
          </form>

          {/* LOGIN LINK */}
          <p className="text-center text-sm text-gray-500 mt-6">
            Already have an account?
            <button
              onClick={() => navigate("/")}
              className="text-red-600 ml-1 font-bold"
            >
              Log in here
            </button>
          </p>
        </div>
      </main>

      {/* FOOTER */}
      <footer className="text-xs text-gray-500 text-center py-6 border-t border-gray-200">
        <div className="flex justify-center gap-6 mb-2">
          <span>Privacy Policy</span>
          <span>Terms of Service</span>
          <span>Security Standards</span>
        </div>
        <p>&copy; 2026 CyberSOC Intelligent Infrastructure</p>
      </footer>
    </div>
  );
}

export default Register;
