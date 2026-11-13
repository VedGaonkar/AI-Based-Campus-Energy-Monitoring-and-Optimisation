import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { readingInput, scheduleInput } from "../../../shared/contracts.js";
import {
  deriveIntervals,
  baselineFor,
  calendar,
  benefits,
} from "../domain/energy.js";
import { getSettings, audit, cancelRoomWork } from "./context.js";
import { fail, withRoomLock } from "../security/access.js";

const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function readingKey(row) {
  return hash([
    row.meterId,
    row.epoch,
    row.register,
    row.kind,
    new Date(row.capturedAt).toISOString(),
    row.intervalStart ? new Date(row.intervalStart).toISOString() : null,
    row.dataMode,
  ]);
}

export async function addReading(
  models,
  input,
  actorId,
  config,
  { now = new Date(), refresh = true } = {},
) {
  const row = readingInput.parse(input);
  if (config.demoMode) row.dataMode = "simulated";
  if (Date.parse(row.capturedAt) > now.getTime() + 300000)
    fail(400, "FUTURE_TIMESTAMP", "Capture time is too far in the future");
  const settings = await getSettings(models);
  const meter = settings.meters.find(
    (m) => m.meterId === row.meterId && m.epoch === row.epoch,
  );
  if (!meter)
    fail(
      400,
      "UNKNOWN_METER_EPOCH",
      "Configure this meter and epoch before importing",
    );
  const importKey = readingKey(row);
  const existing = await models.MeterReading.findOne({ importKey }).lean();
  if (existing) {
    if (existing.value !== row.value)
      fail(
        409,
        "READING_CONFLICT",
        "A different reading exists at this time; use audited review",
      );
    return { reading: existing, duplicate: true };
  }
  let validationState = "accepted",
    validationReason = "Validated input";
  if (
    row.sourceType === "camera_ocr" &&
    (!row.quality.registerMatched ||
      !row.quality.burstAgreement ||
      (row.quality.ocrConfidence ?? 0) < 0.9)
  ) {
    validationState = "needs_review";
    validationReason = "OCR register/quality requires review";
  }
  const neighbors = await models.MeterReading.find({
    meterId: row.meterId,
    epoch: row.epoch,
    register: row.register,
    dataMode: row.dataMode,
    kind: "cumulative",
    validationState: "accepted",
  })
    .sort({ capturedAt: 1 })
    .lean();
  if (row.kind === "cumulative") {
    const before = neighbors
        .filter((r) => new Date(r.capturedAt) < new Date(row.capturedAt))
        .at(-1),
      after = neighbors.find(
        (r) => new Date(r.capturedAt) > new Date(row.capturedAt),
      );
    if (
      (before && row.value < before.value) ||
      (after && row.value > after.value)
    ) {
      validationState = "needs_review";
      validationReason =
        "Counter discontinuity; check digit, reset or replacement epoch";
    }
    const reference = before ?? after;
    if (reference) {
      const hours =
        Math.abs(
          Date.parse(row.capturedAt) - new Date(reference.capturedAt).getTime(),
        ) / 3600000;
      const growth = Math.abs(row.value - reference.value);
      if (growth > (meter.maxPowerKw ?? 100) * hours * 1.1) {
        validationState = "needs_review";
        validationReason =
          "Growth exceeds configured supply bound; repeat/review";
      }
    }
  } else if (
    row.value /
      ((Date.parse(row.capturedAt) - Date.parse(row.intervalStart)) / 3600000) >
    (meter.maxPowerKw ?? 100) * 1.1
  ) {
    validationState = "needs_review";
    validationReason = "Interval exceeds configured supply bound";
  }
  let saved;
  try {
    saved = await models.MeterReading.create({
      ...row,
      importKey,
      receivedAt: now,
      enteredBy: actorId,
      validationState,
      validationReason,
    });
  } catch (err) {
    if (err.code !== 11000) throw err;
    const duplicate = await models.MeterReading.findOne({ importKey }).lean();
    if (!duplicate || duplicate.value !== row.value)
      fail(409, "READING_CONFLICT", "Concurrent reading conflicts");
    return { reading: duplicate, duplicate: true };
  }
  await audit(models, actorId, "meter.create", saved._id, validationState);
  if (refresh) await refreshAnalytics(models, config);
  return { reading: saved.toObject(), duplicate: false };
}

