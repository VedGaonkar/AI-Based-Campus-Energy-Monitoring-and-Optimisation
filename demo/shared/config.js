// Same-origin HTTPS is recommended. Source previews accept public VITE_PHONE_*
// variables; production builds generate this module from PHONE_API_ORIGIN and
// PHONE_REALTIME_ORIGIN. Never put credentials in browser configuration.
export const BACKEND_ORIGIN = import.meta.env?.VITE_PHONE_API_ORIGIN ?? "";
export const REALTIME_ORIGIN = import.meta.env?.VITE_PHONE_REALTIME_ORIGIN ?? BACKEND_ORIGIN;
