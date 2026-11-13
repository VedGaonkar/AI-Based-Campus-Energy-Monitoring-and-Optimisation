import { round } from '../util/time.js';

// Pure energy arithmetic. kWh is energy; kW here is always the average over the interval.

export function intervalFromReadings(previous, current) {
  const durationHours = (new Date(current.capturedAt).getTime() - new Date(previous.capturedAt).getTime()) / 3_600_000;
  const energyKwh = round(current.value - previous.value);
  return {
    startAt: new Date(previous.capturedAt),
    endAt: new Date(current.capturedAt),
    energyKwh,
    durationHours: round(durationHours),
    averagePowerKw: round(energyKwh / durationHours),
  };
}

// `readings` must be accepted cumulative readings of one meter and register.
// Readings from different epochs are never differenced, so a reset or replacement
// cannot produce negative consumption. A long span stays one aggregate gap interval.
export function deriveIntervals(readings, { cadenceMinutes = 60 } = {}) {
  const sorted = [...readings].sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt));
  const intervals = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev.epoch !== cur.epoch) continue;
    const base = intervalFromReadings(prev, cur);
    if (base.durationHours <= 0 || base.energyKwh < 0) continue;
    const simulated = prev.dataMode !== 'live' || cur.dataMode !== 'live';
    intervals.push({
      ...base,
      isGap: base.durationHours * 60 > cadenceMinutes * 1.5,
      sourceReadingIds: [prev._id, cur._id].filter(Boolean),
      dataMode: simulated ? 'simulated' : 'live',
      sourceLabel: simulated ? 'Simulated' : 'Metered',
    });
  }
  return intervals;
}

export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// 1.4826 * MAD estimates a standard deviation without being dragged by outliers.
export function robustSigma(values) {
  const m = median(values);
  if (m === null) return null;
  return 1.4826 * median(values.map((v) => Math.abs(v - m)));
}

export function computeBaseline(samples, cfg, { durationHours = 1, teachingHour = false } = {}) {
  const { minSamples = 8, absoluteExcessFloorKwh = 2, relativeThreshold = 0.3, initialRule } = cfg;
  if (samples.length >= minSamples) {
    const expectedKwh = median(samples);
    const sigma = robustSigma(samples);
    return {
      method: 'historical',
      expectedKwh: round(expectedKwh, 3),
      robustSigmaKwh: round(sigma, 3),
      thresholdKwh: round(Math.max(expectedKwh + absoluteExcessFloorKwh, expectedKwh * (1 + relativeThreshold), expectedKwh + 3 * sigma), 3),
      lowKwh: round(Math.max(0, expectedKwh - Math.max(absoluteExcessFloorKwh, 3 * sigma)), 3),
      sampleCount: samples.length,
    };
  }
  if (initialRule?.enabled) {
    const expectedKwh = (teachingHour ? initialRule.teachingHourKwh : initialRule.offHourKwh) * durationHours;
    return {
      method: 'initial_rule',
      expectedKwh: round(expectedKwh, 3),
      robustSigmaKwh: null,
      thresholdKwh: round(Math.max(expectedKwh + absoluteExcessFloorKwh, expectedKwh * (1 + relativeThreshold)), 3),
      lowKwh: round(Math.max(0, expectedKwh - absoluteExcessFloorKwh), 3),
      sampleCount: samples.length,
    };
  }
  return { method: 'insufficient', expectedKwh: null, robustSigmaKwh: null, thresholdKwh: null, lowKwh: null, sampleCount: samples.length };
}

export function isAnomalous(energyKwh, baseline) {
  return baseline.thresholdKwh !== null && baseline.thresholdKwh !== undefined && energyKwh > baseline.thresholdKwh;
}

export function ratedLoadEstimateKwh(ratedWatts, avoidableHours) {
  return round((ratedWatts / 1000) * avoidableHours, 3);
}

// Payback is only meaningful when the net monthly benefit is positive.
export function simplePaybackMonths(oneTimeInstalledCost, estimatedMonthlyNetBenefit) {
  if (!(oneTimeInstalledCost > 0) || !(estimatedMonthlyNetBenefit > 0)) return null;
  return round(oneTimeInstalledCost / estimatedMonthlyNetBenefit, 1);
}

// Recommendations in one overlap group describe the same avoidable energy,
// so only the largest in each group contributes to the total.
export function nonOverlappingSavings(recommendations) {
  const groups = new Map();
  for (const r of recommendations) {
    const e = r.estimate ?? {};
    const cur = groups.get(r.overlapGroup);
    if (!cur || (e.kwhHigh ?? 0) > (cur.kwhHigh ?? 0)) groups.set(r.overlapGroup, e);
  }
  const total = { kwhLow: 0, kwhHigh: 0, costLow: 0, costHigh: 0 };
  for (const e of groups.values()) {
    total.kwhLow += e.kwhLow ?? 0;
    total.kwhHigh += e.kwhHigh ?? 0;
    total.costLow += e.costLow ?? 0;
    total.costHigh += e.costHigh ?? 0;
  }
  return Object.fromEntries(Object.entries(total).map(([k, v]) => [k, round(v, 2)]));
}
