import test from "node:test";
import assert from "node:assert/strict";
import { chartRows, comparison, selectIntervals, totals, qualityWarnings, freshness, consumptionCsv } from "../frontend/src/services/consumption.js";
const interval = (hour, actual, expected, extra = {}) => ({ _id: `i${hour}`, meterId: "MAIN", epoch: "one", register: "import_kwh", dataMode: "live", startAt: new Date(Date.UTC(2026, 10, 14, hour)).toISOString(), endAt: new Date(Date.UTC(2026, 10, 14, hour + 1)).toISOString(), durationHours: 1, energyKwh: actual, averagePowerKw: actual, baseline: { expectedKwh: expected, thresholdKwh: expected + 3, method: "initial_rule" }, coverage: "interval", ...extra });
test("crossing uses interpolated actual and time-specific baseline, not a chart average", () => {
  const input = [interval(1, 2, 4), interval(2, 8, 6)];
  const rows = chartRows(input), cross = rows.find(r => r.crossing);
  assert.equal(cross.time, Date.parse(input[0].endAt) + 1800000);
  assert.equal(cross.below, 5); assert.equal(cross.above, 5); assert.equal(cross.expected, 5);
  assert.equal(rows[0].below, 2); assert.equal(rows.at(-1).above, 8);
});
test("downward and asymmetric crossings follow the actual difference; equality is green", () => {
  const rows = chartRows([interval(1, 8, 4), interval(2, 5, 7)]);
  assert.equal(rows[1].time, Date.parse(interval(1, 8, 4).endAt) + 2400000);
  assert.equal(rows[1].above, 6); assert.equal(rows[1].below, 6);
  assert.equal(comparison(interval(3, 4, 4)), "At or below baseline");
  const equal = chartRows([interval(1, 5, 5), interval(2, 7, 5), interval(3, 5, 5)]);
  assert.equal(equal[0].above, 5); assert.equal(equal.at(-1).above, 5);
});
test("red means above baseline without changing backend anomaly tolerance", () => {
  const i = interval(1, 6, 5, { anomalous: false });
  assert.equal(comparison(i), "Above baseline"); assert.equal(chartRows([i])[0].above, 6);
  assert.equal(i.anomalous, false); assert.equal(i.baseline.thresholdKwh, 8);
});
test("missing readings, gap aggregates, epoch and duration changes break actual and reference lines", () => {
  for (const b of [interval(3, 4, 5), interval(2, 4, 5, { coverage: "gap_aggregate" }), interval(2, 4, 5, { epoch: "two" }), interval(2, 4, 5, { durationHours: .5 })]) {
    const rows = chartRows([interval(1, 2, 5), b]);
    assert.equal(rows.length, 3); assert.equal(rows[1].expected, null); assert.equal(rows[1].above, null); assert.equal(rows[1].below, null);
  }
  assert.ok(qualityWarnings([interval(1, 2, 5), interval(3, 4, 5)]).some(w => w.includes("Missing readings")));
});
test("missing baseline is unknown; missing actual is never zero or green", () => {
  assert.equal(comparison(interval(1, 2, null)), "Baseline unavailable");
  assert.equal(chartRows([interval(1, null, 5)])[0].actual, null);
  assert.equal(chartRows([interval(1, null, 5)])[0].below, null);
  assert.equal(totals([interval(1, 2, null)]).comparable, 0);
});
test("source and whole-interval time filters drive identical summary, detail and CSV values", () => {
  const rows = [interval(1, 2, 4), interval(2, 6, 5), interval(2, 50, 5, { meterId: "OTHER" }), interval(2, 90, 5, { dataMode: "simulated" })];
  const selected = selectIntervals(rows, { meter: "MAIN", mode: "live", from: rows[1].startAt, to: rows[1].endAt });
  assert.equal(selected.length, 1); assert.equal(totals(selected).actual, 6); assert.equal(totals(selected).expected, 5);
  assert.equal(consumptionCsv(selected).split("\r\n").length, 2);
  assert.equal(selectIntervals(rows, { from: "2026-11-14T02:30:00Z", to: rows[1].endAt }).length, 0);
  assert.deepEqual(selectIntervals([], { range: 1 }), []);
});
test("freshness distinguishes absent, recent, stale and simulated sources", () => {
  const i = interval(1, 3, 4), now = Date.parse(i.endAt);
  assert.equal(freshness(null, now), "No accepted readings");
  assert.equal(freshness(i, now), "Recent accepted reading");
  assert.equal(freshness(i, now + 7200001), "Stale reading");
  assert.equal(freshness({ ...i, dataMode: "simulated" }, now), "Simulated / historical data");
});
test("CSV preserves zero baselines, quality, provenance and safe spreadsheet text", () => {
  const csv = consumptionCsv([interval(1, 0, 0, { meterId: '=CMD("unsafe")', sourceTypes: ["csv"], coverage: "gap_aggregate" })]);
  assert.ok(csv.includes('"\'=CMD(""unsafe"")"'));
  assert.ok(csv.includes('"0","0"')); assert.ok(csv.includes("gap_aggregate")); assert.ok(csv.includes("csv"));
});