export async function refreshAnalytics(models, config) {
  const settings = await getSettings(models);
  const [readings, schedules] = await Promise.all([
    models.MeterReading.find().sort({ capturedAt: 1 }).limit(20000).lean(),
    models.Schedule.find().lean(),
  ]);
  const intervals = deriveIntervals(readings),
    previous = [];
  const currentIds = [],
    anomalousIds = [];
  for (const interval of intervals) {
    interval.baseline = baselineFor(interval, previous, settings, schedules);
    interval.anomalous =
      interval.baseline.thresholdKwh !== null &&
      interval.energyKwh > interval.baseline.thresholdKwh;
    interval.calculationVersion = 1;
    const saved = await models.EnergyInterval.findOneAndUpdate(
      {
        meterId: interval.meterId,
        dataMode: interval.dataMode,
        startAt: interval.startAt,
        endAt: interval.endAt,
      },
      { $set: interval },
      { upsert: true, returnDocument: "after" },
    ).lean();
    currentIds.push(saved._id);
    previous.push(interval);
    if (interval.anomalous) {
      anomalousIds.push(saved._id);
      const issueKey = `energy:${saved._id}`;
      const incident = await models.Incident.findOneAndUpdate(
        { issueKey },
        {
          $setOnInsert: {
            meterId: interval.meterId,
            type: "energy",
            title: "Building consumption above expected range",
            state: "open",
            openedAt: new Date(),
            evidence: {
              intervalId: saved._id,
              actualKwh: interval.energyKwh,
              expectedKwh: interval.baseline.expectedKwh,
              excessKwh: interval.energyKwh - interval.baseline.expectedKwh,
              dataMode: interval.dataMode,
              cause: "unconfirmed",
            },
            timeline: [{ at: new Date(), event: "anomaly_detected" }],
          },
        },
        { upsert: true, returnDocument: "after" },
      ).lean();
      const owner = await models.User.findOne({
        role: "admin",
        active: true,
      }).lean();
      if (owner && incident.active)
        await models.Notification.updateOne(
          { idempotencyKey: `energy:${incident._id}:${owner._id}` },
          {
            $setOnInsert: {
              incidentId: incident._id,
              stage: "energy",
              recipientId: owner._id,
              title: incident.title,
              message:
                "Investigate relevant areas; no room-level cause has been established.",
              state: "delivered",
              idempotencyKey: `energy:${incident._id}:${owner._id}`,
            },
          },
          { upsert: true },
        );
      await models.Recommendation.updateOne(
        { patternKey: `energy:${saved._id}` },
        {
          $setOnInsert: {
            title: "Review unexplained building consumption",
            explanation:
              "This interval exceeds its comparable baseline. Inspect equipment and timetable use; cause remains unconfirmed.",
            proposedAction:
              "Assign a facility inspection, record the cause and review the approved schedule.",
            ownerId: owner?._id,
            evidence: { incidentId: incident._id, intervalId: saved._id },
            estimate: {
              lowKwh: 0,
              highKwh: Math.max(
                0,
                interval.energyKwh - interval.baseline.expectedKwh,
              ),
              period: "this interval",
              tariff: settings.tariff,
              sourceLabel: "Estimated",
              assumptions:
                "Upper bound only; actual avoidable energy requires inspection. No independent verified savings.",
            },
            dataMode: interval.dataMode,
            sourceLabel: "Estimated",
            status: "proposed",
          },
        },
        { upsert: true },
      );
    }
  }
  await models.EnergyInterval.deleteMany({ _id: { $nin: currentIds } });
  await models.Incident.updateMany(
    {
      type: "energy",
      active: true,
      "evidence.intervalId": { $nin: anomalousIds },
    },
    {
      $set: { active: false, state: "cancelled" },
      $push: {
        timeline: {
          at: new Date(),
          event: "analytics_recalculated",
          reason:
            "The current accepted data/baseline no longer supports this anomaly",
        },
      },
    },
  );
  await models.Recommendation.updateMany(
    {
      status: "proposed",
      patternKey: { $regex: "^energy:" },
      "evidence.intervalId": { $nin: anomalousIds },
    },
    {
      $set: { status: "withdrawn" },
      $push: {
        history: {
          at: new Date(),
          action: "evidence_no_longer_supports_pattern",
        },
      },
    },
  );
  return intervals;
}

