import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { randomBytes } from "node:crypto";
import { startDatabase } from "../scripts/database.mjs";
import { connectDatabase } from "../backend/src/models/index.js";
import { loadConfig } from "../backend/src/config.js";
import { createApplication } from "../backend/src/app.js";

test("same-origin polling without Origin is accepted only for configured hosts; hostile origins/fetch-sites remain denied", async () => {
  const db = await startDatabase(); const { connection, models } = await connectDatabase(db.getUri("realtime_test"));
  const config = loadConfig({ NODE_ENV: "test", SESSION_SECRET: randomBytes(32).toString("hex"), SERVICE_INGEST_TOKEN: randomBytes(32).toString("hex"), PUBLIC_APP_URL: "http://localhost:5000", FRONTEND_ORIGIN: "http://localhost:5173" });
  const runtime = createApplication({ models, connection, config });
  await new Promise((resolve) => runtime.server.listen(0, "127.0.0.1", resolve));
  const port = runtime.server.address().port;
  const get = (headers, path = "/socket.io/?EIO=4&transport=polling") => new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port, path, headers }, (response) => {
      let body = ""; response.on("data", (chunk) => { body += chunk; }); response.on("end", () => resolve({ status: response.statusCode, body }));
    }); req.on("error", reject); req.end();
  });
  try {
    // Exercise session persistence before teardown; Engine.IO handshakes alone do
    // not wait for the application's asynchronous session-store initialisation.
    assert.equal((await get({ Host: "localhost:5000" }, "/api/v1/auth/csrf")).status, 200);
    const sameOrigin = await get({ Host: "localhost:5000", "Sec-Fetch-Site": "same-origin" });
    assert.equal(sameOrigin.status, 200); assert.ok(sameOrigin.body.startsWith("0{"));
    assert.equal((await get({ Host: "untrusted.test", "Sec-Fetch-Site": "same-origin" })).status, 403);
    assert.equal((await get({ Host: "localhost:5000", "Sec-Fetch-Site": "cross-site" })).status, 403);
    assert.equal((await get({ Host: "localhost:5000", Origin: "https://untrusted.test" })).status, 403);
    assert.equal((await get({ Host: "localhost:5000", Origin: "http://localhost:5173" })).status, 200);
  } finally { await runtime.close(); await connection.close(); await db.stop(); }
});
