import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { parse } from "dotenv";
import { fail } from "../security/access.js";

// Reuse the existing assistant behind the same origin. One runtime/store per
// immutable building keeps cached data, proposals and announcements isolated.
export function mountWebsiteAssistant(app, { config, directory, models, server }) {
  const instances = new Map();
  let modules;
  app.use("/assistant", async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      let realm, user;
      if (directory) {
        if (!req.session.userId || !req.session.institutionId) fail(401, "AUTH_REQUIRED", "Sign in to use the assistant");
        realm = await directory.realm(req.session.institutionId); user = await directory.user(realm, req.session.userId);
      } else user = await models.User.findOne({ _id: req.session.userId, active: true }).lean();
      if (!user || user.role === "admin" && !req.session.adminVerified) fail(401, "AUTH_REQUIRED", "Sign in to use the assistant");
      const id = realm?.institution._id ?? "legacy";
      if (!instances.has(id)) instances.set(id, (async () => {
        modules ??= Promise.all([import("../../../website-smart-bot/src/server.js"), import("../../../website-smart-bot/src/config.js"), import("../../../website-smart-bot/src/appClient.js")]);
        const [implementation, settings, client] = await modules;
        let local = {};
        try { if (config.env !== "production") local = parse(readFileSync(fileURLToPath(new URL("../../../website-smart-bot/.env", import.meta.url)), "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
        const cfg = settings.loadConfig({ ...local, ...process.env, NODE_ENV: config.env, DATA_CACHE_TTL_SECONDS: "0", ...(config.env === "test" ? { GEMINI_API_KEY: "" } : {}), APP_API_URL: `http://127.0.0.1:${server.address().port}/api/v1`, APP_ORIGIN: config.frontendOrigin, APP_PUBLIC_URL: config.frontendOrigin, ASSISTANT_PUBLIC_URL: config.frontendOrigin, DB_PATH: config.env === "test" ? ":memory:" : resolve(config.assistantDataDir ?? fileURLToPath(new URL("../../../.local/assistant/", import.meta.url)), `${id}.sqlite`) });
        return implementation.createAssistantServer({ cfg, allowedOrigins: [config.frontendOrigin, new URL(config.publicAppUrl).origin], appClient: client.createAppClient({ baseUrl: cfg.appApiUrl, origin: cfg.appOrigin, expectedInstitutionId: realm?.institution._id }) });
      })().catch(error => { instances.delete(id); throw error; }));
      const instance = await instances.get(id);
      instance.app(req, res, next);
    } catch (error) {
      if (error.code === "ERR_MODULE_NOT_FOUND") return next(Object.assign(new Error("Assistant dependencies are missing. Run npm ci --prefix website-smart-bot, then retry."), { status: 503, code: "ASSISTANT_UNAVAILABLE" }));
      next(error);
    }
  });
  return async () => { for (const pending of instances.values()) { try { (await pending).close(); } catch {} } instances.clear(); };
}
