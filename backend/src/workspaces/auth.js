import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { publicInstitution } from "./directory.js";
import { workspaceLogin, workspaceRegistration, workspaceRename, workspaceSelection, workspaceJoinCode } from "../../../shared/institution-contracts.js";
import { equalSecret, fail, requireRole } from "../security/access.js";
import { joinCredentials, withJoinLock, withVerifiedJoinCode, writeJoinCode } from "./join-code.js";
import { publishChange } from "../realtime/journal.js";
const invalid = () => fail(401, "INVALID_LOGIN", "Email or password is incorrect, or no active building membership is available");
const limiter = (limit = 30) => rateLimit({ windowMs: 900000, limit, standardHeaders: "draft-8", legacyHeaders: false, handler: (_req, res) => res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many attempts. Please wait and try again." } }) });
export function workspaceMiddleware(directory) {
  const publicPaths = new Set(["/auth/session", "/auth/login", "/auth/register", "/auth/accept-invitation", "/auth/select-workspace", "/auth/workspaces", "/auth/logout", "/auth/csrf", "/health", "/ready", "/institutions/suggestions", "/institutions/resolve"]);
  return async (req, _res, next) => {
    try {
      if (!req.path.startsWith("/api/v1")) return next();
      const path = req.path.slice(7);
      if (req.method === "OPTIONS" && (path.startsWith("/demo-phone") || path.startsWith("/meter-phone"))) return next();
      if (publicPaths.has(path)) return next();
      let id;
      if (path.startsWith("/demo-phone") || path.startsWith("/meter-phone")) {
        const token = (path === "/demo-phone/pair" || path === "/meter-phone/pair") ? req.body?.code : req.get("Authorization")?.replace(/^Bearer /, "");
        id = String(token ?? "").split(".")[0];
      } else if (path.startsWith("/ingest/")) id = req.get("X-Institution-Id");
      else if (path.startsWith("/access/")) {
        const token = path.split("/")[2];
        id = token?.includes(".") ? token.split(".")[0] : (await directory.Institution.findOne({ kind: "legacy", active: true }).lean())?._id;
      } else id = req.session.institutionId;
      if (!id) fail(401, "WORKSPACE_REQUIRED", "Sign in and select an authorised institution workspace");
      const realm = await directory.realm(id);
      const capability = path.startsWith("/demo-phone") || path.startsWith("/meter-phone") || path.startsWith("/ingest/") || path.startsWith("/access/");
      if (!capability && !await directory.user(realm, req.session.userId)) invalid();
      req.workspaceRealm = realm;
      directory.run(realm, next);
    } catch (error) { next(error); }
  };
}

export function registerWorkspaceAuth(api, { directory, config }) {
  const authLimit = limiter();
  const retired = () => fail(410, "AUTH_FLOW_RETIRED", "This flow is retired. Sign in with email/password, or register with a Building Join Code.");
  api.get("/institutions/suggestions", retired); api.post("/institutions/resolve", retired); api.post("/auth/accept-invitation", retired);
  const save = req => new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
  async function regenerate(req) { await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve())); req.session.csrf = randomBytes(32).toString("hex"); }
  async function choicesFor(userId) {
    const memberships = await directory.Membership.find({ userId, active: true }).lean();
    const institutions = await directory.Institution.find({ _id: { $in: memberships.map(m => m.institutionId) }, active: true }).lean(), choices = [];
    for (const institution of institutions) { const realm = await directory.realm(institution._id), user = await directory.user(realm, userId); if (user) choices.push({ realm, user }); }
    return choices;
  }
  async function signedIn(req, userId, realm, user) {
    await regenerate(req); req.session.userId = userId; req.session.institutionId = realm.institution._id; req.session.adminVerified = user.role === "admin"; await save(req);
    await realm.models.AuditEvent.create({ actorId: userId, action: "auth.login", target: userId, summary: "Password-authenticated building membership" });
    return { user, institution: publicInstitution(realm.institution), csrfToken: req.session.csrf };
  }
  function identity(req) {
    if (req.session.userId) return req.session.userId;
    if (req.session.pendingUserId && Date.now() - req.session.pendingAuthenticatedAt < 300000) return req.session.pendingUserId;
    fail(401, "AUTH_REQUIRED", "Sign in with email and password to choose a building");
  }
  // Safe anonymous bootstrap avoids expected 401 responses on the sign-in page.
  // No identity or workspace names are returned without a verified session.
  api.get("/auth/session", async (req, res) => {
    res.setHeader("Cache-Control", "no-store"); req.session.csrf ??= randomBytes(32).toString("hex");
    let user = null, workspaces = [];
    if (req.session.userId && req.session.institutionId) {
      const choices = await choicesFor(req.session.userId), current = choices.find(c => c.realm.institution._id === req.session.institutionId);
      if (current && (current.user.role !== "admin" || req.session.adminVerified)) user = current.user;
    } else if (req.session.pendingUserId && Date.now() - req.session.pendingAuthenticatedAt < 300000) {
      workspaces = (await choicesFor(req.session.pendingUserId)).map(c => publicInstitution(c.realm.institution));
    }
    res.json({ data: { user, workspaces, csrfToken: req.session.csrf } });
  });
  api.post("/auth/login", authLimit, async (req, res) => {
    const input = workspaceLogin.parse(req.body), account = await directory.Account.findOne({ email: input.email, active: true }).select("+passwordHash").lean();
    if (!account || !await bcrypt.compare(input.password, account.passwordHash)) invalid();
    const choices = await choicesFor(account._id); if (!choices.length) invalid();
    if (choices.length === 1) return res.json({ data: await signedIn(req, account._id, choices[0].realm, choices[0].user) });
    await regenerate(req); req.session.pendingUserId = account._id; req.session.pendingAuthenticatedAt = Date.now(); await save(req);
    res.json({ data: { selectionRequired: true, workspaces: choices.map(c => publicInstitution(c.realm.institution)), csrfToken: req.session.csrf } });
  });
  api.get("/auth/workspaces", authLimit, async (req, res) => { res.setHeader("Cache-Control", "no-store"); res.json({ data: (await choicesFor(identity(req))).map(c => publicInstitution(c.realm.institution)) }); });
  api.post("/auth/select-workspace", authLimit, async (req, res) => {
    const input = workspaceSelection.parse(req.body), userId = identity(req), choices = await choicesFor(userId), chosen = choices.find(c => c.realm.institution._id === input.institutionId);
    if (!chosen) fail(403, "MEMBERSHIP_REQUIRED", "Choose one of your authorised buildings");
    res.json({ data: await signedIn(req, userId, chosen.realm, chosen.user) });
  });
  api.post("/auth/register", limiter(20), async (req, res) => {
    const input = workspaceRegistration.parse(req.body);
    if (input.accountType === "administrator") {
      if (!config.adminInviteKey) fail(503, "ADMIN_REGISTRATION_DISABLED", "Administrator registration requires ADMIN_INVITE_KEY to be configured on the server.");
      if (!input.adminKey || !equalSecret(input.adminKey, config.adminInviteKey)) fail(403, "INVALID_ADMIN_KEY", "Administrator registration key is missing or incorrect. No account was created.");
    }
    if (await directory.Account.exists({ email: input.email })) fail(409, "EMAIL_TAKEN", "An account with that email already exists. Sign in with your existing password.");
    const passwordHash = await bcrypt.hash(input.password, 12);
    async function provision(realm, role, newBuilding = false) {
      let account;
      try {
        // No login or operational access until membership persistence succeeds.
        account = (await directory.Account.create({ name: input.name, email: input.email, passwordHash, active: false })).toObject();
        await directory.addMember(realm, account, { role, permittedRoomIds: [] });
        if (newBuilding) await directory.activate(realm);
        await directory.Account.updateOne({ _id: account._id }, { $set: { active: true } });
      } catch (error) {
        // Only IDs created by this request are eligible for compensation.
        if (account) { await directory.Membership.deleteMany({ userId: account._id, institutionId: realm.institution._id }); await realm.models.User.deleteOne({ _id: account._id }); await directory.Account.deleteOne({ _id: account._id }); }
        if (newBuilding) { await realm.models.Settings.deleteOne({ _id: "installation" }); await directory.Institution.deleteOne({ _id: realm.institution._id }); }
        throw error;
      }
      const current = await directory.realm(realm.institution._id), user = await directory.user(current, account._id);
      await current.models.AuditEvent.create({ actorId: account._id, action: "auth.register", target: account._id, summary: newBuilding ? "New empty building and administrator membership" : "Viewer membership created with Building Join Code" });
      return { account, realm: current, user };
    }
    let result;
    if (input.accountType === "administrator") { const credentials = await joinCredentials(input.joinCode, config), realm = await writeJoinCode(() => directory.createInstitution(input.institutionName, { joinCredentials: credentials })); result = await provision(realm, "admin", true); }
    else result = await withVerifiedJoinCode(directory, input.joinCode, realm => provision(realm, "viewer"));
    res.status(201).json({ data: await signedIn(req, result.account._id, result.realm, result.user) });
  });
  api.post("/auth/logout", async (req, res) => { await new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve())); res.clearCookie("campus.sid"); res.json({ data: { loggedOut: true } }); });
}
export function registerWorkspaceAdministration(api, { directory }) {
  const realm = () => directory.current();
  api.get("/institutions/current", async (_req, res) => { const i = await directory.Institution.findById(realm().institution._id).lean(); res.json({ data: { ...publicInstitution(i), demo: i.kind === "demo", joinCodeEnabled: i.joinCodeEnabled === true } }); });
  api.patch("/institutions/current", async (req, res) => { requireRole(req.user, ["admin"]); const input = workspaceRename.parse(req.body); res.json({ data: await directory.rename(realm(), input.displayName) }); });
  api.put("/institutions/current/join-code", limiter(20), async (req, res) => {
    requireRole(req.user, ["admin"]); const input = workspaceJoinCode.parse(req.body), credentials = input.enabled === false ? null : await joinCredentials(input.joinCode, directory.config);
    await withJoinLock(directory, realm().institution._id, async () => {
      await writeJoinCode(() => directory.Institution.updateOne({ _id: realm().institution._id }, credentials ? { $set: credentials } : { $set: { joinCodeEnabled: false }, $unset: { joinCodeLookup: 1, joinCodeVerifier: 1 } }));
      await realm().models.AuditEvent.create({ actorId: req.user._id, action: credentials ? "building.join_code_replaced" : "building.join_code_disabled", target: realm().institution._id, summary: "Viewer registration updated; existing memberships retained" });
      await publishChange(realm().connection, { resource: "institution", operation: "join-code-setting" });
    });
    res.json({ data: { joinCodeEnabled: !!credentials } });
  });
  for (const path of ["/institutions/current/access-code", "/institutions/current/invitations"]) api.post(path, () => fail(410, "AUTH_FLOW_RETIRED", "Use the Building Join Code setting for Viewer registration"));
  api.patch("/auth/profile", async (req, res) => {
    const input = z.object({ name: z.string().trim().min(1).max(200) }).strict().parse(req.body);
    await directory.Account.updateOne({ _id: req.user._id }, { $set: input });
    await realm().models.User.updateOne({ _id: req.user._id }, { $set: input });
    res.json({ data: { user: await directory.user(realm(), req.user._id) } });
  });
  api.post("/users", async (req, res) => {
    requireRole(req.user, ["admin"]);
    const input = z.object({ name: z.string().min(1).max(200), email: z.email(), password: z.string().min(6).max(200), role: z.enum(["admin", "hod", "technician", "teacher", "viewer"]), permittedRoomIds: z.array(z.string().max(100)).max(100) }).strict().parse(req.body);
    for (const id of input.permittedRoomIds) if (!await realm().models.Room.exists({ _id: id })) fail(400, "INVALID_ROOM", "User room is outside this institution");
    if (await directory.Account.exists({ email: input.email.toLowerCase() })) fail(409, "EMAIL_TAKEN", "An account with that email already exists. Existing memberships were not changed.");
    const account = (await directory.Account.create({ name: input.name, email: input.email.toLowerCase(), passwordHash: await bcrypt.hash(input.password, 12) })).toObject();
    res.status(201).json({ data: await directory.addMember(realm(), account, input) });
  });
}
