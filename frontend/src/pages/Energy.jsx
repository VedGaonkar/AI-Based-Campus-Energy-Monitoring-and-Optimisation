import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../App.jsx';
import EnergyChart from '../components/EnergyChart.jsx';
import { ActionFeedback, Button, Empty, Field, IncidentState, Loading, Notice, PageHeader, Section, SourceLabel, fmtNum, fmtTime } from '../components/ui.jsx';
import { post, useAction, useData } from '../services/api.js';

const RANGES = [['2', '48 hours'], ['7', '7 days'], ['30', '30 days']];

// Builds an ISO timestamp with the browser's own UTC offset from a datetime-local value.
function localInputToIso(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const off = -d.getTimezoneOffset();
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `${value.length === 16 ? `${value}:00` : value}${off >= 0 ? '+' : '-'}${pad(off / 60)}:${pad(off % 60)}`;
}

function ImportCsv({ onDone }) {
  const [csv, setCsv] = useState('');
  const [dataMode, setDataMode] = useState('live');
  const [preview, setPreview] = useState(null);
  const action = useAction();
  const run = async (commit) => {
    const r = await action.run(() => post('/imports/meter-readings', { csv, commit, dataMode }), commit ? 'Import committed' : null);
    if (r) {
      setPreview(r);
      if (commit) onDone();
    }
  };
  return (
    <Section title="Import meter CSV">
      <p className="mb-3 max-w-[70ch] text-[0.9rem] text-muted">
        Cumulative readings: <code>meterId,capturedAt,readingKwh,register,source</code>. Interval energy: <code>meterId,intervalStart,intervalEnd,energyKwh</code>. Every timestamp needs its own UTC offset, for example <span className="num">2026-11-13T10:00:00+05:30</span>.
      </p>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <Field label="CSV file">
          <input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setCsv(await f.text()); setPreview(null); action.clear(); } }} />
        </Field>
        <Field label="This data is">
          <select value={dataMode} onChange={(e) => { setDataMode(e.target.value); setPreview(null); }}>
            <option value="live">Real meter readings</option>
            <option value="simulated">Synthetic or test data</option>
          </select>
        </Field>
      </div>
      <Field label="Or paste CSV">
        <textarea rows={4} value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null); }} className="num mt-1 w-full text-[0.85rem]" spellCheck={false} />
      </Field>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button kind="secondary" disabled={!csv.trim() || action.pending} onClick={() => run(false)}>Preview</Button>
        <Button disabled={!preview || preview.summary.committed || action.pending || preview.summary.accepted + preview.summary.needsReview === 0} onClick={() => run(true)}>Commit import</Button>
      </div>
      <div className="mt-3 space-y-2">
        <ActionFeedback action={action} />
        {preview && (
          <Notice tone={preview.summary.invalid ? 'warn' : 'info'}>
            <p className="num font-semibold">
              {preview.summary.committed ? 'Committed' : 'Preview'} ({preview.summary.format} format, {preview.summary.dataMode === 'live' ? 'real' : 'simulated'} data): {preview.summary.accepted} accepted, {preview.summary.needsReview} need review, {preview.summary.duplicates} already imported, {preview.summary.invalid} invalid.
            </p>
            <p className="text-[0.85rem]">{preview.summary.timezoneAssumption}.</p>
            {[...preview.invalid, ...preview.needsReview].length > 0 && (
              <ul className="num mt-1 max-h-40 list-disc overflow-auto pl-5 text-[0.85rem]">
                {preview.invalid.map((r, i) => <li key={`i${i}`}>Line {r.line}: {r.reason}</li>)}
                {preview.needsReview.map((r, i) => <li key={`r${i}`}>Line {r.line}: needs review. {r.reason}</li>)}
              </ul>
            )}
          </Notice>
        )}
      </div>
    </Section>
  );
}

