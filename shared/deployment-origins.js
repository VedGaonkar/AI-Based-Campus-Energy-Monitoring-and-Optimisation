// Public deployment addresses only. Never accept credentials, paths or wildcards.
export function deploymentOrigin(value, { production = false, optional = false, label = "Origin" } = {}) {
  if (optional && !value) return "";
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be an exact HTTP(S) origin`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/" || url.hostname.includes("*")) throw new Error(`${label} must be an exact HTTP(S) origin without credentials, paths or wildcards`);
  if (production && (url.protocol !== "https:" || ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(url.hostname) || url.hostname.endsWith(".localhost"))) throw new Error(`${label} must use a reachable HTTPS production origin, not localhost`);
  return url.origin;
}
