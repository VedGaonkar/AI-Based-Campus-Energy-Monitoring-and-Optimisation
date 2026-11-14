import { createHmac, timingSafeEqual } from "node:crypto";

// Short-lived handshake credential, never a replacement for the stored session.
export function issueSyncTicket(secret, sessionId, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ purpose: "campus-sync", sid: sessionId, expires: now + 60000 })).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}
export function verifySyncTicket(secret, ticket, now = Date.now()) {
  if (typeof ticket !== "string" || ticket.length > 2048) throw new Error("AUTH_REQUIRED");
  const parts = ticket.split(".");
  if (parts.length !== 2) throw new Error("AUTH_REQUIRED");
  const [body, signature] = parts;
  const expected = createHmac("sha256", secret).update(body).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("AUTH_REQUIRED");
  const value = JSON.parse(Buffer.from(body, "base64url").toString());
  if (value.purpose !== "campus-sync" || typeof value.sid !== "string" || !Number.isFinite(value.expires) || value.expires <= now || value.expires > now + 60000) throw new Error("AUTH_REQUIRED");
  return value.sid;
}
