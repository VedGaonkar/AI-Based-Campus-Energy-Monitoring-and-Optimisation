import { Area, Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { SourceLabel, fmtNum, fmtTime } from './ui.jsx';

const INK = '#14201f';
const TEAL = '#0e5a63';
const RED = '#b42318';
const RULE = '#c3cbc9';

function Tip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="max-w-xs rounded-[3px] border border-ink bg-white p-2 text-[0.85rem] shadow">
      <p className="num font-semibold">{fmtTime(d.startAt)} to {fmtTime(d.endAt, { date: false }).slice(0, 5)}</p>
      <p className="num">{fmtNum(d.energyKwh, 2)} kWh <SourceLabel label={d.sourceLabel} /></p>
      <p className="num text-muted">Average power over the interval: {fmtNum(d.averagePowerKw, 2)} kW</p>
      {d.isGap && <p className="text-muted">Readings were missing: this is one {fmtNum(d.durationHours, 1)}-hour total, not hourly values.</p>}
      {d.baseline?.expectedKwh != null ? (
        <p className="num text-muted">Expected {fmtNum(d.baseline.expectedKwh, 1)} kWh, review above {fmtNum(d.baseline.thresholdKwh, 1)} kWh ({d.baseline.method === 'historical' ? `${d.baseline.sampleCount} comparable intervals` : 'initial rule baseline'})</p>
      ) : (
        <p className="text-muted">{d.isGap ? '' : 'Insufficient baseline data for this interval.'}</p>
      )}
      {d.anomalous && <p className="font-semibold text-red">Above the expected range by {fmtNum(d.excessKwh, 1)} kWh</p>}
    </div>
  );
}

// Bars are measured (or simulated) energy per interval; the band and line are the estimated expectation.
export default function EnergyChart({ intervals, height = 300 }) {
  if (!intervals?.length) return <p className="py-8 text-muted">No intervals in this period. Import meter readings on the Energy page to see consumption.</p>;
  const data = intervals.map((i) => ({
    ...i,
    t: new Date(i.startAt).getTime(),
    // A gap interval is drawn at its hourly-equivalent height and hatched, so it is not read as a spike.
    shown: i.isGap ? i.energyKwh / i.durationHours : i.energyKwh,
    band: i.baseline?.expectedKwh != null ? [i.baseline.lowKwh ?? 0, i.baseline.thresholdKwh] : null,
    expected: i.baseline?.expectedKwh ?? null,
  }));
  const tick = (t) => new Date(t).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit' });
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <pattern id="gap-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#fff" />
              <line x1="0" y1="0" x2="0" y2="6" stroke={TEAL} strokeWidth="2" />
            </pattern>
          </defs>
          <CartesianGrid stroke={RULE} vertical={false} />
          <XAxis dataKey="t" tickFormatter={tick} minTickGap={48} stroke={INK} fontSize={12} />
          <YAxis stroke={INK} fontSize={12} width={44} label={{ value: 'kWh per hour', angle: -90, position: 'insideLeft', fontSize: 12, fill: INK }} />
          <Tooltip content={<Tip />} />
          <Area dataKey="band" stroke="none" fill={TEAL} fillOpacity={0.14} isAnimationActive={false} connectNulls={false} />
          <Bar dataKey="shown" isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.id} fill={d.isGap ? 'url(#gap-hatch)' : d.anomalous ? RED : TEAL} stroke={d.isGap ? TEAL : 'none'} />
            ))}
          </Bar>
          <Line dataKey="expected" stroke={INK} strokeDasharray="5 4" dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[0.82rem] text-muted">
        <li><span className="mr-1.5 inline-block h-3 w-3 align-middle" style={{ background: TEAL }} />Energy per interval</li>
        <li><span className="mr-1.5 inline-block h-3 w-3 align-middle" style={{ background: RED }} />Above expected range</li>
        <li><span className="mr-1.5 inline-block h-3 w-3 border align-middle" style={{ borderColor: TEAL, background: 'repeating-linear-gradient(45deg,#fff 0 2px,#0e5a63 2px 4px)' }} />Gap: one total, shown per hour</li>
        <li><span className="mr-1.5 inline-block w-5 border-t-2 border-dashed border-ink align-middle" />Expected (estimated)</li>
        <li><span className="mr-1.5 inline-block h-3 w-3 align-middle" style={{ background: TEAL, opacity: 0.2 }} />Expected range</li>
      </ul>
    </div>
  );
}
