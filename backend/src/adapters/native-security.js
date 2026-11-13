import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export class ProviderError extends Error {
  constructor(code) {
    const messages = {
      AUTHENTICATION: "Gateway rejected the token. Replace it with an authorised Home Assistant token.",
      AUTHORIZATION: "Gateway account does not permit this operation.",
      UNSUPPORTED: "This entity or action is not supported for native OFF.",
      UNAVAILABLE: "Gateway or entity is unavailable. Check its network and integration.",
      RATE_LIMITED: "Gateway rate limit reached. No automatic backlog will be sent.",
      TIMEOUT: "Gateway request timed out; the reported device outcome is unknown.",
      TRANSPORT: "Gateway transport failed. Check the configured network and trusted certificate.",
      DESTINATION: "Gateway destination is not permitted by the deployment allowlist or its pinned addresses changed.",
      RESPONSE_LIMIT: "Gateway response exceeded the configured 2 MiB safety limit.",
      IDENTITY_CHANGED: "Entity identity changed or disappeared. Reconcile its binding before control.",
    };
    super(messages[code] ?? "Gateway operation failed");
    this.code = code;
    this.status = code === "UNSUPPORTED" ? 409 : 502;
  }
}
export const providerError = (error) => error instanceof ProviderError ? error : new ProviderError("TRANSPORT");
const key = (secret) => Buffer.from(hkdfSync("sha256", secret, "campus-native-credentials-v1", "ha-token-at-rest", 32));
export function sealToken(token, secret, connectionId) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  cipher.setAAD(Buffer.from(connectionId));
  return { version: 1, iv: iv.toString("base64"), data: Buffer.concat([cipher.update(token, "utf8"), cipher.final()]).toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}
export function openToken(encrypted, secret, connectionId) {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(encrypted.iv, "base64"));
    decipher.setAAD(Buffer.from(connectionId));
    decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted.data, "base64")), decipher.final()]).toString("utf8");
  } catch { throw new ProviderError("AUTHENTICATION"); }
}
function forbiddenIp(address, config) {
  const ip = address.toLowerCase();
  if (ip.startsWith("::ffff:")) return true;
  if (ip === "::" || ip === "0.0.0.0" || ip.startsWith("169.254.") || ip.startsWith("fe80:") || ip.startsWith("ff") || ip.startsWith("fd00:ec2:")) return true;
  if (ip === "::1" || ip.startsWith("127.")) return !config.haAllowLoopback;
  if (isIP(ip) === 4 && (+ip.split(".")[0] >= 224 || ip.startsWith("0."))) return true;
  return !isIP(ip);
}
export async function validateDestination(baseUrl, config, pins, resolve = lookup) {
  let url;
  try { url = new URL(baseUrl); } catch { throw new ProviderError("DESTINATION"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      !(config.haAllowedOrigins ?? []).includes(url.origin) || (url.protocol === "http:" && !config.haAllowHttp)) throw new ProviderError("DESTINATION");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (["metadata.google.internal", "metadata", "instance-data"].includes(hostname.toLowerCase())) throw new ProviderError("DESTINATION");
  let addresses;
  let dnsTimeout;
  try { addresses = isIP(hostname) ? [hostname] : (await Promise.race([resolve(hostname, { all: true }), new Promise((_, reject) => { dnsTimeout = setTimeout(() => reject(new ProviderError("TIMEOUT")), 5000); })])).map((entry) => entry.address); }
  catch { throw new ProviderError("UNAVAILABLE"); }
  finally { clearTimeout(dnsTimeout); }
  if (!addresses.length || addresses.some((ip) => forbiddenIp(ip, config)) || (pins && addresses.some((ip) => !pins.includes(ip)))) throw new ProviderError("DESTINATION");
  const trustedLan = (ip) => ip === "::1" || ip.startsWith("127.") || ip.startsWith("10.") || ip.startsWith("192.168.") ||
    (ip.startsWith("172.") && +ip.split(".")[1] >= 16 && +ip.split(".")[1] <= 31) || /^(fc|fd)/i.test(ip);
  if (url.protocol === "http:" && addresses.some((ip) => !trustedLan(ip))) throw new ProviderError("DESTINATION");
  return { origin: url.origin, addresses: [...new Set(addresses)].sort() };
}
// DNS is validated on every connection and the chosen address is injected into
// the actual socket lookup. A second implicit lookup cannot rebind the request.
export async function pinnedOptions(connection, config) {
  const { addresses } = await validateDestination(connection.baseUrl, config, connection.pinnedAddresses);
  const address = addresses.find((ip) => isIP(ip) === 4) ?? addresses[0], family = isIP(address);
  return { lookup: (_hostname, options, callback) => {
    if (typeof options === "function") { callback = options; options = {}; }
    callback(null, options?.all ? [{ address, family }] : address, family);
  }, family, autoSelectFamily: false, rejectUnauthorized: true };
}
export async function gatewayRequest(connection, config, token, path, body, timeoutMs = 5000) {
  if (!/^\/api\/(?:$|config$|states(?:\/[a-z0-9_]+\.[a-z0-9_]+)?$|services(?:\/(?:light|fan|switch|climate)\/(?:turn_off|set_hvac_mode))?$)/.test(path)) throw new ProviderError("UNSUPPORTED");
  if (body && !path.startsWith("/api/services/")) throw new ProviderError("UNSUPPORTED");
  const options = await pinnedOptions(connection, config);
  return new Promise((resolve, reject) => {
    const url = new URL(path, connection.baseUrl), transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = transport(url, { ...options, method: body ? "POST" : "GET", agent: false,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) } }, (res) => {
      const status = res.statusCode;
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new ProviderError(status === 401 ? "AUTHENTICATION" : status === 403 ? "AUTHORIZATION" : status === 429 ? "RATE_LIMITED" : status === 404 ? "IDENTITY_CHANGED" : "UNAVAILABLE"));
        return;
      }
      let size = 0; const chunks = [];
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) { res.destroy(); reject(new ProviderError("RESPONSE_LIMIT")); }
        else chunks.push(chunk);
      });
      res.on("error", () => reject(new ProviderError("TRANSPORT")));
      res.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new ProviderError("TRANSPORT")); } });
    });
    // A fixed overall deadline also bounds a slow response body.
    const deadline = setTimeout(() => req.destroy(new ProviderError("TIMEOUT")), timeoutMs);
    req.on("close", () => clearTimeout(deadline));
    req.on("error", (error) => reject(providerError(error)));
    req.end(body ? JSON.stringify(body) : undefined);
  });
}
