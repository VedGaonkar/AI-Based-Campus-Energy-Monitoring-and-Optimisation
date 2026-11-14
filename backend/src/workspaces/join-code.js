import { createHmac, randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import { fail } from "../security/access.js";
export const joinLookup = (code, config) => createHmac("sha256", config.sessionSecret).update("building-join-code:v1\0").update(code).digest("hex");
export const invalidJoinCode = () => fail(403, "JOIN_CODE_INVALID", "Building Join Code is invalid or disabled");
export async function joinCredentials(code, config) { return { joinCodeLookup: joinLookup(code, config), joinCodeVerifier: await bcrypt.hash(code, 12), joinCodeEnabled: true }; }
// Persisted mutual exclusion also works on standalone MongoDB. Never steal a
// paused writer's lock: crash recovery fails closed and requires reconciliation.
export async function withJoinLock(directory, id, operation) {
  const owner = randomUUID(); let locked;
  for (let n = 0; n < 80; n++) {
    locked = await directory.Institution.findOneAndUpdate({ _id: id, active: true, joinLockOwner: { $exists: false } }, { $set: { joinLockOwner: owner, joinLockAt: new Date() } }, { returnDocument: "after" }).select("+joinCodeLookup +joinCodeVerifier").lean();
    if (locked) break;
    if (!await directory.Institution.exists({ _id: id, active: true })) invalidJoinCode();
    await new Promise(r => setTimeout(r, 25));
  }
  if (!locked) fail(503, "JOIN_CODE_BUSY", "Building Join Code is being updated; retry shortly or contact your administrator");
  try { return await operation(locked); }
  finally { await directory.Institution.updateOne({ _id: id, joinLockOwner: owner }, { $unset: { joinLockOwner: 1, joinLockAt: 1 } }); }
}
export async function withVerifiedJoinCode(directory, code, operation) {
  const lookup = joinLookup(code, directory.config), institution = await directory.Institution.findOne({ joinCodeLookup: lookup, joinCodeEnabled: true, active: true }).lean();
  if (!institution) invalidJoinCode();
  return withJoinLock(directory, institution._id, async current => {
    if (!current.joinCodeEnabled || current.joinCodeLookup !== lookup || !current.joinCodeVerifier || !await bcrypt.compare(code, current.joinCodeVerifier)) invalidJoinCode();
    return operation(await directory.realm(current._id));
  });
}
export async function writeJoinCode(operation) {
  try { return await operation(); }
  catch (error) { if (error.code === 11000 && error.keyPattern?.joinCodeLookup) fail(409, "JOIN_CODE_UNAVAILABLE", "Building Join Code is already in use. Choose a different code."); throw error; }
}
