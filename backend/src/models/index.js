import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;
const opts = { timestamps: true, minimize: false };

export const ROLES = ['admin', 'hod', 'first_responder', 'teacher', 'viewer'];
export const DATA_MODES = ['live', 'replay', 'simulated'];
export const OCCUPANCY = ['occupied', 'vacant', 'unknown'];
export const VERIFICATION = ['simulated', 'command_only', 'controller_reported', 'independently_metered', 'manually_confirmed', 'unknown'];
export const INCIDENT_STATES = [
  'observing', 'open', 'notified_first', 'escalated', 'inspecting', 'snoozed', 'shutdown_pending',
  'action_sent', 'action_unverified', 'resolved', 'cancelled', 'blocked', 'failed',
];

// ---- settings: one installation, one building ----
const settingsSchema = new Schema(
  {
    key: { type: String, default: 'installation', unique: true },
    name: { type: String, default: 'Main Building' },
    timezone: { type: String, default: 'Asia/Kolkata' },
    meterId: { type: String, default: 'MAIN-01' },
    tariffPerKwh: { type: Number, default: 8 },
    tariffIsHypothetical: { type: Boolean, default: true },
    holidays: { type: [String], default: [] }, // local YYYY-MM-DD
    energyResponderIds: [{ type: ObjectId, ref: 'User' }],
    policies: {
      vacancyConfirmationMinutes: { type: Number, default: 15 },
      firstEscalationMinutes: { type: Number, default: 10 },
      finalEscalationAdditionalMinutes: { type: Number, default: 15 },
      bookingPreparationMinutes: { type: Number, default: 15 },
      qrMaxDurationMinutes: { type: Number, default: 120 },
      qrExpiryWarningMinutes: { type: Number, default: 10 },
      observationFreshnessSeconds: { type: Number, default: 120 },
      snoozeMaxMinutes: { type: Number, default: 30 },
      accessStartHour: { type: Number, default: 6 },
      accessEndHour: { type: Number, default: 22 },
      commandExpirySeconds: { type: Number, default: 30 },
    },
    anomaly: {
      minSamples: { type: Number, default: 8 },
      absoluteExcessFloorKwh: { type: Number, default: 2 },
      relativeThreshold: { type: Number, default: 0.3 },
      trainingWindowDays: { type: Number, default: 60 },
      initialRule: {
        enabled: { type: Boolean, default: false },
        teachingHourKwh: { type: Number, default: 0 },
        offHourKwh: { type: Number, default: 0 },
      },
      maxSupplyKw: { type: Number, default: 500 },
      expectedCadenceMinutes: { type: Number, default: 60 },
      essentialLoadKw: { type: Number, default: 2 },
    },
    budget: {
      roomMasterBreakerQuote: { type: Number, default: 0 },
      feederAndLabourQuote: { type: Number, default: 0 },
      presenceNodeCost: { type: Number, default: 0 },
      meterCameraCost: { type: Number, default: 0 },
      networkChanges: { type: Number, default: 0 },
      contingency: { type: Number, default: 0 },
      monthlySoftwareEquivalent: { type: Number, default: 0 },
      monthlyMaintenance: { type: Number, default: 0 },
    },
  },
  opts,
);
export const Settings = model('Settings', settingsSchema);

// ---- users ----
const userSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ROLES, required: true },
    department: String,
    permittedRoomIds: [{ type: ObjectId, ref: 'Room' }],
    active: { type: Boolean, default: true },
  },
  opts,
);
export const User = model('User', userSchema);

