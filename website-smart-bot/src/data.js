import { createHash } from 'node:crypto';
import { createCache } from './cache.js';
import { dataValue } from './text.js';

const READS = {
  rooms: (s) => s.get('/rooms'),
  schedules: (s) => s.get('/schedules?limit=200'),
  devices: (s) => s.get('/devices'),
  building: (s) => s.get('/management/building'),
  users: (s) => s.get('/users'),
};

export function createData({ ttlMs, timezone }) {
  const cache = createCache({ ttlMs, max: 500 });

  return {
    timezone,
    // Always read through the website API with the caller's own session, so what comes back is
    // exactly what that person is allowed to see. Short TTL, plus invalidate() after any change.
    async load(session, kind) {
      const key = `${session.user.id}:${kind}`;
      const hit = cache.get(key);
      if (hit) return hit;
      const value = await cache.once(key, async () => {
        const v = await READS[kind](session);
        cache.set(key, v);
        return v;
      });
      return value;
    },
    invalidate() {
      cache.clear();
    },
  };
}

// ---- local calendar helpers (installation timezone) ----
export function localDate(ms, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

export function dayBounds(ms, tz, dayOffset = 0) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  const sinceMidnight = ((Number(parts.hour) * 60 + Number(parts.minute)) * 60 + Number(parts.second)) * 1000;
  const start = ms - sinceMidnight + dayOffset * 86_400_000;
  return { start, end: start + 86_400_000, label: localDate(start + 12 * 3_600_000, tz) };
}

export const clock = (ms, tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
export const dayLabel = (ms, tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(ms));

export function isoWithOffset(ms, tz) {
  // e.g. 2026-11-14T10:30:00+05:30, so the model can copy the right offset format.
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offMin = Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
  const sign = offMin >= 0 ? '+' : '-';
  const abs = Math.abs(offMin);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

export function schedulesOn(schedules, bounds) {
  return schedules
    .filter((s) => s.status !== 'cancelled' && Date.parse(s.startAt) < bounds.end && Date.parse(s.endAt) > bounds.start)
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
}

// Equipment is summarised per room so the model sees a few lines rather than hundreds of rows.
export function equipmentByRoom(devices) {
  const map = new Map();
  for (const d of devices) {
    const entry = map.get(d.roomId) ?? { count: 0, watts: 0, byCategory: {} };
    entry.count += 1;
    entry.watts += Number(d.ratedWatts) || 0;
    entry.byCategory[d.category] = (entry.byCategory[d.category] ?? 0) + 1;
    map.set(d.roomId, entry);
  }
  return map;
}

// Builds the only website data a model ever sees: compact, size-limited, one line per record.
// Section choice follows the question so unrelated data is not sent.
export function buildSnapshot({ role, rooms, floors = [], schedules = [], devices = [], announcements = [], topics, timezone, now }) {
  const floorById = new Map(floors.map((f) => [f._id, f]));
  const lines = [];
  const roomCode = new Map(rooms.map((r) => [r._id, r.code]));

  lines.push(`ROOMS (${rooms.length})`);
  for (const r of rooms.slice(0, 120)) {
    const floor = role === 'admin' && r.floorId ? ` | floor ${dataValue(floorById.get(r.floorId)?.code ?? '?', 20)}` : '';
    lines.push(`${dataValue(r.code, 20)} | ${dataValue(r.name, 60)} | ${dataValue(r.spaceType ?? 'room', 20)} | capacity ${Number(r.capacity) || 0}${floor}`);
  }
  if (rooms.length > 120) lines.push(`(+${rooms.length - 120} more rooms not shown)`);

  if (role === 'admin' && floors.length) {
    lines.push(`FLOORS (${floors.length})`);
    for (const f of floors.slice(0, 60)) lines.push(`${dataValue(f.code, 20)} | ${dataValue(f.name, 60)} | order ${Number(f.order) || 0} | rooms ${rooms.filter((r) => r.floorId === f._id).length}`);
  }

  if (topics.has('schedule')) {
    const today = dayBounds(now, timezone, 0);
    const tomorrow = dayBounds(now, timezone, 1);
    for (const [label, bounds] of [['TODAY', today], ['TOMORROW', tomorrow]]) {
      const rows = schedulesOn(schedules, bounds);
      lines.push(`TIMETABLE ${label} ${bounds.label} (${rows.length})`);
      for (const s of rows.slice(0, 40)) lines.push(`${dataValue(roomCode.get(s.roomId) ?? '?', 20)} | ${clock(Date.parse(s.startAt), timezone)}-${clock(Date.parse(s.endAt), timezone)} | ${dataValue(s.title, 80)}`);
    }
  }

  if (topics.has('equipment')) {
    const eq = equipmentByRoom(devices);
    lines.push(`EQUIPMENT PER ROOM (${devices.length} items, rated nameplate watts, not measured)`);
    for (const r of rooms.slice(0, 120)) {
      const e = eq.get(r._id);
      if (e) lines.push(`${dataValue(r.code, 20)} | ${Object.entries(e.byCategory).map(([c, n]) => `${dataValue(c, 12)} x${n}`).join(', ')} | ${Math.round(e.watts)} W total`);
    }
  }

  if (announcements.length) {
    lines.push(`ANNOUNCEMENTS (${announcements.length}, newest first)`);
    for (const a of announcements.slice(0, 5)) lines.push(`${localDate(a.createdAt, timezone)} | ${a.audience} | ${dataValue(a.message, 200)}`);
  }

  const text = lines.join('\n');
  return { text, digest: createHash('sha256').update(`${role}\n${text}`).digest('hex').slice(0, 24), approxTokens: Math.ceil(text.length / 4) };
}

export function topicsFor(text) {
  const topics = new Set();
  if (/\b(?:schedule|timetable|booking|class|classes|lecture|today|tomorrow|session|when|time|free|busy|occupied|available)\b/i.test(text)) topics.add('schedule');
  if (/\b(?:device|equipment|load|appliance|fan|light|socket|ac|air|watt|power|energy)\w*\b/i.test(text)) topics.add('equipment');
  return topics;
}
