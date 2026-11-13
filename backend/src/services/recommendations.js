import { now } from '../clock.js';
import { Device, EnergyInterval, Incident, Recommendation, Room, Schedule } from '../models/index.js';
import { dayCategory, localParts, round, startOfLocalDay } from '../util/time.js';
import { median, ratedLoadEstimateKwh, simplePaybackMonths } from './energy.js';
import { badRequest, conflict, getSettings } from './core.js';
import { dayTotals, listIntervals } from './analytics.js';

const LOOKBACK_DAYS = 30;

function money(kwh, tariff) {
  return round(kwh * tariff, 2);
}

function tariffAssumption(settings) {
  return `Energy-only tariff of ₹${settings.tariffPerKwh}/kWh${settings.tariffIsHypothetical ? ' (hypothetical demo rate)' : ''}; fixed and demand charges excluded`;
}

async function upsert(ruleKey, fields) {
  const existing = await Recommendation.findOne({ ruleKey });
  // A recommendation someone has already acted on keeps its recorded evidence and estimate.
  if (existing && existing.status !== 'proposed') return existing;
  return Recommendation.findOneAndUpdate({ ruleKey }, { $set: fields, $setOnInsert: { ruleKey, status: 'proposed' } }, { upsert: true, returnDocument: 'after' });
}

// Rule 1: night-time building consumption above the configured essential-load baseline.
async function overnightRule(settings, since) {
  const tz = settings.timezone;
  const intervals = await EnergyInterval.find({ meterId: settings.meterId, isGap: false, startAt: { $gte: since } }).lean();
  const night = intervals.filter((i) => {
    const h = localParts(i.startAt, tz).hour;
    return h >= 23 || h < 5;
  });
  const nights = new Set(night.map((i) => localParts(new Date(i.startAt.getTime() - 6 * 3_600_000), tz).date)).size;
  if (nights < 7) return null;
  const typicalKw = median(night.map((i) => i.averagePowerKw));
  const excessKw = typicalKw - settings.anomaly.essentialLoadKw;
  if (excessKw < 0.5) return null;
  const monthlyKwh = excessKw * 6 * 30;
  const simulated = night.some((i) => i.dataMode !== 'live');
  return upsert('overnight-baseline', {
    pattern: 'Repeated unexplained overnight usage',
    title: 'Overnight consumption is above the essential-load baseline',
    explanation: `Between 23:00 and 05:00 the building typically draws ${round(typicalKw, 1)} kW on average, against a configured essential load of ${settings.anomaly.essentialLoadKw} kW.`,
    evidence: [{ text: `Median of ${night.length} night-time intervals across ${nights} nights`, source: simulated ? 'Simulated' : 'Metered' }],
    action: 'Inspect always-on equipment after the last class, switch off what is not needed, and document the loads that must stay on.',
    ownerRole: 'admin',
    overlapGroup: 'building:overnight',
    estimate: {
      kwhLow: round(monthlyKwh * 0.4, 1),
      kwhHigh: round(monthlyKwh * 0.8, 1),
      costLow: money(monthlyKwh * 0.4, settings.tariffPerKwh),
      costHigh: money(monthlyKwh * 0.8, settings.tariffPerKwh),
      period: 'month',
      method: '(typical night kW − essential-load kW) × 6 h × 30 nights; 40–80% assumed avoidable',
      assumptions: [tariffAssumption(settings), 'The essential-load baseline is an administrator setting, not a measurement', 'The avoidable share is unknown until an inspection is recorded'],
    },
    confidence: 'low',
    limitations: ['The building meter cannot show which room or equipment draws this power', 'Weather is not considered'],
    priority: monthlyKwh > 300 ? 'high' : 'medium',
    dataMode: simulated ? 'simulated' : 'live',
  });
}