// ---- rooms ----
const roomSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true },
    capacity: Number,
    zoneType: { type: String, enum: ['room', 'common_area'], default: 'room' },
    assignments: {
      firstResponderId: { type: ObjectId, ref: 'User' },
      backupResponderId: { type: ObjectId, ref: 'User' },
      secondResponderId: { type: ObjectId, ref: 'User' },
    },
    occupancySource: { type: String, enum: ['camera', 'presence_sensor', 'none'], default: 'none' },
    coverageValidated: { type: Boolean, default: false },
    coverageNotes: String,
    // alert_only: never switch. simulated: simulator only. physical: needs the armed physical adapter.
    controlMode: { type: String, enum: ['alert_only', 'simulated', 'physical'], default: 'alert_only' },
    autoControlEnabled: { type: Boolean, default: false },
    qrPublicToken: { type: String, unique: true, sparse: true },
    qrExpiryPolicy: { type: String, enum: ['staff_confirmation', 'fixed_duration_cutoff'], default: 'staff_confirmation' },
    policyVersion: { type: Number, default: 1 },
    // Observed occupancy only. Authorised use, supply state and appliance evidence live elsewhere.
    occupancy: {
      state: { type: String, enum: OCCUPANCY, default: 'unknown' },
      reason: { type: String, default: 'no_observation' },
      lastObservationAt: Date,
      lastOccupiedAt: Date,
      vacantSince: Date,
      dataMode: { type: String, enum: DATA_MODES },
      sourceId: String,
      equipmentOn: { type: Boolean, default: null },
    },
  },
  opts,
);
export const Room = model('Room', roomSchema);

