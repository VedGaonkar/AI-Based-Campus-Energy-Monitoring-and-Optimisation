const compact = text => text.toLowerCase().replace(/\s+/g, "");
export function parseMeterText(text, configuration) {
  const reasons = [], normal = compact(text);
  const unit = configuration.unit;
  if (!normal.includes(compact(configuration.registerLabel))) reasons.push("REGISTER_NOT_IDENTIFIED");
  if (!(unit === "kWh" ? /k\s*w\s*h/i : /\bwh\b/i).test(text)) reasons.push("ENERGY_UNIT_NOT_IDENTIFIED");
  if (/\bkw(?!\s*h)\b|\bvolts?\b|\d\s*v\b|\btariff\b|\bhz\b|\bamps?\b/i.test(text)) reasons.push("OTHER_DISPLAY_REGISTER");
  const escaped = configuration.registerLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripped = text.replace(new RegExp(escaped, "gi"), " ").replace(/k\s*w\s*h|\bwh\b/gi, " ");
  const numbers = stripped.match(/-?\d+(?:[.,]\d+)*/g) ?? [];
  if (numbers.length !== 1) reasons.push(numbers.length ? "AMBIGUOUS_NUMBERS" : "UNREADABLE_DIGITS");
  let value = null;
  if (numbers.length === 1) {
    const token = numbers[0];
    if (configuration.decimalMode === "implied") {
      if (!/^\d+$/.test(token)) reasons.push("DECIMAL_FORMAT");
      else value = Number(token) / 10 ** configuration.decimalPlaces;
    } else {
      const separator = configuration.decimalMode === "comma" ? "," : ".";
      const expression = separator === "," ? /^\d+(?:,\d+)?$/ : /^\d+(?:\.\d+)?$/;
      if (!expression.test(token)) reasons.push("DECIMAL_FORMAT");
      else {
        value = Number(token.replace(",", "."));
        if ((token.split(separator)[1]?.length ?? 0) !== configuration.decimalPlaces) reasons.push("DECIMAL_PLACES_MISMATCH");
      }
    }
    // Never silently turn OCR letters into digits or choose a numeric substring.
    if (/[A-Za-z]\d|\d[A-Za-z]/.test(stripped.trim())) reasons.push("AMBIGUOUS_DIGITS");
  }
  if (!Number.isFinite(value) || value === null || value < 0 || value > 1e12) value = null;
  return { value: value === null ? null : value / (unit === "Wh" ? 1000 : 1), reasons: [...new Set(reasons)], registerMatched: !reasons.some(v => ["REGISTER_NOT_IDENTIFIED", "ENERGY_UNIT_NOT_IDENTIFIED", "OTHER_DISPLAY_REGISTER"].includes(v)) };
}

export function validateMeterCandidate({ value, capturedAt, receivedAt, previous, next, maxPowerKw }) {
  const reasons = [], time = +new Date(capturedAt), now = +new Date(receivedAt);
  if (time > now + 300000) reasons.push("FUTURE_TIMESTAMP");
  if (time < now - 600000) reasons.push("STALE_CAPTURE");
  if (value === null) return [...reasons, "NO_NUMERIC_CANDIDATE"];
  if (previous && value < previous.value || next && value > next.value) reasons.push("NON_MONOTONIC");
  for (const reference of [previous, next].filter(Boolean)) {
    const hours = Math.abs(time - +new Date(reference.capturedAt)) / 3600000;
    if (!hours && value !== reference.value) reasons.push("TIMESTAMP_CONFLICT");
    if (Math.abs(value - reference.value) > maxPowerKw * hours * 1.1) reasons.push("IMPLAUSIBLE_CONSUMPTION");
  }
  if (previous?.value > 0 && value > 0) for (const factor of [.001, .01, .1, 10, 100, 1000]) if (Math.abs(value / previous.value - factor) < factor * .002) reasons.push("POSSIBLE_DECIMAL_SHIFT");
  return [...new Set(reasons)];
}
