import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSession } from '../App.jsx';
import { ActionFeedback, Button, Countdown, Empty, Field, IncidentState, Loading, Notice, OccupancyState, PageHeader, Pill, Section, SourceLabel, SupplyState, fmtNum, fmtTime } from '../components/ui.jsx';
import { post, useAction, useData } from '../services/api.js';

const LIVE = ['room.updated', 'incident.updated', 'command.updated', 'schedules.updated'];
const CONTROL_MODE = { alert_only: 'Alert only', simulated: 'Simulated control', physical: 'Physical control' };

function AuthorisedUse({ room }) {
  if (room.lease) return <Pill tone="info">QR access until {fmtTime(room.lease.expiresAt, { date: false }).slice(0, 5)}</Pill>;
  if (room.protected) return <Pill tone="info">Booked or overridden</Pill>;
  return <span className="text-muted">None right now</span>;
}

// Laid out like a distribution-board circuit schedule: one row per room master,
// with the four facts the system keeps separate in fixed columns.
export function Rooms() {
  const rooms = useData('/rooms', { live: LIVE });
  return (
    <>
      <PageHeader title="Rooms" lead="One row per room master. Occupancy is what a camera or sensor saw; authorised use comes from the timetable, QR access or a staff override; supply is what the room master reports." />
      <Loading state={rooms}>
        {(d) =>
          d.rooms.length === 0 ? (
            <Empty>No rooms are assigned to you. Ask an administrator to add you to a room.</Empty>
          ) : (
            <div className="overflow-x-auto rounded-[4px] border border-rule bg-plate">
              <table>
                <thead>
                  <tr>
                    <th>Room</th>
                    <th>Room master</th>
                    <th>Observed occupancy</th>
                    <th>Authorised use</th>
                    <th>Reported supply</th>
                    <th>Open issue</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rooms.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link to={`/rooms/${r.id}`} className="font-bold text-teal underline">{r.code}</Link>
                        <span className="block text-[0.85rem] text-muted">{r.name}</span>
                      </td>
                      <td className="num">
                        {r.breaker?.code ?? '—'}
                        <span className="block text-[0.8rem] text-muted">{CONTROL_MODE[r.controlMode]}</span>
                      </td>
                      <td>
                        <OccupancyState occupancy={r.occupancy} />
                        <span className="mt-1 block"><SourceLabel label={r.occupancy.sourceLabel} /></span>
                      </td>
                      <td><AuthorisedUse room={r} /></td>
                      <td>
                        <SupplyState breaker={r.breaker} />
                        {r.breaker && <span className="mt-1 block"><SourceLabel label={r.breaker.sourceLabel} /></span>}
                      </td>
                      <td>{r.incident ? <Link to={`/incidents/${r.incident.id}`}><IncidentState state={r.incident.state} /></Link> : <span className="text-muted">None</span>}</td>
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

function Fact({ title, children }) {
  return (
    <div className="border-t-4 border-ink pt-2">
      <h3 className="text-[0.85rem] font-semibold text-muted">{title}</h3>
      <div className="mt-1.5 space-y-1.5">{children}</div>
    </div>
  );
}

function SupplyControl({ status, reload }) {
  const action = useAction();
  const { server } = useSession();
  const [result, setResult] = useState(null);
  const send = async (target) => {
    setResult(null);
    const r = await action.run(() => post(`/rooms/${status.room.id}/supply-commands`, { action: target, incidentId: status.incident?.type === 'vacancy_waste' ? status.incident.id : undefined }).catch((e) => {
      if (e.body?.command) return e.body;
      throw e;
    }));
    if (r?.command) setResult(r.command);
    reload();
  };
  const blocks = status.breaker?.supplyState === 'on' ? status.control.offBlocks : status.control.onBlocks;
  const target = status.breaker?.supplyState === 'on' ? 'off' : 'on';
  return (
    <Section title="Room supply">
      <p className="max-w-[65ch] text-[0.9rem] text-muted">
        One control for the whole room: {status.breaker?.code ?? 'no master mapped'} feeds every load listed below. Lights, fans and the AC cannot be switched separately from here; wall switches still work while the supply is on.
      </p>
      {blocks.length > 0 ? (
        <Notice tone="warn">
          <strong>Switching {target} is blocked:</strong>
          <ul className="mt-1 list-disc pl-5">{blocks.map((b) => <li key={b}>{b}</li>)}</ul>
        </Notice>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button kind={target === 'off' ? 'danger' : 'primary'} disabled={action.pending} onClick={() => send(target)}>
            Switch room supply {target}
          </Button>
          {server?.demoMode && <span className="text-[0.85rem] text-muted">Simulated: no physical supply changes.</span>}
        </div>
      )}
      <div className="mt-3 space-y-2">
        <ActionFeedback action={action} />
        {result && (
          <Notice tone={result.status === 'completed' ? (result.verification === 'command_only' ? 'warn' : 'good') : 'bad'}>
            {result.status === 'completed' ? (
              <>Command {result.action.toUpperCase()} sent. Result: {result.reportedOutput ? `room master reports ${result.reportedOutput}` : 'no confirmation received'} <SourceLabel label={result.dataMode === 'simulated' ? 'Simulated' : 'Sensor-reported'} /> (verification: {result.verification.replace('_', ' ')}).</>
            ) : (
              <>Command was not sent ({result.status}). {result.rejectReasons?.join('; ')}</>
            )}
          </Notice>
        )}
      </div>
    </Section>
  );
}

function Override({ status, reload }) {
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState(60);
  const action = useAction();
  const active = status.protection.reasons.find((r) => r.kind === 'override');
  return (
    <Section title="Staff override">
      {active ? (
        <div className="flex flex-wrap items-center gap-3">
          <p>{active.text}, until <span className="num">{fmtTime(active.until)}</span></p>
          <Button kind="secondary" disabled={action.pending} onClick={async () => { await action.run(() => post(`/overrides/${active.id}/end`)); reload(); }}>End override</Button>
        </div>
      ) : (
        <form className="flex flex-wrap items-end gap-3" onSubmit={async (e) => { e.preventDefault(); if (await action.run(() => post(`/rooms/${status.room.id}/overrides`, { reason, durationMinutes: Number(minutes) }), 'Override started')) { setReason(''); reload(); } }}>
          <Field label="Reason" hint="Keeps the supply on while the room is in authorised use."><input required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} className="w-64" /></Field>
          <Field label="Minutes"><input type="number" min="1" max="480" value={minutes} onChange={(e) => setMinutes(e.target.value)} className="w-24" /></Field>
          <Button type="submit" kind="secondary" disabled={action.pending}>Start override</Button>
        </form>
      )}
      <div className="mt-2"><ActionFeedback action={action} /></div>
    </Section>
  );
}

function Inventory({ status, reload, canConfirm }) {
  const action = useAction();
  const total = status.devices.reduce((s, d) => s + d.ratedWatts * (d.quantity ?? 1), 0);
  return (
    <Section title="Loads behind this room master" aside={<span className="num text-[0.85rem] text-muted">Rated total {fmtNum(total / 1000, 2)} kW <SourceLabel label="Estimated" /></span>}>
      {status.devices.length === 0 ? (
        <Empty>No loads are recorded. An administrator adds the inventory in Admin.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead><tr><th>Load</th><th>Rated</th><th>Shared cutoff</th><th>Notes</th></tr></thead>
            <tbody>
              {status.devices.map((d) => {
                const blocked = status.sharedCutoffBlocks.find((b) => b.startsWith(`${d.name}:`));
                return (
                  <tr key={d.id}>
                    <td>{d.name}<span className="block text-[0.8rem] text-muted">{d.category}{d.quantity > 1 ? ` × ${d.quantity}` : ''}</span></td>
                    <td className="num">{fmtNum(d.ratedWatts * (d.quantity ?? 1), 0)} W</td>
                    <td>
                      {blocked ? <Pill tone="bad">Blocks the room cutoff</Pill> : <Pill tone="good">Approved</Pill>}
                      {blocked && <span className="mt-1 block text-[0.82rem]">{blocked.split(': ')[1]}</span>}
                      {d.requiresNormalStopBeforeCutoff && canConfirm && (
                        <Button kind="secondary" className="mt-2" disabled={action.pending} onClick={async () => { await action.run(() => post(`/devices/${d.id}/confirm-stop`), `Stop confirmed for ${d.name}`); reload(); }}>
                          I stopped it with its own controls
                        </Button>
                      )}
                      {d.stopProcedureConfirmedAt && <span className="num mt-1 block text-[0.8rem] text-muted">Stop confirmed {fmtTime(d.stopProcedureConfirmedAt)}</span>}
                    </td>
                    <td className="text-[0.85rem] text-muted">{d.approvalNotes || '—'}{d.restartDelaySeconds > 0 && ` Restart delay ${d.restartDelaySeconds} s.`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-[0.82rem] text-muted">Rated watts are nameplate estimates used for savings calculations. They are not measured room consumption.</p>
      <div className="mt-2"><ActionFeedback action={action} /></div>
    </Section>
  );
}

function DemoObservations({ room, reload }) {
  const action = useAction();
  const send = (body, text) => action.run(() => post('/demo/observations', { roomCode: room.code, ...body }), text).then(reload);
  if (room.occupancySource === 'none') return null;
  return (
    <Section title="Simulate an observation">
      <p className="mb-3 text-[0.9rem] text-muted">Demo only. Sends one simulated camera or sensor report for this room.</p>
      <div className="flex flex-wrap gap-2">
        <Button kind="secondary" disabled={action.pending} onClick={() => send({ occupancy: 'occupied', equipmentOn: true }, 'Sent: person present')}>Person present</Button>
        <Button kind="secondary" disabled={action.pending} onClick={() => send({ occupancy: 'vacant', equipmentOn: true }, 'Sent: nobody seen, lights on')}>Nobody seen, lights on</Button>
        <Button kind="secondary" disabled={action.pending} onClick={() => send({ occupancy: 'unknown', usable: false }, 'Sent: camera offline')}>Camera offline</Button>
      </div>
      <div className="mt-2"><ActionFeedback action={action} /></div>
    </Section>
  );
}

export function RoomDetail() {
  const { id } = useParams();
  const { user, server } = useSession();
  const status = useData(`/rooms/${id}/status`, { live: LIVE, pollMs: 5000 });
  const commands = useData(`/rooms/${id}/commands`, { live: ['command.updated'] });
  const canControl = ['admin', 'hod', 'first_responder'].includes(user.role);
  const canOverride = canControl || user.role === 'teacher';

  return (
    <Loading state={status}>
      {(s) => (
        <>
          <PageHeader title={`${s.room.code}: ${s.room.name}`} lead={s.room.coverageNotes}>
            <Link to="/rooms" className="text-teal underline">All rooms</Link>
          </PageHeader>
          <div className="space-y-5">
            {s.incident && (
              <Notice tone={s.incident.state === 'blocked' || s.incident.state === 'escalated' ? 'bad' : 'warn'}>
                <Link to={`/incidents/${s.incident.id}`} className="font-semibold underline">{s.incident.title}</Link> <IncidentState state={s.incident.state} />
                {s.incident.finalDueAt && !['blocked', 'snoozed'].includes(s.incident.state) && <> Final recheck in <Countdown dueAt={s.incident.finalDueAt} serverTime={s.serverTime} />.</>}
                {s.incident.blockReason && <span className="block">{s.incident.blockReason}</span>}
              </Notice>
            )}

            <Section>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                <Fact title="Observed occupancy">
                  <OccupancyState occupancy={s.occupancy} />
                  <p><SourceLabel label={s.occupancy.sourceLabel} /></p>
                  <p className="num text-[0.82rem] text-muted">
                    {s.room.occupancySource === 'none' ? 'This room has no camera or sensor.' : s.occupancy.lastObservationAt ? `Last report ${fmtTime(s.occupancy.lastObservationAt, { date: false })}` : 'No report received.'}
                  </p>
                  {s.room.occupancySource !== 'none' && !s.room.coverageValidated && <p className="text-[0.82rem] text-red">Coverage is not validated, so an empty view is not treated as vacancy.</p>}
                </Fact>
                <Fact title="Authorised use">
                  {s.protection.protected ? s.protection.reasons.map((r) => <p key={r.id}><Pill tone="info">{r.text}</Pill></p>) : <p className="text-muted">None right now</p>}
                  <p className="num text-[0.82rem] text-muted">{s.nextSchedule ? `Next: ${s.nextSchedule.title}, ${fmtTime(s.nextSchedule.startAt)}` : 'No upcoming booking.'}</p>
                  {s.lease && <p className="num text-[0.82rem]">QR access ends in <Countdown dueAt={s.lease.expiresAt} serverTime={s.serverTime} /></p>}
                </Fact>
                <Fact title="Reported supply">
                  <SupplyState breaker={s.breaker} />
                  {s.breaker && (
                    <>
                      <p><SourceLabel label={s.breaker.sourceLabel} /></p>
                      <p className="text-[0.82rem] text-muted">
                        {s.breaker.code}. {s.breaker.offReason === 'automation' ? 'Switched off by automation; restored when a person is detected.' : s.breaker.offReason === 'manual' ? 'Switched off by a person; not restored automatically.' : s.breaker.offReason === 'fixed_duration_expiry' ? 'Switched off when QR access ended.' : ''}
                      </p>
                    </>
                  )}
                </Fact>
                <Fact title="Appliance evidence">
                  <p>{s.applianceEvidence.equipmentOn === true ? 'Equipment appears on' : s.applianceEvidence.equipmentOn === false ? 'Equipment appears off' : <span className="text-muted">Nothing observed</span>}</p>
                  <p className="text-[0.82rem] text-muted">{s.applianceEvidence.note}.</p>
                </Fact>
              </div>
            </Section>

            {canControl && s.breaker && <SupplyControl status={s} reload={status.reload} />}
            {canOverride && <Override status={s} reload={status.reload} />}
            <Inventory status={s} reload={status.reload} canConfirm={canOverride} />
            {user.role === 'admin' && server?.demoMode && <DemoObservations room={s.room} reload={status.reload} />}

            <Section title="Recent supply commands">
              <Loading state={commands}>
                {(c) =>
                  c.commands.length === 0 ? (
                    <Empty>No command has been sent to this room master.</Empty>
                  ) : (
                    <div className="overflow-x-auto">
                      <table>
                        <thead><tr><th>Time</th><th>Request</th><th>Why</th><th>By</th><th>Outcome</th></tr></thead>
                        <tbody>
                          {c.commands.map((cmd) => (
                            <tr key={cmd.requestId}>
                              <td className="num whitespace-nowrap">{fmtTime(cmd.issuedAt)}</td>
                              <td className="font-semibold">{cmd.action.toUpperCase()}</td>
                              <td>{cmd.reason.replaceAll('_', ' ')}</td>
                              <td>{cmd.actor}</td>
                              <td>
                                {cmd.status === 'completed' ? (
                                  <>{cmd.reportedOutput ? `Reports ${cmd.reportedOutput}` : 'Sent, not confirmed'} <SourceLabel label={cmd.dataMode === 'simulated' ? 'Simulated' : 'Sensor-reported'} /><span className="block text-[0.8rem] text-muted">Verification: {cmd.verification.replaceAll('_', ' ')}</span></>
                                ) : (
                                  <><Pill tone="bad">{cmd.status}</Pill><span className="block text-[0.8rem] text-muted">{cmd.rejectReasons?.join('; ')}</span></>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                }
              </Loading>
            </Section>
          </div>
        </>
      )}
    </Loading>
  );
}
