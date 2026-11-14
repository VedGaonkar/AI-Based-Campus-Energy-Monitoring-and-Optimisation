import { apiUrl } from "./origins.js";
let csrfToken;
export async function api(path, { method = "GET", body, signal } = {}) {
  if (method !== "GET" && !csrfToken) {
    const csrf = await api("/auth/csrf");
    csrfToken = csrf.csrfToken;
  }
  const response = await fetch(apiUrl(path), {
    method,
    credentials: "include",
    signal,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { "X-CSRF-Token": csrfToken } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(
      "The server did not return a usable response. Check that the API is running.",
    );
  }
  if (!response.ok) {
    if (payload.error?.code === "CSRF_REJECTED") csrfToken = undefined;
    const labels = { joinCode: "Building Join Code", password: "Password", confirmPassword: "Confirm password", email: "Email address", name: "Full name", institutionName: "Institution / building name", adminKey: "Administrator registration key" };
    const details = payload.error?.code === "VALIDATION_ERROR" && Array.isArray(payload.error.details) ? [...new Set(payload.error.details.map(item => `${labels[item.path] ?? item.path ?? "Request"}: ${item.message}`))].slice(0, 4) : [];
    const error = new Error(details.length ? details.join(" ") : payload.error?.message ?? `Request failed (${response.status})`);
    error.status = response.status; error.code = payload.error?.code;
    throw error;
  }
  if (payload.data?.csrfToken) csrfToken = payload.data.csrfToken;
  // Clear cached token after logout so the next login fetches a fresh one
  if (path === "/auth/logout" && payload.data?.loggedOut) csrfToken = undefined;
  return payload.data;
}
export const post = (path, body = {}) => api(path, { method: "POST", body });
export const patch = (path, body) => api(path, { method: "PATCH", body });
