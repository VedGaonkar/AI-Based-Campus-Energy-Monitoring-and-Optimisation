import bcrypt from "bcrypt";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { connectDatabase } from "./models/index.js";
import { calendar } from "./domain/energy.js";
import { refreshAnalytics, readingKey } from "./services/energy.js";

export async function seed(
  models,
  config,
  { password = process.env.DEMO_PASSWORD, now = new Date() } = {},
) {
  if (!config.demoMode || config.env === "production")
    throw new Error(
      "Demo seed is disabled outside non-production demonstration mode",
    );
  if (!password || password.length < 12 || password.includes("replace_"))
    throw new Error("Generate local demo credentials with npm run setup");
  await models.Settings.updateOne(
    { _id: "installation" },
    {
      $setOnInsert: {
        installationName: "North Academic Block",
        timezone: "Asia/Kolkata",
        tariff: 8,
        initialBaselineKwh: 5,
      },
    },
    { upsert: true },
  );
  const roomIds = ["room-r101", "room-r102", "room-r103"];
  const passwordHash = await bcrypt.hash(password, 12);
  for (const [role, name] of [
    ["admin", "Campus administrator"],
    ["hod", "Department head"],
    ["technician", "Facilities technician"],
    ["teacher", "Authorised teacher"],
    ["viewer", "Campus viewer"],
  ])
    await models.User.updateOne(
      { _id: `demo-${role}` },
      {
        $setOnInsert: {
          email: `${role}@campus.test`,
          name,
          role,
          passwordHash,
          department: "Academic",
          permittedRoomIds: roomIds,
          active: true,
        },
      },
      { upsert: true },
    );
  for (const [index, code] of ["R101", "R102", "R103"].entries()) {
    const roomId = roomIds[index],
      breakerId = `BRK-${code}`;
    await models.Room.updateOne(
      { _id: roomId },
      {
        $setOnInsert: {
          code,
          name: ["Lecture Hall", "Seminar Room", "Design Studio"][index],
          capacity: [60, 24, 36][index],
          roomBreakerId: breakerId,
          controlMode: "alert_only",
          coverageValidated: index !== 1,
          independentInfrastructure: true,
          requiredSourceIds: index === 1 ? [] : [`CAM-${code}`],
          firstResponderId: "demo-technician",
          secondResponderId: "demo-hod",
          backupResponderId: "demo-admin",
          allowedStartHour: 0,
          allowedEndHour: 24,
          policyVersion: 1,
        },
      },
      { upsert: true },
    );
    await models.Breaker.updateOne(
      { _id: breakerId },
      {
        $setOnInsert: {
          roomId,
          nativeDeviceId: breakerId,
          adapter: "simulator",
          reportedSupply: "on",
          health: "online",
          interlocksKnown: true,
          feederCoverage: "Synthetic room feeder; not commissioned",
          verifiedRatings: { simulated: true },
        },
      },
      { upsert: true },
    );
    for (const [category, watts] of [
      ["lighting", 200],
      ["fan", 300],
      ["socket", 100],
      ["ac", 1500],
    ])
      await models.Device.updateOne(
        { _id: `${roomId}-${category}` },
        {
          $setOnInsert: {
            roomId,
            controlledByRoomBreakerId: breakerId,
            name: `${category === "ac" ? "AC supply" : category} group`,
            category,
            ratedWatts: watts,
            essential: false,
            supplyInterruptionApproved: true,
            requiresNormalStopBeforeCutoff: false,
            restartDelaySeconds: 0,
            restartBehaviourKnown: true,
            essentialStandbyRequirement: false,
            approvalNotes:
              "Simulation fixture only. No physical installation or AC interruption approval.",
          },
        },
        { upsert: true },
      );
    if (index !== 1)
      await models.Integration.updateOne(
        { _id: `CAM-${code}` },
        {
          $setOnInsert: {
            roomId,
            type: "camera",
            name: `${code} observation adapter`,
            health: "unavailable",
            freshnessSeconds: 120,
            coverageValidated: true,
            capabilities: { fixtureReplay: true, liveInference: false },
          },
        },
        { upsert: true },
      );
  }
  for (const [integrationId, type, name] of [
    ["vision", "vision", "Vision / OCR service"],
    ["smtp", "smtp", "External email"],
    ["mqtt", "mqtt", "Presence MQTT gateway"],
    ["physical", "physical", "Physical room-master adapter"],
  ])
    await models.Integration.updateOne(
      { _id: integrationId },
      {
        $setOnInsert: {
          type,
          name,
          health: "unavailable",
          capabilities: { configured: false },
        },
      },
      { upsert: true },
    );
  const today = calendar(now).date,
    dayStart = new Date(`${today}T00:00:00+05:30`).getTime();
  const operations = [];
  for (let day = -29; day <= 0; day++)
    for (let hour = 0; hour < 24; hour++) {
      const start = dayStart + day * 86400000 + hour * 3600000,
        end = start + 3600000;
      if (end > now.getTime()) continue;
      const busy = hour >= 9 && hour < 17;
      const energy = busy ? 6 + (hour % 3) * 0.4 : 1.2 + (hour % 3) * 0.2;
      const value = day >= -1 && hour === 19 ? 13 : energy;
      const row = {
        eventId: `seed-${start}`,
        meterId: "MAIN-01",
        epoch: "initial",
        kind: "interval",
        register: "import_kwh",
        value,
        unit: "kWh",
        capturedAt: new Date(end),
        intervalStart: new Date(start),
        sourceType: "csv",
        dataMode: "simulated",
        validationState: "accepted",
        validationReason: "Explicit deterministic synthetic seed",
        receivedAt: now,
        enteredBy: "demo-admin",
        quality: {},
      };
      const importKey = readingKey(row);
      operations.push({
        updateOne: {
          filter: { importKey },
          update: { $setOnInsert: { ...row, importKey } },
          upsert: true,
        },
      });
    }
  if (operations.length)
    await models.MeterReading.bulkWrite(operations, {
      ordered: false,
      throwOnValidationError: true,
    });
  await refreshAnalytics(models, config);
  return {
    rooms: 3,
    seededIntervals: operations.length,
    accounts: ["admin", "hod", "technician", "teacher", "viewer"].map(
      (role) => `${role}@campus.test`,
    ),
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  const { connection, models } = await connectDatabase(config.mongoUri);
  try {
    const result = await seed(models, config);
    console.log(
      `Demo seed ready: ${result.rooms} rooms, ${result.seededIntervals} synthetic intervals. Accounts: ${result.accounts.join(", ")}. Read DEMO_PASSWORD only from your ignored local .env; it is not printed.`,
    );
  } finally {
    await connection.close();
  }
}
