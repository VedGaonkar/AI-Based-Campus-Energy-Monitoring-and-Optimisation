import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppApiError } from './appClient.js';
import { clock, dayLabel } from './data.js';
import { clean } from './text.js';

// Every change the assistant can make is defined here: a strict schema, a preview built from fresh
// data, and an executor that only calls the website's own endpoints. A model can propose these
// shapes; it can never execute them. Execution needs an administrator's explicit confirmation.

export const SPACE_TYPES = ['classroom', 'laboratory', 'office', 'meeting', 'washroom', 'corridor', 'other'];
export const CATEGORIES = ['lighting', 'fan', 'socket', 'ac', 'other'];
export const AUDIENCES = ['all', 'viewers', 'staff'];
export const AUDIENCE_ROLES = {
  all: ['admin', 'hod', 'technician', 'teacher', 'viewer'],
  viewers: ['viewer'],
  staff: ['admin', 'hod', 'technician', 'teacher'],
};
const AUDIENCE_LABEL = { all: 'everyone with an account', viewers: 'viewers', staff: 'staff (administrators, HODs, technicians, teachers)' };
const TYPE_NAME = { classroom: 'Classroom', laboratory: 'Laboratory', office: 'Office', meeting: 'Meeting Room', washroom: 'Washroom', corridor: 'Corridor', other: 'Space' };
const DEVICE_NAME = { lighting: 'LED light', fan: 'Ceiling fan', socket: 'Socket circuit', ac: 'Split AC', other: 'Equipment' };

