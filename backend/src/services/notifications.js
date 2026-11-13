import { Notification, User } from '../models/index.js';
import { emitLive } from './core.js';

// In-app delivery means "persisted in the recipient's inbox". It is not proof anyone read or acted on it.
export async function notify({ incidentId, leaseId, stage, recipientId, title, body, link, dataMode = 'live' }) {
  const idempotencyKey = `${incidentId ?? leaseId ?? 'general'}:${stage}:${recipientId ?? 'none'}:in_app`;
  const existing = await Notification.findOne({ idempotencyKey }).lean();
  if (existing) return { delivered: existing.deliveryState === 'delivered', duplicate: true, notification: existing };

  const recipient = recipientId ? await User.findById(recipientId).lean() : null;
  const deliverable = Boolean(recipient?.active);
  let notification;
  try {
    notification = await Notification.create({
      incidentId,
      leaseId,
      stage,
      recipientId: recipient?._id,
      channel: 'in_app',
      idempotencyKey,
      title,
      body,
      link,
      deliveryState: deliverable ? 'delivered' : 'failed',
      failureReason: deliverable ? undefined : recipient ? 'Recipient is inactive' : 'No recipient is assigned',
      dataMode,
    });
  } catch (err) {
    if (err.code !== 11000) throw err;
    const dup = await Notification.findOne({ idempotencyKey }).lean();
    return { delivered: dup.deliveryState === 'delivered', duplicate: true, notification: dup };
  }
  if (deliverable) await emitLive('notification.created', { userId: recipient._id, payload: { id: String(notification._id), title } });
  return { delivered: deliverable, duplicate: false, notification };
}

// Tries each recipient in order until one delivery succeeds; every attempt is recorded.
export async function notifyFirstAvailable(recipientIds, message) {
  const attempts = [];
  const seen = new Set();
  for (const id of recipientIds) {
    const key = id ? String(id) : 'none';
    if (seen.has(key)) continue;
    seen.add(key);
    const r = await notify({ ...message, recipientId: id });
    attempts.push({ recipientId: id, delivered: r.delivered, reason: r.notification.failureReason });
    if (r.delivered) return { delivered: true, recipientId: id, attempts };
  }
  return { delivered: false, recipientId: null, attempts };
}
