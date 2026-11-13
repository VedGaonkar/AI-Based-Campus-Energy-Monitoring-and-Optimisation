import { config } from '../config.js';
import { now } from '../clock.js';
import { AuditEvent, LiveEvent, Settings } from '../models/index.js';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, message, details) => new ApiError(400, code, message, details);
export const forbidden = (message = 'Not permitted') => new ApiError(403, 'forbidden', message);
export const notFound = (what = 'Resource') => new ApiError(404, 'not_found', `${what} not found`);
export const conflict = (code, message, details) => new ApiError(409, code, message, details);

export async function getSettings() {
  let s = await Settings.findOne({ key: 'installation' });
  if (!s) {
    const c = config();
    try {
      s = await Settings.create({ key: 'installation', timezone: c.timezone, policies: { ...c.defaults } });
    } catch (err) {
      if (err.code !== 11000) throw err;
      s = await Settings.findOne({ key: 'installation' });
    }
  }
  return s;
}

const SECRET_KEYS = /password|secret|token|credential/i;

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEYS.test(k) ? '[redacted]' : redact(v)]));
  }
  return value;
}

export async function audit(actor, action, targetType, targetId, detail) {
  await AuditEvent.create({
    at: now(),
    actorId: actor?._id,
    actorLabel: actor?.name ?? actor?.label ?? 'system',
    action,
    targetType,
    targetId: targetId ? String(targetId) : undefined,
    detail: detail ? redact(JSON.parse(JSON.stringify(detail))) : undefined,
  });
}

// Persisted so a separate worker process can reach browsers through the API process.
export async function emitLive(type, { roomId, userId, payload } = {}) {
  await LiveEvent.create({
    at: new Date(),
    type,
    roomId: roomId ? String(roomId) : undefined,
    userId: userId ? String(userId) : undefined,
    payload,
  });
}

export function dataModeLabel(dataMode) {
  return dataMode === 'live' ? 'live' : dataMode;
}
