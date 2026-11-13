import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { setConfigForTests } from '../src/config.js';
import { advanceForTests, now, setNowForTests } from '../src/clock.js';
import { connectDb, disconnectDb } from '../src/db.js';
import { Device, Integration, Room, RoomBreaker, User } from '../src/models/index.js';
import { getSettings } from '../src/services/core.js';
import { ingestObservation } from '../src/services/occupancy.js';
import { workerTick } from '../src/workers/jobRunner.js';

export const SERVICE_TOKEN = 'test-service-token-0123456789';
export const PASSWORD = 'test-password';
export const MIN = 60_000;
// A Wednesday morning in the installation timezone: 10:00 IST.
export const T0 = new Date('2026-11-11T10:00:00+05:30');

let mongod;

export async function startTestDb(overrides = {}) {
  setConfigForTests({
    DEMO_MODE: 'true',
    DEMO_TIME_SCALE: '1',
    SESSION_SECRET: 'test-session-secret-0123456789',
    SERVICE_INGEST_TOKEN: SERVICE_TOKEN,
    SEED_PASSWORD: PASSWORD,
    WORKER_INLINE: 'false',
    ...overrides,
  });
  mongod = await MongoMemoryServer.create();
  await connectDb(mongod.getUri('campus_test'));
}

export async function stopTestDb() {
  setNowForTests(null);
  await disconnectDb();
  await mongod?.stop();
}

export async function resetDb() {
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  setNowForTests(T0);
}

export const advance = (minutes) => advanceForTests(minutes * MIN);
export const tick = () => workerTick('test-worker');

// One camera-covered room with a simulated master, approved loads and three responders.
export async function fixture(roomOverrides = {}) {
  const settings = await getSettings();
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const mk = (name, role) => User.create({ name, email: `${name.toLowerCase()}@test.local`, role, passwordHash });
  const [admin, hod, tech, backup, teacher, viewer] = await Promise.all([mk('Admin', 'admin'), mk('Hod', 'hod'), mk('Tech', 'first_responder'), mk('Backup', 'first_responder'), mk('Teacher', 'teacher'), mk('Viewer', 'viewer')]);
  const room = await Room.create({
    code: 'R1',
    name: 'Test room',
    occupancySource: 'camera',
    coverageValidated: true,
    controlMode: 'simulated',
    autoControlEnabled: true,
    qrPublicToken: 'public-token-r1',
    assignments: { firstResponderId: tech._id, backupResponderId: backup._id, secondResponderId: hod._id },
    ...roomOverrides,
  });
  for (const u of [tech, backup, teacher]) {
    u.permittedRoomIds = [room._id];
    await u.save();
  }
  const breaker = await RoomBreaker.create({ roomId: room._id, code: 'BRK-R1', adapter: 'simulator', supplyState: 'on' });
  const light = await Device.create({ roomId: room._id, name: 'Lights', category: 'light', ratedWatts: 200, supplyInterruptionApproved: true, controlledByRoomBreakerId: breaker._id });
  await Integration.create({ sourceId: 'CAM-R1', type: 'camera', roomId: room._id, dataMode: 'simulated' });
  return { settings, admin, hod, tech, backup, teacher, viewer, room, breaker, light };
}

export function observe(occupancy, extra = {}) {
  return ingestObservation({
    eventId: randomUUID(),
    sourceId: 'CAM-R1',
    capturedAt: now().toISOString(),
    occupancy,
    coverageValidated: true,
    quality: { usable: true },
    dataMode: 'simulated',
    ...extra,
  });
}

// Keeps evidence fresh while time passes, the way a camera reporting every minute would.
export async function vacantFor(minutes) {
  for (let i = 0; i < minutes; i += 1) {
    await observe('vacant');
    advance(1);
  }
  await observe('vacant');
}

export async function login(agent, email) {
  const res = await agent.post('/api/v1/auth/login').send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.user;
}
