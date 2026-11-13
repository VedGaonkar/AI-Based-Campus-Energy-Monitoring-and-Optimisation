const formatters = new Map();

function formatter(tz) {
  if (!formatters.has(tz)) {
    formatters.set(
      tz,
      new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        weekday: 'short',
      }),
    );
  }
  return formatters.get(tz);
}

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Calendar fields of an instant as seen in the installation timezone.
export function localParts(date, tz) {
  const parts = Object.fromEntries(formatter(tz).formatToParts(new Date(date)).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday],
  };
}

// UTC instant of local midnight for the local day containing `date`.
export function startOfLocalDay(date, tz) {
  const d = new Date(date);
  const p = localParts(d, tz);
  const guess = new Date(d.getTime() - (p.hour * 60 + p.minute) * 60_000);
  guess.setUTCSeconds(0, 0);
  // Correct once for DST transitions inside the day.
  const g = localParts(guess, tz);
  if (g.hour !== 0 || g.minute !== 0) {
    const diff = g.date === p.date ? g.hour * 60 + g.minute : -((24 - g.hour) * 60 - g.minute);
    return new Date(guess.getTime() - diff * 60_000);
  }
  return guess;
}

export function dayCategory(date, tz, holidays = []) {
  const p = localParts(date, tz);
  if (holidays.includes(p.date)) return 'holiday';
  return p.weekday === 0 || p.weekday === 6 ? 'weekend' : 'teaching';
}

export function round(value, digits = 6) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function parseIsoDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value.trim())) return null;
  // Require an explicit offset so a timestamp is never silently read in the server's zone.
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(value.trim())) return null;
  const d = new Date(value.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}
