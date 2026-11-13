import { now } from '../clock.js';
import { EnergyInterval, Incident, MeterReading, Observation, Recommendation, Room, Schedule } from '../models/index.js';
import { dayCategory, localParts, round, startOfLocalDay } from '../util/time.js';
import { computeBaseline, isAnomalous, nonOverlappingSavings } from './energy.js';
import { emitLive, getSettings } from './core.js';
import { notifyAnomalyResponders } from './incidents.js';

export const BASELINE_VERSION = 1;
const INCIDENT_WINDOW_MS = 72 * 3_600_000;

function overlapsAny(sortedSchedules, start, end) {
  for (const s of sortedSchedules) {
    if (s.startAt >= end) break;
    if (s.endAt > start) return true;
  }
  return false;
}

// Evaluates every interval that has no current baseline, in time order, against earlier
// comparable intervals: same local hour, same day category and, when enough samples exist,
// the same timetable activity. Intervals already flagged anomalous never train the baseline.
export async function evaluateMeter(meterId, { force = false } = {}) {
  const settings = await getSettings();
  const tz = settings.timezone;
  const cfg = settings.anomaly;
  const windowMs = cfg.trainingWindowDays * 86_400_000;
  const intervals = await EnergyInterval.find({ meterId }).sort({ startAt: 1 });
  const schedules = await Schedule.find({ status: 'confirmed' }).select('startAt endAt').sort({ startAt: 1 }).lean();

  const meta = intervals.map((i) => ({
    hour: localParts(i.startAt, tz).hour,
    category: dayCategory(i.startAt, tz, settings.holidays),
    active: overlapsAny(schedules, i.startAt, i.endAt),
  }));

  const changed = [];
  for (let i = 0; i < intervals.length; i += 1) {
    const target = intervals[i];
    if (!force && target.baseline?.version === BASELINE_VERSION) continue;
    if (target.isGap) {
      // An aggregate gap has no like-duration history to compare against.
      target.baseline = { method: 'insufficient', sampleCount: 0, matchRule: 'gap interval', version: BASELINE_VERSION, evaluatedAt: now() };
      target.anomalous = false;
      changed.push(target);
      continue;
    }
    const strict = [];
    const loose = [];
    for (let j = 0; j < i; j += 1) {
      const c = intervals[j];
      if (c.isGap || c.anomalous) continue;
      if (target.startAt - c.startAt > windowMs) continue;
      if (Math.abs(c.durationHours - target.durationHours) > target.durationHours * 0.1) continue;
      if (meta[j].hour !== meta[i].hour || meta[j].category !== meta[i].category) continue;
      loose.push(c.energyKwh);
      if (meta[j].active === meta[i].active) strict.push(c.energyKwh);
    }
    const useStrict = strict.length >= cfg.minSamples;
    const baseline = computeBaseline(useStrict ? strict : loose, cfg, {
      durationHours: target.durationHours,
      teachingHour: meta[i].category === 'teaching' && meta[i].active,
    });
    target.baseline = {
      ...baseline,
      matchRule: `same hour, ${meta[i].category} day${useStrict ? ', same timetable activity' : ''}`,
      version: BASELINE_VERSION,
      evaluatedAt: now(),
    };
    target.anomalous = isAnomalous(target.energyKwh, baseline);
    target.excessKwh = target.anomalous ? round(target.energyKwh - baseline.expectedKwh, 3) : undefined;
    changed.push(target);
  }
  if (changed.length) {
    await EnergyInterval.bulkWrite(
      changed.map((d) => ({ updateOne: { filter: { _id: d._id }, update: { $set: { baseline: d.baseline, anomalous: d.anomalous, excessKwh: d.excessKwh ?? null } } } })),
    );
  }

  const recent = changed.filter((i) => i.anomalous && now() - i.endAt <= INCIDENT_WINDOW_MS);
  for (const interval of recent) await openAnomalyIncident(interval, settings);
  return { evaluated: changed.length, anomalies: changed.filter((i) => i.anomalous).length };
}

