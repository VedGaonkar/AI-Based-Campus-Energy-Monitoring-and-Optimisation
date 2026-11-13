import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateInterval,
  deriveIntervals,
  baselineFor,
  benefits,
  calendar,
} from "../backend/src/domain/energy.js";
const reading = (value, capturedAt, extra = {}) => ({
  _id: `r${value}`,
  value,
  capturedAt,
  meterId: "MAIN-01",
  epoch: "initial",
  register: "import_kwh",
  kind: "cumulative",
  dataMode: "live",
  validationState: "accepted",
  ...extra,
});
test("cumulative kWh and elapsed-time average kW; gaps remain aggregated", () => {
  const a = reading(1200, "2026-11-13T10:00:00+05:30");
  assert.equal(
    calculateInterval(a, reading(1206, "2026-11-13T11:00:00+05:30"))
      .averagePowerKw,
    6,
  );
  const gap = calculateInterval(a, reading(1206, "2026-11-13T12:00:00+05:30"));
  assert.equal(gap.energyKwh, 6);
  assert.equal(gap.averagePowerKw, 3);
  assert.equal(gap.coverage, "gap_aggregate");
});
test("reset/epoch, negative growth, mode and register boundaries cannot produce invalid intervals", () => {
  const a = reading(1200, "2026-11-13T10:00:00Z");
  for (const extra of [
    { epoch: "replacement" },
    { dataMode: "simulated" },
    { register: "export_kwh" },
  ])
    assert.equal(
      calculateInterval(a, reading(1206, "2026-11-13T11:00:00Z", extra)),
      null,
    );
  assert.equal(calculateInterval(a, reading(1, "2026-11-13T11:00:00Z")), null);
});
test("review readings excluded and overlapping alternative representations not added twice", () => {
  const rows = [
    reading(1200, "2026-11-13T10:00:00Z"),
    reading(1206, "2026-11-13T11:00:00Z"),
    reading(6, "2026-11-13T11:00:00Z", {
      kind: "interval",
      intervalStart: "2026-11-13T10:00:00Z",
    }),
    reading(9999, "2026-11-13T12:00:00Z", { validationState: "needs_review" }),
  ];
  const intervals = deriveIntervals(rows);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].energyKwh, 6);
});
test("no history produces an honest rule/insufficient-data baseline", () => {
  const interval = {
    meterId: "MAIN-01",
    dataMode: "live",
    startAt: "2026-11-13T10:00:00Z",
    endAt: "2026-11-13T11:00:00Z",
    durationHours: 1,
  };
  assert.equal(
    baselineFor(interval, [], { timezone: "Asia/Kolkata" }).method,
    "insufficient_data",
  );
  assert.equal(
    baselineFor(interval, [], {
      timezone: "Asia/Kolkata",
      initialBaselineKwh: 5,
    }).expectedKwh,
    5,
  );
});
test("historical median matches compatible teaching intervals and excludes flagged anomalies", () => {
  const interval = {
    meterId: "MAIN-01",
    dataMode: "live",
    startAt: "2026-11-13T10:00:00Z",
    endAt: "2026-11-13T11:00:00Z",
    durationHours: 1,
  };
  const history = [2, 3, 4, 5, 6, 9, 10, 11, 12].map((day, i) => ({
    ...interval,
    startAt: `2026-11-${String(day).padStart(2, "0")}T10:00:00Z`,
    endAt: `2026-11-${String(day).padStart(2, "0")}T11:00:00Z`,
    energyKwh: i === 8 ? 100 : i === 7 ? 7 : 6,
    coverage: "interval",
    anomalous: i === 8,
  }));
  const baseline = baselineFor(interval, history, {
    timezone: "Asia/Kolkata",
    minimumBaselineSamples: 8,
    absoluteExcessFloorKwh: 2,
    relativeThreshold: 0.3,
  });
  assert.equal(baseline.method, "historical_median");
  assert.equal(baseline.sampleCount, 8);
  assert.equal(baseline.expectedKwh, 6);
  assert.equal(baseline.thresholdKwh, 8);
});
test("rupee estimate and net-benefit payback preserve stated units and limitations", () => {
  const result = benefits({
    ratedWatts: 200,
    avoidableHours: 66,
    tariff: 8,
    installedCost: 2000,
  });
  assert.equal(result.estimatedKwh, 13.200000000000001);
  assert.ok(Math.abs(result.energyCost - 105.6) < 0.00001);
  assert.equal(
    benefits({
      ratedWatts: 200,
      avoidableHours: 1,
      tariff: 8,
      installedCost: 2000,
      monthlySoftwareCost: 100,
    }).paybackMonths,
    null,
  );
});
test("pilot calendar uses local date across UTC midnight boundary", () => {
  assert.equal(calendar("2026-11-12T20:00:00Z").date, "2026-11-13");
});