// ---- room master breakers: exactly one per controlled room ----
const roomBreakerSchema = new Schema(
  {
    roomId: { type: ObjectId, ref: 'Room', required: true, unique: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    adapter: { type: String, enum: ['simulator', 'physical'], default: 'simulator' },
    nativeDeviceId: String,
    feederCoverage: String,
    verifiedRatings: String,
    supplyState: { type: String, enum: ['on', 'off', 'unknown'], default: 'on' },
    // Why the supply is off. Only "automation" may be restored automatically.
    offReason: { type: String, enum: ['automation', 'manual', 'fixed_duration_expiry', null], default: null },
    interlocks: {
      faultTripped: { type: Boolean, default: false },
      maintenanceLock: { type: Boolean, default: false },
      manualIsolation: { type: Boolean, default: false },
    },
    minCycleSeconds: { type: Number, default: 0 },
    lastChangedAt: Date,
    lastSeenAt: Date,
    health: { type: String, enum: ['online', 'offline', 'unknown'], default: 'online' },
    lastVerification: { type: String, enum: VERIFICATION, default: 'unknown' },
    commandLockUntil: { type: Date, default: null },
    commandLockRequestId: { type: String, default: null },
    // Simulator-only behaviour switches used by demos and tests.
    simulator: {
      feedback: { type: Boolean, default: true },
      failTransport: { type: Boolean, default: false },
    },
  },
  opts,
);
export const RoomBreaker = model('RoomBreaker', roomBreakerSchema);

// ---- load inventory: observation and estimates only, never a control target ----
const deviceSchema = new Schema(
  {
    roomId: { type: ObjectId, ref: 'Room', required: true, index: true },
    name: { type: String, required: true },
    category: { type: String, enum: ['light', 'fan', 'ac', 'socket', 'projector', 'computer', 'other'], required: true },
    ratedWatts: { type: Number, min: 0, default: 0 },
    quantity: { type: Number, min: 1, default: 1 },
    controlledByRoomBreakerId: { type: ObjectId, ref: 'RoomBreaker' },
    essential: { type: Boolean, default: false },
    supplyInterruptionApproved: { type: Boolean, default: false },
    requiresNormalStopBeforeCutoff: { type: Boolean, default: false },
    stopProcedureConfirmedAt: Date,
    stopProcedureConfirmedBy: { type: ObjectId, ref: 'User' },
    restartDelaySeconds: { type: Number, default: 0 },
    restartBehaviourKnown: { type: Boolean, default: false },
    essentialStandbyRequirement: { type: Boolean, default: false },
    approvalNotes: String,
  },
  opts,
);
export const Device = model('Device', deviceSchema);

// ---- integrations: registered telemetry sources and adapters ----
const integrationSchema = new Schema(
  {
    sourceId: { type: String, required: true, unique: true },
    type: { type: String, enum: ['camera', 'presence_sensor', 'meter_camera', 'room_breaker', 'vision_service', 'smtp', 'mqtt', 'home_assistant'], required: true },
    name: String,
    roomId: { type: ObjectId, ref: 'Room' },
    enabled: { type: Boolean, default: true },
    dataMode: { type: String, enum: DATA_MODES, default: 'simulated' },
    allowedEndpoint: String,
    credentialRef: String,
    capabilities: [String],
    lastSeenAt: Date,
    health: { type: String, enum: ['connected', 'unavailable', 'not_configured', 'degraded'], default: 'not_configured' },
    lastTest: { at: Date, ok: Boolean, message: String },
  },
  opts,
);
export const Integration = model('Integration', integrationSchema);

// ---- schedules ----
const scheduleSchema = new Schema(
  {
    roomId: { type: ObjectId, ref: 'Room', required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    title: { type: String, required: true },
    status: { type: String, enum: ['confirmed', 'cancelled'], default: 'confirmed' },
    origin: { type: String, enum: ['import', 'manual', 'fixture'], default: 'manual' },
    importKey: { type: String, unique: true, sparse: true },
    cancelledAt: Date,
    cancelReason: String,
  },
  opts,
);
scheduleSchema.index({ roomId: 1, startAt: 1, endAt: 1 });
export const Schedule = model('Schedule', scheduleSchema);

// ---- observations ----
const observationSchema = new Schema(
  {
    eventId: { type: String, required: true },
    sourceId: { type: String, required: true },
    roomId: { type: ObjectId, ref: 'Room', required: true },
    capturedAt: { type: Date, required: true },
    receivedAt: { type: Date, required: true },
    sourceType: { type: String, enum: ['camera', 'presence_sensor'], required: true },
    occupancy: { type: String, enum: OCCUPANCY, required: true },
    detectedPeople: Number,
    confidence: Number,
    coverageValidated: { type: Boolean, default: false },
    quality: { usable: { type: Boolean, default: true }, reason: String },
    equipmentOn: { type: Boolean, default: null },
    dataMode: { type: String, enum: DATA_MODES, required: true },
    modelVersion: String,
  },
  opts,
);
observationSchema.index({ sourceId: 1, eventId: 1 }, { unique: true });
observationSchema.index({ roomId: 1, capturedAt: -1 });
export const Observation = model('Observation', observationSchema);

// ---- meter readings ----
const meterReadingSchema = new Schema(
  {
    meterId: { type: String, required: true },
    epoch: { type: Number, default: 1 },
    kind: { type: String, enum: ['cumulative'], default: 'cumulative' },
    register: { type: String, default: 'import_kwh' },
    value: { type: Number, required: true },
    unit: { type: String, enum: ['kWh'], default: 'kWh' },
    capturedAt: { type: Date, required: true },
    receivedAt: { type: Date, required: true },
    sourceType: { type: String, enum: ['csv', 'manual', 'camera_ocr', 'telemetry', 'fixture'], required: true },
    dataMode: { type: String, enum: DATA_MODES, required: true },
    validation: { type: String, enum: ['accepted', 'needs_review', 'rejected'], required: true },
    validationReason: String,
    eventId: String,
    enteredBy: { type: ObjectId, ref: 'User' },
    quality: Schema.Types.Mixed,
    rawText: String,
    corrections: [{ at: Date, by: { type: ObjectId, ref: 'User' }, fromValue: Number, toValue: Number, action: String, note: String }],
  },
  opts,
);
// One reading per meter, register and capture instant: re-imports are idempotent.
meterReadingSchema.index({ meterId: 1, register: 1, capturedAt: 1 }, { unique: true });
meterReadingSchema.index({ meterId: 1, epoch: 1, register: 1, capturedAt: 1 });
export const MeterReading = model('MeterReading', meterReadingSchema);

// ---- energy intervals ----
const energyIntervalSchema = new Schema(
  {
    meterId: { type: String, required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    energyKwh: { type: Number, required: true },
    durationHours: { type: Number, required: true },
    averagePowerKw: { type: Number, required: true },
    isGap: { type: Boolean, default: false },
    sourceKind: { type: String, enum: ['cumulative_diff', 'interval_import'], required: true },
    sourceReadingIds: [{ type: ObjectId, ref: 'MeterReading' }],
    dataMode: { type: String, enum: DATA_MODES, required: true },
    sourceLabel: { type: String, enum: ['Metered', 'Simulated'], required: true },
    calculationVersion: { type: Number, default: 1 },
    baseline: {
      method: { type: String, enum: ['historical', 'initial_rule', 'insufficient'] },
      expectedKwh: Number,
      thresholdKwh: Number,
      lowKwh: Number,
      sampleCount: Number,
      robustSigmaKwh: Number,
      matchRule: String,
      version: Number,
      evaluatedAt: Date,
    },
    anomalous: { type: Boolean, default: false },
    excessKwh: Number,
  },
  opts,
);
energyIntervalSchema.index({ meterId: 1, startAt: 1, endAt: 1 }, { unique: true });
export const EnergyInterval = model('EnergyInterval', energyIntervalSchema);

// ---- incidents ----
const timelineEntry = new Schema(
  {
    at: { type: Date, required: true },
    kind: { type: String, required: true },
    text: { type: String, required: true },
    actorId: { type: ObjectId, ref: 'User' },
    actorLabel: String,
    data: Schema.Types.Mixed,
  },
  { _id: false },
);
const incidentSchema = new Schema(
  {
    type: { type: String, enum: ['vacancy_waste', 'energy_anomaly', 'lease_expiry', 'data_quality'], required: true },
    scope: { type: String, enum: ['room', 'building_meter'], required: true },
    roomId: { type: ObjectId, ref: 'Room' },
    meterId: String,
    issueKey: { type: String, required: true },
    episode: { type: Number, default: 1 },
    active: { type: Boolean, default: true },
    state: { type: String, enum: INCIDENT_STATES, required: true },
    title: { type: String, required: true },
    severity: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    dataMode: { type: String, enum: DATA_MODES, default: 'live' },
    evidence: [{ label: String, source: String, text: String, at: Date }],
    timeline: [timelineEntry],
    assignments: {
      firstResponderId: { type: ObjectId, ref: 'User' },
      backupResponderId: { type: ObjectId, ref: 'User' },
      secondResponderId: { type: ObjectId, ref: 'User' },
    },
    policyVersion: Number,
    openedAt: Date,
    firstNotifiedAt: Date,
    escalatedAt: Date,
    finalDueAt: Date,
    escalateDueAt: Date,
    acknowledgedAt: Date,
    acknowledgedBy: { type: ObjectId, ref: 'User' },
    snoozedUntil: Date,
    blockReason: String,
    resolvedAt: Date,
    resolution: {
      method: String,
      note: String,
      by: { type: ObjectId, ref: 'User' },
      verification: { type: String, enum: [...VERIFICATION, null], default: null },
    },
    suspectedCause: String,
    confirmedCause: String,
    anomaly: {
      intervalId: { type: ObjectId, ref: 'EnergyInterval' },
      startAt: Date,
      endAt: Date,
      actualKwh: Number,
      expectedKwh: Number,
      thresholdKwh: Number,
      excessKwh: Number,
      baselineMethod: String,
      baselineVersion: Number,
      sampleCount: Number,
      possibleContributors: [{ roomId: { type: ObjectId, ref: 'Room' }, roomCode: String, text: String, source: String }],
      inspectionStatus: { type: String, enum: ['contributors_suggested', 'manual_inspection_requested', 'inspected'], default: 'manual_inspection_requested' },
    },
    commandIds: [{ type: ObjectId, ref: 'Command' }],
  },
  opts,
);
// One active incident per issue; closed episodes keep the same key.
incidentSchema.index({ issueKey: 1 }, { unique: true, partialFilterExpression: { active: true } });
incidentSchema.index({ active: 1, type: 1, roomId: 1 });
export const Incident = model('Incident', incidentSchema);

// ---- durable jobs ----
const jobSchema = new Schema(
  {
    type: { type: String, enum: ['notify_first', 'escalate', 'final_check', 'snooze_expiry', 'lease_warning', 'lease_expiry'], required: true },
    incidentId: { type: ObjectId, ref: 'Incident' },
    leaseId: { type: ObjectId, ref: 'AccessLease' },
    roomId: { type: ObjectId, ref: 'Room' },
    dueAt: { type: Date, required: true },
    policyVersion: Number,
    status: { type: String, enum: ['pending', 'leased', 'done', 'cancelled', 'failed'], default: 'pending' },
    leaseOwner: String,
    leaseUntil: Date,
    attempts: { type: Number, default: 0 },
    idempotencyKey: { type: String, required: true, unique: true },
    result: String,
    finishedAt: Date,
  },
  opts,
);
jobSchema.index({ status: 1, dueAt: 1 });
export const Job = model('Job', jobSchema);

// ---- notifications: outbox and in-app inbox ----
const notificationSchema = new Schema(
  {
    incidentId: { type: ObjectId, ref: 'Incident' },
    leaseId: { type: ObjectId, ref: 'AccessLease' },
    stage: { type: String, required: true },
    recipientId: { type: ObjectId, ref: 'User' },
    channel: { type: String, enum: ['in_app'], default: 'in_app' },
    idempotencyKey: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    link: String,
    deliveryState: { type: String, enum: ['delivered', 'failed'], required: true },
    failureReason: String,
    readAt: Date,
    dataMode: { type: String, enum: DATA_MODES, default: 'live' },
  },
  opts,
);
notificationSchema.index({ recipientId: 1, createdAt: -1 });
export const Notification = model('Notification', notificationSchema);

// ---- QR access leases ----
const accessLeaseSchema = new Schema(
  {
    roomId: { type: ObjectId, ref: 'Room', required: true },
    requesterId: { type: ObjectId, ref: 'User', required: true },
    requestedMinutes: Number,
    startAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    status: { type: String, enum: ['active', 'ended', 'expired'], default: 'active' },
    warningSentAt: Date,
    extensions: [{ at: Date, minutes: Number, by: { type: ObjectId, ref: 'User' }, previousExpiresAt: Date }],
    policyAccepted: { type: Boolean, default: false },
    endedAt: Date,
    endReason: String,
    dataMode: { type: String, enum: DATA_MODES, default: 'live' },
  },
  opts,
);
accessLeaseSchema.index({ roomId: 1, status: 1, expiresAt: 1 });
export const AccessLease = model('AccessLease', accessLeaseSchema);

// ---- staff overrides ----
const overrideSchema = new Schema(
  {
    roomId: { type: ObjectId, ref: 'Room', required: true },
    createdBy: { type: ObjectId, ref: 'User', required: true },
    scope: { type: String, enum: ['keep_supply_on'], default: 'keep_supply_on' },
    reason: { type: String, required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    cancelledAt: Date,
    cancelledBy: { type: ObjectId, ref: 'User' },
  },
  opts,
);
overrideSchema.index({ roomId: 1, endAt: 1 });
export const Override = model('Override', overrideSchema);

// ---- room supply commands ----
const commandSchema = new Schema(
  {
    requestId: { type: String, required: true, unique: true },
    roomId: { type: ObjectId, ref: 'Room', required: true },
    roomBreakerId: { type: ObjectId, ref: 'RoomBreaker', required: true },
    roomBreakerCode: String,
    action: { type: String, enum: ['on', 'off'], required: true },
    reason: { type: String, enum: ['vacancy_escalation', 'occupancy_restore', 'qr_access', 'fixed_duration_expiry', 'manual', 'override'], required: true },
    incidentId: { type: ObjectId, ref: 'Incident' },
    leaseId: { type: ObjectId, ref: 'AccessLease' },
    policyVersion: Number,
    issuedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    actorId: { type: ObjectId, ref: 'User' },
    actorLabel: String,
    status: { type: String, enum: ['pending', 'completed', 'rejected', 'expired', 'failed'], default: 'pending' },
    rejectReasons: [String],
    transportStatus: { type: String, enum: ['pending', 'acknowledged', 'failed', 'not_sent'], default: 'pending' },
    reportedOutput: { type: String, enum: ['on', 'off', 'unknown', null], default: null },
    verification: { type: String, enum: VERIFICATION, default: 'unknown' },
    verifiedAt: Date,
    dataMode: { type: String, enum: DATA_MODES, required: true },
  },
  opts,
);
commandSchema.index({ roomBreakerId: 1, status: 1 });
export const Command = model('Command', commandSchema);

// ---- recommendations ----
const recommendationSchema = new Schema(
  {
    ruleKey: { type: String, required: true, unique: true },
    pattern: { type: String, required: true },
    title: { type: String, required: true },
    explanation: String,
    evidence: [{ text: String, source: String }],
    action: String,
    ownerRole: { type: String, enum: ROLES },
    ownerId: { type: ObjectId, ref: 'User' },
    roomId: { type: ObjectId, ref: 'Room' },
    // Recommendations sharing a group describe the same avoidable energy; only the largest counts.
    overlapGroup: { type: String, required: true },
    estimate: {
      kwhLow: Number,
      kwhHigh: Number,
      costLow: Number,
      costHigh: Number,
      period: { type: String, default: 'month' },
      method: String,
      assumptions: [String],
    },
    implementationCost: Number,
    paybackMonths: Number,
    confidence: { type: String, enum: ['low', 'medium', 'high'], default: 'low' },
    limitations: [String],
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    status: { type: String, enum: ['proposed', 'accepted', 'rejected', 'completed', 'verified'], default: 'proposed' },
    rejectReason: String,
    dueDate: Date,
    acceptedAt: Date,
    completedAt: Date,
    outcome: {
      note: String,
      baselineKwhPerDay: Number,
      observedKwhPerDay: Number,
      observedReductionKwhPerDay: Number,
      comparisonDays: Number,
      label: String,
      evaluatedAt: Date,
    },
    history: [{ at: Date, by: { type: ObjectId, ref: 'User' }, action: String, note: String }],
    sourceLabel: { type: String, default: 'Estimated' },
    dataMode: { type: String, enum: DATA_MODES, default: 'live' },
  },
  opts,
);
export const Recommendation = model('Recommendation', recommendationSchema);

// ---- audit ----
const auditEventSchema = new Schema(
  {
    at: { type: Date, required: true },
    actorId: { type: ObjectId, ref: 'User' },
    actorLabel: String,
    action: { type: String, required: true },
    targetType: String,
    targetId: String,
    detail: Schema.Types.Mixed,
  },
  { minimize: false },
);
auditEventSchema.index({ at: -1 });
export const AuditEvent = model('AuditEvent', auditEventSchema);

// ---- live events relayed to Socket.IO by the API process ----
const liveEventSchema = new Schema({
  at: { type: Date, required: true },
  type: { type: String, required: true },
  roomId: String,
  userId: String,
  payload: Schema.Types.Mixed,
});
liveEventSchema.index({ at: 1 }, { expireAfterSeconds: 3600 });
export const LiveEvent = model('LiveEvent', liveEventSchema);
