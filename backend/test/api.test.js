import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { now } from '../src/clock.js';
import { AccessLease, Command, EnergyInterval, Incident, MeterReading, Notification, Recommendation, Room, RoomBreaker, Schedule } from '../src/models/index.js';
import { getSettings } from '../src/services/core.js';
import { importMeterCsv, ingestReadings } from '../src/services/meterIngest.js';
import { generateRecommendations } from '../src/services/recommendations.js';
import { seedDemo } from '../src/seed/index.js';
import { SERVICE_TOKEN, T0, advance, fixture, login, observe, resetDb, startTestDb, stopTestDb, tick, vacantFor } from './helpers.js';

let app;
before(async () => {
  await startTestDb();
  app = createApp().app;
});
after(() => stopTestDb());
beforeEach(() => resetDb());

const api = (path) => `/api/v1${path}`;
const iso = (offsetMin) => new Date(T0.getTime() + offsetMin * 60_000).toISOString();
const csv = (rows) => ['meterId,capturedAt,readingKwh,register,source', ...rows.map(([t, v]) => `MAIN-01,${iso(t)},${v},import_kwh,manual`)].join('\n');

// ---------- meter ingestion ----------

test('CSV preview does not commit; committing twice does not double consumption', async () => {
  const f = await fixture();
  const text = csv([[-180, 1200], [-120, 1206], [-60, 1213]]);
  const preview = await importMeterCsv(text, { dataMode: 'live', enteredBy: f.admin._id, commit: false });
  assert.equal(preview.summary.accepted, 3);
  assert.equal(preview.summary.committed, false);
  assert.equal(await MeterReading.countDocuments(), 0);

  await importMeterCsv(text, { dataMode: 'live', enteredBy: f.admin._id, commit: true });
  const again = await importMeterCsv(text, { dataMode: 'live', enteredBy: f.admin._id, commit: true });
  assert.equal(again.summary.accepted, 0);
  assert.equal(again.summary.duplicates, 3);
  assert.equal(await MeterReading.countDocuments(), 3);
  const intervals = await EnergyInterval.find().sort({ startAt: 1 });
  assert.deepEqual(intervals.map((i) => i.energyKwh), [6, 7]);
  assert.ok(intervals.every((i) => i.sourceLabel === 'Metered'));
});

test('invalid rows are reported with reasons and never stored', async () => {
  const f = await fixture();
  const text = ['meterId,capturedAt,readingKwh,register,source', `MAIN-01,${iso(-120)},1200,import_kwh,manual`, 'MAIN-01,2026-11-11 09:00,1205,import_kwh,manual', `MAIN-01,${iso(-60)},abc,import_kwh,manual`, `MAIN-01,${iso(600)},1300,import_kwh,manual`, `MAIN-01,${iso(-30)},1210,export_kwh,manual`].join('\n');
  const r = await importMeterCsv(text, { dataMode: 'live', enteredBy: f.admin._id, commit: true });
  assert.equal(r.summary.accepted, 1);
  assert.equal(r.summary.invalid, 4);
  assert.match(r.invalid.map((x) => x.reason).join('|'), /UTC offset.*non-negative.*future.*not supported/);
  assert.equal(await MeterReading.countDocuments(), 1);
});

test('a meter gap stays one aggregate interval', async () => {
  const f = await fixture();
  await importMeterCsv(csv([[-300, 1200], [-240, 1206], [0, 1230]]), { dataMode: 'live', enteredBy: f.admin._id, commit: true });
  const intervals = await EnergyInterval.find().sort({ startAt: 1 });
  assert.equal(intervals.length, 2);
  assert.equal(intervals[1].isGap, true);
  assert.equal(intervals[1].durationHours, 4);
  assert.equal(intervals[1].energyKwh, 24);
  assert.equal(intervals[1].baseline.method, 'insufficient');
});

