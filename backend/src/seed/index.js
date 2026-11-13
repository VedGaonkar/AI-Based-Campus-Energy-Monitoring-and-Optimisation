import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { now } from '../clock.js';
import { Device, Incident, Integration, Observation, Room, RoomBreaker, Schedule, User } from '../models/index.js';
import { getSettings } from '../services/core.js';
import { ingestReadings } from '../services/meterIngest.js';
import { generateRecommendations } from '../services/recommendations.js';
import { dayCategory, localParts, round, startOfLocalDay } from '../util/time.js';

// Deterministic generator so every reset produces the same demo dataset.
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOUR = 3_600_000;
const DAY = 86_400_000;
const HISTORY_DAYS = 30;

// Weekly timetable in local hours. weekday: 1 = Monday.
const TIMETABLE = {
  R101: [
    { days: [1, 2, 3, 4, 5], start: 9, end: 11, title: 'BCA lecture' },
    { days: [1, 2, 3, 4, 5], start: 11, end: 13, title: 'BSc Mathematics' },
    { days: [1, 2, 3, 4, 5], start: 14, end: 16, title: 'MCA seminar' },
  ],
  R102: [
    { days: [1, 2, 3, 4, 5], start: 10, end: 12, title: 'BCom Accounting' },
    { days: [1, 3, 5], start: 14, end: 15, title: 'Tutorial group' },
  ],
  R103: [{ days: [2, 4], start: 9, end: 10, title: 'Language elective' }],
  R104: [{ days: [1], start: 15, end: 16, title: 'Staff meeting' }],
  LAB1: [{ days: [1, 3, 5], start: 11, end: 13, title: 'Computer lab practical' }],
};

function buildingKw(at, tz, rnd, anomalyHours) {
  const { hour } = localParts(at, tz);
  const category = dayCategory(at, tz);
  let kw;
  if (hour >= 23 || hour < 6) kw = 3.4;
  else if (category !== 'teaching') kw = hour >= 9 && hour < 17 ? 5 : 3.8;
  else if (hour >= 9 && hour < 17) kw = 19 + (hour >= 11 && hour < 15 ? 3 : 0);
  else if (hour >= 17 && hour < 20) kw = 8;
  else kw = 5;
  kw *= 0.95 + rnd() * 0.1;
  if (anomalyHours.has(at.getTime())) kw *= 2.8;
  return kw;
}

