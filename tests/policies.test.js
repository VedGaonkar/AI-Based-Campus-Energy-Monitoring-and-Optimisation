import test from "node:test";
import assert from "node:assert/strict";
import {
  occupancy,
  protection,
  supplyEligibility,
  accessAllowed,
} from "../backend/src/domain/policies.js";
const now = new Date("2026-11-13T06:30:00Z");
const room = {
  _id: "R101",
  roomBreakerId: "BRK-R101",
  policyVersion: 1,
  controlMode: "simulated",
  coverageValidated: true,
  independentInfrastructure: true,
  requiredSourceIds: ["CAM-R101"],
  allowedStartHour: 7,
  allowedEndHour: 22,
};
const source = {
  _id: "CAM-R101",
  health: "online",
  freshnessSeconds: 120,
  coverageValidated: true,
};
const observation = (occupancy, age = 0, extra = {}) => ({
  sourceId: source._id,
  occupancy,
  capturedAt: new Date(now.getTime() - age),
  confidence: 0.9,
  quality: { usable: true },
  coverageValidated: true,
  dataMode: "live",
  ...extra,
});
const breaker = {
  _id: "BRK-R101",
  roomId: "R101",
  health: "online",
  interlocksKnown: true,
  automationDisabled: true,
};
const device = { supplyInterruptionApproved: true, restartDelaySeconds: 0 };
const request = {
  room,
  breaker,
  devices: [device],
  observed: { state: "vacant" },
  protectedBy: null,
  action: "off",
  reason: "vacancy_escalation",
  now,
  config: {
    demoMode: true,
    deviceAdapter: "simulator",
    allowPhysicalControl: false,
  },
  policyVersion: 1,
};
test("fresh positive occupancy protects despite other source disagreement", () => {
  assert.equal(
    occupancy(room, [observation("occupied")], [source], now).state,
    "occupied",
  );
  assert.equal(
    occupancy(room, [observation("vacant", 180000)], [source], now).state,
    "unknown",
  );
  assert.equal(
    occupancy(
      { ...room, coverageValidated: false },
      [observation("vacant")],
      [source],
      now,
    ).state,
    "unknown",
  );
});
test("vacancy requires continuous healthy covered observations for the confirmation period", () => {
  const records = Array.from({ length: 11 }, (_, i) =>
    observation("vacant", i * 90000),
  );
  assert.equal(occupancy(room, records, [source], now).state, "vacant");
  assert.equal(
    occupancy(room, [records[0], records.at(-1)], [source], now).state,
    "unknown",
  );
  assert.equal(
    occupancy(room, records, [{ ...source, health: "offline" }], now).state,
    "unknown",
  );
  assert.equal(
    occupancy(
      room,
      [observation("vacant", 0, { dataMode: "replay" })],
      [source],
      now,
    ).state,
    "unknown",
  );
});
test("bookings/preparation and active leases protect; tomorrow and expired leases do not", () => {
  const start = new Date(now.getTime() + 600000),
    end = new Date(now.getTime() + 3600000);
  assert.equal(
    protection(
      room,
      [{ roomId: "R101", startAt: start, endAt: end, status: "confirmed" }],
      [],
      [],
      now,
    ),
    "booking",
  );
  assert.equal(
    protection(
      room,
      [
        {
          roomId: "R101",
          startAt: new Date(now.getTime() + 86400000),
          endAt: new Date(now.getTime() + 90000000),
          status: "confirmed",
        },
      ],
      [],
      [],
      now,
    ),
    null,
  );
  assert.equal(
    protection(
      room,
      [],
      [{ roomId: "R101", startAt: now, expiresAt: end }],
      [],
      now,
    ),
    "access_lease",
  );
  assert.equal(
    protection(
      room,
      [],
      [{ roomId: "R101", startAt: new Date(0), expiresAt: new Date(1) }],
      [],
      now,
    ),
    null,
  );
});
test("shared cutoff blocks unknown occupancy, protected use, alert-only room and incompatible loads", () => {
  assert.equal(supplyEligibility(request).allowed, true);
  for (const change of [
    { observed: { state: "unknown" } },
    { protectedBy: "booking" },
    { room: { ...room, controlMode: "alert_only" } },
    { devices: [{ ...device, essential: true }] },
    { devices: [{ ...device, supplyInterruptionApproved: false }] },
  ])
    assert.equal(supplyEligibility({ ...request, ...change }).allowed, false);
});
test("normal stop, fault/maintenance/isolation, policy and expiry interlocks apply", () => {
  for (const change of [
    { devices: [{ ...device, requiresNormalStopBeforeCutoff: true }] },
    { breaker: { ...breaker, faultTripped: true } },
    { breaker: { ...breaker, maintenanceLocked: true } },
    { breaker: { ...breaker, manuallyIsolated: true } },
    { policyVersion: 2 },
    { expiresAt: new Date(now.getTime() - 1) },
  ])
    assert.equal(supplyEligibility({ ...request, ...change }).allowed, false);
});
test("restoration requires automation OFF and observes restart delays; no real adapters", () => {
  assert.equal(
    supplyEligibility({
      ...request,
      action: "on",
      reason: "occupancy_restore",
      breaker: { ...breaker, automationDisabled: false },
    }).allowed,
    false,
  );
  assert.equal(
    supplyEligibility({
      ...request,
      action: "on",
      breaker: { ...breaker, lastChangedAt: now },
      devices: [{ ...device, restartDelaySeconds: 180 }],
    }).allowed,
    false,
  );
  assert.equal(
    supplyEligibility({
      ...request,
      config: {
        demoMode: false,
        allowPhysicalControl: true,
        deviceAdapter: "physical",
      },
    }).allowed,
    false,
  );
});
test("QR leases cannot cross permitted hours or overlap booking", () => {
  assert.equal(
    accessAllowed(
      room,
      [],
      now,
      new Date(now.getTime() + 3600000),
      "Asia/Kolkata",
    ),
    null,
  );
  assert.equal(
    accessAllowed(
      room,
      [
        {
          roomId: "R101",
          status: "confirmed",
          startAt: now,
          endAt: new Date(now.getTime() + 7200000),
        },
      ],
      now,
      new Date(now.getTime() + 3600000),
      "Asia/Kolkata",
    ),
    "Conflicts with a confirmed booking",
  );
});
