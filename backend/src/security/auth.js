import { timingSafeEqual } from 'node:crypto';
import MongoStore from 'connect-mongo';
import session from 'express-session';
import mongoose from 'mongoose';
import { rateLimit } from 'express-rate-limit';
import { config } from '../config.js';
import { User } from '../models/index.js';
import { ApiError, badRequest, forbidden } from '../services/core.js';

export function createSessionMiddleware() {
  const cfg = config();
  return session({
    name: 'campus.sid',
    secret: cfg.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: MongoStore.create({ client: mongoose.connection.getClient(), collectionName: 'sessions', ttl: 8 * 3600 }),
    cookie: { httpOnly: true, sameSite: 'lax', secure: cfg.env === 'production', maxAge: 8 * 3600 * 1000 },
  });
}

export async function loadUser(req, _res, next) {
  if (req.session?.userId) {
    const user = await User.findById(req.session.userId);
    if (user?.active) req.user = user;
  }
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) throw new ApiError(401, 'unauthenticated', 'Sign in is required');
  next();
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) throw new ApiError(401, 'unauthenticated', 'Sign in is required');
    if (!roles.includes(req.user.role)) throw forbidden('Your role is not permitted to do this');
    next();
  };
}

// Admins and HODs see every room; everyone else only the rooms they are permitted.
export function canViewRoom(user, roomId) {
  if (['admin', 'hod'].includes(user.role)) return true;
  return (user.permittedRoomIds ?? []).some((id) => String(id) === String(roomId));
}

export function requireRoomView(param = 'id') {
  return (req, _res, next) => {
    if (!req.user) throw new ApiError(401, 'unauthenticated', 'Sign in is required');
    if (!canViewRoom(req.user, req.params[param])) throw forbidden('You do not have access to this room');
    next();
  };
}

// Telemetry sources authenticate with a separate bearer credential, never a user session.
export function requireService(req, _res, next) {
  const header = req.get('authorization') ?? '';
  const supplied = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
  const expected = Buffer.from(config().serviceIngestToken);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new ApiError(401, 'invalid_service_credential', 'A valid service credential is required');
  }
  req.service = { label: 'integration-service' };
  next();
}

// Cookie-authenticated mutations must come from our own pages.
export function originCheck(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  const cfg = config();
  const allowed = new Set([cfg.frontendOrigin, cfg.publicAppUrl, `${req.protocol}://${req.get('host')}`]);
  if (!allowed.has(origin)) throw forbidden('Request origin is not allowed');
  next();
}

const limiter = (limit, windowMs = 60_000) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => config().env === 'test',
    handler: (_req, _res, next) => next(new ApiError(429, 'rate_limited', 'Too many requests; try again shortly')),
  });

export const loginLimiter = limiter(10);
export const leaseLimiter = limiter(20);
export const commandLimiter = limiter(30);

export function validate(schema, data) {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw badRequest(
      'validation_failed',
      'Request is invalid',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return parsed.data;
}

export function isObjectId(value) {
  return mongoose.isValidObjectId(value);
}
