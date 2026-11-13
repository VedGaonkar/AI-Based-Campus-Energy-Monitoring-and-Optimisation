import { randomUUID } from "node:crypto";
import { loadConfig } from "../config.js";
import { connectDatabase } from "../models/index.js";
import { tick } from "./tick.js";
import { getConnectedDeviceService } from "../services/connected-devices.js";
import { createInstitutionDirectory } from "../workspaces/directory.js";
const config = loadConfig();
const { connection, models } = await connectDatabase(config.mongoUri);
const directory = createInstitutionDirectory(connection, config);
await directory.init(); await directory.assertMigrationReady();
const owner = randomUUID();
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    stopping = true;
  });
console.log(`Persistent policy worker running; physical room masters disabled; native OFF ${config.allowNativeControl && !config.demoMode ? "requires reviewed permissions" : "disabled"}.`);
while (!stopping) {
  try {
    for (const institution of await directory.Institution.find({ active: true }).select("_id").lean()) {
      try {
        const realm = await directory.realm(institution._id);
        await directory.run(realm, () => tick(realm.models, config, new Date(), `${owner}:${institution._id}`));
      } catch (error) { console.error(JSON.stringify({ code: "INSTITUTION_WORKER_TICK_FAILED", name: error.name })); }
    }
  } catch (err) {
    console.error(
      JSON.stringify({ code: "WORKER_TICK_FAILED", name: err.name }),
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
await getConnectedDeviceService(models, config).close();
for (const institution of await directory.Institution.find({ active: true }).select("_id").lean()) {
  const realm = await directory.realm(institution._id); await getConnectedDeviceService(realm.models, config).close();
}
await directory.close();
await connection.close();
