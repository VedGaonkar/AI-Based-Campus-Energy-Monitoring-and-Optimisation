import Help from "./components/Help.jsx";
import React, { useEffect, useState } from "react";
import { api, post } from "./services/api.js";
import { apiUrl } from "./services/origins.js";
import DemoRoomSetup from "./components/DemoRoomSetup.jsx";

const modeLabel = mode => ({ instrumented: "Instrumented demo vision", camera_inference: "Camera inference · person positives only", scenario_injection: "Explicit scenario injection · no pixels" }[mode] ?? mode);
const time = value => value ? new Date(value).toLocaleTimeString() : "Not yet";

export function PhoneDemo({ ui }) {
  const { PageHead, Field, Button, Badge, ErrorText, useApp, useData } = ui;
  const { user, act, refresh } = useApp();
  const [selected, setSelected] = useState(""), [pairings, setPairings] = useState({}), [now, setNow] = useState(Date.now());
  const [rooms] = useData("/rooms"), [rows, sessionsError] = useData(user.role === "admin" ? "/demo/sessions" : null);
  const [candidates, candidatesError] = useData(user.role === "admin" ? "/demo/available-rooms" : null);
  const [detail, detailError] = useData(user.role === "admin" && selected ? `/demo/sessions/${selected}` : null);
  const sessions = rows ?? [], error = sessionsError || candidatesError || detailError;
  useEffect(() => { if (!selected && rows?.length) setSelected(rows.find(s => s.active)?._id ?? ""); }, [rows, selected]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  if (user.role !== "admin") return <ErrorText>Administrator access is required to manage phone demonstrations.</ErrorText>;
  const session = detail?.session;
  const availableRooms = (candidates ?? []).filter(room => !room.unavailableReason);
  const unavailableRooms = (candidates ?? []).filter(room => room.unavailableReason);
  const offset = detail ? new Date(detail.serverTime).getTime() - now : 0;
  const due = value => Math.max(0, Math.ceil((new Date(value).getTime() - (Date.now() + offset)) / 1000));
  return <>
    <PageHead eyebrow="SIMULATED ROOM MASTER / ACTUAL PIXELS" title="Two-phone demonstration" description="Phone A observes. The backend evaluates. Phone B applies and acknowledges the simulated supply." />
    <ErrorText>{error}</ErrorText>
    <div className="phone-demo-steps"><span>01 / Phone A · camera</span><span>02 / Persistent policy worker</span><span>03 / Phone B · classroom</span></div>
    <p className="callout">Quick path: choose a ready room, create the session, then prepare both phone links. Instrumented mode reads the classroom QR; point the camera at that QR, not at yourself. For a laptop-only test without filming a second screen, use explicit scenario injection in Advanced options.</p>
    <DemoRoomSetup ui={ui} rooms={candidates ?? []} />
    <details className="panel section-gap" open={!session?.active}><summary>Create a demonstration session</summary><p className="caption">Assign an existing room with an approved simulated master and inventory. This temporarily uses a dedicated demo camera source; it does not approve unsafe loads or erase bookings, QR leases or overrides.</p>
      <form className="form-grid" onSubmit={async event => {
        event.preventDefault(); const values = new FormData(event.currentTarget);
        const result = await act(() => post("/demo/sessions", { roomId: values.get("roomId"), visionMode: values.get("visionMode"),
          vacancyConfirmationSeconds: Number(values.get("vacancy")), durationMinutes: Number(values.get("duration")), coverageReviewed: true, allowManualControl: values.get("manual") === "on" }), "Simulated phone session created");
        if (result) { setSelected(result._id); setPairings({}); await refresh(); }
      }}>
        <Field label="Existing room"><select name="roomId" required disabled={!availableRooms.length}><option value="">{candidates === null ? "Loading available rooms…" : availableRooms.length ? "Select a room" : "No available rooms"}</option>{availableRooms.map(room => <option key={room._id} value={room._id}>{room.code} · {room.name}</option>)}</select></Field>
        <details className="demo-advanced"><summary>Advanced options: vision mode and timing</summary>
        <Field label="Vision mode"><select name="visionMode"><option value="instrumented">Instrumented demo vision · decode visible QR</option><option value="camera_inference">Camera inference · conservative HOG person detector</option><option value="scenario_injection">Scenario injection fallback · no camera inference</option></select></Field>
        <Field label="Vacancy confirmation (seconds)"><input name="vacancy" type="number" min={2} max={60} defaultValue={5} required /></Field>
        <Field label="Session duration (minutes)"><input name="duration" type="number" min={5} max={120} defaultValue={60} required /></Field>
        <p className="caption">Defaults: classroom QR mode, 5-second vacancy confirmation, 60-minute session. Person detection can protect the room but cannot prove vacancy from a missed detection.</p></details>
        <label className="check"><input type="checkbox" required />I reviewed the demo scene coverage. Markers are a convention, not real-world occupancy proof.</label>
        <label className="check"><input name="manual" type="checkbox" />Permit scoped presenter manual simulated master requests (existing interlocks still apply).</label>
        <Button disabled={!availableRooms.length}>Create demo session</Button>
      </form>
      <p className="caption">Only rooms currently available for demo setup are listed. Bookings, QR leases, overrides and command safety checks still apply before any simulated action.</p>
      {!!unavailableRooms.length && <details open={!availableRooms.length}><summary>{unavailableRooms.length} rooms unavailable for demo setup</summary><ul>{unavailableRooms.map(room => <li key={room._id}>{room.code} · {room.name}: {room.unavailableReason}</li>)}</ul></details>}
      <p className="caption">Demo only: first alert after confirmed vacancy; escalate after 10 seconds, final recheck after another 15 seconds. Production timings remain unchanged. Camera-inference mode cannot establish vacancy from a missing detection.</p>
    </details>
    <section className="panel section-gap"><Field label="Session"><select value={selected} onChange={event => { setSelected(event.target.value); setPairings({}); }}><option value="">Select a session</option>{sessions.map(item => <option key={item._id} value={item._id}>{(rooms ?? []).find(room => room._id === item.roomId)?.code ?? item.roomId} · {item._id.slice(0, 8)} · {item.active ? "active" : "ended"}</option>)}</select></Field></section>
    {session && <>
      <section className="panel section-gap"><div className="section-title"><div><div className="eyebrow">{detail.room.code} / {session._id.slice(0, 8)}</div><h2>{modeLabel(session.visionMode)}</h2></div><Badge tone={session.active ? "success" : "neutral"}>{session.active ? "Demo active" : "Ended"}</Badge></div>
        <p className="caption">Vacancy confirmation: {session.vacancyConfirmationMs / 1000}s. Escalation: +10s / +15s. Session expires {time(session.expiresAt)}. Live physical control is disabled.</p>
        {session.lastError && <ErrorText>{session.lastError}</ErrorText>}
        <div className="demo-next-step" role="status"><strong>Next step</strong><p>{!detail.clients.some(c => c.role === "classroom" && c.online) ? "Connect the classroom using its link below. It applies and acknowledges simulated commands." : session.visionMode === "scenario_injection" ? "Use the classroom's clearly labelled scenario buttons. No camera pixels are processed in this mode." : !detail.clients.some(c => c.role === "camera" && c.online) ? "Open the camera link and press Start camera. Keep its window visible." : session.visionMode === "instrumented" && detail.observed.state === "unknown" ? "Keep the classroom QR in the camera frame and both windows visible. A webcam image without that QR stays unknown." : "Keep evidence flowing. Watch the timeline for notifications, the final check and classroom acknowledgement."}</p></div>
        <Button disabled={!session.active} onClick={async () => {
          await act(async () => {
            for (const role of session.visionMode === "scenario_injection" ? ["classroom"] : ["camera", "classroom"]) {
              // Keep a live pairing, and keep a still-valid unconsumed link. Reissuing
              // credentials requires the explicit individual replacement button.
              if (detail.clients.some(c => c.role === role && c.online) || pairings[role] && new Date(pairings[role].codeExpiresAt) > new Date()) continue;
              const result = await post(`/demo/sessions/${session._id}/pairing`, { role }); setPairings(current => ({ ...current, [role]: result }));
            }
          }, "Phone links ready. Open each on its intended device; camera permission stays explicit.");
        }}>{session.visionMode === "scenario_injection" ? "Prepare classroom link" : "Prepare both phone links"}</Button>
        <div className="phone-demo-pairings">{(session.visionMode === "scenario_injection" ? ["classroom"] : ["camera", "classroom"]).map(role => <div className="phone-pair-card" key={role}><h3>{role === "camera" ? "Phone A · Camera" : "Phone B · Classroom"}</h3><p className="caption">{detail.clients.find(client => client.role === role)?.online ? "Connected" : "Offline / not paired"} · last seen {time(detail.clients.find(client => client.role === role)?.lastSeenAt)}</p>
          <details><summary>Replace {role} pairing</summary><p className="caption">Disconnects the previous {role} app. Use this only to connect a replacement device.</p><Button secondary disabled={!session.active} onClick={async () => { const result = await act(() => post(`/demo/sessions/${session._id}/pairing`, { role }), "Short-lived pairing created; previous role pairing revoked"); if (result) setPairings(current => ({ ...current, [role]: result })); }}>Create {role} pairing</Button></details>
          {pairings[role] && <div className="phone-pair-secret"><img src={pairings[role].qr} alt={`${role} pairing QR`} /><a className="button secondary" href={pairings[role].url} target="_blank" rel="noreferrer">Open paired {role} app</a><details><summary>Enter pairing code manually</summary><code>{pairings[role].code}</code></details><p className="caption">One use · expires {time(pairings[role].codeExpiresAt)}. Scan on the intended phone. Opening a pairing link connects that app automatically.</p></div>}
        </div>)}</div>
        <div className="inline-actions section-gap"><Button secondary disabled={!session.active} onClick={async () => { const result = await act(() => post(`/demo/sessions/${session._id}/stop`), "Demo ended; pairing and jobs revoked"); if (result) { setPairings({}); refresh(); } }}>Stop session</Button><Button secondary onClick={async () => { const result = await act(() => post(`/demo/sessions/${session._id}/reset`), "New session created; pair both phones again"); if (result) { setSelected(result._id); setPairings({}); } }}>Reset & re-pair</Button></div>
      </section>
      <div className="phone-demo-evidence section-gap"><section className="panel"><h2>Latest camera frame</h2>{session.lastFrameAt && session.active && now - new Date(session.lastFrameAt) < 120000 ? <img className="phone-frame" crossOrigin="use-credentials" src={apiUrl(`/demo/sessions/${session._id}/frame?v=${session.lastFrameSequence}`)} alt="Latest private demo camera thumbnail" /> : <p>No current camera thumbnail.</p>}<p className="caption">Last accepted {time(session.lastFrameAt)} · {session.processedFrames} processed frames. Latest thumbnail only, expires after two minutes; never public.</p></section>
        <section className="panel"><h2>Observation & room protections</h2><dl className="phone-evidence-list"><dt>Observed occupancy</dt><dd>{detail.observed.state} · {detail.observed.reason}</dd><dt>Evidence source</dt><dd>{session.latestObservation?.evidenceSource?.replaceAll("_", " ") ?? "Unknown"}</dd><dt>Frame freshness</dt><dd>{session.lastFrameAt ? `${Math.max(0, Math.floor((now - new Date(session.lastFrameAt)) / 1000))}s since accepted` : "No frame"}</dd><dt>Observed equipment</dt><dd>{session.latestObservation?.equipment && Object.keys(session.latestObservation.equipment).length ? Object.entries(session.latestObservation.equipment).map(([key, value]) => `${key}: ${value ? "ON" : "OFF"}`).join(" · ") : "Unknown; object appearance is not operating-state proof"}</dd><dt>Protected use</dt><dd>{detail.protectedBy ?? "None"} · booking {detail.protections.booking ? "active" : "no"}, QR {detail.protections.qr ? "active" : "no"}, override {detail.protections.override ? "active" : "no"}</dd><dt>Simulated master supply</dt><dd>{detail.master?.reportedSupply ?? "unknown"} · separate from camera evidence</dd></dl><p className="caption"><Help topic="confidence" /> HOG scores are uncalibrated; a positive detection protects. Marker decoding is a demonstration convention. Neither establishes measured kWh or savings.</p></section></div>
      <section className="panel section-gap"><h2>Persistent escalation timeline</h2>{!detail.incidents.length && <p>No waste incident yet. Confirmed fresh vacancy, visible equipment ON and no protected use are required.</p>}{detail.incidents.map(incident => <div key={incident._id} className="phone-incident"><strong>{incident.state} · {time(incident.openedAt)}</strong><ul>{incident.timeline.map((entry, i) => <li key={i}>{time(entry.at)} · {entry.event.replaceAll("_", " ")}{entry.reason ? ` · ${entry.reason}` : ""}</li>)}</ul><div className="phone-job-grid">{detail.jobs.filter(job => job.incidentId === incident._id).map(job => <span key={job._id}>{job.stage}: {job.status}{job.status === "pending" ? ` · ${due(job.dueAt)}s` : ""}</span>)}</div></div>)}</section>
      <section className="panel section-gap"><h2>Master commands & classroom acknowledgements</h2>{!detail.commands.length && <p>No master command created.</p>}{detail.commands.map(command => <article key={command._id} className="phone-command"><strong>{command.action.toUpperCase()} · {command.state}</strong><p className="caption">{command.requestId} · created {time(command.issuedAt)} · sent {time(command.sentAt)} · acknowledged {time(command.acknowledgedAt)}</p><p>{command.result?.verification === "simulator_acknowledged" ? `Simulator acknowledged ${command.action.toUpperCase()}` : "No classroom application acknowledgement"}. No physical breaker verification.</p></article>)}</section>
    </>}
    <p className="caption">Phone networking requires a reachable trusted HTTPS origin. Follow DEMO_SETUP.md; localhost on a phone refers to that phone. No tunnel is created automatically.</p>
  </>;
}
