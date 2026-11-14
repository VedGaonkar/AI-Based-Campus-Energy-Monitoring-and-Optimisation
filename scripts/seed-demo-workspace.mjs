import { loadConfig } from "../backend/src/config.js";
import { connectDatabase } from "../backend/src/models/index.js";
import { createInstitutionDirectory } from "../backend/src/workspaces/directory.js";
import { seedDedicatedDemo } from "../backend/src/workspaces/demo-seed.js";
const config = loadConfig(), { connection } = await connectDatabase(config.mongoUri);
const directory = createInstitutionDirectory(connection, config);
try { await directory.init(); await directory.assertMigrationReady(); console.log(JSON.stringify(await seedDedicatedDemo(directory, config))); }
finally { await directory.close(); await connection.close(); }
