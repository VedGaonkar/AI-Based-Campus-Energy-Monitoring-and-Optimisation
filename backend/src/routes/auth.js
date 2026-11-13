import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { User } from '../models/index.js';
import { loginLimiter, requireAuth, validate } from '../security/auth.js';
import { ApiError, audit } from '../services/core.js';

export const authRouter = Router();

export function userView(u) {
  return { id: String(u._id), name: u.name, email: u.email, role: u.role, department: u.department ?? null, permittedRoomIds: (u.permittedRoomIds ?? []).map(String), active: u.active };
}

export function serverView() {
  const c = config();
  return {
    demoMode: c.demoMode,
    timeScale: c.demoTimeScale,
    physicalControlArmed: c.allowPhysicalControl && !c.demoMode,
    banner: c.demoMode ? `Simulation${c.demoTimeScale > 1 ? `: time accelerated ${c.demoTimeScale}×` : ''}. No physical supply is switched.` : null,
  };
}

// A fixed hash to compare against when the account does not exist, so timing does not reveal it.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = validate(z.object({ email: z.string().trim().toLowerCase().min(3), password: z.string().min(1) }), req.body);
  const user = await User.findOne({ email });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok || !user.active) throw new ApiError(401, 'invalid_credentials', 'Email or password is incorrect');
  await new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
  req.session.userId = String(user._id);
  await audit(user, 'auth.login', 'user', user._id);
  res.json({ user: userView(user), server: serverView() });
});

authRouter.post('/logout', async (req, res) => {
  await new Promise((resolve) => req.session.destroy(() => resolve()));
  res.clearCookie('campus.sid');
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: userView(req.user), server: serverView() });
});