export async function previewImport(
  models,
  { type, csv, dataMode },
  actorId,
  config,
) {
  if (
    !["meter", "timetable"].includes(type) ||
    typeof csv !== "string" ||
    Buffer.byteLength(csv) > 1024 * 1024
  )
    fail(400, "INVALID_IMPORT", "Expected meter/timetable CSV, at most 1 MB");
  let records;
  try {
    records = parse(csv, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      trim: true,
      max_record_size: 10000,
    });
  } catch {
    fail(400, "CSV_PARSE_ERROR", "CSV could not be parsed");
  }
  if (records.length > 3000)
    fail(400, "ROW_LIMIT", "At most 3000 rows per import");
  const rows = [],
    errors = [];
  let duplicates = 0;
  const seen = new Set();
  for (const [i, record] of records.entries()) {
    try {
      let row, key;
      if (type === "meter") {
        const kind = record.energyKwh !== undefined ? "interval" : "cumulative";
        if ((kind === "interval" ? record.energyKwh : record.readingKwh) === "")
          throw new Error("Reading value must not be blank");
        row = readingInput.parse({
          eventId: `csv-${hash(record)}`,
          meterId: record.meterId,
          epoch: record.epoch ?? "initial",
          kind,
          register: record.register ?? "import_kwh",
          value: Number(
            kind === "interval" ? record.energyKwh : record.readingKwh,
          ),
          capturedAt:
            kind === "interval" ? record.intervalEnd : record.capturedAt,
          ...(kind === "interval"
            ? { intervalStart: record.intervalStart }
            : {}),
          sourceType: "csv",
          dataMode: config.demoMode ? "simulated" : dataMode,
        });
        key = readingKey(row);
        if (await models.MeterReading.exists({ importKey: key })) duplicates++;
      } else {
        const room = await models.Room.findOne({
          code: record.roomCode,
        }).lean();
        if (!room) throw new Error("Unknown room code");
        row = scheduleInput.parse({
          roomId: room._id,
          startAt: record.startAt,
          endAt: record.endAt,
          title: record.title,
          status: record.status || "confirmed",
        });
        key = hash(row);
        if (await models.Schedule.exists({ importKey: key })) duplicates++;
      }
      if (seen.has(key)) {
        duplicates++;
        continue;
      }
      seen.add(key);
      rows.push({ ...row, _importKey: key });
    } catch (err) {
      errors.push({
        row: i + 2,
        message:
          err.name === "ZodError"
            ? err.issues
                .map((v) => `${v.path.join(".")}: ${v.message}`)
                .join(";")
            : err.message,
      });
    }
  }
  const batch = await models.ImportBatch.create({
    type,
    dataMode: config.demoMode ? "simulated" : dataMode,
    creatorId: actorId,
    rows,
    rowErrors: errors,
    duplicates,
    status: "preview",
    expiresAt: new Date(Date.now() + 86400000),
  });
  return { ...batch.toObject(), errors };
}

export async function commitImport(models, batchId, actorId, config) {
  const batch = await models.ImportBatch.findById(batchId).lean();
  if (!batch || batch.creatorId !== actorId)
    fail(404, "NOT_FOUND", "Import preview not found");
  if (batch.status === "committed")
    return { status: "committed", duplicate: true };
  if (batch.expiresAt < new Date())
    fail(409, "PREVIEW_EXPIRED", "Preview expired");
  if (batch.rowErrors.length)
    fail(
      400,
      "INVALID_ROWS",
      "Correct invalid rows and preview again before committing",
    );
  let imported = 0,
    duplicates = 0;
  for (const { _importKey, ...row } of batch.rows) {
    if (batch.type === "meter") {
      const result = await addReading(models, row, actorId, config, {
        refresh: false,
      });
      result.duplicate ? duplicates++ : imported++;
    } else
      await withRoomLock(models, row.roomId, async () => {
        const result = await models.Schedule.updateOne(
          { importKey: _importKey },
          {
            $setOnInsert: {
              ...row,
              importKey: _importKey,
              timezone: "Asia/Kolkata",
            },
          },
          { upsert: true },
        );
        if (result.upsertedCount) {
          imported++;
          await cancelRoomWork(models, row.roomId, "Timetable import changed");
        } else duplicates++;
      });
  }
  await refreshAnalytics(models, config);
  await models.ImportBatch.updateOne(
    { _id: batchId },
    { $set: { status: "committed", committedAt: new Date() } },
  );
  await audit(
    models,
    actorId,
    "import.commit",
    batchId,
    `${imported} imported, ${duplicates} duplicates`,
  );
  return { status: "committed", imported, duplicates };
}

