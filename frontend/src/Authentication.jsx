import React, { useState } from "react";
import { Activity, ArrowRight, ShieldCheck } from "lucide-react";
import { api, post } from "./services/api.js";
import { joinCodeHint } from "../../shared/building-auth-policy.js";
export function Authentication({ onLogin, accessRoom, Field, ErrorText, initialWorkspaces = [] }) {
  const [busy, setBusy] = useState(false), [tab, setTab] = useState("login"), [email, setEmail] = useState(""), [password, setPassword] = useState(""), [name, setName] = useState(""), [confirmPassword, setConfirmPassword] = useState(""), [institutionName, setInstitutionName] = useState(""), [accountType, setAccountType] = useState("viewer"), [joinCode, setJoinCode] = useState(""), [adminKey, setAdminKey] = useState(""), [choices, setChoices] = useState(initialWorkspaces.length ? initialWorkspaces : null), [error, setError] = useState("");

  function complete(result) {
    setPassword(""); setConfirmPassword(""); setJoinCode(""); setAdminKey("");
    if (result.selectionRequired) { setChoices(result.workspaces); return; }
    onLogin(result.user);
    if (result.user.role === "admin" && !window.location.pathname.startsWith("/access/")) window.location.assign("/admin");
  }
  async function perform(operation) { setBusy(true); setError(""); try { complete(await operation()); } catch (failure) { setError(failure.message); } finally { setBusy(false); } }
  function switchTab(value) { setTab(value); setError(""); setEmail(""); setPassword(""); setName(""); setConfirmPassword(""); setInstitutionName(""); setJoinCode(""); setAdminKey(""); }
  return <div className="login-page">
    <section className="login-story"><div className="brand"><span className="brand-mark"><Activity /></span>campusenergy</div><div><div className="eyebrow">A MORE CONSIDERED CAMPUS</div><h1>See the energy.<br />Make the difference.</h1><p>Turn building data into clear insights, responsible action and measurable progress.</p><div className="story-line" /><div className="story-stats"><span><strong>01</strong>building, connected</span><span><strong>100%</strong>accountable actions</span></div></div><small>LOCAL PROTOTYPE / SIMULATED HARDWARE</small></section>
    <section className="login-form"><div className="eyebrow">CAMPUS ENERGY / OPERATIONS</div>
      {!choices && <div className="login-tabs"><button className={`login-tab ${tab === "login" ? "active" : ""}`} type="button" onClick={() => switchTab("login")}>Sign in</button><button className={`login-tab ${tab === "signup" ? "active" : ""}`} type="button" onClick={() => switchTab("signup")}>Create account</button></div>}
      {choices ? <><h2>Choose your building</h2><p>Your password is verified. Choose one of your existing memberships.</p><div className="workspace-choices">{choices.map(choice => <button className="button secondary" type="button" key={choice._id} disabled={busy} onClick={() => perform(() => post("/auth/select-workspace", { institutionId: choice._id }))}>{choice.displayName}</button>)}</div><button type="button" className="text-link" disabled={busy} onClick={async () => { setBusy(true); try { await post("/auth/logout"); setChoices(null); } catch (failure) { setError(failure.message); } finally { setBusy(false); } }}>Use another account</button></> : tab === "login" ? <>
        <h2>Welcome back</h2><p>{accessRoom ? `Room access: ${accessRoom.code ?? ""} ${accessRoom.name}. Sign in for server authorisation.` : "Sign in to your building workspace."}</p>
        <form onSubmit={event => { event.preventDefault(); perform(() => post("/auth/login", { email, password })); }}>
          <Field label="Email address"><input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></Field>
          <Field label="Password"><input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></Field>
          <button className="button" disabled={busy}>{busy ? "Signing in..." : "Sign in to workspace"}<ArrowRight size={18} /></button>
        </form><div className="login-help"><ShieldCheck size={20} /><p>Your existing building membership opens automatically after sign-in.</p></div>
      </> : <><h2>Create account</h2><p>{accountType === "administrator" ? "Create your own empty building workspace." : "Join your building as a Viewer."}</p>
        <form onSubmit={event => { event.preventDefault(); if (password !== confirmPassword) { setError("Passwords do not match."); return; } perform(() => post("/auth/register", { name, email, password, confirmPassword, accountType, joinCode, ...(accountType === "administrator" ? { institutionName, adminKey } : {}) })); }}>
          <Field label="Account type"><select value={accountType} onChange={e => { setAccountType(e.target.value); setInstitutionName(""); setJoinCode(""); setAdminKey(""); setError(""); }}><option value="administrator">Administrator</option><option value="viewer">Viewer</option></select></Field>
          <Field label="Full name"><input autoComplete="name" value={name} onChange={e => setName(e.target.value)} required maxLength={200} /></Field>
          <Field label="Email address"><input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={200} /></Field>
          <Field label="Password" hint="Minimum 6 characters"><input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} maxLength={200} /></Field>
          <Field label="Confirm password"><input type="password" autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required minLength={6} maxLength={200} /></Field>
          {accountType === "administrator" && <Field label="Institution / building name"><input value={institutionName} onChange={e => setInstitutionName(e.target.value)} required maxLength={200} /></Field>}
          <Field label={accountType === "administrator" ? "Set Building Join Code" : "Building Join Code"} hint={`${accountType === "administrator" ? "Choose a code to share privately with Viewers." : "Get the code from your building administrator."} ${joinCodeHint}`}><input type="password" autoComplete="off" value={joinCode} onChange={e => setJoinCode(e.target.value)} required minLength={8} maxLength={64} /></Field>
          {accountType === "administrator" && <Field label="Administrator registration key" hint="Enter the ADMIN_INVITE_KEY provided by the server owner."><input type="password" name="adminKey" autoComplete="off" value={adminKey} onChange={e => setAdminKey(e.target.value)} required maxLength={200} /></Field>}
          <button className="button" disabled={busy}>{busy ? "Creating account..." : "Create account"}<ArrowRight size={18} /></button>
        </form><p className="caption">{accountType === "administrator" ? "Administrator registration creates a separate building with a new identity." : "The code grants Viewer membership. Your building name appears after registration."}</p><button type="button" className="text-link" onClick={() => switchTab("login")}>Already have an account? Sign in</button>
      </>}<ErrorText>{error}</ErrorText>
    </section>
  </div>;
}