const code = z.string().trim().min(1).max(15).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'use letters, numbers, - or _').transform((s) => s.toUpperCase());
const int = (min, max, def) => {
  const base = z.coerce.number().int().min(min).max(max);
  return def === undefined ? base : base.default(def);
};
const timestamp = z.string().refine((s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(s) && !Number.isNaN(Date.parse(s)), 'must be an ISO 8601 time with a UTC offset');

export const SCHEMAS = {
  create_floor: z.object({ floorCode: code, floorName: z.string().trim().min(1).max(100).optional(), roomCount: int(0, 100, 0), spaceType: z.enum(SPACE_TYPES).default('classroom'), capacity: int(0, 10000, 0), order: int(-20, 200).optional() }).strict(),
  add_rooms: z.object({ floorCode: code, count: int(1, 100), spaceType: z.enum(SPACE_TYPES).default('classroom'), capacity: int(0, 10000, 0) }).strict(),
  add_devices: z.object({ roomCode: z.string().trim().min(1).max(40), category: z.enum(CATEGORIES), count: int(1, 20), ratedWatts: z.coerce.number().min(0).max(100000), name: z.string().trim().min(1).max(100).optional() }).strict(),
  create_booking: z.object({ roomCode: z.string().trim().min(1).max(40), startAt: timestamp, endAt: timestamp, title: z.string().trim().min(1).max(200) }).strict()
    .refine((v) => Date.parse(v.endAt) > Date.parse(v.startAt), { message: 'endAt must be after startAt', path: ['endAt'] }),
  cancel_booking: z.object({ roomCode: z.string().trim().min(1).max(40), startAt: timestamp, title: z.string().trim().min(1).max(200).optional() }).strict(),
  send_announcement: z.object({ audience: z.enum(AUDIENCES), message: z.string().trim().min(3).max(500) }).strict(),
};

export const ACTION_TITLES = {
  create_floor: 'Create floor',
  add_rooms: 'Add rooms to a floor',
  add_devices: 'Record equipment in a room',
  create_booking: 'Create a booking',
  cancel_booking: 'Cancel a booking',
  send_announcement: 'Publish an announcement',
};

// A proposal still "executing" after this long belongs to a process that died; it may be resumed.
const EXECUTING_STALE_MS = 60_000;

const findByCode = (list, value) => list.find((x) => String(x.code).toLowerCase() === String(value).toLowerCase());

function inferFloorOrder(floorCode, floors) {
  let m = floorCode.match(/^B(\d+)$/);
  if (m) return -Number(m[1]);
  m = floorCode.match(/^(?:FL-?|F|L)?(\d{1,3})$/);
  if (m) return Number(m[1]);
  return floors.length ? Math.max(...floors.map((f) => Number(f.order) || 0)) + 1 : 0;
}

const roomRows = (prefix, spaceType, start, count) =>
  Array.from({ length: count }, (_, i) => {
    const suffix = String(start + i).padStart(3, '0');
    return { code: `${prefix}-${suffix}`, name: `${TYPE_NAME[spaceType]} ${suffix}` };
  });

const rangeText = (rows) => (rows.length <= 3 ? rows.map((r) => r.code).join(', ') : `${rows[0].code} to ${rows.at(-1).code}`);

const readFloors = async (ctx) => {
  // Admin-only view of floors; planning always reads fresh, never from the short cache.
  const b = await ctx.session.get('/management/building');
  return { floors: b.floors ?? [], rooms: b.rooms ?? [] };
};

// ---------------- planners: validate against live data and build the preview ----------------
const planners = {
  async create_floor(ctx, p) {
    const { floors, rooms } = await readFloors(ctx);
    const blockers = [];
    const warnings = [];
    if (findByCode(floors, p.floorCode)) blockers.push(`Floor ${p.floorCode} already exists. To add rooms to it, say "add ${p.roomCount || 4} rooms to floor ${p.floorCode}".`);
    const name = p.floorName ?? p.floorCode;
    const order = p.order ?? inferFloorOrder(p.floorCode, floors);
    const rows = p.roomCount > 0 ? roomRows(p.floorCode, p.spaceType, 1, p.roomCount) : [];
    const clash = rows.filter((r) => findByCode(rooms, r.code));
    if (clash.length) blockers.push(`Room codes already exist: ${clash.slice(0, 4).map((r) => r.code).join(', ')}. Choose a different floor name.`);
    const lines = [`Create floor ${p.floorCode} (name "${name}", order ${order}).`];
    const steps = [{ id: 'floor', label: `Create floor ${p.floorCode}` }];
    if (rows.length) {
      lines.push(`Create ${rows.length} ${TYPE_NAME[p.spaceType].toLowerCase()}${rows.length === 1 ? '' : 's'}: ${rangeText(rows)}, named like "${rows[0].name}".`);
      lines.push(p.capacity ? `Capacity ${p.capacity} each.` : 'Capacity is left at 0 (not set).');
      warnings.push('Each room gets its own simulated room master in alert-only mode. Nothing physical is connected, and no camera or load approvals are set.');
      steps.push({ id: 'rooms', label: `Create ${rows.length} rooms on ${p.floorCode}` });
    }
    return { blockers, warnings, lines, steps, normalized: { ...p, floorName: name, order } };
  },

  async add_rooms(ctx, p) {
    const { floors, rooms } = await readFloors(ctx);
    const floor = findByCode(floors, p.floorCode);
    if (!floor) return { blockers: [`There is no floor ${p.floorCode}. Create it first.`], warnings: [], lines: [], steps: [] };
    const re = new RegExp(`^${p.floorCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`, 'i');
    const highest = Math.max(0, ...rooms.map((r) => Number(String(r.code).match(re)?.[1] ?? 0)));
    const rows = roomRows(p.floorCode, p.spaceType, highest + 1, p.count);
    const clash = rows.filter((r) => findByCode(rooms, r.code));
    if (clash.length) return { blockers: [`Room codes already exist: ${clash.slice(0, 4).map((r) => r.code).join(', ')}.`], warnings: [], lines: [], steps: [] };
    return {
      blockers: [],
      warnings: ['Each room gets its own simulated room master in alert-only mode. Nothing physical is connected.'],
      lines: [`Add ${rows.length} ${TYPE_NAME[p.spaceType].toLowerCase()}${rows.length === 1 ? '' : 's'} to floor ${p.floorCode}: ${rangeText(rows)}.`, p.capacity ? `Capacity ${p.capacity} each.` : 'Capacity is left at 0 (not set).'],
      steps: [{ id: 'rooms', label: `Create ${rows.length} rooms on ${p.floorCode}` }],
      normalized: { ...p, floorId: floor._id, startNumber: highest + 1 },
    };
  },

  async add_devices(ctx, p) {
    const rooms = await ctx.data.load(ctx.session, 'rooms');
    const room = findByCode(rooms, p.roomCode);
    if (!room) return { blockers: [`I can't find room ${p.roomCode} in the rooms you can manage.`], warnings: [], lines: [], steps: [] };
    const name = p.name ?? DEVICE_NAME[p.category];
    const warnings = ['These are recorded as NOT approved for shared supply cutoff, so they will block automatic room cutoff until someone reviews them in the website. The assistant never sets interruption approvals.'];
    if (p.category === 'ac') warnings.push('An AC may need a normal-stop procedure before its supply is cut. Record that in the website.');
    const steps = Array.from({ length: p.count }, (_, i) => ({ id: `device-${i + 1}`, label: `Add ${p.count === 1 ? name : `${name} ${i + 1}`}` }));
    return {
      blockers: [],
      warnings,
      lines: [`Add ${p.count} × ${name} (${p.ratedWatts} W each, ${p.category}) to ${room.code} (${room.name}).`, `Rated total ${Math.round(p.count * p.ratedWatts)} W. This is an estimate for planning, not a measurement.`],
      steps,
      normalized: { ...p, name, roomId: room._id },
    };
  },

  async create_booking(ctx, p) {
    const rooms = await ctx.data.load(ctx.session, 'rooms');
    const room = findByCode(rooms, p.roomCode);
    if (!room) return { blockers: [`I can't find room ${p.roomCode} in the rooms you can manage.`], warnings: [], lines: [], steps: [] };
    const start = Date.parse(p.startAt);
    const end = Date.parse(p.endAt);
    const blockers = [];
    if (end - start > 12 * 3_600_000) blockers.push('A booking cannot be longer than 12 hours.');
    if (start < ctx.now - 3_600_000) blockers.push('That start time is in the past.');
    if (start > ctx.now + 366 * 86_400_000) blockers.push('That is more than a year ahead.');
    const schedules = await ctx.session.get('/schedules?limit=200');
    const overlap = schedules.filter((s) => s.roomId === room._id && s.status !== 'cancelled' && Date.parse(s.startAt) < end && Date.parse(s.endAt) > start);
    const tz = ctx.timezone;
    return {
      blockers,
      warnings: overlap.length ? [`This overlaps ${overlap.length} existing booking${overlap.length === 1 ? '' : 's'}: ${overlap.slice(0, 3).map((s) => `"${clean(s.title, 40)}" ${clock(Date.parse(s.startAt), tz)}–${clock(Date.parse(s.endAt), tz)}`).join(', ')}. The website does not block overlaps.`] : [],
      lines: [`Book ${room.code} (${room.name}) on ${dayLabel(start, tz)}, ${clock(start, tz)}–${clock(end, tz)}, titled "${p.title}".`, 'A booking protects the room from vacancy-based shutdown while it is in progress.'],
      steps: [{ id: 'booking', label: `Create booking in ${room.code}` }],
      normalized: { ...p, roomId: room._id },
    };
  },

  async cancel_booking(ctx, p) {
    const rooms = await ctx.data.load(ctx.session, 'rooms');
    const room = findByCode(rooms, p.roomCode);
    if (!room) return { blockers: [`I can't find room ${p.roomCode} in the rooms you can manage.`], warnings: [], lines: [], steps: [] };
    const start = Date.parse(p.startAt);
    const schedules = await ctx.session.get('/schedules?limit=200');
    const matches = schedules.filter((s) => s.roomId === room._id && s.status !== 'cancelled' && Math.abs(Date.parse(s.startAt) - start) <= 60_000 && (!p.title || String(s.title).toLowerCase().includes(p.title.toLowerCase())));
    if (matches.length !== 1) {
      return { blockers: [matches.length ? `${matches.length} bookings match; add the title to pick one.` : `I found no confirmed booking in ${room.code} starting at that time.`], warnings: [], lines: [], steps: [] };
    }
    const s = matches[0];
    return {
      blockers: [],
      warnings: ['Cancelling removes the booking\'s protection of the room.'],
      lines: [`Cancel "${clean(s.title, 80)}" in ${room.code} on ${dayLabel(Date.parse(s.startAt), ctx.timezone)}, ${clock(Date.parse(s.startAt), ctx.timezone)}–${clock(Date.parse(s.endAt), ctx.timezone)}.`],
      steps: [{ id: 'cancel', label: 'Cancel the booking' }],
      normalized: { ...p, scheduleId: s._id },
    };
  },

  async send_announcement(ctx, p) {
    let eligible = null;
    try {
      const users = await ctx.data.load(ctx.session, 'users');
      eligible = users.filter((u) => u.active !== false && AUDIENCE_ROLES[p.audience].includes(u.role)).length;
    } catch {
      /* the count is informational; publishing does not depend on it */
    }
    const warnings = ['It appears inside the assistant for those accounts. It is not added to the website\'s own alert inbox.'];
    if (eligible === 0) warnings.push('No active account currently matches this audience.');
    return {
      blockers: [],
      warnings,
      lines: [`Publish to ${AUDIENCE_LABEL[p.audience]}${eligible === null ? '' : ` (${eligible} active account${eligible === 1 ? '' : 's'})`}:`, `"${p.message}"`],
      steps: [{ id: 'publish', label: 'Publish announcement' }],
      normalized: { ...p, eligible },
    };
  },
};

// ---------------- executors: one website call per step, progress saved after each ----------------
const executors = {
  async create_floor(ctx, p, step, state) {
    if (step.id === 'floor') {
      if (step.resumed) {
        // A previous attempt may have succeeded just before it was interrupted: look before creating again.
        const existing = findByCode((await readFloors(ctx)).floors, p.floorCode);
        if (existing) return { floorId: existing._id, recovered: true };
      }
      const floor = await ctx.session.post('/management/floors', { name: p.floorName, code: p.floorCode, order: p.order });
      return { floorId: floor._id };
    }
    const floorId = state.floor?.floorId;
    const rows = await ctx.session.post(`/management/floors/${floorId}/spaces`, { count: p.roomCount, prefix: p.floorCode, startNumber: 1, spaceType: p.spaceType, capacity: p.capacity });
    return { rooms: rows.map((r) => ({ id: r._id, code: r.code })) };
  },

  async add_rooms(ctx, p) {
    const rows = await ctx.session.post(`/management/floors/${p.floorId}/spaces`, { count: p.count, prefix: p.floorCode, startNumber: p.startNumber, spaceType: p.spaceType, capacity: p.capacity });
    return { rooms: rows.map((r) => ({ id: r._id, code: r.code })) };
  },

  async add_devices(ctx, p, step) {
    const index = Number(step.id.split('-')[1]);
    const name = p.count === 1 ? p.name : `${p.name} ${index}`;
    const device = await ctx.session.post('/devices', { roomId: p.roomId, name, category: p.category, ratedWatts: p.ratedWatts });
    return { deviceId: device._id, name };
  },

  async create_booking(ctx, p) {
    const row = await ctx.session.post('/schedules', { roomId: p.roomId, startAt: p.startAt, endAt: p.endAt, title: p.title });
    return { scheduleId: row._id };
  },

  async cancel_booking(ctx, p) {
    await ctx.session.patch(`/schedules/${p.scheduleId}`, { status: 'cancelled' });
    return { scheduleId: p.scheduleId };
  },
};

const outcomeText = {
  create_floor: (p, s) => `Floor ${p.floorCode} was created${s.rooms ? ` with ${s.rooms.rooms.length} rooms (${rangeText(s.rooms.rooms)})` : ''}.`,
  add_rooms: (p, s) => `${s.rooms.rooms.length} rooms were added to floor ${p.floorCode} (${rangeText(s.rooms.rooms)}).`,
  add_devices: (p) => `${p.count} × ${p.name} recorded in ${p.roomCode}.`,
  create_booking: (p) => `Booking "${p.title}" was created in ${p.roomCode}.`,
  cancel_booking: (p) => `The booking in ${p.roomCode} was cancelled.`,
};

const stateOf = (steps) => Object.fromEntries(steps.filter((s) => s.status === 'done').map((s) => [s.id, s.out]));
const hashOf = (kind, params) => createHash('sha256').update(JSON.stringify([kind, params])).digest('hex').slice(0, 16);

export function createActions({ store, cfg, data, now = () => Date.now() }) {
  const { stmts } = store;
  const audit = (user, action, target, detail) =>
    stmts.insertAudit.run(now(), user?.id ?? null, user?.name ?? null, action, target ?? null, detail ? JSON.stringify(detail).slice(0, 2000) : null);

  const view = (row, extra = {}) => ({
    id: row.id,
    kind: row.kind,
    title: ACTION_TITLES[row.kind],
    status: row.status,
    preview: JSON.parse(row.preview),
    expiresAt: new Date(row.expires_at).toISOString(),
    steps: JSON.parse(row.steps),
    ...extra,
  });

  const ctxFor = (session) => ({ session, data, now: now(), timezone: cfg.timezone });

  return {
    audit,
    parse(kind, raw) {
      const schema = SCHEMAS[kind];
      if (!schema) return { ok: false, message: 'That action is not supported.' };
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return { ok: false, message: `${issue.path.join('.') || 'request'}: ${issue.message}` };
      }
      return { ok: true, params: parsed.data };
    },

    // Builds a pending proposal. Nothing is changed. Returns the preview for the administrator to confirm.
    async propose(session, kind, params) {
      if (session.user.role !== 'admin') return { ok: false, message: 'Only administrators can make changes.' };
      const plan = await planners[kind](ctxFor(session), params);
      if (plan.blockers.length) return { ok: false, message: plan.blockers.join(' ') };
      const id = randomUUID();
      const t = now();
      const preview = { lines: plan.lines, warnings: plan.warnings };
      store.transaction(() => {
        stmts.supersede.run(t, session.user.id);
        stmts.insertProposal.run(id, session.user.id, kind, JSON.stringify(plan.normalized), hashOf(kind, plan.normalized), JSON.stringify(preview), 'pending', t, t + cfg.proposalTtlMs, t);
        stmts.saveProposal.run('pending', JSON.stringify(plan.steps.map((s) => ({ ...s, status: 'pending' }))), null, t, id);
        audit(session.user, 'proposal.created', id, { kind, hash: hashOf(kind, plan.normalized) });
      });
      return { ok: true, proposal: view(stmts.getProposal.get(id)) };
    },

    cancel(session, proposalId) {
      const t = now();
      const info = stmts.cancelProposal.run(t, proposalId, session.user.id);
      if (Number(info.changes) === 1) audit(session.user, 'proposal.cancelled', proposalId);
      const row = stmts.getProposal.get(proposalId);
      if (!row || row.user_id !== session.user.id) return { ok: false, status: 404, message: 'That proposal was not found.' };
      return { ok: true, proposal: view(row) };
    },

    // Runs a confirmed proposal. Safe to call twice: a finished proposal returns its recorded result.
    async confirm(session, proposalId) {
      const row = stmts.getProposal.get(proposalId);
      if (!row || row.user_id !== session.user.id) return { ok: false, status: 404, message: 'That proposal was not found.' };
      if (session.user.role !== 'admin') return { ok: false, status: 403, message: 'Only administrators can confirm changes.' };

      const t0 = now();
      const stale = row.status === 'executing' && row.updated_at < t0 - EXECUTING_STALE_MS;
      if (row.status === 'done') return { ok: true, replayed: true, proposal: view(row), result: JSON.parse(row.result) };
      if (row.status === 'cancelled') return { ok: false, status: 409, message: 'This proposal was cancelled.' };
      if (row.status === 'executing' && !stale) return { ok: false, status: 409, message: 'This change is already being applied.' };
      if (['failed', 'expired'].includes(row.status)) return { ok: false, status: 409, message: 'This proposal can no longer be applied. Ask again to create a fresh one.' };
      if (row.status === 'pending' && row.expires_at <= t0) {
        stmts.saveProposal.run('expired', row.steps, null, t0, row.id);
        return { ok: false, status: 410, message: 'This proposal expired. Ask again to create a fresh one.' };
      }

      const params = JSON.parse(row.params);
      const ctx = ctxFor(session);
      // A proposal left "executing" by a crashed process resumes like a partly applied one.
      const prior = stale ? 'partial' : row.status;

      // Claim first. Only the winner of this atomic update may re-check or act, so two concurrent
      // confirmations can never both run, and a loser can never overwrite the winner's outcome.
      const claimed = stmts.claimProposal.run(now(), row.id, session.user.id, now() - EXECUTING_STALE_MS);
      if (Number(claimed.changes) !== 1) return { ok: false, status: 409, message: 'This change is already being applied.' };
      audit(session.user, 'proposal.confirmed', row.id, { kind: row.kind, resumed: prior === 'partial' });

      if (prior === 'pending' && planners[row.kind]) {
        // Re-check against the live website right before acting; things may have changed since the preview.
        let recheck;
        try {
          recheck = await planners[row.kind](ctx, params);
        } catch (err) {
          // Could not even check (for example the website is down): release the claim, change nothing.
          stmts.saveProposal.run('pending', row.steps, null, now(), row.id);
          throw err;
        }
        if (recheck.blockers.length) {
          stmts.saveProposal.run('cancelled', row.steps, JSON.stringify({ blockedBy: recheck.blockers }), now(), row.id);
          audit(session.user, 'proposal.blocked', row.id, { blockers: recheck.blockers });
          return { ok: false, status: 409, message: `Nothing was changed. ${recheck.blockers.join(' ')}` };
        }
      }

      // Announcements live in the assistant's own database, so publishing is one real transaction.
      if (row.kind === 'send_announcement') return this.publish(session, row, params);

      const steps = JSON.parse(row.steps);
      const save = (status, result = null) => stmts.saveProposal.run(status, JSON.stringify(steps), result ? JSON.stringify(result) : null, now(), row.id);
      let failure = null;
      for (const step of steps) {
        if (step.status === 'done') continue;
        // Anything other than a never-tried step may have half-run before an interruption.
        const resumed = step.status !== 'pending';
        step.status = 'started';
        save('executing');
        try {
          step.out = await executors[row.kind](ctx, params, { ...step, resumed }, stateOf(steps));
          step.status = 'done';
          save('executing');
        } catch (err) {
          step.status = 'failed';
          step.error = err instanceof AppApiError ? `${err.message}` : 'The step could not be completed.';
          failure = { step, err };
          break;
        }
      }
      data.invalidate();

      const done = steps.filter((s) => s.status === 'done');
      if (!failure) {
        const summary = outcomeText[row.kind](params, stateOf(steps));
        const result = { ok: true, summary, steps: steps.map((s) => ({ id: s.id, label: s.label, status: s.status })) };
        save('done', result);
        audit(session.user, 'proposal.done', row.id, { kind: row.kind, summary });
        return { ok: true, proposal: view(stmts.getProposal.get(row.id)), result };
      }
      // The website has no delete route for these records, so completed steps stay in place and the
      // proposal can be resumed from the failed step. The result says exactly what changed.
      // With no progress there is nothing to repair, so the proposal simply stays confirmable.
      const status = done.length ? 'partial' : 'pending';
      const result = {
        ok: false,
        summary: done.length
          ? `Partly applied: ${done.map((s) => s.label).join('; ')} succeeded, but "${failure.step.label}" failed: ${failure.step.error}. Nothing was rolled back. Fix the cause, then confirm again to continue from the failed step.`
          : `Nothing was changed. "${failure.step.label}" failed: ${failure.step.error}`,
        steps: steps.map((s) => ({ id: s.id, label: s.label, status: s.status, error: s.error })),
      };
      save(status, result);
      audit(session.user, `proposal.${status}`, row.id, { kind: row.kind, failedStep: failure.step.id, code: failure.err.code });
      return { ok: false, status: 409, proposal: view(stmts.getProposal.get(row.id)), result, message: result.summary };
    },

    publish(session, row, params) {
      const id = randomUUID();
      const t = now();
      try {
        // Announcement, proposal state and audit entry commit together or not at all.
        store.transaction(() => {
          stmts.insertAnnouncement.run(id, params.audience, params.message, session.user.id, session.user.name, t, row.id, params.eligible ?? null);
          const result = { ok: true, summary: `Announcement published to ${AUDIENCE_LABEL[params.audience]}.`, announcementId: id, delivery: { state: 'published', eligible: params.eligible ?? null, opened: 0 }, steps: [{ id: 'publish', label: 'Publish announcement', status: 'done' }] };
          stmts.saveProposal.run('done', JSON.stringify(result.steps), JSON.stringify(result), t, row.id);
          audit(session.user, 'announcement.published', id, { audience: params.audience, length: params.message.length });
        });
      } catch (err) {
        stmts.saveProposal.run('failed', row.steps, JSON.stringify({ ok: false, summary: 'The announcement could not be saved.' }), now(), row.id);
        return { ok: false, status: 500, message: 'The announcement could not be saved, and nothing was published.' };
      }
      return { ok: true, proposal: view(stmts.getProposal.get(row.id)), result: JSON.parse(stmts.getProposal.get(row.id).result) };
    },
  };
}