test('a bad OCR digit goes to review and creates no interval or anomaly', async () => {
  await fixture();
  await ingestReadings([{ meterId: 'MAIN-01', capturedAt: iso(-120), value: 1200 }, { meterId: 'MAIN-01', capturedAt: iso(-60), value: 1206 }], { sourceType: 'manual', dataMode: 'live', commit: true });
  // Misread leading digit: 7212 instead of 1212.
  const bad = await ingestReadings([{ meterId: 'MAIN-01', capturedAt: iso(0), value: 7212, quality: { ocrConfidence: 0.97, registerMatched: true, burstAgreement: true } }], { sourceType: 'camera_ocr', dataMode: 'live', commit: true });
  assert.equal(bad.summary.needsReview, 1);
  assert.match(bad.needsReview[0].reason, /supply limit/);
  // Wrong register is caught even when the number itself looks plausible.
  const wrong = await ingestReadings([{ meterId: 'MAIN-01', capturedAt: iso(1), value: 1212, quality: { ocrConfidence: 0.99, registerMatched: false } }], { sourceType: 'camera_ocr', dataMode: 'live', commit: true });
  assert.equal(wrong.summary.needsReview, 1);
  assert.equal(await EnergyInterval.countDocuments(), 1);
  assert.equal(await Incident.countDocuments({ type: 'energy_anomaly' }), 0);
});

test('a meter replacement is reviewed into a new epoch with no negative consumption', async () => {
  const f = await fixture();
  await importMeterCsv(csv([[-240, 9990], [-180, 9996]]), { dataMode: 'live', enteredBy: f.admin._id, commit: true });
  const low = await importMeterCsv(csv([[-120, 3], [-60, 9]]), { dataMode: 'live', enteredBy: f.admin._id, commit: true });
  assert.equal(low.summary.needsReview, 2);
  const agent = request.agent(app);
  await login(agent, 'admin@test.local');
  const first = await MeterReading.findOne({ value: 3 });
  const res = await agent.post(api(`/meter-readings/${first._id}/review`)).send({ action: 'new_epoch', note: 'Meter replaced' });
  assert.equal(res.status, 200);
  assert.equal(res.body.reading.epoch, 2);
  const second = await MeterReading.findOne({ value: 9 });
  await agent.post(api(`/meter-readings/${second._id}/review`)).send({ action: 'accept' });
  const intervals = await EnergyInterval.find().sort({ startAt: 1 });
  assert.deepEqual(intervals.map((i) => i.energyKwh), [6, 6]);
  assert.ok(intervals.every((i) => i.energyKwh >= 0));
});

test('simulated imports stay simulated end to end', async () => {
  const f = await fixture();
  await importMeterCsv(csv([[-120, 100], [-60, 106]]), { dataMode: 'simulated', enteredBy: f.admin._id, commit: true });
  const i = await EnergyInterval.findOne();
  assert.equal(i.dataMode, 'simulated');
  assert.equal(i.sourceLabel, 'Simulated');
});

test('interval imports that overlap existing energy are rejected, not added', async () => {
  const f = await fixture();
  await importMeterCsv(csv([[-120, 100], [-60, 106]]), { dataMode: 'live', enteredBy: f.admin._id, commit: true });
  const text = ['meterId,intervalStart,intervalEnd,energyKwh', `MAIN-01,${iso(-120)},${iso(-60)},6`, `MAIN-01,${iso(-60)},${iso(0)},5`].join('\n');
  const r = await importMeterCsv(text, { dataMode: 'live', enteredBy: f.admin._id, commit: true });
  assert.equal(r.summary.invalid + r.summary.duplicates, 1);
  assert.equal(r.summary.accepted, 1);
  assert.equal(await EnergyInterval.countDocuments(), 2);
});

// ---------- seed, baseline, anomalies and recommendations ----------

