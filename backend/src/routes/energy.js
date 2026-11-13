import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { now } from '../clock.js';
import { Incident, MeterReading, Recommendation } from '../models/index.js';
import { isObjectId, requireAuth, requireRole, validate } from '../security/auth.js';
import { listIntervals, summary } from '../services/analytics.js';
import { ApiError, audit, emitLive, getSettings, notFound } from '../services/core.js';
import { nonOverlappingSavings } from '../services/energy.js';
import { importMeterCsv, ingestReadings, reviewReading } from '../services/meterIngest.js';
import { generateRecommendations, transitionRecommendation } from '../services/recommendations.js';
import { parseIsoDate } from '../util/time.js';

export const energyRouter = Router();
const oid = z.string().refine(isObjectId, 'must be a valid id');

const readingView = (r) => ({
  id: String(r._id),
  meterId: r.meterId,
  epoch: r.epoch,
  register: r.register,
  value: r.value,
  unit: r.unit,
  capturedAt: r.capturedAt,
  receivedAt: r.receivedAt,
  sourceType: r.sourceType,
  dataMode: r.dataMode,
  sourceLabel: r.validation !== 'accepted' ? 'Unknown' : r.dataMode === 'live' ? 'Metered' : 'Simulated',
  validation: r.validation,
  validationReason: r.validationReason ?? null,
  rawText: r.rawText ?? null,
  quality: r.quality ?? null,
  corrections: r.corrections ?? [],
});

// ---- utility data ----
energyRouter.post('/imports/meter-readings', requireRole('admin'), async (req, res) => {
  const body = validate(z.object({ csv: z.string().max(2_000_000), commit: z.boolean().default(false), dataMode: z.enum(['live', 'simulated']).default('live') }), req.body);
  const result = await importMeterCsv(body.csv, { dataMode: body.dataMode, enteredBy: req.user._id, commit: body.commit });
  if (body.commit) {
    await audit(req.user, 'import.meter_readings', 'meter', null, result.summary);
    await generateRecommendations();
    await emitLive('energy.updated');
  }
  res.json(result);
});

energyRouter.post('/meter-readings', requireRole('admin', 'hod', 'first_responder'), async (req, res) => {
  const settings = await getSettings();
  const body = validate(
    z.object({ meterId: z.string().min(1).default(settings.meterId), capturedAt: z.string(), value: z.number().min(0), newEpoch: z.boolean().optional(), note: z.string().max(300).optional() }),
    req.body,
  );
  const result = await ingestReadings([{ ...body, register: 'import_kwh' }], { sourceType: 'manual', dataMode: 'live', enteredBy: req.user._id, commit: true });
  await audit(req.user, 'meter.manual_reading', 'meter', body.meterId, { capturedAt: body.capturedAt, value: body.value, summary: result.summary });
  await emitLive('energy.updated');
  const ok = result.summary.accepted + result.summary.needsReview > 0;
  res.status(ok ? 201 : 422).json(result);
});

energyRouter.get('/meter-readings', requireAuth, async (req, res) => {
  const settings = await getSettings();
  const q = { meterId: req.query.meterId || settings.meterId };
  if (['accepted', 'needs_review', 'rejected'].includes(req.query.validation)) q.validation = req.query.validation;
  const limit = Math.min(Number(req.query.limit) || 100, 1000);
  const readings = await MeterReading.find(q).sort({ capturedAt: -1 }).limit(limit).lean();
  res.json({ readings: readings.map(readingView) });
});

energyRouter.post('/meter-readings/:id/review', requireRole('admin'), async (req, res) => {
  const body = validate(z.object({ action: z.enum(['accept', 'correct', 'reject', 'new_epoch']), correctedValue: z.number().min(0).optional(), note: z.string().max(300).optional() }), req.body);
  if (!isObjectId(req.params.id)) throw notFound('Reading');
  const reading = await reviewReading(req.params.id, body, req.user);
  if (!reading) throw notFound('Reading');
  await audit(req.user, 'meter.review', 'meterReading', reading._id, body);
  await emitLive('energy.updated');
  res.json({ reading: readingView(reading) });
});

// OCR needs the optional vision service. Without it this route says so; it never fabricates a reading.
energyRouter.post('/meter-images', requireRole('admin', 'hod', 'first_responder'), async (req, res) => {
  const cfg = config();
  if (!cfg.visionBaseUrl) throw new ApiError(503, 'vision_unavailable', 'The vision/OCR service is not configured. Enter the reading manually or import a CSV.');
  const body = validate(z.object({ imageBase64: z.string().min(100).max(8_000_000), capturedAt: z.string(), meterId: z.string().optional() }), req.body);
  const settings = await getSettings();
  let ocr;
  try {
    const r = await fetch(`${cfg.visionBaseUrl}/v1/ocr-meter`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ imageBase64: body.imageBase64 }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error(`vision service answered ${r.status}`);
    ocr = await r.json();
  } catch (err) {
    throw new ApiError(503, 'vision_unavailable', `The vision/OCR service could not be reached (${err.message}). Enter the reading manually.`);
  }
  if (typeof ocr.value !== 'number') {
    return res.status(422).json({ ocr, message: 'No reading could be extracted. Re-capture the image or enter the reading manually.' });
  }
  const result = await ingestReadings(
    [{ meterId: body.meterId || settings.meterId, capturedAt: body.capturedAt, value: ocr.value, register: 'import_kwh', rawText: ocr.rawText, quality: ocr.quality }],
    { sourceType: 'camera_ocr', dataMode: ocr.dataMode === 'live' ? 'live' : 'replay', enteredBy: req.user._id, commit: true },
  );
  await audit(req.user, 'meter.image_ocr', 'meter', body.meterId || settings.meterId, { summary: result.summary, rawText: ocr.rawText });
  await emitLive('energy.updated');
  res.status(201).json({ ocr, ...result });
});