export async function seedDemo() {
  const cfg = config();
  if (!cfg.demoMode) throw new Error('Demo data can only be loaded in demonstration mode');

  for (const [name, collection] of Object.entries(mongoose.connection.collections)) {
    if (name !== 'sessions') await collection.deleteMany({});
  }

  const settings = await getSettings();
  settings.name = 'Science Block (demo data)';
  settings.meterId = 'MAIN-01';
  settings.tariffPerKwh = 8;
  settings.tariffIsHypothetical = true;
  settings.anomaly.essentialLoadKw = 2;
  settings.budget.roomMasterBreakerQuote = 0;
  await settings.save();
  const tz = settings.timezone;

  // Demo accounts only. Never seed real staff contact details.
  const passwordHash = await bcrypt.hash(cfg.seedPassword, 10);
  const mkUser = (name, email, role, department) => ({ name, email, role, department, passwordHash });
  const [admin, hod, tech, backup, teacher, student] = await User.insertMany([
    mkUser('Demo Administrator', 'admin@demo.local', 'admin', 'Administration'),
    mkUser('Demo HOD', 'hod@demo.local', 'hod', 'Computer Science'),
    mkUser('Demo Technician', 'tech@demo.local', 'first_responder', 'Facilities'),
    mkUser('Demo Backup Technician', 'backup@demo.local', 'first_responder', 'Facilities'),
    mkUser('Demo Teacher', 'teacher@demo.local', 'teacher', 'Computer Science'),
    mkUser('Demo Student', 'student@demo.local', 'viewer', 'Computer Science'),
  ]);

  const assignments = { firstResponderId: tech._id, backupResponderId: backup._id, secondResponderId: hod._id };
  const mkRoom = (code, name, capacity, extra) => ({ code, name, capacity, assignments, qrPublicToken: randomBytes(18).toString('base64url'), ...extra });
  const rooms = await Room.insertMany([
    mkRoom('R101', 'Lecture Room 101', 60, { occupancySource: 'camera', coverageValidated: true, controlMode: 'simulated', autoControlEnabled: true, coverageNotes: 'Whole seating area visible; validated with a person in the back corner' }),
    mkRoom('R102', 'Lecture Room 102', 60, { occupancySource: 'camera', coverageValidated: true, controlMode: 'simulated', autoControlEnabled: true, coverageNotes: 'Whole seating area visible' }),
    mkRoom('R103', 'Seminar Room 103', 30, { occupancySource: 'presence_sensor', coverageValidated: true, controlMode: 'simulated', autoControlEnabled: true, coverageNotes: 'LD2410 node above the door; rear row tested seated' }),
    mkRoom('R104', 'Meeting Room 104', 16, { occupancySource: 'none', controlMode: 'simulated', autoControlEnabled: false, coverageNotes: 'No camera or sensor: QR access only' }),
    mkRoom('LAB1', 'Computer Lab 1', 40, { occupancySource: 'camera', coverageValidated: true, controlMode: 'alert_only', autoControlEnabled: false, coverageNotes: 'Alert-only: computers need graceful shutdown' }),
  ]);
  const byCode = Object.fromEntries(rooms.map((r) => [r.code, r]));

  tech.permittedRoomIds = rooms.map((r) => r._id);
  backup.permittedRoomIds = rooms.map((r) => r._id);
  teacher.permittedRoomIds = [byCode.R101._id, byCode.R104._id];
  student.permittedRoomIds = [byCode.R101._id];
  await Promise.all([tech.save(), backup.save(), teacher.save(), student.save()]);

  const breakers = await RoomBreaker.insertMany(
    rooms.map((r) => ({ roomId: r._id, code: `BRK-${r.code}`, adapter: 'simulator', supplyState: 'on', feederCoverage: `Simulated feeder for ${r.code}: lights, fans, sockets and AC supply`, verifiedRatings: 'Simulated device: no electrical rating', lastSeenAt: now() })),
  );
  const breakerOf = Object.fromEntries(breakers.map((b) => [String(b.roomId), b._id]));

  const ok = { supplyInterruptionApproved: true, restartBehaviourKnown: true };
  const dev = (code, name, category, ratedWatts, quantity, extra = {}) => ({ roomId: byCode[code]._id, controlledByRoomBreakerId: breakerOf[String(byCode[code]._id)], name, category, ratedWatts, quantity, ...ok, ...extra });
  await Device.insertMany([
    dev('R101', 'LED tube lights', 'light', 20, 12),
    dev('R101', 'Ceiling fans', 'fan', 75, 6),
    dev('R101', 'Projector', 'projector', 300, 1),
    dev('R102', 'LED tube lights', 'light', 20, 12),
    dev('R102', 'Ceiling fans', 'fan', 75, 6),
    dev('R102', 'Wall sockets', 'socket', 200, 1),
    dev('R103', 'LED panel lights', 'light', 36, 6),
    dev('R103', 'Split AC 1.5 t', 'ac', 1600, 1, { requiresNormalStopBeforeCutoff: true, restartDelaySeconds: 180, approvalNotes: 'Operating manual requires a normal stop before the breaker is opened' }),
    dev('R104', 'LED panel lights', 'light', 36, 4),
    dev('R104', 'Ceiling fans', 'fan', 75, 2),
    dev('LAB1', 'Desktop computers', 'computer', 150, 40, { supplyInterruptionApproved: false, approvalNotes: 'Need graceful shutdown; not approved for shared cutoff' }),
    dev('LAB1', 'LED tube lights', 'light', 20, 16),
  ]);

  await Integration.insertMany([
    { sourceId: 'CAM-R101', type: 'camera', name: 'R101 camera (simulated feed)', roomId: byCode.R101._id, dataMode: 'simulated' },
    { sourceId: 'CAM-R102', type: 'camera', name: 'R102 camera (simulated feed)', roomId: byCode.R102._id, dataMode: 'simulated' },
    { sourceId: 'PRES-R103', type: 'presence_sensor', name: 'R103 LD2410 node (simulated)', roomId: byCode.R103._id, dataMode: 'simulated' },
    { sourceId: 'CAM-LAB1', type: 'camera', name: 'LAB1 camera (simulated feed)', roomId: byCode.LAB1._id, dataMode: 'simulated' },
  ]);

  // Timetable: the past month and the coming week.
  const today = startOfLocalDay(now(), tz);
  const schedules = [];
  for (let d = -HISTORY_DAYS; d <= 7; d += 1) {
    // Midday avoids landing on the wrong local date around the day boundary.
    const dayStart = startOfLocalDay(new Date(today.getTime() + d * DAY + 12 * HOUR), tz);
    const { weekday } = localParts(new Date(dayStart.getTime() + 12 * HOUR), tz);
    for (const [code, slots] of Object.entries(TIMETABLE)) {
      for (const s of slots.filter((x) => x.days.includes(weekday))) {
        schedules.push({ roomId: byCode[code]._id, startAt: new Date(dayStart.getTime() + s.start * HOUR), endAt: new Date(dayStart.getTime() + s.end * HOUR), title: s.title, origin: 'fixture' });
      }
    }
  }
  await Schedule.insertMany(schedules);

  // Synthetic hourly cumulative readings, labelled simulated end to end.
  const rnd = mulberry32(20261113);
  // Readings sit on local clock hours (the timezone offset may not be a whole hour).
  const lastHour = new Date(today.getTime() + Math.floor((now().getTime() - today.getTime()) / HOUR) * HOUR);
  const first = new Date(lastHour.getTime() - HISTORY_DAYS * 24 * HOUR);
  const yesterday19 = new Date(startOfLocalDay(new Date(now().getTime() - DAY), tz).getTime() + 19 * HOUR);
  const anomalyHours = new Set([yesterday19.getTime(), yesterday19.getTime() + HOUR, first.getTime() + 20 * 24 * HOUR + 13 * HOUR]);
  const gapStart = first.getTime() + 12 * 24 * HOUR + 2 * HOUR;
  const rows = [];
  let cumulative = 48_250;
  for (let t = first.getTime(); t <= lastHour.getTime(); t += HOUR) {
    if (t > first.getTime()) cumulative += buildingKw(new Date(t - HOUR), tz, rnd, anomalyHours);
    // Three missing readings leave one aggregate gap interval instead of invented hourly points.
    if (t > gapStart && t <= gapStart + 3 * HOUR) continue;
    rows.push({ meterId: settings.meterId, capturedAt: new Date(t).toISOString(), value: round(cumulative, 1), register: 'import_kwh' });
  }

  // Evidence that makes R102 a possible (never measured) contributor to yesterday's anomaly.
  if (yesterday19 < now()) {
    await Observation.create({
      eventId: 'fixture-r102-evening', sourceId: 'CAM-R102', roomId: byCode.R102._id, capturedAt: new Date(yesterday19.getTime() + 30 * 60_000), receivedAt: now(),
      sourceType: 'camera', occupancy: 'vacant', detectedPeople: 0, confidence: 0.9, coverageValidated: true, quality: { usable: true }, equipmentOn: true, dataMode: 'simulated', modelVersion: 'demo-fixture',
    });
  }

  // Closed history for the "repeatedly left on" recommendation.
  const past = [3, 8, 13, 19].map((daysAgo, i) => {
    const openedAt = new Date(today.getTime() - daysAgo * DAY + 18 * HOUR);
    return {
      type: 'vacancy_waste', scope: 'room', roomId: byCode.R102._id, issueKey: `vacancy:${byCode.R102._id}`, episode: i + 1, active: false, state: 'resolved',
      title: 'R102: supply ON in a vacant room with no scheduled use', dataMode: 'simulated', assignments, policyVersion: 1, openedAt, firstNotifiedAt: openedAt,
      resolvedAt: new Date(openedAt.getTime() + 20 * 60_000), resolution: { method: 'manual_switch_off', by: tech._id, verification: 'manually_confirmed' },
      evidence: [{ label: 'Simulated', source: 'CAM-R102', text: 'Fixture: no person detected, equipment appeared ON', at: openedAt }],
      timeline: [{ at: openedAt, kind: 'opened', text: 'Fixture incident (simulated history)', actorLabel: 'system' }],
    };
  });
  await Incident.insertMany(past);

  const ingest = await ingestReadings(rows, { sourceType: 'fixture', dataMode: 'simulated', enteredBy: admin._id, commit: true });
  // One reading that fails validation, so the review queue has something real to show.
  await ingestReadings(
    [{ meterId: settings.meterId, capturedAt: new Date(lastHour.getTime() - 30 * 60_000).toISOString(), value: round(cumulative - 900, 1), register: 'import_kwh', rawText: '047?61.4', quality: { ocrConfidence: 0.52, registerMatched: true, burstAgreement: false } }],
    { sourceType: 'camera_ocr', dataMode: 'simulated', enteredBy: admin._id, commit: true },
  );
  const recs = await generateRecommendations();

  return { users: 6, rooms: rooms.length, schedules: schedules.length, readings: ingest.summary.accepted, recommendations: recs.length, password: 'value of SEED_PASSWORD' };
}
