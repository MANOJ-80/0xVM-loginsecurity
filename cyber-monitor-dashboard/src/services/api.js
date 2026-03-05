import axios from "axios";

const API = axios.create({
    baseURL: "http://localhost:3000/api/v1",
});

export const getStatistics = () => API.get("/statistics/global");
export const getFeed = () => API.get("/feed");
export const getSuspiciousIps = () => API.get("/suspicious-ips");
export const getBlockedIps = () => API.get("/blocked-ips");
export const getVMs = () => API.get("/vms");

export default API;