// Candidates only. Nothing here measures what a room consumed.
async function possibleContributors(interval, settings) {
  const observations = await Observation.find({
    capturedAt: { $gte: interval.startAt, $lt: interval.endAt },
    equipmentOn: true,
    occupancy: { $ne: 'occupied' },
    'quality.usable': { $ne: false },
  }).lean();
  const roomIds = [...new Set(observations.map((o) => String(o.roomId)))];
  const out = [];
  for (const roomId of roomIds) {
    const room = await Room.findById(roomId).lean();
    if (!room) continue;
    const booked = await Schedule.exists({ roomId, status: 'confirmed', startAt: { $lt: interval.endAt }, endAt: { $gt: interval.startAt } });
    if (booked) continue;
    const obs = observations.find((o) => String(o.roomId) === roomId);
    out.push({
      roomId,
      roomCode: room.code,
      text: `Equipment appears ON in ${room.code} with no person detected and no scheduled use`,
      source: obs.dataMode !== 'live' ? 'Simulated' : obs.sourceType === 'camera' ? 'Camera-observed' : 'Sensor-reported',
    });
  }
  const incidents = await Incident.find({ type: 'vacancy_waste', openedAt: { $lt: interval.endAt }, $or: [{ resolvedAt: null }, { resolvedAt: { $gt: interval.startAt } }] }).lean();
  for (const inc of incidents) {
    if (out.some((c) => String(c.roomId) === String(inc.roomId))) continue;
    const room = await Room.findById(inc.roomId).lean();
    if (room) out.push({ roomId: inc.roomId, roomCode: room.code, text: `${room.code} had an open vacant-room incident during this interval`, source: inc.dataMode !== 'live' ? 'Simulated' : 'Camera-observed' });
  }
  return out;
}

export async function openAnomalyIncident(interval, settings) {
  const issueKey = `anomaly:${interval.meterId}:${interval.startAt.toISOString()}`;
  if (await Incident.exists({ issueKey })) return null;
  const contributors = await possibleContributors(interval, settings);
  const b = interval.baseline;
  const span = `${interval.startAt.toISOString()} to ${interval.endAt.toISOString()}`;
  const label = interval.dataMode === 'live' ? 'Metered' : 'Simulated';
  let incident;
  try {
    incident = await Incident.create({
      type: 'energy_anomaly',
      scope: 'building_meter',
      meterId: interval.meterId,
      issueKey,
      state: 'open',
      title: `Building consumption exceeded the expected range (${round(interval.energyKwh, 1)} kWh against ${round(b.expectedKwh, 1)} kWh expected)`,
      severity: interval.energyKwh > b.thresholdKwh * 1.5 ? 'high' : 'medium',
      dataMode: interval.dataMode,
      openedAt: now(),
      evidence: [
        { label, source: interval.meterId, text: `${round(interval.energyKwh, 2)} kWh over ${span} (average ${round(interval.averagePowerKw, 2)} kW over the interval)`, at: interval.endAt },
        { label: 'Estimated', text: `Expected ${b.expectedKwh} kWh, review threshold ${b.thresholdKwh} kWh; ${b.method === 'historical' ? `median of ${b.sampleCount} comparable intervals (${b.matchRule})` : 'initial rule baseline set by an administrator'}. Weather is not considered.` },
        ...contributors.map((c) => ({ label: c.source, source: c.roomCode, text: `${c.text}. Possible contributor, not measured room-level attribution.` })),
      ],
      suspectedCause: contributors.length ? `Possible contributors: ${contributors.map((c) => c.roomCode).join(', ')} (unconfirmed)` : undefined,
      anomaly: {
        intervalId: interval._id,
        startAt: interval.startAt,
        endAt: interval.endAt,
        actualKwh: interval.energyKwh,
        expectedKwh: b.expectedKwh,
        thresholdKwh: b.thresholdKwh,
        excessKwh: round(interval.energyKwh - b.expectedKwh, 3),
        baselineMethod: b.method,
        baselineVersion: b.version,
        sampleCount: b.sampleCount,
        possibleContributors: contributors,
        inspectionStatus: contributors.length ? 'contributors_suggested' : 'manual_inspection_requested',
      },
      timeline: [
        {
          at: now(),
          kind: 'opened',
          actorLabel: 'system',
          text: contributors.length
            ? 'Anomaly opened with possible contributors. Inspect them and other relevant areas, including unmonitored ones. Cause remains unconfirmed.'
            : 'Anomaly opened. No cause is established: manual inspection requested across relevant areas, including areas without cameras or sensors.',
        },
      ],
    });
  } catch (err) {
    if (err.code === 11000) return null;
    throw err;
  }
  await notifyAnomalyResponders(incident, settings);
  incident.state = 'notified_first';
  incident.firstNotifiedAt = now();
  await incident.save();
  await emitLive('incident.updated', { payload: { id: String(incident._id), state: incident.state, type: incident.type } });
  return incident;
}

