import { loadConfig } from "../backend/src/config.js";
import { connectDatabase } from "../backend/src/models/index.js";
import { createInstitutionDirectory } from "../backend/src/workspaces/directory.js";
import { migrateLegacyInstallation } from "../backend/src/workspaces/migration.js";
const config = loadConfig(), { connection } = await connectDatabase(config.mongoUri);
const directory = createInstitutionDirectory(connection, config);
try { await directory.init(); console.log(JSON.stringify(await migrateLegacyInstallation(directory, { apply: process.argv.includes("--apply") }), null, 2)); }
finally { await directory.close(); await connection.close(); }
