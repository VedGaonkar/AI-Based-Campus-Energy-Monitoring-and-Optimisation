// Shared by the chart, range totals, details and export. Never rebucket gap totals.
export const validEnergy = i => Number.isFinite(i.energyKwh) && i.energyKwh >= 0 && Date.parse(i.endAt) > Date.parse(i.startAt);
export const hasBaseline = i => Number.isFinite(i.baseline?.expectedKwh);
export function comparison(i) {
  if (!validEnergy(i)) return "Reading unavailable";
  if (!hasBaseline(i)) return "Baseline unavailable";
  return i.energyKwh > i.baseline.expectedKwh ? "Above baseline" : "At or below baseline";
}
export function baselineLabel(i) {
  return ({ initial_rule: "Configured hourly expectation × interval duration", historical_median: "Historical median: similar hour, day type, schedule activity and duration", insufficient_data: "Insufficient baseline history" })[i.baseline?.method] ?? "Baseline method unavailable";
}
export function selectIntervals(intervals, { range = 7, meter, mode, from, to } = {}) {
  const scoped = intervals.filter(i => (!meter || i.meterId === meter) && (!mode || i.dataMode === mode));
  const end = to ? Date.parse(to) : Math.max(...scoped.map(i => Date.parse(i.endAt)).filter(Number.isFinite));
  const start = from ? Date.parse(from) : end - range * 86400000;
  // Whole intervals only: clipping an interval would invent a partial measurement.
  return scoped.filter(i => Date.parse(i.startAt) >= start && Date.parse(i.endAt) <= end).sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
}
export function connected(a, b) {
  return a && b && validEnergy(a) && validEnergy(b) && a.coverage !== "gap_aggregate" && b.coverage !== "gap_aggregate" &&
    a.meterId === b.meterId && a.epoch === b.epoch && a.register === b.register && a.dataMode === b.dataMode &&
    Date.parse(a.endAt) === Date.parse(b.startAt) && Math.abs(a.durationHours - b.durationHours) < 0.001;
}
function point(i) {
  const actual = validEnergy(i) ? i.energyKwh : null;
  const expected = hasBaseline(i) ? i.baseline.expectedKwh : null;
  return { time: Date.parse(i.endAt), actual, expected, interval: i,
    below: actual !== null && expected !== null && actual <= expected ? actual : null,
    above: actual !== null && expected !== null && actual > expected ? actual : null,
    unknown: actual !== null && expected === null ? actual : null };
}
export function chartRows(intervals) {
  const rows = [];
  for (let index = 0; index < intervals.length; index++) {
    const i = intervals[index], previous = intervals[index - 1], p = point(i);
    if (previous) {
      const a = point(previous);
      if (!connected(previous, i)) rows.push({ time: (a.time + p.time) / 2, actual: null, below: null, above: null, unknown: null, expected: null });
      else if (a.expected !== null && p.expected !== null && a.actual !== null && p.actual !== null) {
        const d0 = a.actual - a.expected, d1 = p.actual - p.expected;
        if (d0 * d1 < 0) {
          const fraction = d0 / (d0 - d1);
          const value = a.actual + fraction * (p.actual - a.actual);
          rows.push({ time: a.time + fraction * (p.time - a.time), below: value, above: value, expected: value, crossing: true });
        } else {
          // An equality endpoint belongs to both segments so the line reaches it.
          if (d0 === 0 && d1 > 0) rows.at(-1).above = a.actual;
          if (d1 === 0 && d0 > 0) p.above = p.actual;
        }
      }
    }
    rows.push(p);
  }
  return rows;
}
export function totals(intervals) {
  const valid = intervals.filter(validEnergy), comparable = valid.filter(hasBaseline);
  return { actual: valid.reduce((s, i) => s + i.energyKwh, 0), expected: comparable.reduce((s, i) => s + i.baseline.expectedKwh, 0), comparable: comparable.length, count: valid.length };
}
export function sourceLabel(i) {
  return `${i.dataMode === "live" ? "Metered" : "Simulated"} · ${i.meterId} · ${(i.sourceTypes?.length ? i.sourceTypes.join(" / ") : "source method unavailable").replaceAll("_", " ")}`;
}
export function freshness(i, now = Date.now()) {
  if (!i) return "No accepted readings";
  if (i.dataMode !== "live") return "Simulated / historical data";
  return now - Date.parse(i.endAt) > Math.max(1 / 60, i.durationHours) * 7200000 ? "Stale reading" : "Recent accepted reading";
}
export function qualityWarnings(intervals) {
  const warnings = [];
  intervals.forEach((i, index) => {
    if (!validEnergy(i)) warnings.push("Invalid or missing interval reading");
    if (i.coverage === "gap_aggregate") warnings.push("Gap aggregate: total energy only; usage within this interval is unknown");
    if (!hasBaseline(i)) warnings.push("Some intervals have no applicable baseline");
    if (index && Date.parse(i.startAt) > Date.parse(intervals[index - 1].endAt)) warnings.push("Missing readings between recorded intervals");
    if (index && !connected(intervals[index - 1], i)) warnings.push("Line breaks mark gaps, epoch boundaries or changes in interval duration");
  });
  return [...new Set(warnings)];
}
export function consumptionCsv(intervals) {
  const headers = ["meter", "mode", "start_utc", "end_utc", "duration_hours", "actual_kWh", "baseline_kWh", "average_power_kW", "comparison", "anomaly", "threshold_kWh", "baseline_method", "baseline_samples", "coverage", "source", "source_reading_ids"];
  // Spreadsheet formula injection is possible even in authorised text fields.
  const cell = value => `"${String(value ?? "").replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`;
  return [headers, ...intervals.map(i => [i.meterId, i.dataMode, i.startAt, i.endAt, i.durationHours, i.energyKwh, i.baseline?.expectedKwh, i.averagePowerKw, comparison(i), i.anomalous ? "Flagged anomaly; cause unconfirmed" : "Not flagged", i.baseline?.thresholdKwh, baselineLabel(i), i.baseline?.sampleCount, i.coverage, sourceLabel(i), i.sourceReadingIds?.join(" / ")])].map(row => row.map(cell).join(",")).join("\r\n");
}