test('demo seed: baselines, an explained anomaly, a gap, a review item and non-overlapping recommendations', async () => {
  // Real time is used here so "yesterday" in the seed lines up with the wall clock.
  const { setNowForTests } = await import('../src/clock.js');
  setNowForTests(null);
  const summary = await seedDemo();
  assert.ok(summary.readings > 600);

  const intervals = await EnergyInterval.find().sort({ startAt: 1 });
  assert.ok(intervals.every((i) => i.dataMode === 'simulated' && i.sourceLabel === 'Simulated'));
  assert.equal(intervals.filter((i) => i.isGap).length, 1);
  // Early intervals have no comparable history and say so.
  assert.equal(intervals[0].baseline.method, 'insufficient');
  assert.ok(intervals.some((i) => i.baseline.method === 'historical'));
  assert.ok(intervals.filter((i) => i.anomalous).length >= 2);

  const anomalies = await Incident.find({ type: 'energy_anomaly' });
  assert.ok(anomalies.length >= 1);
  const a = anomalies[0];
  assert.equal(a.scope, 'building_meter');
  assert.equal(a.roomId, undefined);
  assert.equal(a.dataMode, 'simulated');
  assert.ok(a.anomaly.excessKwh > 0);
  // A contributor is a suggestion with its limits stated, never a measured room figure.
  const withContributor = anomalies.find((x) => x.anomaly.possibleContributors.length);
  if (withContributor) {
    assert.match(withContributor.evidence.map((e) => e.text).join(' '), /Possible contributor, not measured room-level attribution/);
    assert.equal(withContributor.confirmedCause, undefined);
  }
  assert.ok(await Notification.countDocuments({ stage: 'anomaly' }));
  assert.equal(await MeterReading.countDocuments({ validation: 'needs_review' }), 1);

  const recs = await Recommendation.find();
  assert.ok(recs.length >= 2);
  assert.ok(recs.every((r) => r.sourceLabel === 'Estimated' && r.estimate.assumptions.length));
  // Regenerating never duplicates a recommendation.
  await generateRecommendations();
  assert.equal(await Recommendation.countDocuments(), recs.length);

  const agent = request.agent(app);
  const res = await agent.post(api('/auth/login')).send({ email: 'admin@demo.local', password: 'test-password' });
  assert.equal(res.status, 200);
  assert.match(res.body.server.banner, /Simulation/);
  const sum = await agent.get(api('/analytics/summary'));
  assert.equal(sum.status, 200);
  assert.equal(sum.body.today.sourceLabel, 'Simulated');
  assert.equal(sum.body.potentialSavings.sourceLabel, 'Estimated');
  const list = await agent.get(api('/recommendations'));
  const naive = list.body.recommendations.filter((r) => r.status === 'proposed').reduce((s, r) => s + r.estimate.kwhHigh, 0);
  assert.ok(list.body.potentialSavings.kwhHigh <= naive + 0.01);
  const iv = await agent.get(api('/analytics/intervals'));
  assert.equal(iv.status, 200);
  assert.ok(iv.body.intervals.length > 20);
});

// ---------- authentication and permissions ----------

test('login, session and role checks are enforced on the server', async () => {
  const f = await fixture();
  assert.equal((await request(app).get(api('/rooms'))).status, 401);
  assert.equal((await request(app).post(api('/auth/login')).send({ email: 'admin@test.local', password: 'wrong' })).status, 401);

  const viewer = request.agent(app);
  await login(viewer, 'viewer@test.local');
  assert.equal((await viewer.get(api('/rooms'))).body.rooms.length, 0);
  assert.equal((await viewer.get(api(`/rooms/${f.room._id}/status`))).status, 403);
  assert.equal((await viewer.post(api(`/rooms/${f.room._id}/supply-commands`)).send({ action: 'off' })).status, 403);
  assert.equal((await viewer.patch(api('/settings')).send({ tariffPerKwh: 1 })).status, 403);
  assert.equal((await viewer.post(api('/imports/meter-readings')).send({ csv: 'x', commit: true })).status, 403);
  assert.equal((await viewer.get(api('/audit-events'))).status, 403);

  const teacher = request.agent(app);
  await login(teacher, 'teacher@test.local');
  assert.equal((await teacher.get(api('/rooms'))).body.rooms.length, 1);
  assert.equal((await teacher.post(api(`/rooms/${f.room._id}/supply-commands`)).send({ action: 'off' })).status, 403);
  assert.equal(await Command.countDocuments(), 0);

  await teacher.post(api('/auth/logout'));
  assert.equal((await teacher.get(api('/auth/me'))).status, 401);
});

