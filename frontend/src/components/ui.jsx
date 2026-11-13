import { useEffect, useState } from 'react';

const cx = (...parts) => parts.filter(Boolean).join(' ');

export function fmtTime(value, { date = true } = {}) {
  if (!value) return '—';
  const d = new Date(value);
  return d.toLocaleString('en-IN', date ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export const fmtNum = (v, digits = 1) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: 0 }));
export const fmtRupees = (v) => (v === null || v === undefined ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);

// Evidence labels differ by wording and border style, not by colour alone.
const SOURCE_STYLE = {
  Metered: 'border-solid border-ink',
  'Camera-observed': 'border-solid border-teal text-teal-dark',
  'Sensor-reported': 'border-solid border-teal text-teal-dark',
  Estimated: 'border-dashed border-ink',
  Simulated: 'border-double border-4 border-amber bg-amber-tint',
  Unknown: 'border-dotted border-muted text-muted',
};

export function SourceLabel({ label }) {
  if (!label) return null;
  return <span className={cx('inline-block rounded-[2px] border px-1.5 py-px text-[0.72rem] font-semibold whitespace-nowrap', SOURCE_STYLE[label] ?? SOURCE_STYLE.Unknown)}>{label}</span>;
}

const TONES = {
  neutral: 'bg-panel text-ink',
  good: 'bg-green-tint text-green',
  warn: 'bg-amber-tint text-ink',
  bad: 'bg-red-tint text-red',
  info: 'bg-teal-tint text-teal-dark',
};

export function Pill({ tone = 'neutral', children }) {
  return <span className={cx('inline-block rounded-full px-2.5 py-0.5 text-[0.8rem] font-semibold whitespace-nowrap', TONES[tone])}>{children}</span>;
}

const INCIDENT_STATE = {
  observing: ['Observing', 'neutral'],
  open: ['Open', 'warn'],
  notified_first: ['First responder alerted', 'warn'],
  escalated: ['Escalated to HOD', 'bad'],
  inspecting: ['Being inspected', 'info'],
  snoozed: ['Snoozed', 'neutral'],
  shutdown_pending: ['Final recheck', 'bad'],
  action_sent: ['Command sent', 'info'],
  action_unverified: ['Sent, not confirmed', 'bad'],
  resolved: ['Resolved', 'good'],
  cancelled: ['Cancelled', 'neutral'],
  blocked: ['Manual action needed', 'bad'],
  failed: ['Failed, needs review', 'bad'],
};

export function IncidentState({ state }) {
  const [text, tone] = INCIDENT_STATE[state] ?? [state, 'neutral'];
  return <Pill tone={tone}>{text}</Pill>;
}

export function OccupancyState({ occupancy }) {
  const reasons = {
    no_occupancy_source: 'no camera or sensor',
    no_observation: 'nothing received yet',
    stale_observation: 'source stopped reporting',
    coverage_not_validated: 'coverage not validated',
    camera_offline: 'camera offline',
    vacancy_unconfirmed: 'waiting to confirm',
    vacancy_confirmed: 'confirmed',
  };
  const note = reasons[occupancy.reason];
  if (occupancy.state === 'occupied') return <Pill tone="good">Occupied</Pill>;
  if (occupancy.state === 'vacant') return <Pill tone={occupancy.confirmedVacant ? 'warn' : 'neutral'}>Vacant{note ? `, ${note}` : ''}</Pill>;
  return <Pill tone="neutral">Unknown{note ? `: ${note}` : ''}</Pill>;
}

export function SupplyState({ breaker }) {
  if (!breaker) return <Pill>No room master</Pill>;
  const lock = breaker.interlocks?.faultTripped ? 'fault-tripped' : breaker.interlocks?.maintenanceLock ? 'maintenance lock' : breaker.interlocks?.manualIsolation ? 'isolated' : null;
  const text = breaker.supplyState === 'on' ? 'Supply on' : breaker.supplyState === 'off' ? 'Supply off' : 'Supply unknown';
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Pill tone={breaker.supplyState === 'on' ? 'info' : breaker.supplyState === 'off' ? 'neutral' : 'bad'}>{text}</Pill>
      {lock && <Pill tone="bad">{lock}</Pill>}
    </span>
  );
}

export function Button({ kind = 'primary', className, ...props }) {
  const kinds = {
    primary: 'bg-teal text-white hover:bg-teal-dark border-teal',
    secondary: 'bg-plate text-ink hover:bg-teal-tint border-ink',
    danger: 'bg-plate text-red hover:bg-red-tint border-red',
  };
  return <button type="button" {...props} className={cx('rounded-[3px] border px-3 py-1.5 font-semibold disabled:cursor-not-allowed disabled:opacity-50', kinds[kind], className)} />;
}

export function Section({ title, aside, children, className }) {
  return (
    <section className={cx('rounded-[4px] border border-rule bg-plate', className)}>
      {(title || aside) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-2.5">
          <h2>{title}</h2>
          {aside}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[0.85rem] font-semibold">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[0.8rem] text-muted">{hint}</span>}
    </label>
  );
}

export function Notice({ tone = 'info', children }) {
  const tones = { info: 'border-teal bg-teal-tint', warn: 'border-amber bg-amber-tint', bad: 'border-red bg-red-tint', good: 'border-green bg-green-tint' };
  return <div role={tone === 'bad' ? 'alert' : 'status'} className={cx('rounded-[3px] border-l-4 px-3 py-2 text-[0.9rem]', tones[tone])}>{children}</div>;
}

export function ActionFeedback({ action }) {
  if (action.error) {
    return (
      <Notice tone="bad">
        {action.error.message}
        {Array.isArray(action.error.details) && (
          <ul className="mt-1 list-disc pl-5">
            {action.error.details.map((d, i) => (
              <li key={i}>{d.path ? `${d.path}: ` : ''}{d.message}</li>
            ))}
          </ul>
        )}
      </Notice>
    );
  }
  if (action.done) return <Notice tone="good">{action.done}</Notice>;
  return null;
}

export function Loading({ state, children }) {
  if (state.error && !state.data) return <Notice tone="bad">{state.error.message}</Notice>;
  if (!state.data) return <p className="text-muted">Loading…</p>;
  return children(state.data);
}

export function Empty({ children }) {
  return <p className="py-4 text-muted">{children}</p>;
}

// Shows time left until a due time stored on the server. Display only: the server decides what happens.
export function Countdown({ dueAt, serverTime }) {
  const [offset] = useState(() => (serverTime ? new Date(serverTime).getTime() - Date.now() : 0));
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!dueAt) return <span>—</span>;
  const ms = new Date(dueAt).getTime() - (Date.now() + offset);
  if (ms <= 0) return <span className="num">due now</span>;
  const s = Math.ceil(ms / 1000);
  return <span className="num">{s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`}</span>;
}

export function PageHeader({ title, children, lead }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1>{title}</h1>
        {lead && <p className="mt-1 max-w-[70ch] text-muted">{lead}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </header>
  );
}

export { cx };
