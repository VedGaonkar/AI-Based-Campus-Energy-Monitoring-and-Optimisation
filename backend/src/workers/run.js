import { randomUUID } from "node:crypto";
import { loadConfig } from "../config.js";
import { connectDatabase } from "../models/index.js";
import { tick } from "./tick.js";
const config = loadConfig();
const { connection, models } = await connectDatabase(config.mongoUri);
const owner = randomUUID();
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    stopping = true;
  });
console.log("Persistent policy worker running; physical control disabled.");
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
await connection.close();
