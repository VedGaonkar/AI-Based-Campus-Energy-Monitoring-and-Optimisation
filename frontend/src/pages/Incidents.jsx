import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSession } from '../App.jsx';
import { ActionFeedback, Button, Countdown, Empty, Field, IncidentState, Loading, Notice, PageHeader, Pill, Section, SourceLabel, fmtNum, fmtTime } from '../components/ui.jsx';
import { post, useAction, useData } from '../services/api.js';

const TYPE = { vacancy_waste: 'Empty room, supply on', energy_anomaly: 'Building energy anomaly', lease_expiry: 'Access ended, room unconfirmed', data_quality: 'Data quality' };
const METHODS = [
  ['manual_switch_off', 'Switched off by hand'],
  ['authorised_use', 'Room was in authorised use'],
  ['false_alarm', 'False alarm'],
  ['cause_confirmed', 'Cause found and confirmed'],
  ['inspected_no_cause', 'Inspected, no cause found'],
  ['other', 'Other'],
];

export function Incidents() {
  const [filter, setFilter] = useState({ active: 'true', type: '', assigned: '' });
  const query = new URLSearchParams(Object.entries(filter).filter(([, v]) => v)).toString();
  const list = useData(`/incidents?${query}`, { live: ['incident.updated'] });
  const set = (k) => (e) => setFilter((f) => ({ ...f, [k]: e.target.value }));
  return (
    <>
      <PageHeader title="Incidents" lead="Each incident is one episode with its own timeline. Acknowledging shows someone is looking; only a recorded outcome closes it.">
        <select aria-label="Status" value={filter.active} onChange={set('active')}>
          <option value="true">Open</option>
          <option value="false">Closed</option>
          <option value="">Open and closed</option>
        </select>
        <select aria-label="Type" value={filter.type} onChange={set('type')}>
          <option value="">All types</option>
          {Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select aria-label="Assignment" value={filter.assigned} onChange={set('assigned')}>
          <option value="">Everyone's</option>
          <option value="me">Assigned to me</option>
        </select>
      </PageHeader>
      <Loading state={list}>
        {(d) =>
          d.incidents.length === 0 ? (
            <Empty>No incidents match these filters.</Empty>
          ) : (
            <div className="overflow-x-auto rounded-[4px] border border-rule bg-plate">
              <table>
                <thead><tr><th>Where</th><th>Issue</th><th>Status</th><th>Opened</th><th>Next automatic step</th></tr></thead>
                <tbody>
                  {d.incidents.map((i) => (
                    <tr key={i.id}>
                      <td className="font-bold whitespace-nowrap">{i.roomCode ?? i.meterId ?? 'Building'}</td>
                      <td>
                        <Link to={`/incidents/${i.id}`} className="font-semibold text-teal underline">{i.title}</Link>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[0.82rem] text-muted">{TYPE[i.type]}{i.episode > 1 && `, episode ${i.episode}`}{i.dataMode !== 'live' && <SourceLabel label="Simulated" />}</span>
                      </td>
                      <td><IncidentState state={i.state} /></td>
                      <td className="num whitespace-nowrap">{fmtTime(i.openedAt)}</td>
                      <td className="num">
                        {!i.active ? '—' : i.state === 'snoozed' ? <>Resumes in <Countdown dueAt={i.snoozedUntil} serverTime={d.serverTime} /></> : i.state === 'notified_first' && i.escalateDueAt ? <>Escalates in <Countdown dueAt={i.escalateDueAt} serverTime={d.serverTime} /></> : i.state === 'escalated' && i.finalDueAt ? <>Final recheck in <Countdown dueAt={i.finalDueAt} serverTime={d.serverTime} /></> : <span className="text-muted">None: needs a person</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loading>
    </>
  );
}

function Actions({ incident, reload }) {
  const action = useAction();
  const [minutes, setMinutes] = useState(15);
  const [method, setMethod] = useState('manual_switch_off');
  const [note, setNote] = useState('');
  const [cause, setCause] = useState('');
  const act = async (path, body, text) => { await action.run(() => post(`/incidents/${incident.id}/${path}`, body), text); reload(); };
  const canSnooze = incident.type === 'vacancy_waste' && ['open', 'notified_first', 'escalated', 'inspecting'].includes(incident.state);
  return (
    <Section title="Record what you did">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          {!incident.acknowledgedAt && <Button kind="secondary" disabled={action.pending} onClick={() => act('acknowledge', {}, 'Acknowledged. The incident stays open until you record an outcome.')}>Acknowledge and inspect</Button>}
          {canSnooze && (
            <>
              <Field label="Snooze, minutes"><input type="number" min="1" value={minutes} onChange={(e) => setMinutes(e.target.value)} className="w-24" /></Field>
              <Button kind="secondary" disabled={action.pending} onClick={() => act('snooze', { minutes: Number(minutes) }, 'Snoozed. Evidence is rechecked when the snooze ends.')}>Snooze</Button>
            </>
          )}
        </div>
        <form className="grid gap-3 border-t border-rule pt-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); act('resolve', { method, note: note || undefined, confirmedCause: cause || undefined }, 'Resolved'); }}>
          <Field label="Outcome">
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full">{METHODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </Field>
          <Field label="Confirmed cause" hint="Leave empty unless you verified it on site."><input value={cause} onChange={(e) => setCause(e.target.value)} className="w-full" /></Field>
          <Field label="Note"><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className="w-full" /></Field>
          <div className="self-end"><Button type="submit" disabled={action.pending}>Resolve incident</Button></div>
        </form>
        <ActionFeedback action={action} />
      </div>
    </Section>
  );
}

export function IncidentDetail() {
  const { id } = useParams();
  const { user } = useSession();
  const detail = useData(`/incidents/${id}`, { live: ['incident.updated', 'command.updated'], pollMs: 5000 });
  const canAct = ['admin', 'hod', 'first_responder'].includes(user.role);
  return (
    <Loading state={detail}>
      {({ incident: i, commands, jobs, notifications, serverTime }) => (
        <>
          <PageHeader title={i.title}>
            <Link to="/incidents" className="text-teal underline">All incidents</Link>
          </PageHeader>
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <IncidentState state={i.state} />
              <Pill>{TYPE[i.type]}</Pill>
              {i.dataMode !== 'live' && <SourceLabel label="Simulated" />}
              {i.roomId && <Link to={`/rooms/${i.roomId}`} className="text-teal underline">Open {i.roomCode}</Link>}
            </div>
            {i.blockReason && i.active && <Notice tone="bad"><strong>No automatic action will happen.</strong> {i.blockReason}</Notice>}
            {i.state === 'action_unverified' && <Notice tone="bad">An OFF command was sent but nothing confirmed it. Do not assume the room is off: check on site and record the outcome.</Notice>}

            <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
              <Section title="Evidence">
                <ul className="space-y-2">
                  {i.evidence.map((e, n) => (
                    <li key={n} className="flex gap-2">
                      <span className="shrink-0"><SourceLabel label={e.label} /></span>
                      <span>{e.text}{e.source && <span className="text-muted"> ({e.source})</span>}</span>
                    </li>
                  ))}
                </ul>
                <dl className="mt-4 grid gap-x-4 gap-y-1 border-t border-rule pt-3 text-[0.9rem] sm:grid-cols-[10rem_1fr]">
                  <dt className="font-semibold">Suspected cause</dt><dd>{i.suspectedCause ?? <span className="text-muted">None suggested</span>}</dd>
                  <dt className="font-semibold">Confirmed cause</dt><dd>{i.confirmedCause ?? <span className="text-muted">Not confirmed</span>}</dd>
                  {i.resolution && (<><dt className="font-semibold">Outcome</dt><dd>{i.resolution.method.replaceAll('_', ' ')}{i.resolution.verification && `, verification: ${i.resolution.verification.replaceAll('_', ' ')}`}{i.resolution.note && `. ${i.resolution.note}`}</dd></>)}
                </dl>
                {i.anomaly && (
                  <div className="mt-4 border-t border-rule pt-3 text-[0.9rem]">
                    <p className="num">
                      {fmtTime(i.anomaly.startAt)} to {fmtTime(i.anomaly.endAt, { date: false }).slice(0, 5)}: {fmtNum(i.anomaly.actualKwh, 2)} kWh recorded, {fmtNum(i.anomaly.expectedKwh, 1)} kWh expected, {fmtNum(i.anomaly.excessKwh, 1)} kWh above.
                    </p>
                    <p className="mt-1 text-muted">
                      {i.anomaly.possibleContributors.length ? 'The rooms listed are possible contributors only. One building meter cannot show which room used the energy, and areas without cameras were not observed.' : 'No cause is established. Inspect the relevant areas, including those without cameras or sensors.'}
                    </p>
                  </div>
                )}
              </Section>

              <Section title="Who and when">
                <dl className="grid grid-cols-[9rem_1fr] gap-y-1 text-[0.9rem]">
                  <dt className="font-semibold">First responder</dt><dd>{i.assignmentNames.firstResponderId ?? '—'}</dd>
                  <dt className="font-semibold">Backup</dt><dd>{i.assignmentNames.backupResponderId ?? '—'}</dd>
                  <dt className="font-semibold">HOD / second</dt><dd>{i.assignmentNames.secondResponderId ?? '—'}</dd>
                  <dt className="font-semibold">Opened</dt><dd className="num">{fmtTime(i.openedAt)}</dd>
                  {i.resolvedAt && (<><dt className="font-semibold">Closed</dt><dd className="num">{fmtTime(i.resolvedAt)}</dd></>)}
                </dl>
                {jobs.some((j) => j.status === 'pending') && (
                  <div className="mt-3 border-t border-rule pt-3">
                    <h3 className="text-[0.85rem] font-semibold text-muted">Scheduled on the server</h3>
                    <ul className="mt-1 space-y-1 text-[0.9rem]">
                      {jobs.filter((j) => j.status === 'pending').map((j, n) => (
                        <li key={n} className="num">{{ notify_first: 'First alert', escalate: 'Escalate to HOD', final_check: 'Final recheck', snooze_expiry: 'Snooze ends' }[j.type] ?? j.type}: in <Countdown dueAt={j.dueAt} serverTime={serverTime} /></li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="mt-3 border-t border-rule pt-3">
                  <h3 className="text-[0.85rem] font-semibold text-muted">Alerts</h3>
                  {notifications.length === 0 ? <p className="text-[0.9rem] text-muted">None sent.</p> : (
                    <ul className="mt-1 space-y-1 text-[0.9rem]">
                      {notifications.map((n, k) => (
                        <li key={k}>{n.recipient ?? 'Nobody assigned'}: {n.deliveryState === 'delivered' ? (n.readAt ? 'delivered, opened' : 'delivered, not opened') : <span className="text-red">failed ({n.failureReason})</span>}</li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-1 text-[0.8rem] text-muted">Opened means the alert was read. It does not show that anything was switched off.</p>
                </div>
              </Section>
            </div>

            {canAct && i.active && <Actions incident={i} reload={detail.reload} />}

            <Section title="Timeline">
              <ol className="space-y-2">
                {i.timeline.map((t, n) => (
                  <li key={n} className="grid grid-cols-[6.5rem_1fr] gap-3 border-l-2 border-teal pl-3">
                    <span className="num text-[0.85rem] text-muted">{fmtTime(t.at, { date: false })}</span>
                    <span>{t.text}{t.actorLabel && t.actorLabel !== 'system' && <span className="text-muted"> ({t.actorLabel})</span>}</span>
                  </li>
                ))}
              </ol>
              {commands.length > 0 && (
                <p className="mt-3 border-t border-rule pt-3 text-[0.9rem]">
                  Commands: {commands.map((c) => `${c.action.toUpperCase()} to ${c.roomBreakerId}, ${c.status}, ${c.verification.replaceAll('_', ' ')} (${c.dataMode})`).join('; ')}
                </p>
              )}
            </Section>
          </div>
        </>
      )}
    </Loading>
  );
}