function ManualReading({ onDone }) {
  const [capturedAt, setCapturedAt] = useState('');
  const [value, setValue] = useState('');
  const [newEpoch, setNewEpoch] = useState(false);
  const action = useAction();
  const [result, setResult] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setResult(null);
    const iso = localInputToIso(capturedAt);
    const r = await action.run(() => post('/meter-readings', { capturedAt: iso, value: Number(value), newEpoch }).catch((err) => { if (err.body?.summary) return err.body; throw err; }));
    if (r) { setResult(r); onDone(); }
  };
  return (
    <Section title="Enter a meter reading">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <Field label="Read at"><input type="datetime-local" required value={capturedAt} onChange={(e) => setCapturedAt(e.target.value)} /></Field>
        <Field label="Cumulative import, kWh"><input type="number" step="0.1" min="0" required value={value} onChange={(e) => setValue(e.target.value)} className="num w-40" /></Field>
        <label className="flex items-center gap-2 pb-2"><input type="checkbox" checked={newEpoch} onChange={(e) => setNewEpoch(e.target.checked)} /> Meter was replaced or reset</label>
        <Button type="submit" disabled={action.pending}>Save reading</Button>
      </form>
      <div className="mt-3 space-y-2">
        <ActionFeedback action={action} />
        {result && (
          <Notice tone={result.summary.accepted ? 'good' : 'warn'}>
            {result.summary.accepted ? 'Reading accepted.' : result.summary.needsReview ? `Saved for review, not used in charts: ${result.needsReview[0].reason}.` : result.summary.duplicates ? 'This reading is already recorded.' : `Not saved: ${result.invalid[0]?.reason}.`}
          </Notice>
        )}
      </div>
    </Section>
  );
}

