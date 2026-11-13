import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyObservation, commandBlocks, effectiveOccupancy, scheduleProtection, sharedCutoffBlocks } from '../src/policies/index.js';
import { computeBaseline, deriveIntervals, isAnomalous, nonOverlappingSavings, ratedLoadEstimateKwh, simplePaybackMonths } from '../src/services/energy.js';

const reading = (iso, value, epoch = 1) => ({ capturedAt: new Date(iso), value, epoch, dataMode: 'live' });

test('1,200 to 1,206 kWh over one hour is 6 kWh and 6 kW average', () => {
  const [i] = deriveIntervals([reading('2026-11-13T10:00:00+05:30', 1200), reading('2026-11-13T11:00:00+05:30', 1206)]);
  assert.equal(i.energyKwh, 6);
  assert.equal(i.durationHours, 1);
  assert.equal(i.averagePowerKw, 6);
  assert.equal(i.isGap, false);
  assert.equal(i.sourceLabel, 'Metered');
});

test('the same increase over two hours is 6 kWh and 3 kW average', () => {
  const [i] = deriveIntervals([reading('2026-11-13T10:00:00+05:30', 1200), reading('2026-11-13T12:00:00+05:30', 1206)]);
  assert.equal(i.energyKwh, 6);
  assert.equal(i.averagePowerKw, 3);
});

test('a meter gap is one aggregate interval, not invented hourly points', () => {
  const intervals = deriveIntervals([reading('2026-11-13T10:00:00+05:30', 1200), reading('2026-11-13T14:00:00+05:30', 1224)]);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].durationHours, 4);
  assert.equal(intervals[0].energyKwh, 24);
  assert.equal(intervals[0].isGap, true);
});

test('a meter reset starts a new epoch and never yields negative consumption', () => {
  const intervals = deriveIntervals([
    reading('2026-11-13T10:00:00+05:30', 9990, 1),
    reading('2026-11-13T11:00:00+05:30', 9996, 1),
    reading('2026-11-13T12:00:00+05:30', 3, 2),
    reading('2026-11-13T13:00:00+05:30', 8, 2),
  ]);
  assert.deepEqual(intervals.map((i) => i.energyKwh), [6, 5]);
  assert.ok(intervals.every((i) => i.energyKwh >= 0));
});

test('any simulated reading keeps the interval simulated', () => {
  const [i] = deriveIntervals([{ ...reading('2026-11-13T10:00:00+05:30', 1), dataMode: 'simulated' }, reading('2026-11-13T11:00:00+05:30', 2)]);
  assert.equal(i.dataMode, 'simulated');
  assert.equal(i.sourceLabel, 'Simulated');
});

test('baseline: too little history is labelled insufficient or initial rule, never invented', () => {
  const cfg = { minSamples: 8, absoluteExcessFloorKwh: 2, relativeThreshold: 0.3 };
  const none = computeBaseline([5, 6, 5], cfg);
  assert.equal(none.method, 'insufficient');
  assert.equal(none.thresholdKwh, null);
  assert.equal(isAnomalous(500, none), false);

  const rule = computeBaseline([5, 6, 5], { ...cfg, initialRule: { enabled: true, teachingHourKwh: 20, offHourKwh: 4 } }, { teachingHour: true });
  assert.equal(rule.method, 'initial_rule');
  assert.equal(rule.expectedKwh, 20);
  assert.equal(rule.thresholdKwh, 26);
});

test('baseline: historical threshold is the largest of floor, relative and 3 sigma', () => {
  const cfg = { minSamples: 8, absoluteExcessFloorKwh: 2, relativeThreshold: 0.3 };
  const b = computeBaseline([10, 10, 10, 10, 10, 10, 10, 10], cfg);
  assert.equal(b.method, 'historical');
  assert.equal(b.expectedKwh, 10);
  assert.equal(b.thresholdKwh, 13);
  assert.equal(isAnomalous(12.9, b), false);
  assert.equal(isAnomalous(13.1, b), true);
  // Tiny expected usage falls back to the absolute floor rather than an unstable percentage.
  assert.equal(computeBaseline(Array(8).fill(0.1), cfg).thresholdKwh, 2.1);
});

test('savings: rated-load estimate, payback only when positive, overlaps counted once', () => {
  assert.equal(ratedLoadEstimateKwh(200, 66), 13.2);
  assert.equal(simplePaybackMonths(2000, 105.6), 18.9);
  assert.equal(simplePaybackMonths(2000, -5), null);
  const total = nonOverlappingSavings([
    { overlapGroup: 'room:1:idle', estimate: { kwhLow: 5, kwhHigh: 10, costLow: 40, costHigh: 80 } },
    { overlapGroup: 'room:1:idle', estimate: { kwhLow: 3, kwhHigh: 6, costLow: 24, costHigh: 48 } },
    { overlapGroup: 'building:overnight', estimate: { kwhLow: 100, kwhHigh: 200, costLow: 800, costHigh: 1600 } },
  ]);
  assert.deepEqual(total, { kwhLow: 105, kwhHigh: 210, costLow: 840, costHigh: 1680 });
});

test("tomorrow's booking does not protect today; the preparation window does", () => {
  const at = new Date('2026-11-13T10:00:00+05:30');
  const prep = 15 * 60_000;
  const s = (start, end, status = 'confirmed') => ({ startAt: new Date(start), endAt: new Date(end), status, title: 'x' });
  assert.equal(scheduleProtection([s('2026-11-14T10:00:00+05:30', '2026-11-14T11:00:00+05:30')], at, prep).length, 0);
  assert.equal(scheduleProtection([s('2026-11-13T10:10:00+05:30', '2026-11-13T11:00:00+05:30')], at, prep).length, 1);
  assert.equal(scheduleProtection([s('2026-11-13T10:30:00+05:30', '2026-11-13T11:00:00+05:30')], at, prep).length, 0);
  assert.equal(scheduleProtection([s('2026-11-13T09:00:00+05:30', '2026-11-13T11:00:00+05:30', 'cancelled')], at, prep).length, 0);
});

