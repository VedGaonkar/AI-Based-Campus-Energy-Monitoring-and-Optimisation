import mongoose from 'mongoose';
import { Server } from 'socket.io';
import { config } from './config.js';
import { LiveEvent, User } from './models/index.js';
import { canViewRoom } from './security/auth.js';

// Socket.IO shares the Express session. Every socket joins only the channels its role and
// room scope allow, so an event about a room never reaches someone who cannot view that room.
export function attachLive(httpServer, sessionMiddleware) {
  const cfg = config();
  const io = new Server(httpServer, { cors: { origin: cfg.frontendOrigin, credentials: true }, serveClient: false });
  io.engine.use(sessionMiddleware);

  io.use(async (socket, next) => {
    const userId = socket.request.session?.userId;
    const user = userId ? await User.findById(userId).lean() : null;
    if (!user?.active) return next(new Error('unauthenticated'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(`user:${user._id}`);
    socket.join('authenticated');
    if (['admin', 'hod'].includes(user.role)) socket.join('all-rooms');
    for (const roomId of user.permittedRoomIds ?? []) if (canViewRoom(user, roomId)) socket.join(`room:${roomId}`);
  });

  let cursor = mongoose.Types.ObjectId.createFromTime(Math.floor(Date.now() / 1000));
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const events = await LiveEvent.find({ _id: { $gt: cursor } }).sort({ _id: 1 }).limit(200).lean();
      for (const e of events) {
        cursor = e._id;
        const message = { type: e.type, roomId: e.roomId ?? null, payload: e.payload ?? null };
        if (e.userId) io.to(`user:${e.userId}`).emit('event', message);
        else if (e.roomId) io.to('all-rooms').to(`room:${e.roomId}`).emit('event', message);
        else io.to('authenticated').emit('event', message);
      }
    } catch (err) {
      console.error('[live] relay failed:', err.message);
    } finally {
      busy = false;
    }
  }, 500);
  timer.unref?.();
  return { io, stop: () => clearInterval(timer) };
}
