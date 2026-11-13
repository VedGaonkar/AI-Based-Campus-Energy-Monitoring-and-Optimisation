import { parse } from 'csv-parse/sync';
import { now } from '../clock.js';
import { EnergyInterval, MeterReading } from '../models/index.js';
import { parseIsoDate, round } from '../util/time.js';
import { deriveIntervals } from './energy.js';
import { badRequest, getSettings } from './core.js';
import { evaluateMeter } from './analytics.js';

const FUTURE_TOLERANCE_MS = 5 * 60_000;
const MAX_ROWS = 20_000;

export function parseCsv(text) {
  if (typeof text !== 'string' || !text.trim()) throw badRequest('empty_csv', 'CSV content is empty');
  let records;
  try {
    records = parse(text, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  } catch (err) {
    throw badRequest('invalid_csv', `CSV could not be parsed: ${err.message}`);
  }
  if (records.length > MAX_ROWS) throw badRequest('too_many_rows', `CSV has more than ${MAX_ROWS} rows`);
  return records;
}

export function detectMeterCsvFormat(records) {
  const cols = Object.keys(records[0] ?? {});
  if (cols.includes('readingKwh') && cols.includes('capturedAt')) return 'cumulative';
  if (cols.includes('energyKwh') && cols.includes('intervalStart') && cols.includes('intervalEnd')) return 'interval';
  throw badRequest('unknown_format', 'Expected columns meterId,capturedAt,readingKwh,register,source or meterId,intervalStart,intervalEnd,energyKwh');
}

function ocrProblem(quality) {
  if (!quality) return null;
  if (quality.registerMatched === false) return 'OCR did not match the intended kWh register';
  if (quality.burstAgreement === false) return 'Frames in the capture burst disagree';
  if (typeof quality.ocrConfidence === 'number' && quality.ocrConfidence < 0.8) return 'OCR confidence is low';
  return null;
}

// Decides accepted / needs_review for one candidate against the readings already known.
// Incoming confidence never bypasses these checks.
export function validateReading(candidate, known, { maxSupplyKw }) {
  const sameEpoch = known.filter((r) => r.epoch === candidate.epoch && r.validation === 'accepted');
  const t = candidate.capturedAt.getTime();
  let prev = null;
  let next = null;
  for (const r of sameEpoch) {
    const rt = r.capturedAt.getTime();
    if (rt < t && (!prev || rt > prev.capturedAt.getTime())) prev = r;
    if (rt > t && (!next || rt < next.capturedAt.getTime())) next = r;
  }
  const ocr = candidate.sourceType === 'camera_ocr' ? ocrProblem(candidate.quality) : null;
  if (ocr) return { validation: 'needs_review', reason: ocr };
  if (prev && candidate.value < prev.value) {
    return { validation: 'needs_review', reason: 'Lower than the previous reading: possible misread, counter reset or meter replacement' };
  }
  if (next && candidate.value > next.value) {
    return { validation: 'needs_review', reason: 'Higher than a later accepted reading' };
  }
  if (prev) {
    const hours = (t - prev.capturedAt.getTime()) / 3_600_000;
    const kw = (candidate.value - prev.value) / hours;
    if (kw > maxSupplyKw) {
      return { validation: 'needs_review', reason: `Implies ${round(kw, 1)} kW average, above the configured ${maxSupplyKw} kW supply limit` };
    }
  }
  return { validation: 'accepted', reason: null };
}

// rows: [{ meterId, capturedAt, value, register?, epoch?, newEpoch?, eventId?, quality?, rawText?, line? }]
export async function ingestReadings(rows, { sourceType, dataMode, enteredBy, commit = true }) {
  const settings = await getSettings();
  const maxSupplyKw = settings.anomaly.maxSupplyKw;
  const result = { accepted: [], needsReview: [], duplicates: [], invalid: [] };
  const groups = new Map();
  const current = now().getTime();

  for (const [index, raw] of rows.entries()) {
    const line = raw.line ?? index + 1;
    const capturedAt = parseIsoDate(raw.capturedAt);
    const value = typeof raw.value === 'number' ? raw.value : Number(raw.value);
    const register = raw.register || 'import_kwh';
    if (!raw.meterId) result.invalid.push({ line, reason: 'meterId is missing' });
    else if (!capturedAt) result.invalid.push({ line, reason: 'capturedAt must be an ISO 8601 timestamp with a UTC offset' });
    else if (raw.value === '' || raw.value === null || raw.value === undefined || !Number.isFinite(value) || value < 0) result.invalid.push({ line, reason: 'reading must be a non-negative number in kWh' });
    else if (register !== 'import_kwh') result.invalid.push({ line, reason: `register "${register}" is not supported; only cumulative import_kwh is accepted` });
    else if (capturedAt.getTime() > current + FUTURE_TOLERANCE_MS) result.invalid.push({ line, reason: 'capturedAt is in the future' });
    else {
      const key = `${raw.meterId}|${register}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ ...raw, line, capturedAt, value, register });
    }
  }

  const touchedMeters = new Set();
  for (const [key, candidates] of groups) {
    const [meterId, register] = key.split('|');
    const known = (await MeterReading.find({ meterId, register }).lean()).map((r) => ({ ...r }));
    candidates.sort((a, b) => a.capturedAt - b.capturedAt);

    for (const c of candidates) {
      const same = known.find((r) => r.capturedAt.getTime() === c.capturedAt.getTime());
      if (same) {
        if (same.value === c.value) result.duplicates.push({ line: c.line, capturedAt: c.capturedAt, value: c.value });
        else result.invalid.push({ line: c.line, reason: `Conflicts with an existing reading of ${same.value} kWh at the same time; correct that reading instead` });
        continue;
      }
      const before = known
        .filter((r) => r.validation === 'accepted' && r.capturedAt.getTime() < c.capturedAt.getTime())
        .sort((a, b) => b.capturedAt - a.capturedAt)[0];
      const baseEpoch = before?.epoch ?? 1;
      const epoch = Number.isInteger(Number(c.epoch)) && Number(c.epoch) > 0 ? Number(c.epoch) : c.newEpoch ? baseEpoch + 1 : baseEpoch;
      const candidate = { meterId, register, epoch, value: c.value, capturedAt: c.capturedAt, sourceType, quality: c.quality };
      const { validation, reason } = validateReading(candidate, known, { maxSupplyKw });
      const doc = {
        ...candidate,
        kind: 'cumulative',
        unit: 'kWh',
        receivedAt: now(),
        dataMode,
        validation,
        validationReason: reason ?? undefined,
        eventId: c.eventId,
        enteredBy,
        rawText: c.rawText,
      };
      known.push(doc);
      (validation === 'accepted' ? result.accepted : result.needsReview).push({ line: c.line, capturedAt: c.capturedAt, value: c.value, epoch, reason, doc });
    }
    touchedMeters.add(meterId);
  }

  const summary = {
    accepted: result.accepted.length,
    needsReview: result.needsReview.length,
    duplicates: result.duplicates.length,
    invalid: result.invalid.length,
    committed: false,
    format: 'cumulative',
    dataMode,
    timezoneAssumption: 'Each timestamp must carry its own UTC offset; none is assumed',
  };

  if (commit) {
    const docs = [...result.accepted, ...result.needsReview].map((r) => r.doc);
    if (docs.length) {
      try {
        await MeterReading.insertMany(docs, { ordered: false });
      } catch (err) {
        // A concurrent identical import can win the unique index; those rows are duplicates, not failures.
        if (err.code !== 11000 && !err.writeErrors?.every((w) => w.code === 11000)) throw err;
      }
    }
    for (const meterId of touchedMeters) await rebuildIntervals(meterId);
    for (const meterId of touchedMeters) await evaluateMeter(meterId);
    summary.committed = true;
  }

  const strip = (list) => list.map(({ doc, ...rest }) => rest);
  return { summary, accepted: strip(result.accepted), needsReview: strip(result.needsReview), duplicates: result.duplicates, invalid: result.invalid };
}

// Re-derives cumulative intervals from accepted readings. Unchanged intervals keep their baseline.
export async function rebuildIntervals(meterId) {
  const settings = await getSettings();
  const readings = await MeterReading.find({ meterId, register: 'import_kwh', validation: 'accepted' }).sort({ capturedAt: 1 }).lean();
  const derived = deriveIntervals(readings, { cadenceMinutes: settings.anomaly.expectedCadenceMinutes });
  const existing = await EnergyInterval.find({ meterId, sourceKind: 'cumulative_diff' }).lean();
  const keyOf = (i) => `${new Date(i.startAt).getTime()}|${new Date(i.endAt).getTime()}`;
  const derivedByKey = new Map(derived.map((i) => [keyOf(i), i]));
  const existingByKey = new Map(existing.map((i) => [keyOf(i), i]));

  const stale = existing.filter((i) => {
    const d = derivedByKey.get(keyOf(i));
    return !d || d.energyKwh !== i.energyKwh || d.dataMode !== i.dataMode;
  });
  if (stale.length) await EnergyInterval.deleteMany({ _id: { $in: stale.map((i) => i._id) } });
  const staleKeys = new Set(stale.map(keyOf));
  const fresh = derived.filter((i) => !existingByKey.has(keyOf(i)) || staleKeys.has(keyOf(i)));
  if (fresh.length) {
    await EnergyInterval.insertMany(fresh.map((i) => ({ ...i, meterId, sourceKind: 'cumulative_diff' })), { ordered: false });
  }
  return { total: derived.length, inserted: fresh.length, removed: stale.length };
}

export async function ingestIntervalRows(rows, { dataMode, commit = true }) {
  const result = { accepted: [], duplicates: [], invalid: [] };
  const current = now().getTime();
  const pending = [];
  for (const [index, raw] of rows.entries()) {
    const line = index + 1;
    const startAt = parseIsoDate(raw.intervalStart);
    const endAt = parseIsoDate(raw.intervalEnd);
    const energyKwh = Number(raw.energyKwh);
    if (!raw.meterId) result.invalid.push({ line, reason: 'meterId is missing' });
    else if (!startAt || !endAt) result.invalid.push({ line, reason: 'intervalStart and intervalEnd must be ISO 8601 timestamps with a UTC offset' });
    else if (endAt <= startAt) result.invalid.push({ line, reason: 'intervalEnd must be after intervalStart' });
    else if (raw.energyKwh === '' || !Number.isFinite(energyKwh) || energyKwh < 0) result.invalid.push({ line, reason: 'energyKwh must be a non-negative number' });
    else if (endAt.getTime() > current + FUTURE_TOLERANCE_MS) result.invalid.push({ line, reason: 'interval ends in the future' });
    else {
      const overlapping = [
        ...(await EnergyInterval.find({ meterId: raw.meterId, startAt: { $lt: endAt }, endAt: { $gt: startAt } }).lean()),
        ...pending.filter((p) => p.meterId === raw.meterId && p.startAt < endAt && p.endAt > startAt),
      ];
      const identical = overlapping.find((o) => o.startAt.getTime() === startAt.getTime() && o.endAt.getTime() === endAt.getTime() && o.energyKwh === energyKwh);
      if (identical) result.duplicates.push({ line, startAt, endAt, energyKwh });
      else if (overlapping.length) result.invalid.push({ line, reason: 'Overlaps energy already recorded for this meter; sources are reconciled, not added together' });
      else {
        const durationHours = round((endAt - startAt) / 3_600_000);
        const doc = {
          meterId: raw.meterId,
          startAt,
          endAt,
          energyKwh,
          durationHours,
          averagePowerKw: round(energyKwh / durationHours),
          isGap: false,
          sourceKind: 'interval_import',
          dataMode,
          sourceLabel: dataMode === 'live' ? 'Metered' : 'Simulated',
        };
        pending.push(doc);
        result.accepted.push({ line, startAt, endAt, energyKwh });
      }
    }
  }
  const summary = { accepted: result.accepted.length, needsReview: 0, duplicates: result.duplicates.length, invalid: result.invalid.length, committed: false, format: 'interval', dataMode, timezoneAssumption: 'Each timestamp must carry its own UTC offset; none is assumed' };
  if (commit) {
    if (pending.length) await EnergyInterval.insertMany(pending, { ordered: false });
    for (const meterId of new Set(pending.map((p) => p.meterId))) await evaluateMeter(meterId);
    summary.committed = true;
  }
  return { summary, ...result, needsReview: [] };
}

export async function importMeterCsv(text, { dataMode, enteredBy, commit }) {
  const records = parseCsv(text);
  const format = detectMeterCsvFormat(records);
  if (format === 'interval') return ingestIntervalRows(records, { dataMode, commit });
  const rows = records.map((r, i) => ({ meterId: r.meterId, capturedAt: r.capturedAt, value: r.readingKwh, register: r.register, epoch: r.epoch, line: i + 2 }));
  return ingestReadings(rows, { sourceType: 'csv', dataMode, enteredBy, commit });
}

// Review of a needs_review reading: accept as read, correct the value, reject, or start a new meter epoch.
export async function reviewReading(readingId, { action, correctedValue, note }, user) {
  const reading = await MeterReading.findById(readingId);
  if (!reading) return null;
  const fromValue = reading.value;
  if (action === 'reject') {
    reading.validation = 'rejected';
  } else if (action === 'new_epoch') {
    const later = await MeterReading.find({ meterId: reading.meterId, register: reading.register, capturedAt: { $gte: reading.capturedAt } });
    const maxEpoch = (await MeterReading.findOne({ meterId: reading.meterId, register: reading.register }).sort({ epoch: -1 }).lean())?.epoch ?? 1;
    for (const r of later) {
      r.epoch = maxEpoch + 1;
      if (r._id.equals(reading._id)) continue;
      await r.save();
    }
    reading.epoch = maxEpoch + 1;
    reading.validation = 'accepted';
    reading.validationReason = 'Accepted as the first reading of a new meter epoch';
  } else {
    if (action === 'correct') {
      if (!Number.isFinite(correctedValue) || correctedValue < 0) throw badRequest('invalid_value', 'correctedValue must be a non-negative number');
      reading.value = correctedValue;
    }
    const settings = await getSettings();
    const known = await MeterReading.find({ meterId: reading.meterId, register: reading.register, _id: { $ne: reading._id } }).lean();
    const check = validateReading(
      { epoch: reading.epoch, value: reading.value, capturedAt: reading.capturedAt, sourceType: 'manual' },
      known,
      { maxSupplyKw: settings.anomaly.maxSupplyKw },
    );
    if (check.validation !== 'accepted' && action === 'correct') throw badRequest('still_inconsistent', check.reason);
    reading.validation = 'accepted';
    reading.validationReason = action === 'correct' ? 'Corrected during review' : 'Accepted during review';
  }
  reading.corrections.push({ at: now(), by: user._id, fromValue, toValue: reading.value, action, note });
  await reading.save();
  await rebuildIntervals(reading.meterId);
  await evaluateMeter(reading.meterId);
  return reading;
}
