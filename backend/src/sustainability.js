import { z } from "zod";
import { createHash } from "node:crypto";
import { requireRole, fail } from "./security/access.js";
import { audit, getSettings } from "./services/context.js";
import { deriveIntervals } from "./domain/energy.js";
import { defaults, assumedFactor, officialFactor, buildSustainability } from "./domain/sustainability.js";

const text = z.string().trim().min(1).max(500);
const date = z.iso.datetime({ offset: true });
const selectionInput = z.object({ meterId: z.string().min(1).max(100), dataMode: z.enum(["live", "simulated", "replay"]), start: date, end: date, baselineStart: date, baselineEnd: date, occupancy: z.enum(["unknown", "similar", "different"]).default("unknown"), contextEvidence: z.string().trim().max(1000).default("") }).strict().superRefine((s, ctx) => {
  for (const [a, b] of [[s.start, s.end], [s.baselineStart, s.baselineEnd]]) if (!(new Date(b) > new Date(a)) || new Date(b) - new Date(a) > 366 * 86400000) ctx.addIssue({ code: "custom", message: "Choose positive periods of at most 366 days" });
  if (new Date(s.start) < new Date(s.baselineEnd) && new Date(s.baselineStart) < new Date(s.end)) ctx.addIssue({ code: "custom", message: "Comparison periods must not overlap" });
  if (s.occupancy !== "unknown" && s.contextEvidence.length < 10) ctx.addIssue({ code: "custom", path: ["contextEvidence"], message: "Record evidence for the occupancy comparison (at least 10 characters)" });
});
const factorInput = z.object({ value: z.number().finite().min(0).max(5), geography: text, source: text, reportingYear: text, effectiveFrom: date, effectiveTo: date, methodology: text }).strict().refine(f => new Date(f.effectiveTo) > new Date(f.effectiveFrom), "Factor dates must be increasing");
const recordInput = z.object({ kind: z.enum(["activity", "policy", "reporting"]), title: text, date, endAt: date.optional(), reviewAt: date.optional(), responsible: text, evidence: text, initiative: z.string().trim().max(500).default(""), students: z.number().int().min(0).max(1000000).default(0), staff: z.number().int().min(0).max(1000000).default(0), denominator: z.number().int().min(0).max(1000000).default(0), countingMethod: z.enum(["attendance", "unique_within_activity"]).default("attendance") }).strict().superRefine((r, ctx) => {
  if (r.kind !== "activity" && (!r.endAt || new Date(r.endAt) <= new Date(r.date))) ctx.addIssue({ code: "custom", path: ["endAt"], message: "Policy/reporting coverage end must follow its start" });
  if (r.denominator > 0 && r.students + r.staff > r.denominator) ctx.addIssue({ code: "custom", path: ["denominator"], message: "Eligible opportunities must cover the recorded participants" });
});
const admin = req => requireRole(req.user, ["admin"]);
export function registerSustainability(api, { models }) {
  const configuration = async () => ({ ...defaults, ...await models.SustainabilityConfig.findById("module").lean() });
  const enabled = async () => { const config = await configuration(); if (!config.enabled) fail(409, "MODULE_DISABLED", "An administrator must enable optional sustainability reporting first"); return config; };
  const build = async raw => {
    const config = await enabled(), selection = selectionInput.parse(raw);
    const settings = await getSettings(models);
    if (!settings.meters.some(m => m.meterId === selection.meterId && m.register === "import_kwh")) fail(400, "METER_UNKNOWN", "Select a configured import electricity meter");
    const end = new Date(Math.max(+new Date(selection.end), +new Date(selection.baselineEnd)));
    // Explicit bound, never silently build a report from a truncated feed. Keep predecessors for cumulative calculation.
    const [readings, storedFactors, records, schedules] = await Promise.all([
      models.MeterReading.find({ meterId: selection.meterId, dataMode: selection.dataMode, register: "import_kwh", capturedAt: { $lte: end } }).sort({ capturedAt: 1, _id: 1 }).limit(20001).lean(),
      models.EmissionFactor.find().sort({ createdAt: 1, _id: 1 }).lean(),
      models.SustainabilityRecord.find({ status: "approved" }).lean(),
      models.Schedule.find({ status: "confirmed", startAt: { $lt: end }, endAt: { $gt: new Date(Math.min(+new Date(selection.start), +new Date(selection.baselineStart))) } }).lean(),
    ]);
    if (readings.length > 20000) fail(422, "REPORT_LIMIT", "This meter exceeds the 20,000-reading report bound. Historical reporting needs an archival aggregation before export; no partial report was created.");
    const usable = readings.filter(r => r.unit === "kWh" && Number.isFinite(r.value) && r.value >= 0);
    const sourceById = new Map(usable.map(r => [r._id, r.sourceType || "unknown"]));
    const intervals = deriveIntervals(usable).map(r => ({ ...r, sourceTypes: [...new Set(r.sourceReadingIds.map(id => sourceById.get(id) || "unknown"))] }));
    const configuredFactors = storedFactors.filter(f => f._id !== assumedFactor._id);
    const result = buildSustainability({ intervals, factors: configuredFactors.length ? configuredFactors : storedFactors.length ? storedFactors : [assumedFactor], records, schedules, config, selection, tariff: settings.tariff });
    result.institution = { id: models.institutionId ?? reqInstitution(models), name: settings.installationName, timezone: settings.timezone };
    const inPeriods = r => [[selection.start, selection.end], [selection.baselineStart, selection.baselineEnd]].some(([a, b]) => new Date(r.capturedAt) >= new Date(a) && new Date(r.capturedAt) <= new Date(b));
    result.quality = { unacceptedReadings: readings.filter(r => inPeriods(r) && r.validationState !== "accepted").length, invalidUnitOrValueReadings: readings.filter(r => inPeriods(r) && !usable.includes(r)).length, sourceAssurance: "Accepted is a validation status, not independent meter accuracy verification. Source types are retained per interval.", bound: 20000 };
    if (result.quality.unacceptedReadings || result.quality.invalidUnitOrValueReadings) { result.warnings.push("Excluded unaccepted or unsupported-unit/value readings exist in the selected periods; review source quality."); result.recognition = null; }
    result.settingsSnapshot = { tariff: settings.tariff, timezone: settings.timezone };
    const usedIds = new Set([...result.current.intervals, ...result.baseline.intervals].flatMap(r => r.sourceReadingIds));
    result.sourceReadings = usable.filter(r => usedIds.has(r._id)).map(r => Object.fromEntries(["_id", "meterId", "epoch", "register", "kind", "unit", "value", "capturedAt", "intervalStart", "sourceType", "dataMode", "validationState", "quality"].filter(key => r[key] !== undefined).map(key => [key, r[key]])));
    return result;
  };
  api.get("/sustainability/config", async (req, res) => res.json({ data: { ...await configuration(), officialFactor, meters: (await getSettings(models)).meters.map(m => ({ meterId: m.meterId, register: m.register })) } }));
  api.patch("/sustainability/config", async (req, res) => {
    admin(req); const input = z.object({ enabled: z.boolean(), reductionThreshold: z.number().finite().min(0.1).max(100), minimumCoverage: z.number().finite().min(80).max(100) }).strict().parse(req.body);
    await models.SustainabilityConfig.updateOne({ _id: "module" }, { $set: input }, { upsert: true });
    if (input.enabled) {
      const { createdAt, ...factor } = assumedFactor;
      await models.EmissionFactor.updateOne({ _id: factor._id }, { $setOnInsert: { ...factor, revision: 0, recordedBy: req.user._id } }, { upsert: true });
    }
    await audit(models, req.user._id, "sustainability.config", "module"); res.json({ data: await configuration() });
  });
  api.get("/sustainability/factors", async (req, res) => { await enabled(); res.json({ data: await models.EmissionFactor.find().sort({ createdAt: -1 }).lean() }); });
  api.post("/sustainability/factors", async (req, res) => {
    admin(req); await enabled();
    const official = z.object({ officialIndiaFY2025: z.literal(true) }).strict().safeParse(req.body);
    const input = official.success ? officialFactor : { ...factorInput.parse(req.body), unit: "kg CO2/kWh", verificationStatus: "user-specified assumption" };
    const counter = await models.SustainabilityConfig.findOneAndUpdate({ _id: "module" }, { $inc: { factorRevision: 1 } }, { returnDocument: "after" }).lean();
    const row = await models.EmissionFactor.create({ ...input, revision: counter.factorRevision, recordedBy: req.user._id });
    await audit(models, req.user._id, "sustainability.factor_append", row._id); res.status(201).json({ data: row });
  });
  api.get("/sustainability/records", async (req, res) => { await enabled(); res.json({ data: await models.SustainabilityRecord.find(req.user.role === "admin" ? {} : { status: "approved" }).sort({ date: -1 }).lean() }); });
  api.post("/sustainability/records", async (req, res) => {
    admin(req); await enabled(); const input = recordInput.parse(req.body);
    const row = await models.SustainabilityRecord.create({ ...input, status: "pending", recordedBy: req.user._id, reviews: [] });
    await audit(models, req.user._id, "sustainability.record", row._id); res.status(201).json({ data: row });
  });
  api.post("/sustainability/records/:id/review", async (req, res) => {
    admin(req); await enabled(); const input = z.object({ status: z.enum(["approved", "rejected"]), note: text }).strict().parse(req.body);
    const row = await models.SustainabilityRecord.findOneAndUpdate({ _id: req.params.id }, { $set: { status: input.status }, $push: { reviews: { ...input, by: req.user._id, at: new Date() } } }, { returnDocument: "after" }).lean();
    if (!row) fail(404, "NOT_FOUND", "Evidence record not found");
    await audit(models, req.user._id, "sustainability.review", row._id); res.json({ data: row });
  });
  api.post("/sustainability/preview", async (req, res) => res.json({ data: await build(req.body) }));
  api.get("/sustainability/reports", async (req, res) => { admin(req); await enabled(); res.json({ data: await models.Report.find({ "payload.module": "sustainability" }).select("_id name generatedAt dataMode").sort({ generatedAt: -1 }).limit(100).lean() }); });
  api.post("/sustainability/reports", async (req, res) => {
    admin(req); const snapshot = await build(req.body);
    const payload = { module: "sustainability", snapshot: JSON.parse(JSON.stringify(snapshot)) };
    payload.sha256 = createHash("sha256").update(JSON.stringify(payload.snapshot)).digest("hex");
    const row = await models.Report.create({ name: `Sustainability ${snapshot.selection.start} to ${snapshot.selection.end}`, generatedAt: snapshot.generatedAt, createdBy: req.user._id, dataMode: snapshot.selection.dataMode, payload });
    await audit(models, req.user._id, "sustainability.report", row._id); res.status(201).json({ data: row });
  });
  api.get("/sustainability/reports/:id/export", async (req, res) => {
    admin(req); await enabled(); const row = await models.Report.findOne({ _id: req.params.id, "payload.module": "sustainability" }).lean();
    if (!row) fail(404, "NOT_FOUND", "Report not found in this building");
    await audit(models, req.user._id, "sustainability.export", row._id);
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Content-Disposition", `attachment; filename="sustainability-${row._id}.json"`); res.json({ data: row });
  });
}
const reqInstitution = models => models.workspaceDirectory?.current()?.institution?._id ?? "legacy";
