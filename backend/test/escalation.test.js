import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { now } from '../src/clock.js';
import { Command, Device, Incident, Job, Notification, Room, RoomBreaker, Schedule } from '../src/models/index.js';
import { issueSupplyCommand } from '../src/services/commands.js';
import { acknowledgeIncident, snoozeIncident } from '../src/services/incidents.js';
import { createOverride } from '../src/services/leases.js';
import { advance, fixture, observe, resetDb, startTestDb, stopTestDb, tick, vacantFor } from './helpers.js';

before(() => startTestDb());
after(() => stopTestDb());
beforeEach(() => resetDb());

const activeIncident = (roomId) => Incident.findOne({ roomId, active: true });
const lastIncident = (roomId) => Incident.findOne({ roomId }).sort({ createdAt: -1 });

// Confirms vacancy and opens the incident: the alert clock starts here, not at the first empty frame.
async function openIncident(f) {
  await vacantFor(15);
  await tick();
  const incident = await activeIncident(f.room._id);
  assert.ok(incident, 'incident should open once vacancy is confirmed');
  return incident;
}

// Advances time while the camera keeps reporting, ticking the worker each minute.
async function pass(minutes, occupancy = 'vacant') {
  for (let i = 0; i < minutes; i += 1) {
    advance(1);
    if (occupancy) await observe(occupancy);
    await tick();
  }
}

test('no incident before the vacancy period completes', async () => {
  const f = await fixture();
  await vacantFor(14);
  await tick();
  assert.equal(await activeIncident(f.room._id), null);
});

test('full escalation: first alert, +10 min HOD, +15 min simulated OFF that is never shown as verified', async () => {
  const f = await fixture();
  const incident = await openIncident(f);
  assert.equal((await Incident.findById(incident._id)).state, 'notified_first');
  assert.equal(await Notification.countDocuments({ recipientId: f.tech._id, stage: 'first' }), 1);
  assert.equal(await Notification.countDocuments({ recipientId: f.hod._id }), 0);

  await pass(9);
  assert.equal((await Incident.findById(incident._id)).state, 'notified_first');
  await pass(1);
  assert.equal((await Incident.findById(incident._id)).state, 'escalated');
  assert.equal(await Notification.countDocuments({ recipientId: f.hod._id, stage: 'escalation' }), 1);

  await pass(14);
  assert.equal((await RoomBreaker.findOne({ roomId: f.room._id })).supplyState, 'on');
  await pass(1);

  const done = await Incident.findById(incident._id);
  assert.equal(done.state, 'resolved');
  assert.equal(done.active, false);
  assert.equal(done.resolution.method, 'automatic_supply_off');
  assert.equal(done.resolution.verification, 'simulated');

  const breaker = await RoomBreaker.findOne({ roomId: f.room._id });
  assert.equal(breaker.supplyState, 'off');
  assert.equal(breaker.offReason, 'automation');

  const commands = await Command.find({ incidentId: incident._id });
  assert.equal(commands.length, 1);
  assert.equal(commands[0].action, 'off');
  assert.equal(commands[0].verification, 'simulated');
  assert.equal(commands[0].dataMode, 'simulated');
});

test('occupied room with no booking is never shut down', async () => {
  const f = await fixture();
  for (let i = 0; i < 45; i += 1) {
    await observe('occupied', { detectedPeople: 2 });
    advance(1);
    await tick();
  }
  assert.equal(await Incident.countDocuments(), 0);
  assert.equal(await Command.countDocuments(), 0);
});

test('vacant room inside a booking or its preparation window is protected', async () => {
  const f = await fixture();
  await Schedule.create({ roomId: f.room._id, startAt: new Date(now().getTime() + 25 * 60_000), endAt: new Date(now().getTime() + 90 * 60_000), title: 'Lecture' });
  // Vacancy confirms at +15 min, which is inside the 15-minute preparation window of the +25 min class.
  await vacantFor(15);
  await tick();
  assert.equal(await Incident.countDocuments(), 0);
});

test("tomorrow's booking does not protect today's idle room", async () => {
  const f = await fixture();
  await Schedule.create({ roomId: f.room._id, startAt: new Date(now().getTime() + 24 * 3_600_000), endAt: new Date(now().getTime() + 25 * 3_600_000), title: 'Tomorrow' });
  await openIncident(f);
});

