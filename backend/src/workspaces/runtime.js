import { connectDatabase } from "../models/index.js";
import { createInstitutionDirectory } from "./directory.js";
import { createApplication } from "../app.js";
export async function createInstitutionApplication(config) {
  const { connection } = await connectDatabase(config.mongoUri);
  const directory = createInstitutionDirectory(connection, config);
  try {
    await directory.init(); await directory.assertMigrationReady();
    const runtime = createApplication({ config, connection, models: directory.models, workspaceDirectory: directory });
    const close = runtime.close;
    return { ...runtime, directory, connection, close: async () => { await close(); await directory.close(); await connection.close(); } };
  } catch (error) { await directory.close(); await connection.close(); throw error; }
}