export async function analyticsSummary(models, now = new Date()) {
  const settings = await getSettings(models);
  const [intervals, latest, anomalies, recommendations] = await Promise.all([
    models.EnergyInterval.find().sort({ startAt: 1 }).limit(20000).lean(),
    models.MeterReading.findOne({ validationState: "accepted" })
      .sort({ capturedAt: -1 })
      .lean(),
    models.Incident.countDocuments({ active: true, type: "energy" }),
    models.Recommendation.find({
      status: { $in: ["proposed", "accepted", "scheduled"] },
    }).lean(),
  ]);
  const today = calendar(now, settings.timezone).date;
  // Do not apportion a gap crossing a date boundary into invented daily energy.
  const daily = intervals.filter(
    (i) =>
      calendar(i.startAt, settings.timezone).date === today &&
      calendar(new Date(new Date(i.endAt) - 1), settings.timezone).date ===
        today,
  );
  const todayKwh = daily.reduce((sum, i) => sum + i.energyKwh, 0),
    coverageHours = daily.reduce((sum, i) => sum + i.durationHours, 0);
  return {
    installationName: settings.installationName,
    timezone: settings.timezone,
    todayKwh,
    coverageHours,
    partialDay: coverageHours < 23.99,
    energyCost: todayKwh * settings.tariff,
    tariff: settings.tariff,
    latestMeterAt: latest?.capturedAt ?? null,
    anomalies,
    sourceLabel: daily.some((i) => i.dataMode !== "live")
      ? "Simulated"
      : "Metered",
    excludedCrossDayIntervals: intervals.filter(
      (i) =>
        calendar(i.startAt, settings.timezone).date !==
        calendar(new Date(new Date(i.endAt) - 1), settings.timezone).date,
    ).length,
    potentialSavingKwh: recommendations.reduce(
      (sum, r) => sum + (r.estimate?.lowKwh ?? 0),
      0,
    ),
    potentialSavingLabel:
      "Estimated lower bound; overlapping intervals excluded",
    budget: benefits({
      ratedWatts: 0,
      avoidableHours: 0,
      tariff: settings.tariff,
      ...settings,
    }),
  };
}

export async function reviewReading(
  models,
  readingId,
  { value, reason },
  actorId,
  config,
) {
  const row = await models.MeterReading.findById(readingId).lean();
  if (!row) fail(404, "NOT_FOUND", "Meter reading not found");
  const settings = await getSettings(models),
    meter = settings.meters.find(
      (m) => m.meterId === row.meterId && m.epoch === row.epoch,
    );
  if (!meter)
    fail(
      400,
      "UNKNOWN_METER_EPOCH",
      "Configure the original meter epoch before review",
    );
  if (row.kind === "cumulative") {
    const neighbors = await models.MeterReading.find({
      _id: { $ne: row._id },
      meterId: row.meterId,
      epoch: row.epoch,
      register: row.register,
      dataMode: row.dataMode,
      kind: "cumulative",
      validationState: "accepted",
    })
      .sort({ capturedAt: 1 })
      .lean();
    const before = neighbors
        .filter((r) => r.capturedAt < row.capturedAt)
        .at(-1),
      after = neighbors.find((r) => r.capturedAt > row.capturedAt);
    if ((before && value < before.value) || (after && value > after.value))
      fail(
        409,
        "COUNTER_DISCONTINUITY",
        "Review conflicts with adjacent accepted readings; use a new epoch for a reset",
      );
    for (const reference of [before, after].filter(Boolean))
      if (
        Math.abs(value - reference.value) >
        ((meter.maxPowerKw * Math.abs(row.capturedAt - reference.capturedAt)) /
          3600000) *
          1.1
      )
        fail(
          409,
          "SUPPLY_BOUND",
          "Reviewed growth exceeds configured supply bound",
        );
  } else if (
    value / ((row.capturedAt - row.intervalStart) / 3600000) >
    meter.maxPowerKw * 1.1
  )
    fail(
      409,
      "SUPPLY_BOUND",
      "Reviewed interval exceeds configured supply bound",
    );
  const updated = await models.MeterReading.findOneAndUpdate(
    { _id: row._id, value: row.value, updatedAt: row.updatedAt },
    {
      $set: {
        value,
        validationState: "accepted",
        validationReason:
          "Authorised manual review; original provenance retained",
      },
      $push: {
        corrections: {
          at: new Date(),
          actorId,
          oldValue: row.value,
          newValue: value,
          reason,
        },
      },
    },
    { returnDocument: "after" },
  ).lean();
  if (!updated)
    fail(409, "STATE_CHANGED", "Reading changed during review; reload");
  await audit(
    models,
    actorId,
    "meter.review",
    row._id,
    `Value ${row.value} to ${value}; manual evidence recorded`,
  );
  await refreshAnalytics(models, config);
  return updated;
}
