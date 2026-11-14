import { loadConfig } from "./config.js";
import { createInstitutionApplication } from "./workspaces/runtime.js";
const config = loadConfig();
const runtime = await createInstitutionApplication(config);
runtime.server.listen(config.port, config.host, () =>
  console.log(
    `Campus Energy API listening on ${config.host}:${config.port} (room-master physical switching disabled; native OFF ${config.allowNativeControl && !config.demoMode ? "requires connection/target approval" : "disabled"})`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    await runtime.close();
    process.exit(0);
  });
