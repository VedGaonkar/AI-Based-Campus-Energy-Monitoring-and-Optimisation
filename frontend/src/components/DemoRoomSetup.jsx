import React, { useState } from "react";
import { api, post, patch } from "../services/api.js";

// A consolidated review of existing API-owned settings, never a bypass of the
// session's server-side eligibility/interlock checks. All approvals are explicit.
export default function DemoRoomSetup({ ui, rooms }) {
  const { Field, Button, ErrorText, useApp, useData } = ui;
  const { act, refresh, health } = useApp();
  const [roomId, setRoomId] = useState(""), [failure, setFailure] = useState("");
  const [room, roomError] = useData(roomId ? `/rooms/${roomId}` : null);
  const [allLoads, loadsError] = useData(roomId ? "/devices" : null);
  const loads = allLoads?.filter(d => d.roomId === roomId) ?? [];
  const blockedLoads = loads.filter(d => d.essential || d.essentialStandbyRequirement);
  const approvals = loads.filter(d => !d.supplyInterruptionApproved && !d.essential && !d.essentialStandbyRequirement);
  const candidate = rooms.find(r => r._id === roomId);
  if (!health) return <p role="status">Checking server simulation mode...</p>;
  if (!health.demoMode || health.physicalControl || health.nativeControl) return <p role="status">Quick room preparation is available only on a simulation server with live controls disabled.</p>;
  return <details className="panel section-gap demo-room-setup"><summary>Prepare a room for simulation</summary>
    <p>Review the missing setup here instead of visiting several pages. This changes simulation metadata for the selected room; no physical installation is approved.</p>
    <Field label="Room to prepare"><select value={roomId} onChange={e => { setRoomId(e.target.value); setFailure(""); }}><option value="">Choose an existing room</option>{rooms.map(r => <option key={r._id} value={r._id}>{r.code} · {r.name}</option>)}</select></Field>
    <ErrorText>{failure || roomError || loadsError}</ErrorText>
    {room && allLoads && <form key={`${roomId}-${room.policyVersion}`} onSubmit={async e => {
      e.preventDefault(); const values = new FormData(e.currentTarget); setFailure("");
      await act(async () => {
        try {
          const server = await api("/health");
          if (!server.demoMode || server.physicalControl || server.nativeControl) throw new Error("Simulation-only room setup is unavailable on this server");
          if (!room.independentInfrastructure && values.has("independent")) await patch(`/rooms/${roomId}`, { independentInfrastructure: true });
          if (!loads.length && values.has("virtualLight")) await post("/devices", { roomId, name: "Virtual demo light", category: "lighting", ratedWatts: 20, supplyInterruptionApproved: true, restartBehaviourKnown: true, approvalNotes: "Explicitly reviewed virtual demonstration light only; no electrical commissioning." });
          for (const load of approvals) if (values.getAll("approve").includes(load._id)) await patch(`/devices/${load._id}`, { supplyInterruptionApproved: true });
        } catch (error) { setFailure(`${error.message} Saved steps are retained. Review the remaining items and retry.`); refresh(); throw error; }
      }, "Simulation setup saved; room availability refreshed");
    }}>
      <p><strong>{room.code}</strong>: {candidate?.unavailableReason || "Ready for a demonstration session"}</p>
      {!room.independentInfrastructure && <label className="checkbox"><input type="checkbox" name="independent" required /><span>I reviewed that camera, network and control supplies stay available when the simulated room master is OFF.</span></label>}
      {!loads.length && <label className="checkbox"><input type="checkbox" name="virtualLight" required /><span>Add and approve one virtual demo light (20 W estimate). This represents simulated equipment only.</span></label>}
      {approvals.map(load => <label className="checkbox" key={load._id}><input type="checkbox" name="approve" value={load._id} required /><span>I reviewed shared interruption for {load.name}. Approve this ordinary load for the simulated demonstration.</span></label>)}
      {!!blockedLoads.length && <p role="status">Protected loads block room-wide cutoff: {blockedLoads.map(d => d.name).join(", ")}. Use another suitable demo room; this form cannot remove their protection.</p>}
      <p className="caption">Existing bookings, native appliance automation, master faults, normal-stop requirements and active sessions remain enforced. Floors, meter cameras and real camera coverage are not extra steps for this simulated session.</p>
      <Button disabled={!!blockedLoads.length || !!room.demoSessionId || (!approvals.length && loads.length > 0 && room.independentInfrastructure)}>Save simulation setup</Button>
    </form>}
  </details>;
}
