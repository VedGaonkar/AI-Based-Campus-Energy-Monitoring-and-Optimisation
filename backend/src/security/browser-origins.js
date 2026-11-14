import { fail } from "./access.js";
// CORS grants browser visibility only. Sessions, CSRF and scoped pairing remain
// independently required by their routes. Phone origins never grant app access.
export function browserOrigins(config) {
  const appOrigins = new Set([config.frontendOrigin, new URL(config.publicAppUrl).origin]);
  return (req, res, next) => {
    const origin = req.get("Origin");
    const phone = /^\/api\/v1\/(demo-phone|meter-phone)(\/|$)/.test(req.path);
    const allowed = phone ? new Set([...appOrigins, ...config.demoPhoneOrigins]) : appOrigins;
    if (origin) {
      if (!allowed.has(origin)) return fail(403, "ORIGIN_REJECTED", "Browser origin is not allowed for this interface");
      res.setHeader("Access-Control-Allow-Origin", origin); res.vary("Origin");
      if (!phone) res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", phone ? "Authorization, Content-Type" : "Content-Type, X-CSRF-Token");
      res.setHeader("Access-Control-Allow-Methods", phone ? "GET, POST, OPTIONS" : "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  };
}
