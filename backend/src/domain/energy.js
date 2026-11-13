const ms = (value) => new Date(value).getTime();
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
};
const formatters = new Map();

export function calendar(at, timezone = "Asia/Kolkata") {
  if (!formatters.has(timezone))
    formatters.set(
      timezone,
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        weekday: "short",
        hourCycle: "h23",
      }),
    );
  const parts = Object.fromEntries(
    formatters
      .get(timezone)
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    weekday: parts.weekday,
  };
}

export function calculateInterval(previous, current) {
  const durationHours =
    (ms(current.capturedAt) - ms(previous.capturedAt)) / 3600000;
  const energyKwh = current.value - previous.value;
  if (
    previous.meterId !== current.meterId ||
    previous.epoch !== current.epoch ||
    previous.register !== current.register ||
    previous.dataMode !== current.dataMode ||
    !(durationHours > 0) ||
    energyKwh < 0
  )
    return null;
  return {
    startAt: new Date(previous.capturedAt),
    endAt: new Date(current.capturedAt),
    energyKwh,
    durationHours,
    averagePowerKw: energyKwh / durationHours,
    coverage: durationHours > 1.05 ? "gap_aggregate" : "interval",
    sourceReadingIds: [previous._id, current._id],
  };
}

export function deriveIntervals(readings) {
  const groups = new Map(),
    intervals = [];
  for (const r of readings.filter((r) => r.validationState === "accepted")) {
    if (r.kind === "interval") {
      const durationHours = (ms(r.capturedAt) - ms(r.intervalStart)) / 3600000;
      if (durationHours > 0)
        intervals.push({
          meterId: r.meterId,
          epoch: r.epoch,
          register: r.register,
          dataMode: r.dataMode,
          startAt: new Date(r.intervalStart),
          endAt: new Date(r.capturedAt),
          energyKwh: r.value,
          durationHours,
          averagePowerKw: r.value / durationHours,
          coverage: durationHours > 1.05 ? "gap_aggregate" : "interval",
          sourceReadingIds: [r._id],
        });
    } else {
      const key = [r.meterId, r.epoch, r.register, r.dataMode].join(":");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
  }
  for (const group of groups.values()) {
    group.sort((a, b) => ms(a.capturedAt) - ms(b.capturedAt));
    for (let i = 1; i < group.length; i++) {
      const interval = calculateInterval(group[i - 1], group[i]);
      if (interval)
        intervals.push({
          ...interval,
          meterId: group[i].meterId,
          epoch: group[i].epoch,
          register: group[i].register,
          dataMode: group[i].dataMode,
        });
    }
  }
  // Alternative representations overlap: prefer explicit interval data; never add both.
  const accepted = [];
  for (const interval of intervals.sort(
    (a, b) =>
      a.sourceReadingIds.length - b.sourceReadingIds.length ||
      ms(a.startAt) - ms(b.startAt),
  )) {
    if (
      !accepted.some(
        (other) =>
          other.meterId === interval.meterId &&
          other.dataMode === interval.dataMode &&
          ms(other.startAt) < ms(interval.endAt) &&
          ms(other.endAt) > ms(interval.startAt),
      )
    )
      accepted.push(interval);
  }
  return accepted.sort((a, b) => ms(a.startAt) - ms(b.startAt));
}

export function baselineFor(interval, history, settings, schedules = []) {
  const target = calendar(interval.startAt, settings.timezone);
  const category = (at) => {
    const c = calendar(at, settings.timezone);
    return settings.holidays?.includes(c.date) ||
      ["Sat", "Sun"].includes(c.weekday)
      ? "holiday"
      : "teaching";
  };
  const active = (at) =>
    schedules.some(
      (s) =>
        s.status === "confirmed" &&
        ms(s.startAt) < ms(at) + interval.durationHours * 3600000 &&
        ms(s.endAt) > ms(at),
    );
  const samples = history.filter(
    (h) =>
      h.meterId === interval.meterId &&
      h.dataMode === interval.dataMode &&
      ms(h.endAt) <= ms(interval.startAt) &&
      !h.anomalous &&
      h.coverage !== "gap_aggregate" &&
      Math.abs(h.durationHours - interval.durationHours) < 0.05 &&
      calendar(h.startAt, settings.timezone).hour === target.hour &&
      category(h.startAt) === category(interval.startAt) &&
      active(h.startAt) === active(interval.startAt),
  );
  if (samples.length < (settings.minimumBaselineSamples ?? 8)) {
    if (settings.initialBaselineKwh == null)
      return {
        method: "insufficient_data",
        expectedKwh: null,
        thresholdKwh: null,
        sampleCount: samples.length,
        version: 1,
      };
    const expectedKwh = settings.initialBaselineKwh * interval.durationHours;
    return {
      method: "initial_rule",
      expectedKwh,
      thresholdKwh: Math.max(
        expectedKwh + (settings.absoluteExcessFloorKwh ?? 2),
        expectedKwh * (1 + (settings.relativeThreshold ?? 0.3)),
      ),
      sampleCount: samples.length,
      version: 1,
    };
  }
  const expectedKwh = median(samples.map((s) => s.energyKwh));
  const robustSigmaKwh =
    1.4826 * median(samples.map((s) => Math.abs(s.energyKwh - expectedKwh)));
  return {
    method: "historical_median",
    expectedKwh,
    robustSigmaKwh,
    thresholdKwh: Math.max(
      expectedKwh + (settings.absoluteExcessFloorKwh ?? 2),
      expectedKwh * (1 + (settings.relativeThreshold ?? 0.3)),
      expectedKwh + 3 * robustSigmaKwh,
    ),
    sampleCount: samples.length,
    version: 1,
  };
}

export function benefits({
  ratedWatts,
  avoidableHours,
  tariff,
  installedCost = 0,
  monthlySoftwareCost = 0,
  monthlyMaintenanceCost = 0,
  addedSystemCost = 0,
}) {
  const estimatedKwh = (ratedWatts / 1000) * avoidableHours;
  const energyCost = estimatedKwh * tariff;
  const netBenefit =
    energyCost - monthlySoftwareCost - monthlyMaintenanceCost - addedSystemCost;
  return {
    estimatedKwh,
    energyCost,
    netBenefit,
    paybackMonths:
      netBenefit > 0 && installedCost > 0 ? installedCost / netBenefit : null,
    sourceLabel: "Estimated",
  };
}
