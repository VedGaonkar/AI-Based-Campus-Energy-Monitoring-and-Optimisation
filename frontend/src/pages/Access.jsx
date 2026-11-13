import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { SignIn, useSession } from '../App.jsx';
import { ActionFeedback, Button, Countdown, Field, Loading, Notice, SourceLabel, fmtTime } from '../components/ui.jsx';
import { post, useAction, useData } from '../services/api.js';

// Opened from the printed QR. Loading this page never switches anything:
// supply is requested only by the explicit button below, after sign-in.
export default function Access() {
  const { token } = useParams();
  const { user, ready, signOut } = useSession();
  const info = useData(`/access/${token}${user ? '?u=1' : ''}`, { live: ['room.updated'], pollMs: 10000 });
  const [minutes, setMinutes] = useState(60);
  const [accept, setAccept] = useState(false);
  const [command, setCommand] = useState(null);
  const action = useAction();

  const request = async (e) => {
    e.preventDefault();
    const r = await action.run(() => post(`/rooms/${info.data.room.id}/access-leases`, { durationMinutes: Number(minutes), acceptPolicy: accept }), 'Access approved');
    if (r) setCommand(r.command);
    info.reload();
  };
  const extend = async (more) => { await action.run(() => post(`/access-leases/${info.data.lease.id}/extend`, { additionalMinutes: more }), `Extended by ${more} minutes`); info.reload(); };
  const end = async () => { await action.run(() => post(`/access-leases/${info.data.lease.id}/end`), 'Access ended'); setCommand(null); info.reload(); };

  return (
    <main className="mx-auto max-w-md px-4 py-6">
      {info.error && !info.data ? (
        <Notice tone="bad">{info.error.status === 404 ? 'This access code is not recognised. Ask facilities staff for a new QR code.' : info.error.message}</Notice>
      ) : (
        <Loading state={info}>
          {(d) => {
            const myLease = d.lease?.id ? d.lease : null;
            const scaled = d.timeScale > 1;
            return (
              <div className="space-y-4">
                <header>
                  <p className="text-muted">Room access</p>
                  <h1>{d.room.code}: {d.room.name}</h1>
                </header>

                {d.supply.simulationOnly && d.supply.available && <Notice tone="warn"><SourceLabel label="Simulated" /> Only a simulator is connected. Approving access here does not switch any real supply.</Notice>}
                {d.supply.note && <Notice tone="warn">{d.supply.note}.</Notice>}

                {!ready ? null : !user ? (
                  <section className="rounded-[4px] border border-rule bg-plate p-4">
                    <h2 className="mb-3">Sign in to request supply</h2>
                    <SignIn compact />
                  </section>
                ) : myLease ? (
                  <section className="space-y-3 rounded-[4px] border border-rule bg-plate p-4">
                    <h2>Access is active</h2>
                    <p className="num text-[1.6rem] font-bold" style={{ fontStretch: '85%' }}><Countdown dueAt={myLease.expiresAt} /> left</p>
                    <p className="num text-muted">Ends at {fmtTime(myLease.expiresAt)}. You will get an alert {d.policy.warningMinutes} minutes before.</p>
                    {myLease.warningSentAt && <Notice tone="warn">Access is about to end. Extend it if the room is still in use.</Notice>}
                    <div className="flex flex-wrap gap-2">
                      <Button disabled={action.pending} onClick={() => extend(30)}>Extend by 30 minutes</Button>
                      <Button kind="secondary" disabled={action.pending} onClick={end}>End access now</Button>
                    </div>
                    {command && (
                      <p className="text-[0.9rem]">
                        {command.status === 'completed' ? <>Room supply switched on <SourceLabel label={command.dataMode === 'simulated' ? 'Simulated' : 'Sensor-reported'} /></> : <>The supply could not be switched: {command.rejectReasons?.join('; ') || command.status}.</>}
                      </p>
                    )}
                  </section>
                ) : d.lease ? (
                  <Notice tone="info">Someone else already has active access to this room.</Notice>
                ) : !d.viewer?.canRequest ? (
                  <Notice tone="bad">Your account is not authorised to request supply for this room. Ask an administrator to add the room to your account.</Notice>
                ) : (
                  <form onSubmit={request} className="space-y-3 rounded-[4px] border border-rule bg-plate p-4">
                    <h2>Request room supply</h2>
                    <Field label="How long, in minutes" hint={`Up to ${d.policy.maxDurationMinutes} minutes, between ${d.policy.accessHours}.${scaled ? ` Demo clock: 1 minute passes in ${Math.round(60 / d.timeScale)} second${60 / d.timeScale === 1 ? '' : 's'}.` : ''}`}>
                      <input type="number" min="1" max={d.policy.maxDurationMinutes} required value={minutes} onChange={(e) => setMinutes(e.target.value)} className="num w-28" />
                    </Field>
                    <p className="text-[0.9rem] text-muted">{d.policy.text}</p>
                    <label className="flex items-start gap-2"><input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-1" /> <span>I accept that access ends at the stated time unless I extend it.</span></label>
                    <Button type="submit" disabled={!accept || action.pending} className="w-full">Request supply for this room</Button>
                  </form>
                )}

                <ActionFeedback action={action} />
                {user && (
                  <p className="text-[0.85rem] text-muted">
                    Signed in as {user.name}. <button className="text-teal underline" onClick={signOut}>Sign out</button>
                  </p>
                )}
              </div>
            );
          }}
        </Loading>
      )}
    </main>
  );
}