// ---- Gemini function declarations: the only write shapes a model may propose ----
const prop = {
  floorCode: { type: 'string', description: 'Floor code such as B1 or FL-02. Letters, numbers, - or _, max 15 characters.' },
  roomCode: { type: 'string', description: 'Exact room code from the ROOMS list, such as B1-001.' },
  spaceType: { type: 'string', enum: SPACE_TYPES },
  isoTime: { type: 'string', description: 'ISO 8601 time WITH the UTC offset, e.g. 2026-11-14T10:00:00+05:30.' },
};

export const TOOL_DECLARATIONS = [
  {
    name: 'propose_create_floor',
    description: 'Propose creating a new floor, optionally with a number of rooms. Does not change anything until the administrator confirms.',
    parametersJsonSchema: {
      type: 'object',
      properties: { floorCode: prop.floorCode, floorName: { type: 'string' }, roomCount: { type: 'integer', minimum: 0, maximum: 100 }, spaceType: prop.spaceType, capacity: { type: 'integer', minimum: 0 } },
      required: ['floorCode'],
    },
  },
  {
    name: 'propose_add_rooms',
    description: 'Propose adding rooms to an existing floor.',
    parametersJsonSchema: { type: 'object', properties: { floorCode: prop.floorCode, count: { type: 'integer', minimum: 1, maximum: 100 }, spaceType: prop.spaceType, capacity: { type: 'integer', minimum: 0 } }, required: ['floorCode', 'count'] },
  },
  {
    name: 'propose_add_devices',
    description: 'Propose recording equipment (lights, fans, sockets, AC) in a room. Only for loads the user states; never guess watts.',
    parametersJsonSchema: { type: 'object', properties: { roomCode: prop.roomCode, category: { type: 'string', enum: CATEGORIES }, count: { type: 'integer', minimum: 1, maximum: 20 }, ratedWatts: { type: 'number', description: 'Rated watts per item, as stated by the user.' }, name: { type: 'string' } }, required: ['roomCode', 'category', 'count', 'ratedWatts'] },
  },
  {
    name: 'propose_create_booking',
    description: 'Propose a timetable booking for a room.',
    parametersJsonSchema: { type: 'object', properties: { roomCode: prop.roomCode, startAt: prop.isoTime, endAt: prop.isoTime, title: { type: 'string' } }, required: ['roomCode', 'startAt', 'endAt', 'title'] },
  },
  {
    name: 'propose_cancel_booking',
    description: 'Propose cancelling one existing booking, identified by room and start time.',
    parametersJsonSchema: { type: 'object', properties: { roomCode: prop.roomCode, startAt: prop.isoTime, title: { type: 'string' } }, required: ['roomCode', 'startAt'] },
  },
  {
    name: 'propose_send_announcement',
    description: 'Propose publishing an announcement. The message must be the administrator\'s own wording.',
    parametersJsonSchema: { type: 'object', properties: { audience: { type: 'string', enum: AUDIENCES }, message: { type: 'string' } }, required: ['audience', 'message'] },
  },
];

export const TOOL_TO_KIND = {
  propose_create_floor: 'create_floor',
  propose_add_rooms: 'add_rooms',
  propose_add_devices: 'add_devices',
  propose_create_booking: 'create_booking',
  propose_cancel_booking: 'cancel_booking',
  propose_send_announcement: 'send_announcement',
};