test('errors use one standard shape', async () => {
  await fixture();
  const agent = request.agent(app);
  await login(agent, 'admin@test.local');
  const bad = await agent.post(api('/rooms')).send({ code: '' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'validation_failed');
  assert.ok(Array.isArray(bad.body.error.details));
  const missing = await agent.get(api('/nope'));
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'not_found');
});

test('cross-origin mutations are refused', async () => {
  await fixture();
  const res = await request(app).post(api('/auth/login')).set('Origin', 'https://evil.example').send({ email: 'admin@test.local', password: 'test-password' });
  assert.equal(res.status, 403);
});

test('telemetry needs the service credential and cannot force vacancy', async () => {
  const f = await fixture();
  const body = { eventId: 'e1', sourceId: 'CAM-R1', capturedAt: now().toISOString(), occupancy: 'vacant', detectedPeople: 0, coverageValidated: true, dataMode: 'live' };
  assert.equal((await request(app).post(api('/ingest/observations')).send(body)).status, 401);
  assert.equal((await request(app).post(api('/ingest/observations')).set('Authorization', 'Bearer wrong').send(body)).status, 401);
  const ok = await request(app).post(api('/ingest/observations')).set('Authorization', `Bearer ${SERVICE_TOKEN}`).send(body);
  assert.equal(ok.status, 202);
  // One zero-count post is a candidate, not confirmed vacancy, and a simulated source cannot claim to be live.
  const room = await Room.findById(f.room._id);
  assert.equal(room.occupancy.dataMode, 'simulated');
  await tick();
  assert.equal(await Incident.countDocuments(), 0);
  // Unregistered sources are refused.
  const unknown = await request(app).post(api('/ingest/observations')).set('Authorization', `Bearer ${SERVICE_TOKEN}`).send({ ...body, eventId: 'e2', sourceId: 'CAM-OTHER' });
  assert.equal(unknown.status, 403);
});

// ---------- room master mapping ----------

test('a room has exactly one master, and a master serves exactly one room', async () => {
  const f = await fixture();
  const agent = request.agent(app);
  await login(agent, 'admin@test.local');
  const second = await agent.post(api(`/rooms/${f.room._id}/breaker`)).send({ code: 'BRK-R1-B' });
  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, 'room_master_exists');

  const other = await agent.post(api('/rooms')).send({ code: 'R2', name: 'Second room' });
  assert.equal(other.status, 201);
  const reuse = await agent.post(api(`/rooms/${other.body.room.id}/breaker`)).send({ code: 'BRK-R1' });
  assert.equal(reuse.status, 409);
  assert.equal(reuse.body.error.code, 'breaker_in_use');
  assert.equal(await RoomBreaker.countDocuments(), 1);
});