export async function listIntervals({ meterId, from, to }) {
  const q = { meterId };
  if (from || to) q.endAt = {};
  if (from) q.endAt.$gt = from;
  if (to) q.startAt = { $lt: to };
  if (q.endAt && !Object.keys(q.endAt).length) delete q.endAt;
  return EnergyInterval.find(q).sort({ startAt: 1 }).lean();
}

// Sums a local day. Coverage is reported so a partial day is never shown as a complete one.
export function dayTotals(intervals, dayStart, dayEnd) {
  let energyKwh = 0;
  let coveredMs = 0;
  let simulated = false;
  for (const i of intervals) {
    const s = Math.max(i.startAt.getTime(), dayStart.getTime());
    const e = Math.min(i.endAt.getTime(), dayEnd.getTime());
    if (e <= s) continue;
    // An interval crossing the day boundary is apportioned by time; this is an estimate.
    const share = (e - s) / (i.endAt.getTime() - i.startAt.getTime());
    energyKwh += i.energyKwh * share;
    coveredMs += e - s;
    if (i.dataMode !== 'live') simulated = true;
  }
  return { energyKwh: round(energyKwh, 2), coveredHours: round(coveredMs / 3_600_000, 2), simulated };
}

export async function summary() {
  const settings = await getSettings();
  const at = now();
  const dayStart = startOfLocalDay(at, settings.timezone);
  const intervals = await listIntervals({ meterId: settings.meterId, from: dayStart, to: at });
  const elapsedHours = round((at - dayStart) / 3_600_000, 2);
  const today = dayTotals(intervals, dayStart, at);
  const expectedKwh = intervals.every((i) => i.baseline?.expectedKwh != null) && intervals.length ? round(intervals.reduce((s, i) => s + i.baseline.expectedKwh, 0), 2) : null;
  const latest = await MeterReading.findOne({ meterId: settings.meterId, validation: 'accepted' }).sort({ capturedAt: -1 }).lean();
  const [needsReview, activeAnomalies, openRoomIncidents, recs] = await Promise.all([
    MeterReading.countDocuments({ validation: 'needs_review' }),
    Incident.countDocuments({ active: true, type: 'energy_anomaly' }),
    Incident.countDocuments({ active: true, type: { $in: ['vacancy_waste', 'lease_expiry'] } }),
    Recommendation.find({ status: { $in: ['proposed', 'accepted'] } }).lean(),
  ]);
  return {
    installation: { name: settings.name, timezone: settings.timezone, meterId: settings.meterId },
    today: {
      localDate: localParts(at, settings.timezone).date,
      energyKwh: today.energyKwh,
      coveredHours: today.coveredHours,
      elapsedHours,
      coverageComplete: today.coveredHours >= elapsedHours - 1.5,
      expectedKwh,
      estimatedEnergyCost: round(today.energyKwh * settings.tariffPerKwh, 2),
      costLabel: `Estimated, energy-only, at ${settings.tariffIsHypothetical ? 'a hypothetical' : 'the configured'} ₹${settings.tariffPerKwh}/kWh; excludes fixed and demand charges`,
      sourceLabel: !intervals.length ? 'Unknown' : today.simulated ? 'Simulated' : 'Metered',
    },
    latestReading: latest
      ? { capturedAt: latest.capturedAt, value: latest.value, unit: 'kWh', sourceType: latest.sourceType, dataMode: latest.dataMode, sourceLabel: latest.dataMode === 'live' ? 'Metered' : 'Simulated' }
      : null,
    counts: { readingsNeedingReview: needsReview, activeAnomalies, openRoomIncidents, openRecommendations: recs.length },
    potentialSavings: { ...nonOverlappingSavings(recs), period: 'month', sourceLabel: 'Estimated', note: 'Overlapping recommendations are counted once' },
  };
}