test('occupancy: stale, unvalidated and retained-old evidence never become vacancy', () => {
  const limits = { freshnessMs: 120_000, vacancyMs: 15 * 60_000 };
  const t = new Date('2026-11-13T10:00:00+05:30');
  const room = { occupancySource: 'camera', coverageValidated: true, occupancy: {} };

  // Blind spot: coverage not validated, so "no person" is unknown rather than vacant.
  const unvalidated = applyObservation({ ...room, coverageValidated: false }, { capturedAt: t, occupancy: 'vacant', coverageValidated: true, dataMode: 'live' }, limits);
  assert.equal(unvalidated.state, 'unknown');

  const vacant = applyObservation(room, { capturedAt: t, occupancy: 'vacant', coverageValidated: true, dataMode: 'live' }, limits);
  assert.equal(vacant.state, 'vacant');
  const withState = { ...room, occupancy: vacant };
  assert.equal(effectiveOccupancy(withState, limits, new Date(t.getTime() + 60_000)).confirmedVacant, false);
  // A retained old value is stale: unknown, not vacant.
  const stale = effectiveOccupancy(withState, limits, new Date(t.getTime() + 20 * 60_000));
  assert.equal(stale.state, 'unknown');
  assert.equal(stale.reason, 'stale_observation');

  // An older event arriving late must not overwrite newer evidence.
  assert.equal(applyObservation(withState, { capturedAt: new Date(t.getTime() - 60_000), occupancy: 'occupied', dataMode: 'live' }, limits), null);

  // A gap longer than the freshness limit restarts the vacancy clock.
  const later = applyObservation(withState, { capturedAt: new Date(t.getTime() + 10 * 60_000), occupancy: 'vacant', coverageValidated: true, dataMode: 'live' }, limits);
  assert.equal(later.vacantSince.getTime(), t.getTime() + 10 * 60_000);

  assert.equal(effectiveOccupancy({ occupancySource: 'none' }, limits, t).state, 'unknown');
});

test('shared cutoff: one unapproved or unstopped load blocks the whole room', () => {
  const at = new Date('2026-11-13T10:00:00+05:30');
  const light = { name: 'Lights', supplyInterruptionApproved: true };
  const ac = { name: 'AC', supplyInterruptionApproved: true, requiresNormalStopBeforeCutoff: true };
  assert.deepEqual(sharedCutoffBlocks([light], {}, at), []);
  assert.equal(sharedCutoffBlocks([light, ac], {}, at).length, 1);
  assert.deepEqual(sharedCutoffBlocks([light, { ...ac, stopProcedureConfirmedAt: new Date(at.getTime() - 60_000) }], {}, at), []);
  // A confirmation from before the supply was last switched describes an earlier shutdown.
  assert.equal(sharedCutoffBlocks([{ ...ac, stopProcedureConfirmedAt: new Date(at.getTime() - 600_000) }], { lastChangedAt: new Date(at.getTime() - 60_000) }, at).length, 1);
  assert.equal(sharedCutoffBlocks([{ name: 'Server', essential: true, supplyInterruptionApproved: true }], {}, at).length, 1);
  assert.equal(sharedCutoffBlocks([{ name: 'PCs', supplyInterruptionApproved: false }], {}, at).length, 1);
});

test('command eligibility: fault trip, demo isolation and non-automation OFF block restoration', () => {
  const at = new Date('2026-11-13T10:00:00+05:30');
  const base = {
    room: { controlMode: 'simulated', autoControlEnabled: true },
    breaker: { adapter: 'simulator', supplyState: 'off', offReason: 'automation', interlocks: {}, health: 'online' },
    devices: [],
    occupancy: { state: 'occupied', confirmedVacant: false, dataMode: 'simulated' },
    protection: { protected: false, reasons: [] },
    cfg: { demoMode: true, allowPhysicalControl: false, deviceAdapter: 'simulator' },
    at,
    action: 'on',
    reason: 'occupancy_restore',
  };
  assert.deepEqual(commandBlocks(base), []);
  assert.match(commandBlocks({ ...base, breaker: { ...base.breaker, interlocks: { faultTripped: true } } }).join(), /fault-tripped/);
  assert.match(commandBlocks({ ...base, breaker: { ...base.breaker, interlocks: { maintenanceLock: true } } }).join(), /maintenance-locked/);
  assert.match(commandBlocks({ ...base, breaker: { ...base.breaker, offReason: 'manual' } }).join(), /not switched off by this automation/);
  // Demo mode can never drive a physical adapter.
  assert.match(commandBlocks({ ...base, room: { ...base.room, controlMode: 'physical' } }).join(), /demonstration mode/);
  assert.match(commandBlocks({ ...base, room: { ...base.room, controlMode: 'alert_only' } }).join(), /alert-only/);
  // Simulated evidence can never authorise a physical vacancy shutdown.
  const physical = commandBlocks({
    ...base,
    room: { controlMode: 'physical', autoControlEnabled: true },
    breaker: { ...base.breaker, adapter: 'physical', supplyState: 'on' },
    cfg: { demoMode: false, allowPhysicalControl: true, deviceAdapter: 'physical' },
    occupancy: { state: 'vacant', confirmedVacant: true, dataMode: 'replay' },
    action: 'off',
    reason: 'vacancy_escalation',
    incident: { active: true },
  });
  assert.deepEqual(physical, ['Only live evidence may authorise a physical action']);
});
