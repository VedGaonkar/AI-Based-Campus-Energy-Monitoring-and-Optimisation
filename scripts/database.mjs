import { MongoMemoryServer } from "mongodb-memory-server";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function startDatabase({ persistent = false, port } = {}) {
  const directory = fileURLToPath(
    new URL("../.local/mongodb-data/", import.meta.url),
  );
  if (persistent) await mkdir(directory, { recursive: true });
  const database = new MongoMemoryServer({
    binary: {
      version: "8.2.6",
      downloadDir: fileURLToPath(
        new URL("../.local/mongodb-binaries/", import.meta.url),
      ),
    },
    instance: {
      ip: "127.0.0.1",
      port,
      storageEngine: "wiredTiger",
      ...(persistent ? { dbPath: directory } : {}),
    },
  });
  await database.start(port !== undefined);
  return database;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const database = await startDatabase({ persistent: true, port: 27017 });
  console.log(
    `Local MongoDB 8.2.6 ready on 127.0.0.1:${database.instanceInfo.port}; persistent data is ignored under .local/.`,
  );
  if (process.argv.includes("--check")) await database.stop();
  else
    for (const signal of ["SIGINT", "SIGTERM"])
      process.once(signal, async () => {
        await database.stop();
        process.exit(0);
      });
}