function Review({ readings, canReview, reload }) {
  const action = useAction();
  const [corrections, setCorrections] = useState({});
  const act = async (id, body, text) => { await action.run(() => post(`/meter-readings/${id}/review`, body), text); reload(); };
  if (!readings.length) return null;
  return (
    <Section title="Readings needing review">
      <p className="mb-3 text-[0.9rem] text-muted">These readings failed a check and are not used in any chart or anomaly until someone decides.</p>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Read at</th><th>Value</th><th>Source</th><th>Why it was held</th>{canReview && <th>Decision</th>}</tr></thead>
          <tbody>
            {readings.map((r) => (
              <tr key={r.id}>
                <td className="num whitespace-nowrap">{fmtTime(r.capturedAt)}</td>
                <td className="num">{fmtNum(r.value, 1)} kWh{r.rawText && <span className="block text-[0.8rem] text-muted">OCR text: {r.rawText}</span>}</td>
                <td>{r.sourceType.replace('_', ' ')} {r.dataMode !== 'live' && <SourceLabel label="Simulated" />}</td>
                <td>{r.validationReason}</td>
                {canReview && (
                  <td>
                    <div className="flex flex-wrap items-center gap-2">
                      <input aria-label="Corrected value" type="number" step="0.1" placeholder="Correct value" value={corrections[r.id] ?? ''} onChange={(e) => setCorrections((c) => ({ ...c, [r.id]: e.target.value }))} className="num w-32" />
                      <Button kind="secondary" disabled={action.pending || !corrections[r.id]} onClick={() => act(r.id, { action: 'correct', correctedValue: Number(corrections[r.id]) }, 'Reading corrected')}>Save correction</Button>
                      <Button kind="secondary" disabled={action.pending} onClick={() => act(r.id, { action: 'new_epoch' }, 'New meter epoch started')}>Meter was replaced</Button>
                      <Button kind="danger" disabled={action.pending} onClick={() => act(r.id, { action: 'reject' }, 'Reading rejected')}>Reject</Button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2"><ActionFeedback action={action} /></div>
    </Section>
  );
}

export default function Energy() {
  const { user } = useSession();
  const [days, setDays] = useState('2');
  const from = new Date(Date.now() - Number(days) * 86_400_000).toISOString();
  const intervals = useData(`/analytics/intervals?from=${encodeURIComponent(from.slice(0, 13) + ':00:00Z')}`, { live: ['energy.updated'] });
  const anomalies = useData('/analytics/anomalies', { live: ['energy.updated', 'incident.updated'] });
  const review = useData('/meter-readings?validation=needs_review', { live: ['energy.updated'] });
  const reloadAll = () => { intervals.reload(); anomalies.reload(); review.reload(); };
  const canEnter = ['admin', 'hod', 'first_responder'].includes(user.role);

  return (
    <>
      <PageHeader title="Energy" lead="Building meter consumption against what comparable past intervals suggest. An anomaly is a prompt to look, not proof of a fault.">
        <select aria-label="Period" value={days} onChange={(e) => setDays(e.target.value)}>
          {RANGES.map(([v, l]) => <option key={v} value={v}>Last {l}</option>)}
        </select>
      </PageHeader>
      <div className="space-y-5">
        <Section title="Consumption per interval">
          <Loading state={intervals}>
            {(d) => {
              const total = d.intervals.reduce((s, i) => s + i.energyKwh, 0);
              const hours = d.intervals.reduce((s, i) => s + i.durationHours, 0);
              const gaps = d.intervals.filter((i) => i.isGap);
              const sim = d.intervals.some((i) => i.dataMode !== 'live');
              return (
                <>
                  <EnergyChart intervals={d.intervals} height={320} />
                  <p className="num mt-3 text-[0.9rem]">
                    {fmtNum(total, 1)} kWh over {fmtNum(hours, 1)} hours of data {d.intervals.length > 0 && <SourceLabel label={sim ? 'Simulated' : 'Metered'} />}
                    {gaps.length > 0 && `. ${gaps.length} gap${gaps.length > 1 ? 's' : ''} where readings were missing; each is one total, not hourly values`}.
                  </p>
                  <p className="text-[0.82rem] text-muted">{d.note} Weather is not considered in the expected range.</p>
                </>
              );
            }}
          </Loading>
        </Section>

        <Section title="Anomalies">
          <Loading state={anomalies}>
            {(d) =>
              d.anomalies.length === 0 ? (
                <Empty>No anomaly has been raised. One appears when an interval exceeds its expected range.</Empty>
              ) : (
                <div className="overflow-x-auto">
                  <table>
                    <thead><tr><th>Interval</th><th>Recorded</th><th>Expected</th><th>Above by</th><th>Possible contributors</th><th>Status</th></tr></thead>
                    <tbody>
                      {d.anomalies.map((a) => (
                        <tr key={a.incidentId}>
                          <td className="num whitespace-nowrap"><Link to={`/incidents/${a.incidentId}`} className="text-teal underline">{fmtTime(a.startAt)}</Link>{a.dataMode !== 'live' && <span className="block"><SourceLabel label="Simulated" /></span>}</td>
                          <td className="num">{fmtNum(a.actualKwh, 1)} kWh</td>
                          <td className="num">{fmtNum(a.expectedKwh, 1)} kWh<span className="block text-[0.8rem] text-muted">{a.baselineMethod === 'historical' ? `${a.sampleCount} comparable intervals` : 'initial rule baseline'}</span></td>
                          <td className="num font-semibold text-red">{fmtNum(a.excessKwh, 1)} kWh</td>
                          <td>{a.possibleContributors?.length ? <>{a.possibleContributors.map((c) => c.roomCode).join(', ')}<span className="block text-[0.8rem] text-muted">Unconfirmed; not a room measurement</span></> : <span className="text-muted">None found. Manual inspection requested.</span>}{a.confirmedCause && <span className="block text-[0.85rem]">Confirmed: {a.confirmedCause}</span>}</td>
                          <td><IncidentState state={a.state} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
          </Loading>
        </Section>

        <Loading state={review}>{(d) => <Review readings={d.readings} canReview={user.role === 'admin'} reload={reloadAll} />}</Loading>
        {canEnter && <ManualReading onDone={reloadAll} />}
        {user.role === 'admin' && <ImportCsv onDone={reloadAll} />}
      </div>
    </>
  );
}
