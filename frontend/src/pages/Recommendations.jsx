import { useState } from 'react';
import { useSession } from '../App.jsx';
import { ActionFeedback, Button, Empty, Loading, PageHeader, Pill, Section, SourceLabel, fmtNum, fmtRupees, fmtTime } from '../components/ui.jsx';
import { post, useAction, useData } from '../services/api.js';

const STATUS = { proposed: ['Proposed', 'warn'], accepted: ['Accepted, in progress', 'info'], rejected: ['Rejected', 'neutral'], completed: ['Completed, not yet compared', 'info'], verified: ['Completed and compared', 'good'] };
const PRIORITY = { high: 'High priority', medium: 'Medium priority', low: 'Low priority' };
const OWNER = { admin: 'Administrator', hod: 'HOD', first_responder: 'Facilities' };

function Card({ rec, canAct, reload }) {
  const action = useAction();
  const [text, setText] = useState('');
  const act = async (name, body, done) => { await action.run(() => post(`/recommendations/${rec.id}/${name}`, body), done); setText(''); reload(); };
  const [label, tone] = STATUS[rec.status];
  const e = rec.estimate ?? {};
  return (
    <article className="rounded-[4px] border border-rule bg-plate">
      <header className="border-b border-rule px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={tone}>{label}</Pill>
          <span className="text-[0.85rem] text-muted">{PRIORITY[rec.priority]}, owner: {OWNER[rec.ownerRole] ?? 'unassigned'}</span>
          {rec.dataMode !== 'live' && <SourceLabel label="Simulated" />}
        </div>
        <h2 className="mt-1.5 text-[1.1rem]">{rec.title}</h2>
      </header>
      <div className="grid gap-5 p-4 md:grid-cols-[3fr_2fr]">
        <div className="space-y-3">
          <p>{rec.explanation}</p>
          <p><strong>Do this: </strong>{rec.action}</p>
          <ul className="space-y-1 text-[0.9rem]">
            {rec.evidence.map((x, i) => <li key={i} className="flex gap-2"><span className="shrink-0"><SourceLabel label={x.source} /></span>{x.text}</li>)}
          </ul>
          {rec.limitations?.length > 0 && (
            <details className="text-[0.88rem] text-muted">
              <summary className="cursor-pointer font-semibold">Limits of this estimate</summary>
              <ul className="mt-1 list-disc pl-5">{[...rec.limitations, ...(e.assumptions ?? [])].map((l, i) => <li key={i}>{l}</li>)}</ul>
            </details>
          )}
        </div>
        <div className="border-l-4 border-teal pl-3">
          <p className="text-[0.85rem] font-semibold text-muted">Possible saving per month <SourceLabel label="Estimated" /></p>
          <p className="num text-[1.5rem] font-bold leading-tight" style={{ fontStretch: '85%' }}>{fmtRupees(e.costLow)}–{fmtRupees(e.costHigh).slice(1)}</p>
          <p className="num text-[0.9rem]">{fmtNum(e.kwhLow, 1)}–{fmtNum(e.kwhHigh, 1)} kWh</p>
          <p className="mt-1 text-[0.82rem] text-muted">{e.method}</p>
          <p className="mt-2 text-[0.85rem]">
            {rec.implementationCost ? <>Installed cost entered: {fmtRupees(rec.implementationCost)}. {rec.paybackMonths ? `Simple payback about ${fmtNum(rec.paybackMonths, 1)} months.` : 'No payback shown: the net benefit is not positive.'}</> : <span className="text-muted">No installation quote entered, so no payback is shown.</span>}
          </p>
        </div>
      </div>
      {rec.outcome?.label && (
        <div className="border-t border-rule bg-panel px-4 py-3 text-[0.9rem]">
          <strong>Outcome: </strong>{rec.outcome.note && `${rec.outcome.note}. `}{rec.outcome.label}
          {rec.outcome.observedReductionKwhPerDay != null && (
            <p className="num mt-1">Before: {fmtNum(rec.outcome.baselineKwhPerDay, 1)} kWh per teaching day. After: {fmtNum(rec.outcome.observedKwhPerDay, 1)} kWh ({rec.outcome.comparisonDays} day{rec.outcome.comparisonDays > 1 ? 's' : ''}). Observed difference: {fmtNum(rec.outcome.observedReductionKwhPerDay, 1)} kWh per day.</p>
          )}
        </div>
      )}
      {rec.status === 'rejected' && <p className="border-t border-rule px-4 py-3 text-[0.9rem]"><strong>Rejected: </strong>{rec.rejectReason}</p>}
      {canAct && ['proposed', 'accepted', 'completed'].includes(rec.status) && (
        <footer className="space-y-2 border-t border-rule px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {rec.status !== 'completed' && <input aria-label={rec.status === 'proposed' ? 'Reason if rejecting' : 'What was done'} placeholder={rec.status === 'proposed' ? 'Reason, if rejecting' : 'What was done'} value={text} onChange={(ev) => setText(ev.target.value)} className="w-64" />}
            {rec.status === 'proposed' && <Button disabled={action.pending} onClick={() => act('accept', {}, 'Accepted')}>Accept</Button>}
            {rec.status === 'accepted' && <Button disabled={action.pending} onClick={() => act('complete', { note: text || undefined }, 'Marked as completed')}>Mark as completed</Button>}
            {rec.status === 'completed' && <Button disabled={action.pending} onClick={() => act('verify', {}, 'Comparison updated')}>Compare before and after</Button>}
            {rec.status !== 'completed' && <Button kind="danger" disabled={action.pending || !text.trim()} onClick={() => act('reject', { reason: text }, 'Rejected')}>Reject</Button>}
          </div>
          <ActionFeedback action={action} />
        </footer>
      )}
      {rec.history?.length > 0 && <p className="num border-t border-rule px-4 py-2 text-[0.8rem] text-muted">{rec.history.map((h) => `${h.action} ${fmtTime(h.at)}`).join(', ')}</p>}
    </article>
  );
}

export default function Recommendations() {
  const { user } = useSession();
  const list = useData('/recommendations', { live: ['recommendations.updated', 'energy.updated'] });
  const action = useAction();
  const canAct = ['admin', 'hod'].includes(user.role);
  return (
    <>
      <PageHeader title="Recommendations" lead="Suggested changes for people to review. Nothing here alters a timetable, a temperature or a supply by itself.">
        {canAct && <Button kind="secondary" disabled={action.pending} onClick={async () => { await action.run(() => post('/recommendations/refresh'), 'Recommendations refreshed'); list.reload(); }}>Refresh from latest data</Button>}
      </PageHeader>
      <div className="space-y-4">
        <ActionFeedback action={action} />
        <Loading state={list}>
          {(d) => (
            <>
              <Section>
                <p className="num">
                  Open recommendations together: <strong>{fmtRupees(d.potentialSavings.costLow)}–{fmtRupees(d.potentialSavings.costHigh).slice(1)}</strong> per month ({fmtNum(d.potentialSavings.kwhLow, 0)}–{fmtNum(d.potentialSavings.kwhHigh, 0)} kWh) <SourceLabel label="Estimated" />
                </p>
                <p className="mt-1 text-[0.85rem] text-muted">{d.potentialSavings.note}. These are estimates from rated loads and meter history, not verified savings.</p>
              </Section>
              {d.recommendations.length === 0 ? <Empty>No recommendation yet. They are generated from at least a week of meter history, the timetable and incident history.</Empty> : d.recommendations.map((r) => <Card key={r.id} rec={r} canAct={canAct} reload={list.reload} />)}
            </>
          )}
        </Loading>
      </div>
    </>
  );
}