// ---- analytics ----
energyRouter.get('/analytics/summary', requireAuth, async (_req, res) => {
  res.json(await summary());
});

energyRouter.get('/analytics/intervals', requireAuth, async (req, res) => {
  const settings = await getSettings();
  const to = parseIsoDate(req.query.to) ?? now();
  const from = parseIsoDate(req.query.from) ?? new Date(to.getTime() - 48 * 3_600_000);
  const intervals = await listIntervals({ meterId: req.query.meterId || settings.meterId, from, to });
  res.json({
    meterId: req.query.meterId || settings.meterId,
    from,
    to,
    timezone: settings.timezone,
    note: 'averagePowerKw is the average over each interval, not instantaneous or peak demand. Gap intervals are single aggregates.',
    intervals: intervals.map((i) => ({
      id: String(i._id),
      startAt: i.startAt,
      endAt: i.endAt,
      energyKwh: i.energyKwh,
      durationHours: i.durationHours,
      averagePowerKw: i.averagePowerKw,
      isGap: i.isGap,
      sourceKind: i.sourceKind,
      dataMode: i.dataMode,
      sourceLabel: i.sourceLabel,
      baseline: i.baseline?.method ? { method: i.baseline.method, expectedKwh: i.baseline.expectedKwh ?? null, lowKwh: i.baseline.lowKwh ?? null, thresholdKwh: i.baseline.thresholdKwh ?? null, sampleCount: i.baseline.sampleCount, matchRule: i.baseline.matchRule } : null,
      anomalous: i.anomalous,
      excessKwh: i.excessKwh ?? null,
    })),
  });
});

energyRouter.get('/analytics/anomalies', requireAuth, async (req, res) => {
  const q = { type: 'energy_anomaly' };
  if (req.query.active === 'true') q.active = true;
  const incidents = await Incident.find(q).sort({ 'anomaly.startAt': -1 }).limit(100).lean();
  res.json({
    anomalies: incidents.map((i) => ({
      incidentId: String(i._id),
      state: i.state,
      active: i.active,
      severity: i.severity,
      dataMode: i.dataMode,
      title: i.title,
      ...i.anomaly,
      intervalId: i.anomaly?.intervalId ? String(i.anomaly.intervalId) : null,
      suspectedCause: i.suspectedCause ?? null,
      confirmedCause: i.confirmedCause ?? null,
    })),
  });
});

// ---- recommendations ----
const recView = (r) => ({ ...(r.toObject?.() ?? r), id: String(r._id), _id: undefined, __v: undefined });

energyRouter.get('/recommendations', requireAuth, async (_req, res) => {
  const recs = await Recommendation.find().sort({ status: 1, 'estimate.kwhHigh': -1 }).lean();
  const open = recs.filter((r) => ['proposed', 'accepted'].includes(r.status));
  res.json({
    recommendations: recs.map(recView),
    potentialSavings: { ...nonOverlappingSavings(open), period: 'month', sourceLabel: 'Estimated', note: 'Recommendations about the same avoidable energy are counted once' },
  });
});

energyRouter.post('/recommendations/refresh', requireRole('admin', 'hod'), async (_req, res) => {
  const recs = await generateRecommendations();
  res.json({ generated: recs.length });
});

for (const action of ['accept', 'reject', 'complete', 'verify']) {
  energyRouter.post(`/recommendations/:id/${action}`, requireRole('admin', 'hod'), async (req, res) => {
    const body = validate(z.object({ reason: z.string().trim().max(500).optional(), note: z.string().trim().max(500).optional(), dueDate: z.string().optional(), ownerId: oid.optional() }), req.body ?? {});
    const rec = isObjectId(req.params.id) && (await Recommendation.findById(req.params.id));
    if (!rec) throw notFound('Recommendation');
    const dueDate = body.dueDate ? (parseIsoDate(body.dueDate) ?? undefined) : undefined;
    await transitionRecommendation(rec, action, req.user, { ...body, dueDate });
    await audit(req.user, `recommendation.${action}`, 'recommendation', rec._id, body);
    await emitLive('recommendations.updated');
    res.json({ recommendation: recView(rec) });
  });
}
