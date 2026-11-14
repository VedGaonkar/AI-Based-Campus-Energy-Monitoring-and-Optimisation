import { deploymentOrigin } from "../../../shared/deployment-origins.js";
const environment = import.meta.env ?? {};
export const API_ORIGIN = deploymentOrigin(environment.VITE_API_ORIGIN, { optional: true, production: environment.PROD, label: "VITE_API_ORIGIN" });
export const REALTIME_ORIGIN = deploymentOrigin(environment.VITE_REALTIME_ORIGIN || API_ORIGIN, { optional: true, production: environment.PROD, label: "VITE_REALTIME_ORIGIN" });
export const apiUrl = path => `${API_ORIGIN}/api/v1${path}`;
export const backendUrl = path => `${API_ORIGIN}${path}`;
