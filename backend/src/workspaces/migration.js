import { randomUUID } from "node:crypto";
import { createModels } from "../models/index.js";
import { fail } from "../security/access.js";

// The source database was one shared installation. It stays that installation,
// with all original IDs/roles/password hashes retained, not a random user's site.
export async function migrateLegacyInstallation(directory, { apply = false } = {}) {
  const { connection, Institution, Account, Membership } = directory;
  const operational = createModels(connection);
  const existing = await Institution.findOne({ kind: "legacy" }).select("+dbName").lean();
  const id = existing?._id ?? randomUUID(), issues = [], counts = {};
  let unscopedRecords = 0;
  for (const model of Object.values(operational)) {
    const rows = connection.collection(model.collection.name);
    counts[model.collection.name] = await rows.countDocuments({});
    unscopedRecords += await rows.countDocuments({ $or: [{ institutionId: { $exists: false } }, { institutionId: null }] });
    if (await rows.countDocuments({ institutionId: { $exists: true, $nin: [null, id] } })) issues.push(`Conflicting institution ownership in ${model.collection.name}; operator mapping required`);
  }
  const known = new Set([...Object.values(operational).map(model => model.collection.name), "institutions", "workspaceAccounts", "workspaceMemberships", "workspaceInvitations", "sessions", "syncEvents", "syncCounters"]);
  for (const collection of await connection.db.listCollections({}, { nameOnly: true }).toArray()) if (!known.has(collection.name) && !collection.name.startsWith("system.") && await connection.collection(collection.name).countDocuments({})) issues.push(`Unmapped non-empty collection ${collection.name}; operator ownership review required`);
  const users = await operational.User.find().select("+passwordHash").lean();
  for (const user of users) {
    const global = await Account.findOne({ email: user.email }).select("+passwordHash").lean();
    if (global && (global._id !== user._id || global.passwordHash !== user.passwordHash)) issues.push("Conflicting global account identity; operator reconciliation required");
  }
  const settings = await operational.Settings.findById("installation").lean();
  const hasData = Object.values(counts).some(value => value > 0);
  const report = { dryRun: !apply, hasData, counts, conflicts: [...new Set(issues)], alreadyComplete: !!existing?.migrationComplete,
    preservesOriginalDatabase: true, passwordsOrRolesChanged: false, operatorAction: "Back up MongoDB, stop API/worker, review this report, then run with --apply. Existing gateway tokens/phone pairings require scoped re-pair/reissue." };
  if (!apply || !hasData || (existing?.migrationComplete && !unscopedRecords && !issues.length)) return report;
  if (issues.length) fail(409, "MIGRATION_AMBIGUOUS", "Ambiguous institution/account ownership. Review dry-run conflicts; no records reassigned.");
  if (!existing) await Institution.create({ _id: id, displayName: settings?.installationName || settings?.organisationName || "Existing institution", searchName: (settings?.installationName || settings?.organisationName || "Existing institution").toLowerCase(), dbName: connection.name, kind: "legacy", active: false, discoverable: true, migrationComplete: false });
  for (const user of users) {
    await Account.updateOne({ _id: user._id }, { $setOnInsert: { email: user.email, name: user.name, passwordHash: user.passwordHash, active: user.active } }, { upsert: true });
    await Membership.updateOne({ userId: user._id, institutionId: id }, { $setOnInsert: { active: true } }, { upsert: true });
  }
  for (const model of Object.values(operational)) await connection.collection(model.collection.name).updateMany({ $or: [{ institutionId: { $exists: false } }, { institutionId: null }] }, { $set: { institutionId: id } });
  // Expired operational work is rechecked by the existing worker. Phone tokens
  // predate institution-qualified routing; revoke, retain history, re-pair.
  await operational.DemoClient.updateMany({}, { $unset: { tokenHash: "", codeHash: "" }, $set: { offlineAt: new Date(), captureActive: false } });
  await Institution.updateOne({ _id: id }, { $set: { active: true, migrationComplete: true } });
  return { ...report, dryRun: false, completed: true, institutionId: id };
}
