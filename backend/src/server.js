import { loadConfig } from "./config.js";
import { createInstitutionApplication } from "./workspaces/runtime.js";
const config = loadConfig();
const runtime = await createInstitutionApplication(config);
runtime.server.listen(config.port, "127.0.0.1", () =>
  console.log(
    `Campus Energy API: http://localhost:${config.port} (room-master physical switching disabled; native OFF ${config.allowNativeControl && !config.demoMode ? "requires connection/target approval" : "disabled"})`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    await runtime.close();
    process.exit(0);
  });
