import { loadConfig } from "./config.js";
import { connectDatabase } from "./models/index.js";
import { createApplication } from "./app.js";
const config = loadConfig(),
  { connection, models } = await connectDatabase(config.mongoUri);
const runtime = createApplication({ config, connection, models });
runtime.server.listen(config.port, "127.0.0.1", () =>
  console.log(
    `Campus Energy API: http://localhost:${config.port} (physical switching disabled)`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    await runtime.close();
    await connection.close();
    process.exit(0);
  });
