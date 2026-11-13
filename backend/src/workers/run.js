import { randomUUID } from "node:crypto";
import { loadConfig } from "../config.js";
import { connectDatabase } from "../models/index.js";
import { tick } from "./tick.js";
import { getConnectedDeviceService } from "../services/connected-devices.js";
const config = loadConfig();
const { connection, models } = await connectDatabase(config.mongoUri);
const owner = randomUUID();
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    stopping = true;
  });
console.log(`Persistent policy worker running; physical room masters disabled; native OFF ${config.allowNativeControl && !config.demoMode ? "requires reviewed permissions" : "disabled"}.`);
while (!stopping) {
  try {
    await tick(models, config, new Date(), owner);
  } catch (err) {
    console.error(
      JSON.stringify({ code: "WORKER_TICK_FAILED", name: err.name }),
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
await getConnectedDeviceService(models, config).close();
await connection.close();
