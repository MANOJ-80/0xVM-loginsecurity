import axios from "axios";

const API_BASE =
  import.meta.env.VITE_API_BASE || "http://localhost:3000/api/v1";

const API = axios.create({
  baseURL: API_BASE,
});

// ---- Axios interceptor: attach JWT token to every request ----
API.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ---- Axios interceptor: handle 401 responses (token expired / invalid) ----
API.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      // Clear stale token and redirect to login
      localStorage.removeItem("token");
      if (window.location.pathname !== "/" && window.location.pathname !== "/register") {
        window.location.href = "/";
      }
    }
    return Promise.reject(error);
  }
);

// ---- Helper: unwrap { success, data } envelope ----
// Backend returns { success: true, data: [...], count: N }
// Axios already unwraps HTTP body into res.data, so the actual
// payload is at res.data.data for list endpoints.
function unwrap(res) {
  // If the response has a `data` field inside, return that
  if (res.data && typeof res.data === "object" && "data" in res.data) {
    return res.data.data;
  }
  return res.data;
}

// ---- Auth ----
export const loginUser = (email, password) =>
  API.post("/auth/login", { email, password }).then((res) => res.data);

export const registerUser = (username, email, password) =>
  API.post("/auth/register", { username, email, password }).then((res) => res.data);

// getCurrentUser uses a supplied token (for initial validation on page load)
export const getCurrentUser = (token) =>
  axios
    .get(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    .then((res) => res.data);

// ---- Statistics ----
export const getGlobalStatistics = () =>
  API.get("/statistics/global").then(unwrap);

export const getStatistics = () =>
  API.get("/statistics").then(unwrap);

// ---- Suspicious IPs ----
export const getSuspiciousIps = (threshold = 5) =>
  API.get(`/suspicious-ips?threshold=${threshold}`).then(unwrap);

// ---- Blocked IPs ----
export const getBlockedIps = () =>
  API.get("/blocked-ips").then(unwrap);

export const blockIp = (ipAddress, reason = "Manual block", durationMinutes = 120) =>
  API.post("/block", {
    ip_address: ipAddress,
    reason,
    duration_minutes: durationMinutes,
  });

export const blockIpPerVm = (ipAddress, vmId, reason = "Manual block", durationMinutes = 120) =>
  API.post("/block/per-vm", {
    ip_address: ipAddress,
    vm_id: vmId,
    reason,
    duration_minutes: durationMinutes,
  });

export const unblockIp = (ip) =>
  API.delete(`/block/${encodeURIComponent(ip)}`);

// ---- VMs ----
export const getVMs = () =>
  API.get("/vms").then(unwrap);

export const getVmAttacks = (vmId) =>
  API.get(`/vms/${encodeURIComponent(vmId)}/attacks`).then((res) => res.data);

export const registerVm = (vmId, hostname, ipAddress, collectionMethod = "agent") =>
  API.post("/vms", {
    vm_id: vmId,
    hostname,
    ip_address: ipAddress,
    collection_method: collectionMethod,
  });

export const deleteVm = (vmId) =>
  API.delete(`/vms/${encodeURIComponent(vmId)}`);

// ---- Health ----
export const getHealth = () =>
  API.get("/health").then((res) => res.data);

// ---- SSE Feed ----
// Uses native EventSource (NOT axios) — SSE is a streaming protocol.
// SSE /feed is [AllowAnonymous] on the backend so no token needed.
export function subscribeToFeed(onEvent, onError) {
  const source = new EventSource(`${API_BASE}/feed`);

  source.addEventListener("new_attack", (e) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch {
      /* ignore parse errors */
    }
  });

  source.onerror = (e) => {
    if (onError) onError(e);
  };

  return source; // caller should call source.close() on cleanup
}

export default API;
