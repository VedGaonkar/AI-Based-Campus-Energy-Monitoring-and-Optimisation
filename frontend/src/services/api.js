let csrfToken;
export async function api(path, { method = "GET", body, signal } = {}) {
  if (method !== "GET" && !csrfToken) {
    const csrf = await api("/auth/csrf");
    csrfToken = csrf.csrfToken;
  }
  const response = await fetch(`/api/v1${path}`, {
    method,
    credentials: "same-origin",
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
    throw new Error(
      payload.error?.message ?? `Request failed (${response.status})`,
    );
  }
  if (payload.data?.csrfToken) csrfToken = payload.data.csrfToken;
  return payload.data;
}
export const post = (path, body = {}) => api(path, { method: "POST", body });
export const patch = (path, body) => api(path, { method: "PATCH", body });
