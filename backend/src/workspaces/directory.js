import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID, createHash } from "node:crypto";
import mongoose from "mongoose";
import { createModels } from "../models/index.js";
import { fail } from "../security/access.js";

export const digest = value => createHash("sha256").update(value).digest("hex");
export const publicInstitution = row => ({ _id: row._id, displayName: row.displayName });
export function createInstitutionDirectory(connection, config) {
  const { Schema } = mongoose;
  function model(name, collection, fields, indexes = []) {
    if (connection.models[name]) return connection.models[name];
    const schema = new Schema({ _id: { type: String, default: () => randomUUID() }, ...fields }, { timestamps: true, strict: "throw" });
    for (const [key, options] of indexes) schema.index(key, options);
    return connection.model(name, schema, collection);
  }
  const Institution = model("WorkspaceInstitution", "institutions", {
    displayName: { type: String, required: true }, searchName: String,
    dbName: { type: String, required: true, select: false }, kind: { type: String, default: "regular" },
    discoverable: { type: Boolean, default: false }, active: { type: Boolean, default: false },
    accessCodeHash: { type: String, select: false }, migrationComplete: Boolean,
    joinCodeLookup: { type: String, select: false }, joinCodeVerifier: { type: String, select: false }, joinCodeEnabled: { type: Boolean, default: false },
    joinLockOwner: { type: String, select: false }, joinLockAt: { type: Date, select: false },
  }, [[{ joinCodeLookup: 1 }, { unique: true, partialFilterExpression: { joinCodeLookup: { $type: "string" } } }], [{ dbName: 1 }, { unique: true }], [{ searchName: 1 }, {}], [{ kind: 1 }, { unique: true, partialFilterExpression: { kind: "demo" } }]]);
  const Account = model("WorkspaceAccount", "workspaceAccounts", {
    email: { type: String, required: true, lowercase: true }, name: String,
    passwordHash: { type: String, required: true, select: false }, active: { type: Boolean, default: true },
  }, [[{ email: 1 }, { unique: true }]]);
  const Membership = model("WorkspaceMembership", "workspaceMemberships", {
    userId: { type: String, required: true }, institutionId: { type: String, required: true }, active: { type: Boolean, default: true },
  }, [[{ userId: 1, institutionId: 1 }, { unique: true }]]);
  const Invitation = model("WorkspaceInvitation", "workspaceInvitations", {
    institutionId: String, tokenHash: { type: String, select: false }, email: String,
    role: String, permittedRoomIds: [String], expiresAt: Date, usedBy: String, usedAt: Date, createdBy: String,
  }, [[{ tokenHash: 1 }, { unique: true }]]);
  const context = new AsyncLocalStorage(), realms = new Map(), services = new Map();
  let closed = false;
  const current = () => {
    const realm = context.getStore();
    if (!realm || closed) fail(401, "WORKSPACE_REQUIRED", "Select an authorised institution workspace");
    return realm;
  };
  const models = new Proxy({}, { get(_target, name) {
    if (name === "workspaceDirectory") return directory;
    if (name === "resolveInstitutionModels") return () => current().models;
    if (name === "institutionId") return current().institution._id;
    return current().models[name];
  } });
  const directory = {
    Institution, Account, Membership, Invitation, connection, config, models,
    async init() { await Promise.all([Institution, Account, Membership, Invitation].map(item => item.init())); },
    async assertMigrationReady() {
      if (await Institution.exists({ kind: "legacy", active: true, migrationComplete: true })) return;
      for (const model of Object.values(createModels(connection))) {
        if (await connection.collection(model.collection.name).countDocuments({}))
          fail(503, "WORKSPACE_MIGRATION_REQUIRED", "Existing installation requires operator migration: npm run migrate:institutions -- --apply (review dry-run first). No data was deleted.");
      }
    },
    current,
    async realm(id, { allowInactive = false } = {}) {
      if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) fail(401, "WORKSPACE_UNAVAILABLE", "Invalid login or workspace selection");
      const institution = await Institution.findOne({ _id: id, ...(allowInactive ? {} : { active: true }) }).select("+dbName").lean();
      if (!institution) fail(401, "WORKSPACE_UNAVAILABLE", "Invalid login or workspace selection");
      if (!realms.has(id)) realms.set(id, (async () => {
        const db = institution.dbName === connection.name ? connection : connection.useDb(institution.dbName, { useCache: true });
        const bound = createModels(db, id);
        Object.defineProperty(bound, "institutionId", { value: id });
        Object.defineProperty(bound, "workspaceDirectory", { value: directory });
        await Promise.all(Object.values(bound).map(item => item.init()));
        return { models: bound, connection: db };
      })().catch(error => { realms.delete(id); throw error; }));
      return { ...await realms.get(id), institution };
    },
    run(realm, operation) { return context.run(realm, operation); },
    service(name, factory) {
      if (!services.has(name)) services.set(name, new Map());
      const instances = services.get(name);
      return new Proxy({}, { get(_target, method) {
        if (method === "close") return async () => { for (const service of instances.values()) await service.close?.(); instances.clear(); };
        return (...args) => {
          const realm = current(), id = realm.institution._id;
          if (!instances.has(id)) instances.set(id, factory(realm.models));
          return instances.get(id)[method](...args);
        };
      } });
    },
    async createInstitution(displayName, { kind = "regular", discoverable = false, joinCredentials = {} } = {}) {
      const id = randomUUID();
      const institution = await Institution.create({ _id: id, displayName, searchName: displayName.toLocaleLowerCase(), dbName: `campus_workspace_${id.replaceAll("-", "")}`, kind, discoverable: false, ...joinCredentials });
      try {
      const realm = await directory.realm(id, { allowInactive: true });
      await realm.models.Settings.create({ _id: "installation", installationName: displayName, organisationName: displayName, setupCompleted: false, meters: [] });
      return { ...realm, desiredDiscoverable: discoverable, institution: institution.toObject() };
      } catch (error) { await Institution.deleteOne({ _id: id, active: false }); realms.delete(id); throw error; }
    },
    async activate(realm) {
      await Institution.updateOne({ _id: realm.institution._id }, { $set: { active: true, discoverable: !!realm.desiredDiscoverable } });
    },
    async user(realm, userId) {
      if (!userId || !await Membership.exists({ userId, institutionId: realm.institution._id, active: true })) return null;
      const account = await Account.findOne({ _id: userId, active: true }).lean();
      const member = account && await realm.models.User.findOne({ _id: userId, active: true }).lean();
      if (!member) return null;
      return { ...member, name: account.name, email: account.email, institutionId: realm.institution._id, institution: publicInstitution(realm.institution) };
    },
    async addMember(realm, account, { role = "viewer", permittedRoomIds = [] } = {}) {
      const id = realm.institution._id;
      await realm.models.User.updateOne({ _id: account._id }, { $setOnInsert: { name: account.name, email: account.email, passwordHash: account.passwordHash, role, active: true, permittedRoomIds } }, { upsert: true });
      await Membership.updateOne({ userId: account._id, institutionId: id }, { $setOnInsert: { active: true } }, { upsert: true });
      return directory.user(realm, account._id);
    },
    async rename(realm, displayName, discoverable) {
      await Institution.updateOne({ _id: realm.institution._id }, { $set: { displayName, searchName: displayName.toLocaleLowerCase(), ...(discoverable === undefined ? {} : { discoverable }) } });
      await realm.models.Settings.updateOne({ _id: "installation" }, { $set: { installationName: displayName, organisationName: displayName } });
      return { _id: realm.institution._id, displayName };
    },
    async close() {
      for (const group of services.values()) for (const service of group.values()) await service.close?.();
      services.clear(); closed = true;
    },
  };
  return directory;
}