// Rule 2: a room that keeps generating vacant-room incidents.
async function repeatIncidentRule(settings, since) {
  const groups = await Incident.aggregate([
    { $match: { type: 'vacancy_waste', openedAt: { $gte: since }, state: { $ne: 'cancelled' } } },
    { $group: { _id: '$roomId', count: { $sum: 1 }, simulated: { $sum: { $cond: [{ $ne: ['$dataMode', 'live'] }, 1, 0] } } } },
    { $match: { count: { $gte: 3 } } },
  ]);
  const out = [];
  const b = settings.budget;
  for (const g of groups) {
    const room = await Room.findById(g._id).lean();
    if (!room) continue;
    const devices = await Device.find({ roomId: room._id, essential: false }).lean();
    const watts = devices.reduce((s, d) => s + d.ratedWatts * (d.quantity ?? 1), 0);
    if (!watts) continue;
    const perMonth = (g.count / LOOKBACK_DAYS) * 30;
    const low = ratedLoadEstimateKwh(watts, perMonth * 0.5);
    const high = ratedLoadEstimateKwh(watts, perMonth * 2);
    const installed = (b.roomMasterBreakerQuote ?? 0) + (b.feederAndLabourQuote ?? 0);
    const netMonthly = money((low + high) / 2, settings.tariffPerKwh) - (b.monthlySoftwareEquivalent ?? 0) - (b.monthlyMaintenance ?? 0);
    out.push(
      await upsert(`room-repeat:${room._id}`, {
        pattern: 'Repeated manual forgetfulness in one room',
        title: `${room.code}: supply is repeatedly left on in the empty room`,
        explanation: `${g.count} vacant-room incidents were recorded for ${room.code} in the last ${LOOKBACK_DAYS} days.`,
        evidence: [{ text: `${g.count} incidents in ${LOOKBACK_DAYS} days`, source: g.simulated ? 'Simulated' : 'Camera-observed' }],
        action: `Assign a last-user switch-off check for ${room.code}, and compare a room-master installation quote with the estimated avoidable usage.`,
        ownerRole: 'hod',
        ownerId: room.assignments?.secondResponderId,
        roomId: room._id,
        overlapGroup: `room:${room._id}:idle`,
        estimate: {
          kwhLow: low,
          kwhHigh: high,
          costLow: money(low, settings.tariffPerKwh),
          costHigh: money(high, settings.tariffPerKwh),
          period: 'month',
          method: 'rated watts ÷ 1000 × avoidable hours, assuming 0.5–2 idle hours per incident',
          assumptions: [tariffAssumption(settings), `Rated load of ${watts} W from the manual inventory, with everything running`, 'Idle duration per incident is assumed, not measured'],
        },
        implementationCost: installed || undefined,
        paybackMonths: simplePaybackMonths(installed, netMonthly) ?? undefined,
        confidence: 'low',
        limitations: ['Rated-load estimate, not metered room consumption', 'Payback is shown only when a quote is entered and the net benefit is positive'],
        priority: g.count >= 6 ? 'high' : 'medium',
        dataMode: g.simulated ? 'simulated' : 'live',
      }),
    );
  }
  return out;
}

// Rule 3: rooms that are barely timetabled, where classes could share a room.
async function sparseRoomRule(settings, since) {
  const rooms = await Room.find({ zoneType: 'room' }).lean();
  const weeks = LOOKBACK_DAYS / 7;
  const usage = [];
  for (const room of rooms) {
    const schedules = await Schedule.find({ roomId: room._id, status: 'confirmed', startAt: { $gte: since, $lt: now() } }).lean();
    const hours = schedules.reduce((s, x) => s + (x.endAt - x.startAt) / 3_600_000, 0);
    usage.push({ room, hoursPerWeek: hours / weeks, sessions: schedules.length });
  }
  const sparse = usage.filter((u) => u.sessions > 0 && u.hoursPerWeek < 8).sort((a, b) => a.hoursPerWeek - b.hoursPerWeek);
  if (sparse.length < 2) return null;
  const target = sparse[0];
  const devices = await Device.find({ roomId: target.room._id, essential: false }).lean();
  const watts = devices.reduce((s, d) => s + d.ratedWatts * (d.quantity ?? 1), 0);
  if (!watts) return null;
  const monthlyHours = target.hoursPerWeek * (30 / 7);
  const low = ratedLoadEstimateKwh(watts, monthlyHours * 0.2);
  const high = ratedLoadEstimateKwh(watts, monthlyHours * 0.5);
  return upsert(`sparse-room:${target.room._id}`, {
    pattern: 'Several suitable rooms used sparsely in the same building',
    title: `Review whether ${target.room.code}'s classes can share another lightly used room`,
    explanation: `${sparse.map((u) => `${u.room.code} is timetabled about ${round(u.hoursPerWeek, 1)} h/week`).join('; ')}.`,
    evidence: [{ text: `Confirmed timetable entries over the last ${LOOKBACK_DAYS} days`, source: 'Estimated' }],
    action: 'Ask the timetable owner to review consolidation within available room capacity. No schedule is changed automatically.',
    ownerRole: 'hod',
    roomId: target.room._id,
    overlapGroup: `room:${target.room._id}:idle`,
    estimate: {
      kwhLow: low,
      kwhHigh: high,
      costLow: money(low, settings.tariffPerKwh),
      costHigh: money(high, settings.tariffPerKwh),
      period: 'month',
      method: 'rated watts ÷ 1000 × timetabled hours, assuming 20–50% of conditioning and lighting hours are avoided',
      assumptions: [tariffAssumption(settings), `Rated load of ${watts} W from the manual inventory`, 'The other room has enough capacity and free slots; staff must confirm'],
    },
    confidence: 'low',
    limitations: ['Rated-load estimate, not metered room consumption', 'Moving a class also moves its load; the net saving depends on the receiving room'],
    priority: 'low',
    dataMode: 'live',
  });
}