test('a person entering at minute 24 cancels the pending minute-25 cutoff', async () => {
  const f = await fixture();
  const incident = await openIncident(f);
  await pass(24);
  assert.equal((await Incident.findById(incident._id)).state, 'escalated');
  await observe('occupied', { detectedPeople: 1 });
  const cancelled = await Incident.findById(incident._id);
  assert.equal(cancelled.state, 'cancelled');
  await pass(5, 'occupied');
  assert.equal(await Command.countDocuments(), 0);
  assert.equal((await RoomBreaker.findOne({ roomId: f.room._id })).supplyState, 'on');
  assert.equal(await Job.countDocuments({ incidentId: incident._id, status: 'pending' }), 0);
});

test('camera disconnect makes occupancy unknown and blocks the automatic cutoff', async () => {
  const f = await fixture();
  const incident = await openIncident(f);
  await pass(12);
  // The camera stops reporting: evidence goes stale rather than staying "vacant".
  await pass(20, null);
  const blocked = await Incident.findById(incident._id);
  assert.equal(blocked.state, 'blocked');
  assert.match(blocked.blockReason, /unknown/);
  assert.equal(blocked.active, true);
  assert.equal(await Command.countDocuments(), 0);
  assert.equal((await RoomBreaker.findOne({ roomId: f.room._id })).supplyState, 'on');
});

test('an unusable frame is unknown, not vacant', async () => {
  const f = await fixture();
  await vacantFor(10);
  await observe('unknown', { quality: { usable: false, reason: 'too_dark' } });
  advance(10);
  await observe('vacant');
  await tick();
  // The vacancy clock restarted after the unusable frame.
  assert.equal(await Incident.countDocuments(), 0);
  assert.equal((await Room.findById(f.room._id)).occupancy.state, 'vacant');
});

test('acknowledging alone leaves the incident open and escalation continues', async () => {
  const f = await fixture();
  const incident = await openIncident(f);
  await acknowledgeIncident(await Incident.findById(incident._id), f.tech);
  const acked = await Incident.findById(incident._id);
  assert.equal(acked.state, 'inspecting');
  assert.equal(acked.active, true);
  await pass(10);
  assert.equal((await Incident.findById(incident._id)).state, 'escalated');
});

test('an expired snooze re-evaluates current evidence before anything else happens', async () => {
  const f = await fixture();
  const incident = await openIncident(f);
  await snoozeIncident(await Incident.findById(incident._id), f.tech, 20);
  await pass(19);
  assert.equal((await Incident.findById(incident._id)).state, 'snoozed');
  assert.equal(await Command.countDocuments(), 0);
  await pass(1);
  // Still vacant, so escalation resumes from stored due times.
  assert.equal((await Incident.findById(incident._id)).state, 'escalated');
  await pass(15);
  assert.equal((await Incident.findById(incident._id)).state, 'resolved');

  // Second run: someone is present when the snooze expires, so nothing proceeds.
  await resetDb();
  const g = await fixture();
  const second = await openIncident(g);
  await snoozeIncident(await Incident.findById(second._id), g.tech, 20);
  advance(20);
  await observe('occupied');
  await tick();
  assert.equal((await Incident.findById(second._id)).state, 'cancelled');
  assert.equal(await Command.countDocuments(), 0);
});

test('a worker restart recovers persisted work without repeating a command', async () => {
  const f = await fixture();
  const incident = await openIncident(f);
  await pass(24);
  // Simulate a crash: the final job was claimed by a worker that died holding its lease.
  advance(1);
  await observe('vacant');
  const final = await Job.findOne({ incidentId: incident._id, type: 'final_check' });
  final.status = 'leased';
  final.leaseOwner = 'dead-worker';
  final.leaseUntil = new Date(now().getTime() - 1000);
  await final.save();

  await tick();
  assert.equal((await Incident.findById(incident._id)).state, 'resolved');
  assert.equal(await Command.countDocuments({ incidentId: incident._id }), 1);
  // Running the worker again changes nothing.
  await tick();
  await tick();
  assert.equal(await Command.countDocuments({ incidentId: incident._id }), 1);
});

