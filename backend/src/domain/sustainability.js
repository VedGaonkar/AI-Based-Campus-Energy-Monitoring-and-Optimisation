// Whole accepted import-energy intervals only. No interpolation, causal claim or ESG rating.
export const methodology = {
  version: "internal-sustainability-1",
  disclaimer: "Internal sustainability reporting; not a certified ESG rating. Observed changes are not attributed to this software.",
  energy: "Sum accepted, non-overlapping import_kwh intervals in one meter and data mode, wholly inside each UTC period. No boundary proration or gap filling.",
  carbon: "Estimated kg CO2 = interval kWh x applicable kg CO2/kWh. A factor must cover the entire interval. Latest recorded applicable version wins. Missing factors leave emissions incomplete, never zero.",
  coverage: "Regular-interval hours / requested elapsed hours x 100. Gap aggregates contribute known energy but not regular sampling coverage. Missing energy is not estimated.",
  reduction: "(baseline kWh - current kWh) / baseline kWh x 100. Requires recorded energy in both periods and positive baseline. Positive is decrease; negative is increase.",
  social: "Internally approved unique-within-activity student + staff participation / recorded eligible opportunities x 100. Sum only activities with a positive denominator. People across activities may repeat; this is not campus-wide unique participation.",
  governance: "Documentation index: 25 points each for approved evidenced policy covering period, that policy reviewed within period, approved evidenced reporting record covering period, and regular energy coverage meeting the disclosed threshold. Missing input means not recorded, not that no policy exists.",
  money: "Recorded kWh x configured INR/kWh tariff; excludes fixed charges, taxes, tariff history and attribution. Difference is an estimate, not verified savings.",
};
export const defaults = { enabled: false, reductionThreshold: 5, minimumCoverage: 90 };
export const assumedFactor = { _id: "user-assumption-0.675-v1", value: 0.675, unit: "kg CO2/kWh", geography: "Not specified", source: "User-proposed assumption; applicability not verified", reportingYear: "Not specified", effectiveFrom: "1970-01-01T00:00:00.000Z", effectiveTo: "2100-01-01T00:00:00.000Z", verificationStatus: "user-specified assumption", methodology: "Electricity-consumption estimate; not CO2e", createdAt: "1970-01-01T00:00:00.000Z" };
// Source checked 2026-11-14. Explicit opt-in only, for its stated grid and fiscal year.
export const officialFactor = { value: 0.675, unit: "kg CO2/kWh", geography: "India unified grid", source: "https://cea.nic.in/api/cdm-report-version/view-pdf/en/82", reportingYear: "FY 2025-26", effectiveFrom: "2025-04-01T00:00:00.000Z", effectiveTo: "2026-04-01T00:00:00.000Z", verificationStatus: "official source checked", methodology: "CEA User Guide v22.0 August 2026 Table S: net-generation weighted average, including renewables/captive injection, cross-border adjusted; 0.675 tCO2/MWh = 0.675 kg CO2/kWh. Consumption estimate, not project OM/BM/CM or CO2e." };
const time = x => +new Date(x);
const sum = (rows, fn) => rows.reduce((n, r) => n + fn(r), 0);
export function periodSummary(intervals, start, end, factors, now = new Date()) {
  const rows = intervals.filter(r => time(r.startAt) >= time(start) && time(r.endAt) <= time(end));
  const hours = (time(end) - time(start)) / 3600000;
  const versions = [...factors].sort((a, b) => (b.revision ?? 0) - (a.revision ?? 0) || time(b.createdAt) - time(a.createdAt) || String(b._id).localeCompare(String(a._id)));
  const applied = rows.map(r => {
    const index = versions.findIndex(f => time(f.effectiveFrom) <= time(r.startAt) && time(f.effectiveTo) >= time(r.endAt));
    // A newer factor that starts/ends inside the interval makes its applicable
    // factor ambiguous. Do not prorate unmeasured energy or fall back to the old version.
    const crossesRevision = index >= 0 && versions.slice(0, index).some(f => time(f.effectiveFrom) < time(r.endAt) && time(f.effectiveTo) > time(r.startAt));
    const factor = index >= 0 && !crossesRevision ? versions[index] : null;
    return { ...r, factorId: factor?._id ?? null, estimatedKgCO2: factor ? r.energyKwh * factor.value : null };
  });
  const gaps = []; let cursor = time(start);
  for (const r of rows) { if (time(r.startAt) > cursor) gaps.push({ startAt: new Date(cursor), endAt: r.startAt, kind: "missing" }); if (r.coverage === "gap_aggregate") gaps.push({ startAt: r.startAt, endAt: r.endAt, kind: "gap aggregate; timing unknown" }); cursor = Math.max(cursor, time(r.endAt)); }
  if (cursor < time(end)) gaps.push({ startAt: new Date(cursor), endAt: new Date(end), kind: "missing" });
  const factorComplete = applied.length > 0 && applied.every(r => r.factorId);
  const knownEmissions = sum(applied, r => r.estimatedKgCO2 ?? 0);
  return { start, end, hours, intervalCount: rows.length, kwh: rows.length ? sum(rows, r => r.energyKwh) : null,
    regularCoveragePercent: Math.min(100, sum(rows.filter(r => r.coverage !== "gap_aggregate"), r => r.durationHours) / hours * 100),
    futureOrOpenPeriod: time(end) > time(now), gaps, factorComplete,
    estimatedKgCO2: factorComplete ? knownEmissions : null, partialKnownKgCO2: applied.length ? knownEmissions : null,
    intervals: applied, sourceTypes: [...new Set(rows.flatMap(r => r.sourceTypes ?? ["unknown"]))],
  };
}
export function buildSustainability({ intervals, factors = [], records = [], selection, config = defaults, tariff, schedules = [], now = new Date() }) {
  const current = periodSummary(intervals, selection.start, selection.end, factors, now);
  const baseline = periodSummary(intervals, selection.baselineStart, selection.baselineEnd, factors, now);
  const comparableDuration = Math.abs(current.hours - baseline.hours) < 0.000001;
  const reductionPercent = comparableDuration && baseline.kwh > 0 && current.kwh !== null ? (baseline.kwh - current.kwh) / baseline.kwh * 100 : null;
  const bookedHours = p => sum(schedules.filter(s => s.status === "confirmed"), s => Math.max(0, Math.min(time(s.endAt), time(p.end)) - Math.max(time(s.startAt), time(p.start))) / 3600000);
  const scheduleHours = { current: bookedHours(current), baseline: bookedHours(baseline) };
  const scheduleDifferencePercent = scheduleHours.baseline > 0 ? Math.abs(scheduleHours.current - scheduleHours.baseline) / scheduleHours.baseline * 100 : scheduleHours.current > 0 ? 100 : null;
  const warnings = [];
  if (!comparableDuration) warnings.push("Periods have different elapsed durations; comparison is not comparable.");
  if (baseline.kwh === null || current.kwh === null) warnings.push("No accepted interval energy in at least one period.");
  if (baseline.kwh === 0) warnings.push("Zero baseline: percentage change is undefined.");
  if ([current, baseline].some(p => p.regularCoveragePercent < config.minimumCoverage || p.futureOrOpenPeriod)) warnings.push("Incomplete period or insufficient regular sampling coverage; totals are partial recorded use.");
  if (!current.factorComplete || !baseline.factorComplete) warnings.push("Factor coverage incomplete: emissions total unavailable for at least one period.");
  if (scheduleDifferencePercent === null) warnings.push("Comparable timetable evidence not recorded.");
  else if (scheduleDifferencePercent >= 20) warnings.push("Material timetable difference (at least 20% booked room-hours); electricity periods may not be comparable.");
  if (selection.occupancy !== "similar") warnings.push(selection.occupancy === "different" ? "Material occupancy difference declared." : "Occupancy comparability not recorded; electricity alone cannot establish it.");
  if (selection.dataMode !== "live") warnings.push(`${selection.dataMode} data: not measured operational sustainability performance.`);
  const approved = records.filter(r => r.status === "approved" && String(r.evidence ?? "").trim());
  const activities = approved.filter(r => r.kind === "activity" && time(r.date) >= time(selection.start) && time(r.date) < time(selection.end));
  const scored = activities.filter(r => r.countingMethod === "unique_within_activity" && r.denominator > 0);
  const numerator = sum(scored, r => r.students + r.staff), denominator = sum(scored, r => r.denominator);
  const covering = kind => approved.filter(r => r.kind === kind && time(r.date) <= time(selection.start) && time(r.endAt) >= time(selection.end));
  const policies = covering("policy"), reporting = covering("reporting");
  const rubric = [
    { criterion: "Evidenced policy covers selected period", recorded: policies.length > 0, ids: policies.map(r => r._id) },
    { criterion: "Policy reviewed within selected period", recorded: policies.some(r => time(r.reviewAt) >= time(selection.start) && time(r.reviewAt) < time(selection.end)), ids: policies.filter(r => time(r.reviewAt) >= time(selection.start) && time(r.reviewAt) < time(selection.end)).map(r => r._id) },
    { criterion: "Evidenced reporting record covers selected period", recorded: reporting.length > 0, ids: reporting.map(r => r._id) },
    { criterion: `Regular energy coverage at least ${config.minimumCoverage}%`, recorded: current.regularCoveragePercent >= config.minimumCoverage && !current.futureOrOpenPeriod, ids: [] },
  ].map(r => ({ ...r, points: r.recorded ? 25 : 0, possible: 25, status: r.recorded ? "recorded" : "not recorded" }));
  const recognise = reductionPercent >= config.reductionThreshold && warnings.length === 0;
  return { methodology, generatedAt: now, selection, config, factors, current, baseline, comparableDuration, reductionPercent, scheduleHours, scheduleDifferencePercent, warnings,
    recognition: recognise ? `Recorded electricity use decreased by ${reductionPercent.toFixed(1)}% compared with the selected baseline.` : null,
    trend: reductionPercent === null ? "Insufficient comparison" : reductionPercent > 0 ? "Recorded decrease" : reductionPercent < 0 ? "Recorded increase" : "No recorded change",
    monetary: Number.isFinite(tariff) && tariff >= 0 ? { tariff, unit: "INR/kWh", currentEstimate: current.kwh === null ? null : current.kwh * tariff, observedDifferenceEstimate: current.kwh !== null && baseline.kwh !== null ? (baseline.kwh - current.kwh) * tariff : null } : null,
    social: { numerator, denominator, score: denominator > 0 ? numerator / denominator * 100 : null, approvedActivityCount: activities.length, verifiedParticipationRemark: activities.length ? `${activities.length} evidence-backed activities internally approved; counts are recorded, not independently audited.` : "Participation evidence not recorded.", activities },
    governance: { score: sum(rubric, r => r.points), rubric, policies, reporting, remark: reporting.length ? `${reporting.length} internally approved reporting records cover this period.` : "Reporting evidence not recorded." },
    evidence: records,
  };
}