test('demo mode refuses physical control configuration', async () => {
  const f = await fixture();
  const agent = request.agent(app);
  await login(agent, 'admin@test.local');
  assert.equal((await agent.patch(api(`/rooms/${f.room._id}`)).send({ controlMode: 'physical' })).status, 409);
  assert.equal((await agent.patch(api(`/rooms/${f.room._id}/breaker`)).send({ adapter: 'physical' })).status, 409);
  assert.throws(() => loadConfig({ NODE_ENV: 'test', DEMO_MODE: 'true', ALLOW_PHYSICAL_CONTROL: 'true' }), /ALLOW_PHYSICAL_CONTROL/);
  assert.throws(() => loadConfig({ NODE_ENV: 'test', DEMO_MODE: 'true', DEVICE_ADAPTER: 'physical' }), /simulator/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', DEMO_MODE: 'false', DEMO_TIME_SCALE: '1' }), /placeholder/);
  // Accelerated time exists only inside demonstration mode.
  assert.equal(loadConfig({ NODE_ENV: 'test', DEMO_MODE: 'false', DEMO_TIME_SCALE: '60', SESSION_SECRET: 'x'.repeat(20) }).demoTimeScale, 1);
});

test('manual room supply: one room-level command, with the status endpoint showing separate facts', async () => {
  const f = await fixture();
  const tech = request.agent(app);
  await login(tech, 'tech@test.local');
  await observe('occupied', { detectedPeople: 3, equipmentOn: true });
  const status = await tech.get(api(`/rooms/${f.room._id}/status`));
  assert.equal(status.status, 200);
  assert.equal(status.body.occupancy.state, 'occupied');
  assert.equal(status.body.breaker.supplyState, 'on');
  assert.equal(status.body.breaker.sourceLabel, 'Simulated');
  assert.equal(status.body.protection.protected, false);
  assert.equal(status.body.applianceEvidence.equipmentOn, true);

  const off = await tech.post(api(`/rooms/${f.room._id}/supply-commands`)).send({ action: 'off' });
  assert.equal(off.status, 201);
  assert.equal(off.body.command.verification, 'simulated');
  assert.equal(off.body.command.roomBreakerId, 'BRK-R1');
  const fetched = await tech.get(api(`/commands/${off.body.command.requestId}`));
  assert.equal(fetched.body.command.reportedOutput, 'off');
  // There is no per-appliance control endpoint.
  assert.equal((await tech.post(api(`/devices/${f.light._id}/commands`)).send({ action: 'off' })).status, 404);
});

// ---------- QR access ----------

test('public QR lookup is minimal and switches nothing', async () => {
  const f = await fixture();
  await RoomBreaker.updateOne({ _id: f.breaker._id }, { $set: { supplyState: 'off', offReason: 'automation' } });
  const res = await request(app).get(api('/access/public-token-r1'));
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body.room).sort(), ['code', 'id', 'name']);
  assert.equal(res.body.supply.simulationOnly, true);
  assert.equal(JSON.stringify(res.body).includes('BRK-R1'), false);
  assert.equal(JSON.stringify(res.body).includes('@test.local'), false);
  assert.equal((await RoomBreaker.findById(f.breaker._id)).supplyState, 'off');
  assert.equal(await Command.countDocuments(), 0);
  assert.equal((await request(app).get(api('/access/unknown-token'))).status, 404);
});

test('unauthorised lease requests are denied on the server', async () => {
  const f = await fixture();
  assert.equal((await request(app).post(api(`/rooms/${f.room._id}/access-leases`)).send({ durationMinutes: 30, acceptPolicy: true })).status, 401);
  const viewer = request.agent(app);
  await login(viewer, 'viewer@test.local');
  assert.equal((await viewer.post(api(`/rooms/${f.room._id}/access-leases`)).send({ durationMinutes: 30, acceptPolicy: true })).status, 403);
  const teacher = request.agent(app);
  await login(teacher, 'teacher@test.local');
  assert.equal((await teacher.post(api(`/rooms/${f.room._id}/access-leases`)).send({ durationMinutes: 500, acceptPolicy: true })).status, 400);
  assert.equal((await teacher.post(api(`/rooms/${f.room._id}/access-leases`)).send({ durationMinutes: 30, acceptPolicy: false })).status, 400);
  assert.equal(await AccessLease.countDocuments(), 0);
});

