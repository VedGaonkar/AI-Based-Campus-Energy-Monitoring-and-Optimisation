import React, { useEffect, useState } from "react";
import { api, post, patch } from "./services/api.js";

export function InstitutionPicker({ onSelect, Field }) {
  const [query, setQuery] = useState(""), [suggestions, setSuggestions] = useState([]), [selected, setSelected] = useState(null), [code, setCode] = useState(""), [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (query.trim().length < 3 || selected) { setSuggestions([]); return; }
      api(`/institutions/suggestions?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal }).then(setSuggestions).catch(failure => { if (failure.name !== "AbortError") setError("Could not search institutions. Use a private workspace code if needed."); });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, selected]);
  function choose(row) { setSelected(row); setQuery(row.displayName); setSuggestions([]); onSelect(row._id); setError(""); }
  return <div className="institution-picker">
    <Field label="Institution / building"><input value={query} placeholder="Type at least 3 characters" autoComplete="off" maxLength={80} onChange={event => { setQuery(event.target.value); setSelected(null); onSelect(""); setError(""); }} /></Field>
    {!!suggestions.length && <ul className="institution-suggestions" aria-label="Institution suggestions">{suggestions.map(row => <li key={row._id}><button type="button" onClick={() => choose(row)}>{row.displayName}<small>{row._id.slice(0, 8)}</small></button></li>)}</ul>}
    {selected ? <p className="caption">Selected: {selected.displayName}. Your account must already be a member.</p> : query.trim().length >= 3 && !suggestions.length && <p className="caption">Choose a suggestion, or use your institution's private workspace/invitation code.</p>}
    <details><summary>Private institution or invitation code</summary><Field label="Workspace identity code"><input type="password" value={code} autoComplete="off" maxLength={200} onChange={event => setCode(event.target.value)} /></Field><button type="button" className="button secondary" disabled={!code.trim()} onClick={async () => { try { choose(await post("/institutions/resolve", { code: code.trim() })); setCode(""); } catch (failure) { setError(failure.message); } }}>Find private institution</button><p className="caption">Finding a workspace does not grant membership. Use an invitation to join.</p></details>
    {error && <p role="alert" className="error">{error}</p>}
  </div>;
}

export function InstitutionSettings({ ui }) {
  const { useApp, Field, Button, ErrorText } = ui;
  const { user, act, refresh, health, version } = useApp();
  const [institution, setInstitution] = useState(null), [error, setError] = useState(""), [code, setCode] = useState(""), [invite, setInvite] = useState(null);
  useEffect(() => { const controller = new AbortController(); if (health?.institutionWorkspaces) api("/institutions/current", { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setInstitution(value); }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); }); return () => controller.abort(); }, [health?.institutionWorkspaces, version]);
  if (!health?.institutionWorkspaces) return null;
  return <section className="panel section-gap"><div className="eyebrow">YOUR INSTITUTION WORKSPACE</div><h2>{institution?.displayName ?? user.institution?.displayName ?? "Institution"}</h2><p className="caption">One building in this workspace. Institution ID: {institution?._id ?? user.institutionId}. Renaming preserves memberships and all room identities.</p>{institution?.demo && <p className="badge">Dedicated demo · sample data is simulated</p>}<ErrorText>{error}</ErrorText>
    {user.role === "admin" && institution && <>
      <form key={`${institution.displayName}:${institution.discoverable}`} className="form-grid" onSubmit={async event => { event.preventDefault(); const values = new FormData(event.currentTarget); const result = await act(() => patch("/institutions/current", { displayName: values.get("displayName"), discoverable: values.get("discoverable") === "on" }), "Institution name updated; membership IDs preserved"); if (result) { setInstitution(current => ({ ...current, ...result, discoverable: values.get("discoverable") === "on" })); refresh(); } }}>
        <Field label="Institution / building display name"><input name="displayName" defaultValue={institution.displayName} required maxLength={200} /></Field><label className="check"><input name="discoverable" type="checkbox" defaultChecked={institution.discoverable} />Allow minimal name suggestions on the sign-in page</label><Button>Save institution identity</Button>
      </form>
      <div className="section-gap"><Button secondary onClick={async () => { const result = await act(() => post("/institutions/current/access-code"), "New private identity code created; previous code revoked"); if (result) setCode(result.code); }}>Generate private workspace code</Button>{code && <p className="caption">Share privately with existing members. Identity only, not membership: <code className="institution-secret">{code}</code></p>}</div>
      <h3 className="section-gap">Invite a member</h3><p className="caption">A scoped, expiring invitation grants membership only in this institution. Existing global accounts accept it using their current password; new users supply it during registration.</p>
      <form className="form-grid" onSubmit={async event => { event.preventDefault(); const values = new FormData(event.currentTarget); const result = await act(() => post("/institutions/current/invitations", { role: values.get("role"), ...(values.get("email") ? { email: values.get("email") } : {}), expiresInHours: Number(values.get("hours")), permittedRoomIds: [] }), "Membership invitation created"); if (result) setInvite(result); }}>
        <Field label="Invited email (optional)"><input type="email" name="email" /></Field><Field label="Invitation role"><select name="role"><option value="viewer">Viewer</option><option value="teacher">Teacher</option><option value="technician">Technician</option><option value="hod">HOD</option><option value="admin">Administrator</option></select></Field><Field label="Invitation validity (hours)"><input name="hours" type="number" min={1} max={168} defaultValue={24} /></Field><Button>Create membership invitation</Button>
      </form>{invite && <p className="caption">Share privately, expires {new Date(invite.expiresAt).toLocaleString()}: <code className="institution-secret">{invite.token}</code></p>}
    </>}
    <p className="caption">To enter another authorised workspace, sign out and select it on the sign-in page. An institution name or the shared admin enrollment key alone never creates membership in an existing workspace.</p>
  </section>;
}