export async function generateRecommendations() {
  const settings = await getSettings();
  const since = new Date(now().getTime() - LOOKBACK_DAYS * 86_400_000);
  const results = [await overnightRule(settings, since), ...(await repeatIncidentRule(settings, since)), await sparseRoomRule(settings, since)];
  return results.filter(Boolean);
}

const TRANSITIONS = {
  accept: ['proposed'],
  reject: ['proposed', 'accepted'],
  complete: ['accepted'],
  verify: ['completed'],
};

export async function transitionRecommendation(rec, action, user, { reason, note, dueDate, ownerId } = {}) {
  if (!TRANSITIONS[action].includes(rec.status)) throw conflict('invalid_state', `Cannot ${action} a recommendation that is ${rec.status}`);
  if (action === 'accept') {
    rec.status = 'accepted';
    rec.acceptedAt = now();
    if (dueDate) rec.dueDate = dueDate;
    if (ownerId) rec.ownerId = ownerId;
  } else if (action === 'reject') {
    if (!reason) throw badRequest('reason_required', 'A reason is required to reject a recommendation');
    rec.status = 'rejected';
    rec.rejectReason = reason;
  } else if (action === 'complete') {
    rec.status = 'completed';
    rec.completedAt = now();
    rec.outcome = { note, label: 'Action recorded as completed; no reduction has been measured yet' };
  } else if (action === 'verify') {
    rec.outcome = { ...(rec.outcome?.toObject?.() ?? rec.outcome ?? {}), ...(await compareBeforeAfter(rec)) };
    if (rec.outcome.observedReductionKwhPerDay != null) rec.status = 'verified';
  }
  rec.history.push({ at: now(), by: user._id, action, note: reason ?? note });
  await rec.save();
  return rec;
}

// Compares like days before acceptance with days after completion. This is an observed
// difference on the building meter, not causally verified savings.
export async function compareBeforeAfter(rec) {
  const settings = await getSettings();
  const tz = settings.timezone;
  const anchor = rec.acceptedAt ?? rec.completedAt;
  const perDay = async (from, to) => {
    const totals = [];
    for (let d = startOfLocalDay(from, tz); d < to; d = new Date(d.getTime() + 86_400_000)) {
      const end = new Date(d.getTime() + 86_400_000);
      if (end > to || dayCategory(d, tz, settings.holidays) !== 'teaching') continue;
      const t = dayTotals(await listIntervals({ meterId: settings.meterId, from: d, to: end }), d, end);
      if (t.coveredHours >= 23) totals.push(t.energyKwh);
    }
    return totals;
  };
  const before = await perDay(new Date(anchor.getTime() - 14 * 86_400_000), startOfLocalDay(anchor, tz));
  const after = await perDay(new Date(startOfLocalDay(rec.completedAt, tz).getTime() + 86_400_000), now());
  if (before.length < 3 || after.length < 1) {
    return { evaluatedAt: now(), comparisonDays: after.length, label: 'Not enough complete teaching days after completion to compare yet' };
  }
  const baseline = median(before);
  const observed = median(after);
  return {
    baselineKwhPerDay: round(baseline, 2),
    observedKwhPerDay: round(observed, 2),
    observedReductionKwhPerDay: round(baseline - observed, 2),
    comparisonDays: after.length,
    evaluatedAt: now(),
    label: 'Observed difference on the building meter between comparable teaching days. Not causally verified: timetable, weather and equipment changes are not controlled for.',
  };
}
