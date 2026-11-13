import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { digest, publicInstitution } from "./directory.js";
import { workspaceLogin, workspaceRegistration, workspaceRename, workspaceInvitation, workspaceAccept } from "../../../shared/institution-contracts.js";
import { equalSecret, fail, requireRole } from "../security/access.js";

const invalid = () => fail(401, "INVALID_WORKSPACE_LOGIN", "Invalid credentials or unavailable institution membership");
const limiter = () => rateLimit({ windowMs: 900000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many attempts. Please wait and try again." } }) });
export function workspaceMiddleware(directory) {
  const publicPaths = new Set(["/auth/login", "/auth/register", "/auth/accept-invitation", "/auth/logout", "/auth/csrf", "/health", "/ready", "/institutions/suggestions", "/institutions/resolve"]);
  return async (req, _res, next) => {
    try {
      if (!req.path.startsWith("/api/v1")) return next();
      const path = req.path.slice(7);
      if (req.method === "OPTIONS" && path.startsWith("/demo-phone")) return next();
      if (publicPaths.has(path)) return next();
      let id;
      if (path.startsWith("/demo-phone")) {
        const token = path === "/demo-phone/pair" ? req.body?.code : req.get("Authorization")?.replace(/^Bearer /, "");
        id = String(token ?? "").split(".")[0];
      } else if (path.startsWith("/ingest/")) id = req.get("X-Institution-Id");
      else if (path.startsWith("/access/")) {
        const token = path.split("/")[2];
        id = token?.includes(".") ? token.split(".")[0] : (await directory.Institution.findOne({ kind: "legacy", active: true }).lean())?._id;
      } else id = req.session.institutionId;
      if (!id) fail(401, "WORKSPACE_REQUIRED", "Sign in and select an authorised institution workspace");
      const realm = await directory.realm(id);
      const capability = path.startsWith("/demo-phone") || path.startsWith("/ingest/") || path.startsWith("/access/");
      if (!capability && !await directory.user(realm, req.session.userId)) invalid();
      req.workspaceRealm = realm;
      directory.run(realm, next);
    } catch (error) { next(error); }
  };
}

export function registerWorkspaceAuth(api, { directory, config }) {
  const authLimit = limiter(), discoveryLimit = rateLimit({ windowMs: 60000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false });
  async function resolveCode(code) {
    if (!code) return null;
    return directory.Institution.findOne({ accessCodeHash: digest(code), active: true }).lean();
  }
  async function signedIn(req, account, realm, user) {
    await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.userId = account._id; req.session.institutionId = realm.institution._id;
    req.session.adminVerified = user.role === "admin"; req.session.csrf = randomBytes(32).toString("hex");
    await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
    return { user, institution: publicInstitution(realm.institution), csrfToken: req.session.csrf };
  }
  async function invitation(token, email) {
    const row = await directory.Invitation.findOne({ tokenHash: digest(token), usedAt: null, expiresAt: { $gt: new Date() } }).lean();
    if (!row || (row.email && row.email !== email)) fail(403, "INVITATION_INVALID", "Invitation is invalid, expired or not authorised for this account");
    return row;
  }
  async function accept(row, account) {
    const realm = await directory.realm(row.institutionId);
    // Conditional claim prevents concurrent re-use. A recoverable claim remains
    // associated with this identity if later membership persistence fails.
    const claimed = await directory.Invitation.findOneAndUpdate({ _id: row._id, usedAt: null, expiresAt: { $gt: new Date() } }, { $set: { usedAt: new Date(), usedBy: account._id } }, { returnDocument: "after" }).lean();
    if (!claimed) fail(403, "INVITATION_INVALID", "Invitation is invalid, expired or already used");
    const user = await directory.addMember(realm, account, row);
    return { realm, user };
  }
  api.get("/institutions/suggestions", discoveryLimit, async (req, res) => {
    const value = typeof req.query.q === "string" ? req.query.q.trim().toLocaleLowerCase() : "";
    if (!config.institutionDiscoveryEnabled || value.length < 3 || value.length > 80) return res.json({ data: [] });
    const escaped = [...value].map(char => "\\^$.*+?()[]{}|".includes(char) ? "\\" + char : char).join("");
    const rows = await directory.Institution.find({ active: true, discoverable: true, searchName: { $regex: escaped } }).sort({ searchName: 1, _id: 1 }).limit(8).select("_id displayName").lean();
    res.setHeader("Cache-Control", "no-store"); res.json({ data: rows.map(publicInstitution) });
  });
  api.post("/institutions/resolve", discoveryLimit, async (req, res) => {
    const { code } = z.object({ code: z.string().trim().min(10).max(200) }).strict().parse(req.body);
    let institution = await resolveCode(code);
    if (!institution) {
      const invite = await directory.Invitation.findOne({ tokenHash: digest(code), usedAt: null, expiresAt: { $gt: new Date() } }).lean();
      if (invite) institution = await directory.Institution.findOne({ _id: invite.institutionId, active: true }).lean();
    }
    if (!institution) fail(404, "WORKSPACE_UNAVAILABLE", "Institution code is invalid or unavailable");
    res.json({ data: publicInstitution(institution) });
  });
  api.post("/auth/login", authLimit, async (req, res) => {
    const input = workspaceLogin.parse(req.body);
    const account = await directory.Account.findOne({ email: input.email, active: true }).select("+passwordHash").lean();
    if (!account || !await bcrypt.compare(input.password, account.passwordHash)) invalid();
    let institutionId = input.institutionId;
    if (!institutionId && input.workspaceCode) institutionId = (await resolveCode(input.workspaceCode))?._id;
    if (!institutionId) {
      const memberships = await directory.Membership.find({ userId: account._id, active: true }).lean();
      // Always require explicit selection, especially for multi-membership users.
      if (memberships.length) fail(409, "WORKSPACE_SELECTION_REQUIRED", "Select your institution or enter its private workspace code before signing in");
      invalid();
    }
    const realm = await directory.realm(institutionId), user = await directory.user(realm, account._id);
    if (!user) invalid();
    if (input.adminKey || (user.role === "admin" && config.adminInviteKey)) {
      if (!config.adminInviteKey) fail(503, "ADMIN_ACCESS_DISABLED", "Admin activation is not configured. Set ADMIN_INVITE_KEY and restart the backend.");
      if (!input.adminKey || !equalSecret(input.adminKey, config.adminInviteKey)) fail(403, "INVALID_ADMIN_KEY", "A valid admin invite key is required for administrator sign-in.");
      if (user.role !== "admin") {
        if (realm.institution.kind !== "legacy") fail(403, "MEMBERSHIP_ROLE_REQUIRED", "An institution administrator must authorise your membership role. The enrollment key cannot upgrade this workspace membership.");
        await realm.models.User.updateOne({ _id: account._id }, { $set: { role: "admin" } });
        user.role = "admin";
        await realm.models.AuditEvent.create({ actorId: account._id, action: "auth.admin_access_granted", target: account._id, summary: "Existing workspace membership and admin key verified" });
      }
    }
    res.json({ data: await signedIn(req, account, realm, user) });
  });
  api.post("/auth/register", authLimit, async (req, res) => {
    const input = workspaceRegistration.parse(req.body);
    if (await directory.Account.exists({ email: input.email })) fail(409, "EMAIL_TAKEN", "An account with that email already exists. Sign in or accept an invitation using the existing account.");
    let invite;
    if (input.invitationToken) {
      invite = await invitation(input.invitationToken, input.email);
      if (invite.role === "admin") {
        if (!config.adminInviteKey) fail(503, "ADMIN_ACCESS_DISABLED", "Admin registration is not configured. Set ADMIN_INVITE_KEY and restart the backend.");
        if (!input.adminKey || !equalSecret(input.adminKey, config.adminInviteKey)) fail(403, "INVALID_ADMIN_KEY", "A valid admin invite key is required for administrator registration.");
      }
    }
    else {
      if (!input.institutionName) fail(400, "INSTITUTION_NAME_REQUIRED", "Enter the institution/building display name for your new workspace");
      if (!config.adminInviteKey) fail(503, "ADMIN_ACCESS_DISABLED", "Admin registration is not configured. Set ADMIN_INVITE_KEY and restart the backend.");
      if (!input.adminKey || !equalSecret(input.adminKey, config.adminInviteKey)) fail(403, "INVALID_ADMIN_KEY", "The admin invite key is incorrect. No account was created.");
    }
    const account = (await directory.Account.create({ name: input.name, email: input.email, passwordHash: await bcrypt.hash(input.password, 12) })).toObject();
    let realm, user;
    if (invite) ({ realm, user } = await accept(invite, account));
    else {
      realm = await directory.createInstitution(input.institutionName, { discoverable: input.discoverable });
      user = await directory.addMember(realm, account, { role: "admin" });
      await directory.activate(realm);
    }
    res.status(201).json({ data: await signedIn(req, account, realm, user) });
  });
  api.post("/auth/accept-invitation", authLimit, async (req, res) => {
    const input = workspaceAccept.parse(req.body), row = await invitation(input.invitationToken, input.email);
    const account = await directory.Account.findOne({ email: input.email, active: true }).select("+passwordHash").lean();
    if (!account || !await bcrypt.compare(input.password, account.passwordHash)) invalid();
    const { realm, user } = await accept(row, account);
    if (user.role === "admin" && config.adminInviteKey) {
      // Membership is granted by invitation, but administrator login still uses
      // the existing configured key flow; never create a bypassed admin session.
      return res.json({ data: { joined: true, institution: publicInstitution(realm.institution), signInRequired: true } });
    }
    res.json({ data: await signedIn(req, account, realm, user) });
  });
  api.post("/auth/logout", async (req, res) => {
    await new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
    res.clearCookie("campus.sid"); res.json({ data: { loggedOut: true } });
  });
}

export function registerWorkspaceAdministration(api, { directory }) {
  const realm = () => directory.current();
  api.get("/institutions/current", async (req, res) => {
    const institution = await directory.Institution.findById(realm().institution._id).lean();
    res.json({ data: { ...publicInstitution(institution), discoverable: institution.discoverable, demo: institution.kind === "demo" } });
  });
  api.patch("/institutions/current", async (req, res) => {
    requireRole(req.user, ["admin"]); const input = workspaceRename.parse(req.body);
    res.json({ data: await directory.rename(realm(), input.displayName, input.discoverable) });
  });
  api.post("/institutions/current/access-code", async (req, res) => {
    requireRole(req.user, ["admin"]); const code = randomBytes(24).toString("base64url");
    await directory.Institution.updateOne({ _id: realm().institution._id }, { $set: { accessCodeHash: digest(code) } });
    res.json({ data: { code, purpose: "Workspace identity only; membership and password still required" } });
  });
  api.get("/auth/workspaces", async (req, res) => {
    const memberships = await directory.Membership.find({ userId: req.user._id, active: true }).lean();
    const rows = await directory.Institution.find({ _id: { $in: memberships.map(row => row.institutionId) }, active: true }).select("_id displayName").lean();
    res.json({ data: rows.map(publicInstitution) });
  });
  api.post("/institutions/current/invitations", async (req, res) => {
    requireRole(req.user, ["admin"]); const input = workspaceInvitation.parse(req.body), target = realm();
    for (const roomId of input.permittedRoomIds) if (!await target.models.Room.exists({ _id: roomId })) fail(400, "INVALID_ROOM", "Invitation room is not in this institution");
    const token = randomBytes(32).toString("base64url"), expiresAt = new Date(Date.now() + input.expiresInHours * 3600000);
    const row = await directory.Invitation.create({ institutionId: target.institution._id, tokenHash: digest(token), email: input.email, role: input.role, permittedRoomIds: input.permittedRoomIds, expiresAt, createdBy: req.user._id });
    res.status(201).json({ data: { _id: row._id, token, expiresAt } });
  });
  api.patch("/auth/profile", async (req, res) => {
    const input = z.object({ name: z.string().trim().min(1).max(200) }).strict().parse(req.body);
    await directory.Account.updateOne({ _id: req.user._id }, { $set: input });
    await realm().models.User.updateOne({ _id: req.user._id }, { $set: input });
    res.json({ data: { user: await directory.user(realm(), req.user._id) } });
  });
  api.post("/users", async (req, res) => {
    requireRole(req.user, ["admin"]);
    const input = z.object({ name: z.string().min(1).max(200), email: z.email(), password: z.string().min(12).max(200), role: z.enum(["admin", "hod", "technician", "teacher", "viewer"]), permittedRoomIds: z.array(z.string().max(100)).max(100) }).strict().parse(req.body);
    for (const id of input.permittedRoomIds) if (!await realm().models.Room.exists({ _id: id })) fail(400, "INVALID_ROOM", "User room is outside this institution");
    if (await directory.Account.exists({ email: input.email.toLowerCase() })) fail(409, "EMAIL_TAKEN", "Email already exists globally. Invite the existing account instead.");
    const account = (await directory.Account.create({ name: input.name, email: input.email.toLowerCase(), passwordHash: await bcrypt.hash(input.password, 12) })).toObject();
    res.status(201).json({ data: await directory.addMember(realm(), account, input) });
  });
}
