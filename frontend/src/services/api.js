const API_BASE =
  import.meta.env.VITE_API_BASE || "http://localhost:3000/api/v1";

async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || err.error || "Request failed");
  }
  return res.json();
}

// ---- Health ----
export const getHealth = () => request("/health");

// ---- Statistics ----
export const getStatistics = () => request("/statistics");
export const getGlobalStatistics = () => request("/statistics/global");

// ---- Suspicious IPs ----
export const getSuspiciousIps = (threshold = 5) =>
  request(`/suspicious-ips?threshold=${threshold}`);

// ---- Blocked IPs ----
export const getBlockedIps = () => request("/blocked-ips");
export const blockIp = (ipAddress, reason, durationMinutes = 120) =>
  request("/block", {
    method: "POST",
    body: JSON.stringify({
      ip_address: ipAddress,
      reason,
      duration_minutes: durationMinutes,
    }),
  });
export const blockIpPerVm = (ipAddress, vmId, reason, durationMinutes = 120) =>
  request("/block/per-vm", {
    method: "POST",
    body: JSON.stringify({
      ip_address: ipAddress,
      vm_id: vmId,
      reason,
      duration_minutes: durationMinutes,
    }),
  });
export const unblockIp = (ip) => request(`/block/${ip}`, { method: "DELETE" });

// ---- VMs ----
export const listVms = () => request("/vms");
export const registerVm = (
  vmId,
  hostname,
  ipAddress,
  collectionMethod = "agent",
) =>
  request("/vms", {
    method: "POST",
    body: JSON.stringify({
      vm_id: vmId,
      hostname,
      ip_address: ipAddress,
      collection_method: collectionMethod,
    }),
  });
export const deleteVm = (vmId) => request(`/vms/${vmId}`, { method: "DELETE" });
export const getVmAttacks = (vmId) => request(`/vms/${vmId}/attacks`);

// ---- Geo ----
export const getGeoAttacks = () => request("/geo-attacks");

// ---- SSE Feed ----
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