test('a crash mid-command is reported as unverified, not reissued', async () => {
  const f = await fixture();
  const incident = await openIncident(f);
  await pass(24);
  const live = await Incident.findById(incident._id);
  const orphan = await Command.create({ requestId: 'orphan-1', roomId: f.room._id, roomBreakerId: f.breaker._id, roomBreakerCode: 'BRK-R1', action: 'off', reason: 'vacancy_escalation', incidentId: incident._id, issuedAt: now(), expiresAt: new Date(now().getTime() + 30_000), dataMode: 'simulated' });
  live.commandIds.push(orphan._id);
  live.state = 'action_sent';
  await live.save();
  await pass(1);
  const after = await Incident.findById(incident._id);
  assert.equal(after.state, 'action_unverified');
  assert.equal(after.active, true);
  assert.equal(await Command.countDocuments({ incidentId: incident._id }), 1);
});

test('a staff override arriving during queued work invalidates it', async () => {
  const f = await fixture();
  const incident = await openIncident(f);
  await pass(20);
  await createOverride(f.room._id, f.tech, { reason: 'Exam invigilation setup', durationMinutes: 60 });
  assert.equal((await Incident.findById(incident._id)).state, 'cancelled');
  await pass(10);
  assert.equal(await Command.countDocuments(), 0);
});

test('a booking that starts while the incident is queued cancels it', async () => {
  const f = await fixture();
  const incident = await openIncident(f);
  await Schedule.create({ roomId: f.room._id, startAt: new Date(now().getTime() + 30 * 60_000), endAt: new Date(now().getTime() + 90 * 60_000), title: 'Late class' });
  await pass(16);
  assert.equal((await Incident.findById(incident._id)).state, 'cancelled');
  assert.equal(await Command.countDocuments(), 0);
});

test('a room policy change invalidates work queued under the old version', async () => {
  const f = await fixture();
  const incident = await openIncident(f);
  await Room.updateOne({ _id: f.room._id }, { $inc: { policyVersion: 1 } });
  await pass(10);
  assert.equal((await Incident.findById(incident._id)).state, 'cancelled');
});

test('an AC that needs a normal stop blocks the whole room cutoff until staff confirm it', async () => {
  const f = await fixture();
  const ac = await Device.create({ roomId: f.room._id, name: 'Split AC', category: 'ac', ratedWatts: 1600, supplyInterruptionApproved: true, requiresNormalStopBeforeCutoff: true });
  const incident = await openIncident(f);
  await pass(25);
  const blocked = await Incident.findById(incident._id);
  assert.equal(blocked.state, 'blocked');
  assert.match(blocked.blockReason, /normal stop procedure/);
  assert.equal((await RoomBreaker.findOne({ roomId: f.room._id })).supplyState, 'on');
  assert.ok(await Notification.countDocuments({ incidentId: incident._id, stage: 'manual_task' }));

  // After an authenticated confirmation the same room-level command is allowed.
  ac.stopProcedureConfirmedAt = now();
  await ac.save();
  const command = await issueSupplyCommand({ roomId: f.room._id, action: 'off', reason: 'manual', actor: f.tech });
  assert.equal(command.status, 'completed');
  assert.equal((await RoomBreaker.findOne({ roomId: f.room._id })).supplyState, 'off');
});

test('alert-only rooms get a manual task and no command', async () => {
  const f = await fixture({ controlMode: 'alert_only', autoControlEnabled: false });
  const incident = await openIncident(f);
  await pass(25);
  const blocked = await Incident.findById(incident._id);
  assert.equal(blocked.state, 'blocked');
  assert.match(blocked.blockReason, /alert-only/);
  assert.equal(await Command.countDocuments(), 0);
});

test('a room master command without feedback is unverified, never confirmed OFF', async () => {
  const f = await fixture();
  await RoomBreaker.updateOne({ _id: f.breaker._id }, { $set: { 'simulator.feedback': false } });
  const incident = await openIncident(f);
  await pass(25);
  const after = await Incident.findById(incident._id);
  assert.equal(after.state, 'action_unverified');
  assert.equal(after.active, true);
  const command = await Command.findOne({ incidentId: incident._id });
  assert.equal(command.verification, 'command_only');
  assert.equal(command.reportedOutput, null);
  assert.equal((await RoomBreaker.findOne({ roomId: f.room._id })).supplyState, 'unknown');
});