test('a QR lease starting during a pending cutoff invalidates it and restores simulated supply', async () => {
  const f = await fixture();
  await vacantFor(15);
  await tick();
  const incident = await Incident.findOne({ roomId: f.room._id, active: true });
  assert.ok(incident);
  const teacher = request.agent(app);
  await login(teacher, 'teacher@test.local');
  const res = await teacher.post(api(`/rooms/${f.room._id}/access-leases`)).send({ durationMinutes: 60, acceptPolicy: true });
  assert.equal(res.status, 201);
  assert.equal((await Incident.findById(incident._id)).state, 'cancelled');
  // The lease protects the room for its whole duration even though the camera still sees nobody.
  for (let i = 0; i < 40; i += 1) {
    advance(1);
    await observe('vacant');
    await tick();
  }
  assert.equal(await Incident.countDocuments({ active: true }), 0);
  assert.equal(await Command.countDocuments({ action: 'off' }), 0);
});

test('QR lease on a room whose supply is off issues one simulated room-level ON', async () => {
  const f = await fixture({ occupancySource: 'none', coverageValidated: false });
  await RoomBreaker.updateOne({ _id: f.breaker._id }, { $set: { supplyState: 'off', offReason: 'automation' } });
  const teacher = request.agent(app);
  await login(teacher, 'teacher@test.local');
  const res = await teacher.post(api(`/rooms/${f.room._id}/access-leases`)).send({ durationMinutes: 60, acceptPolicy: true });
  assert.equal(res.status, 201);
  assert.equal(res.body.command.action, 'on');
  assert.equal(res.body.command.reason, 'qr_access');
  assert.equal(res.body.command.verification, 'simulated');
  assert.equal(res.body.lease.dataMode, 'simulated');
  assert.equal((await RoomBreaker.findById(f.breaker._id)).supplyState, 'on');
});

test('lease warning, extension and expiry without an occupancy source', async () => {
  const f = await fixture({ occupancySource: 'none', coverageValidated: false });
  const teacher = request.agent(app);
  await login(teacher, 'teacher@test.local');
  const created = await teacher.post(api(`/rooms/${f.room._id}/access-leases`)).send({ durationMinutes: 30, acceptPolicy: true });
  const leaseId = created.body.lease.id;

  advance(21);
  await tick();
  assert.equal(await Notification.countDocuments({ leaseId, recipientId: f.teacher._id }), 1);

  const extended = await teacher.post(api(`/access-leases/${leaseId}/extend`)).send({ additionalMinutes: 30 });
  assert.equal(extended.status, 200);
  advance(10);
  await tick();
  // The original expiry time has passed, but the old expiry work was cancelled by the extension.
  assert.equal((await AccessLease.findById(leaseId)).status, 'active');
  assert.equal(await Incident.countDocuments(), 0);

  advance(30);
  await tick();
  assert.equal((await AccessLease.findById(leaseId)).status, 'expired');
  // Expiry is not evidence of vacancy: occupancy stays unknown and staff are asked to confirm.
  const status = await teacher.get(api(`/rooms/${f.room._id}/status`));
  assert.equal(status.body.occupancy.state, 'unknown');
  assert.equal(status.body.occupancy.reason, 'no_occupancy_source');
  const incident = await Incident.findOne({ type: 'lease_expiry' });
  assert.ok(incident);
  assert.equal(incident.active, true);
  assert.equal(await Command.countDocuments({ action: 'off' }), 0);
  assert.equal((await RoomBreaker.findById(f.breaker._id)).supplyState, 'on');
});

test('opt-in fixed-duration cutoff is its own command reason and is labelled simulated', async () => {
  const f = await fixture({ occupancySource: 'none', coverageValidated: false, qrExpiryPolicy: 'fixed_duration_cutoff' });
  const teacher = request.agent(app);
  await login(teacher, 'teacher@test.local');
  await teacher.post(api(`/rooms/${f.room._id}/access-leases`)).send({ durationMinutes: 30, acceptPolicy: true });
  advance(31);
  await tick();
  const command = await Command.findOne({ action: 'off' });
  assert.equal(command.reason, 'fixed_duration_expiry');
  assert.equal(command.verification, 'simulated');
  assert.equal((await RoomBreaker.findById(f.breaker._id)).offReason, 'fixed_duration_expiry');
  assert.equal(await Incident.countDocuments({ type: 'vacancy_waste' }), 0);
});

