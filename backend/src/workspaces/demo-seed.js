import { seed } from "../seed.js";
import { fail } from "../security/access.js";
export async function seedDedicatedDemo(directory, config) {
  if (!config.enableDemoSetup || !config.demoMode || (config.env === "production" && !config.allowProductionDemoSeed)) fail(409, "DEMO_SEED_DISABLED", "Explicit ENABLE_DEMO_SETUP and simulated mode required; production also requires ALLOW_PRODUCTION_DEMO_SEED.");
  const entries = [["admin", "Demo administrator", config.demoAdminEmail, config.demoAdminPassword], ["viewer", "Demo viewer", config.demoViewerEmail, config.demoViewerPassword]];
  if (entries.some(([, , email, password]) => !email || !password || password.length < 20)) fail(503, "DEMO_CREDENTIALS_REQUIRED", "Set dedicated DEMO_ADMIN_EMAIL/PASSWORD and DEMO_VIEWER_EMAIL/PASSWORD, or run local setup --enable-demo; values are never printed.");
  if (entries[0][2].toLowerCase() === entries[1][2].toLowerCase()) fail(409, "DEMO_IDENTITY_CONFLICT", "Demo administrator/viewer must use distinct globally unique emails");
  let existing = await directory.Institution.findOne({ kind: "demo" }).lean();
  if (!existing) {
    for (const [, , email] of entries) if (await directory.Account.exists({ email: email.toLowerCase() })) fail(409, "DEMO_IDENTITY_CONFLICT", "A demo email belongs to an existing identity. Choose unused configured demo emails; existing accounts are never repurposed.");
  }
  const realm = existing ? await directory.realm(existing._id, { allowInactive: true }) : await directory.createInstitution("Campus Energy Demo", { kind: "demo", discoverable: true });
  const memberId = role => `${realm.institution._id}-demo-${role}`;
  if (!existing) await realm.models.Settings.updateOne({ _id: "installation" }, { $set: { meters: [{ meterId: "MAIN-01", epoch: "initial", maxPowerKw: 100, register: "import_kwh" }] } });
  for (const [role, , email] of entries) {
    const account = await directory.Account.findOne({ email: email.toLowerCase() }).lean();
    if (account && (!await directory.Membership.exists({ userId: account._id, institutionId: realm.institution._id }) || account._id !== memberId(role))) fail(409, "DEMO_IDENTITY_CONFLICT", "Demo credentials conflict with an existing identity; no role/password will be changed");
    const member = await realm.models.User.findById(memberId(role)).lean();
    if (member && (member.role !== role || member.active !== true || member.email !== email.toLowerCase())) fail(409, "DEMO_IDENTITY_CONFLICT", "Existing demo membership was changed/disabled; operator review required, not automatic reactivation");
  }
  await seed(realm.models, config, { password: config.demoAdminPassword, accounts: entries.map(([role, name, email, password]) => [role, name, email.toLowerCase(), password]), allowProductionDemo: config.allowProductionDemoSeed });
  for (const [role] of entries) {
    const member = await realm.models.User.findById(memberId(role)).select("+passwordHash").lean();
    const account = await directory.Account.findOneAndUpdate({ _id: member._id }, { $setOnInsert: { name: member.name, email: member.email, passwordHash: member.passwordHash, active: true } }, { upsert: true, returnDocument: "after" }).select("+passwordHash").lean();
    if (account.active !== true) fail(409, "DEMO_IDENTITY_CONFLICT", "Existing demo account inactive; no automatic reactivation");
    await directory.addMember(realm, account, { role, permittedRoomIds: member.permittedRoomIds });
  }
  if (!existing?.active) {
    realm.desiredDiscoverable = true; await directory.activate(realm);
  }
  return { institutionId: realm.institution._id, demo: true, seeded: true, credentialsPrinted: false, existingPasswordsAndRolesPreserved: true };
}
