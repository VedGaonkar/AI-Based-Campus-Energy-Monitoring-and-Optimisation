import { randomUUID, timingSafeEqual } from "node:crypto";
import { errorEnvelope } from "../../../shared/contracts.js";

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const fail = (status, code, message) => {
  throw new HttpError(status, code, message);
};
export const canRoom = (user, roomId) =>
  user.role === "admin" || user.permittedRoomIds.includes(roomId);
export const requireRole = (user, allowed) => {
  if (!allowed.includes(user.role))
    fail(403, "FORBIDDEN", "Your role cannot perform this action");
};
export const requireRoom = (user, roomId) => {
  if (!canRoom(user, roomId))
    fail(403, "ROOM_FORBIDDEN", "Room is outside your assigned scope");
};
export const scope = (user) =>
  user.role === "admin" ? {} : { roomId: { $in: user.permittedRoomIds } };
export const equalSecret = (a, b) => {
  const left = Buffer.from(a ?? ""),
    right = Buffer.from(b ?? "");
  return left.length === right.length && timingSafeEqual(left, right);
};

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err.name === "ZodError")
    return res.status(400).json(
      errorEnvelope(
        "VALIDATION_ERROR",
        "Invalid request",
        req.requestId,
        err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      ),
    );
  if (err.code === 11000)
    return res
      .status(409)
      .json(
        errorEnvelope(
          "DUPLICATE",
          "This mapping or record already exists",
          req.requestId,
        ),
      );
  if (err.type === "entity.too.large")
    return res
      .status(413)
      .json(
        errorEnvelope(
          "PAYLOAD_TOO_LARGE",
          "Request exceeds the upload limit",
          req.requestId,
        ),
      );
  const status = err.status ?? 500;
  if (status === 500)
    console.error(
      JSON.stringify({
        requestId: req.requestId,
        code: "INTERNAL_ERROR",
        name: err.name,
      }),
    );
  res
    .status(status)
    .json(
      errorEnvelope(
        err.code && typeof err.code === "string" ? err.code : "INTERNAL_ERROR",
        status === 500 ? "The request could not be completed" : err.message,
        req.requestId,
      ),
    );
}

export async function withRoomLock(
  models,
  roomId,
  operation,
  now = new Date(),
) {
  const owner = randomUUID();
  const room = await models.Room.findOneAndUpdate(
    {
      _id: roomId,
      $or: [
        { commandLockUntil: { $exists: false } },
        { commandLockUntil: null },
        { commandLockUntil: { $lte: now } },
      ],
    },
    {
      $set: {
        commandLockOwner: owner,
        commandLockUntil: new Date(now.getTime() + 30000),
      },
    },
    { returnDocument: "after" },
  ).lean();
  if (!room) {
    if (!(await models.Room.exists({ _id: roomId })))
      fail(404, "NOT_FOUND", "Room not found");
    fail(409, "ROOM_BUSY", "Room policy is changing; retry shortly");
  }
  try {
    return await operation(room, owner);
  } finally {
    await models.Room.updateOne(
      { _id: roomId, commandLockOwner: owner },
      { $unset: { commandLockOwner: "", commandLockUntil: "" } },
    );
  }
}