test('a failed transport leaves the incident failed and the supply untouched', async () => {
  const f = await fixture();
  await RoomBreaker.updateOne({ _id: f.breaker._id }, { $set: { 'simulator.failTransport': true } });
  const incident = await openIncident(f);
  await pass(25);
  assert.equal((await Incident.findById(incident._id)).state, 'failed');
  assert.equal((await RoomBreaker.findOne({ roomId: f.room._id })).supplyState, 'on');
});

test('a returning person restores a supply this automation switched off', async () => {
  const f = await fixture();
  await openIncident(f);
  await pass(25);
  assert.equal((await RoomBreaker.findOne({ roomId: f.room._id })).supplyState, 'off');
  advance(5);
  const result = await observe('occupied', { detectedPeople: 1 });
  assert.ok(result.restoreCommand);
  const breaker = await RoomBreaker.findOne({ roomId: f.room._id });
  assert.equal(breaker.supplyState, 'on');
  assert.equal(breaker.offReason, null);
  const restore = await Command.findOne({ requestId: result.restoreCommand });
  assert.equal(restore.reason, 'occupancy_restore');
});

test('a fault-tripped or maintenance-locked breaker is never restored automatically', async () => {
  for (const lock of ['faultTripped', 'maintenanceLock']) {
    await resetDb();
    const f = await fixture();
    await RoomBreaker.updateOne({ _id: f.breaker._id }, { $set: { supplyState: 'off', offReason: 'automation', [`interlocks.${lock}`]: true } });
    const result = await observe('occupied', { detectedPeople: 1 });
    const command = await Command.findOne({ requestId: result.restoreCommand });
    assert.equal(command.status, 'rejected');
    assert.equal(command.transportStatus, 'not_sent');
    assert.equal((await RoomBreaker.findOne({ roomId: f.room._id })).supplyState, 'off');
  }
});

test('a supply switched off by hand is not restored by occupancy', async () => {
  const f = await fixture();
  await RoomBreaker.updateOne({ _id: f.breaker._id }, { $set: { supplyState: 'off', offReason: 'manual' } });
  const result = await observe('occupied', { detectedPeople: 1 });
  assert.equal(result.restoreCommand, null);
  assert.equal(await Command.countDocuments(), 0);
});

test('duplicate observation events are ignored', async () => {
  await fixture();
  const payload = { eventId: 'same-event', sourceId: 'CAM-R1', capturedAt: now().toISOString(), occupancy: 'occupied', coverageValidated: true, dataMode: 'simulated' };
  const { ingestObservation } = await import('../src/services/occupancy.js');
  assert.equal((await ingestObservation(payload)).duplicate, false);
  assert.equal((await ingestObservation(payload)).duplicate, true);
});

test('a failed first notification is recorded and routed to the backup', async () => {
  const f = await fixture();
  f.tech.active = false;
  await f.tech.save();
  const incident = await openIncident(f);
  const failed = await Notification.findOne({ incidentId: incident._id, recipientId: f.tech._id });
  assert.equal(failed.deliveryState, 'failed');
  assert.equal(await Notification.countDocuments({ incidentId: incident._id, recipientId: f.backup._id, deliveryState: 'delivered' }), 1);
  assert.ok((await Incident.findById(incident._id)).timeline.some((t) => t.kind === 'notification_failed'));
});

test('after staff resolve an episode the same vacancy does not immediately re-alert', async () => {
  const f = await fixture();
  const incident = await openIncident(f);
  const { resolveIncident } = await import('../src/services/incidents.js');
  await resolveIncident(await Incident.findById(incident._id), f.tech, { method: 'false_alarm' });
  await pass(30);
  assert.equal(await Incident.countDocuments(), 1);
  // New occupancy followed by a new vacancy is a new episode with its own timeline.
  await pass(2, 'occupied');
  await vacantFor(15);
  await tick();
  const next = await lastIncident(f.room._id);
  assert.equal(next.episode, 2);
  assert.equal(next.active, true);
});