test('a lease or extension that runs into another booking is rejected', async () => {
  const f = await fixture();
  await Schedule.create({ roomId: f.room._id, startAt: new Date(now().getTime() + 45 * 60_000), endAt: new Date(now().getTime() + 105 * 60_000), title: 'Scheduled lab' });
  const teacher = request.agent(app);
  await login(teacher, 'teacher@test.local');
  const clash = await teacher.post(api(`/rooms/${f.room._id}/access-leases`)).send({ durationMinutes: 60, acceptPolicy: true });
  assert.equal(clash.status, 409);
  assert.equal(clash.body.error.code, 'booking_conflict');
  const ok = await teacher.post(api(`/rooms/${f.room._id}/access-leases`)).send({ durationMinutes: 30, acceptPolicy: true });
  assert.equal(ok.status, 201);
  const ext = await teacher.post(api(`/access-leases/${ok.body.lease.id}/extend`)).send({ additionalMinutes: 30 });
  assert.equal(ext.status, 409);
});

test('a locked-out room refuses access leases', async () => {
  const f = await fixture();
  await RoomBreaker.updateOne({ _id: f.breaker._id }, { $set: { 'interlocks.maintenanceLock': true } });
  const teacher = request.agent(app);
  await login(teacher, 'teacher@test.local');
  const res = await teacher.post(api(`/rooms/${f.room._id}/access-leases`)).send({ durationMinutes: 30, acceptPolicy: true });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'room_locked_out');
});

// ---------- incidents over HTTP ----------

test('incident actions: assigned staff only; acknowledge is not resolve; resolve records how', async () => {
  const f = await fixture();
  await vacantFor(15);
  await tick();
  const incident = await Incident.findOne({ roomId: f.room._id, active: true });

  const teacher = request.agent(app);
  await login(teacher, 'teacher@test.local');
  assert.equal((await teacher.post(api(`/incidents/${incident._id}/resolve`)).send({ method: 'false_alarm' })).status, 403);

  const tech = request.agent(app);
  await login(tech, 'tech@test.local');
  const inbox = await tech.get(api('/notifications'));
  assert.equal(inbox.body.unread, 1);
  const ack = await tech.post(api(`/incidents/${incident._id}/acknowledge`));
  assert.equal(ack.body.state, 'inspecting');
  assert.equal(ack.body.active, true);
  assert.equal((await tech.post(api(`/incidents/${incident._id}/snooze`)).send({ minutes: 500 })).status, 400);

  const detail = await tech.get(api(`/incidents/${incident._id}`));
  assert.equal(detail.status, 200);
  assert.ok(detail.body.jobs.some((j) => j.type === 'final_check' && j.status === 'pending'));
  assert.ok(detail.body.incident.timeline.length >= 3);

  const resolved = await tech.post(api(`/incidents/${incident._id}/resolve`)).send({ method: 'manual_switch_off', note: 'Switched off at the wall' });
  assert.equal(resolved.body.state, 'resolved');
  const stored = await Incident.findById(incident._id);
  assert.equal(stored.resolution.verification, 'manually_confirmed');
  assert.equal((await tech.post(api(`/incidents/${incident._id}/resolve`)).send({ method: 'other' })).status, 409);
});

test('settings validate and persist; the tariff feeds the cost estimate', async () => {
  await fixture();
  const agent = request.agent(app);
  await login(agent, 'admin@test.local');
  assert.equal((await agent.patch(api('/settings')).send({ tariffPerKwh: -1 })).status, 400);
  const ok = await agent.patch(api('/settings')).send({ tariffPerKwh: 9.5, tariffIsHypothetical: false, policies: { vacancyConfirmationMinutes: 20 } });
  assert.equal(ok.status, 200);
  const s = await getSettings();
  assert.equal(s.tariffPerKwh, 9.5);
  assert.equal(s.policies.vacancyConfirmationMinutes, 20);
  assert.equal(s.policies.firstEscalationMinutes, 10);
});
