import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  Link,
  useParams,
  useLocation,
} from "react-router";
import { startLiveSync } from "./services/live-sync.js";
import { setReadState, subscribeReadState } from "./services/read-state.js";
import {
  Activity,
  LayoutDashboard,
  DoorOpen,
  ChartNoAxesCombined,
  CalendarDays,
  Bell,
  Lightbulb,
  QrCode,
  Settings,
  LogOut,
  ArrowUpRight,
  ArrowRight,
  Plus,
  Check,
  RefreshCw,
  ShieldCheck,
  PlugZap,
  Upload,
  Menu,
  X,
  Clock3,
  FileCheck2,
  TriangleAlert,
  Wifi,
  Camera,
  Search,
  List,
  Grid2X2,
} from "lucide-react";
import { api, post, patch } from "./services/api";
import { Management, Profile } from "./Management.jsx";
import { MeterCameras } from "./MeterCameras.jsx";
import { ConnectedDevices } from "./ConnectedDevices.jsx";
import { PhoneDemo, PhoneDemoSummary } from "./PhoneDemo.jsx";
import { InstitutionPicker } from "./Institutions.jsx";
import "./styles.css";
import "./stewardship.css";

const LazyConsumptionChart = React.lazy(
  () => import("./components/ConsumptionChart.jsx"),
);

const AppContext = createContext();
const useApp = () => useContext(AppContext);
const number = (n, d = 1) =>
  Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: d });
const money = (n) => `₹${number(n, 0)}`;
const date = (value) =>
  value
    ? new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Unavailable";
const localInput = (value = new Date()) => {
  const d = new Date(value);
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const roleCan = (user, roles) => roles.includes(user.role);
const STAFF = ["admin", "hod", "technician", "teacher"],
  RESPONDERS = ["admin", "hod", "technician"];

function useData(path) {
  const requestKey = useRef(Symbol("page-read"));
  const { version, user } = useApp(),
    [data, setData] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    if (!path) { setData(null); setReadState(requestKey.current, null); return; }
    setError("");
    setReadState(requestKey.current, { pending: true });
    api(path, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) { setData({ path, institutionId: user.institutionId, value }); setReadState(requestKey.current, { pending: false }); } })
      .catch((err) => {
        if (!controller.signal.aborted && err.name !== "AbortError") { setError(err.message); setData(null); setReadState(requestKey.current, { error: true }); }
      });
    return () => { controller.abort(); setReadState(requestKey.current, null); };
  }, [path, version, user.institutionId]);
  return [data?.path === path && data.institutionId === user.institutionId ? data.value : null, error];
}
function Badge({ children, tone = "neutral" }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Empty({ title = "Nothing here yet", children }) {
  return (
    <div className="empty">
      <FileCheck2 size={26} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function ErrorText({ children }) {
  return children ? (
    <div role="alert" className="error">
      <TriangleAlert size={17} />
      {children}
    </div>
  ) : null;
}
function PageHead({
  eyebrow = "BUILDING OPERATIONS",
  title,
  description,
  children,
}) {
  return (
    <header className="page-head">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="head-actions">{children}</div>
    </header>
  );
}
function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Button({ children, secondary = false, disabled = false, ...props }) {
  const { busy } = useApp();
  return (
    <button
      className={secondary ? "button secondary" : "button"}
      {...props}
      disabled={busy || disabled}
    >
      {children}
    </button>
  );
}
function Modal({ title, onClose, children }) {
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-title">
          <h2>{title}</h2>
          <button
            autoFocus
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function Clock({ until }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  return (
    <span>
      {until
        ? `${Math.max(0, Math.ceil((new Date(until) - now) / 1000))}s remaining`
        : "No pending deadline"}
    </span>
  );
}

function App() {
  const [user, setUser] = useState(undefined),
    [health, setHealth] = useState(null),
    [version, setVersion] = useState(0),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [menu, setMenu] = useState(false);
  const location = useLocation();
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const [syncState, setSyncState] = useState("connecting"), [reads, setReads] = useState({ pending: false, failed: false });
  useEffect(() => subscribeReadState(setReads), []);
  useEffect(() => {
    api("/auth/me")
      .then((d) => setUser(d.user))
      .catch(() => setUser(null));
    api("/health")
      .then(setHealth)
      .catch(() => {});
  }, []);
  useEffect(() => {
    setMenu(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!user) return;
    return startLiveSync({ request: api, invalidate: refresh, status: setSyncState, expectedInstitutionId: user.institutionId ?? "legacy",
      identity: next => setUser(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next),
      revoked: () => setUser(null),
    });
  }, [user?._id, user?.institutionId, refresh]);
  async function act(operation, message = "Saved") {
    setBusy(true);
    setError("");
    try {
      const result = await operation();
      setNotice(message);
      refresh();
      return result;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  const context = { user, version, busy, act, refresh, health, setUser, syncState };
  if (user === undefined)
    return (
      <div className="boot">
        <Activity size={32} />
        <p>Connecting to Campus Energy…</p>
      </div>
    );
  return (
    <AppContext.Provider value={context}>
      {!user ? (
        <Login onLogin={setUser} />
      ) : (
        <div className="app-shell">
          <a className="skip" href="#main">
            Skip to content
          </a>
          <aside className={`sidebar ${menu ? "open" : ""}`}>
            <Link className="brand" to="/">
              <span className="brand-mark">
                <Activity size={24} />
              </span>
              <span>
                CAMPUS ENERGY
                <small>STEWARDSHIP / OPERATIONS</small>
              </span>
            </Link>
            <div className="workspace-label">FACILITY WORKSPACE</div>
            <nav>
              {[
                ["/", LayoutDashboard, "Overview"],
                ["/rooms", DoorOpen, "Rooms"],
                ["/energy", ChartNoAxesCombined, "Energy analytics"],
                ["/timetable", CalendarDays, "Timetable"],
                ["/incidents", Bell, "Incidents"],
                ["/recommendations", Lightbulb, "Recommendations"],
                ["/access", QrCode, "QR access"],
                ["/connected-devices", PlugZap, "Connected devices"],
                ...(user.role === "admin" ? [["/phone-demo", Camera, "Two-phone demo"], ["/meter-cameras", Camera, "Meter cameras"]] : []),
                ...(user.role === "admin"
                  ? [["/admin", Settings, "Admin management"]]
                  : []),
              ].map(([path, Icon, label]) => (
                <NavLink
                  key={path}
                  to={path}
                  end={path === "/"}
                  className={({ isActive }) =>
                    isActive ? "nav-link active" : "nav-link"
                  }
                >
                  <Icon size={19} />
                  {label}
                </NavLink>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <div className="pilot-card">
                <span className="status-dot" />
                <strong>Single-building pilot</strong>
                <p>
                  Evidence first.
                  <br />
                  Every action accountable.
                </p>
                <Badge tone="sage">Local prototype</Badge>
              </div>
              <div className="profile">
                <div className="avatar">{user.name[0]}</div>
                <div>
                  <Link to="/profile" className="profile-link"><strong>{user.name}</strong></Link>
                  <small>{user.role}</small>
                  <Link to="/profile" className="text-link">My profile</Link>
                </div>
                <button
                  className="signout-btn"
                  onClick={() =>
                    act(async () => {
                      await post("/auth/logout");
                      setUser(null);
                    }, "Signed out")
                  }
                >
                  <LogOut size={14} />
                  Sign out
                </button>
              </div>
            </div>
          </aside>
          <div className="workspace">
            <div className="topbar">
              <div className="topbar-left">
                <button
                  aria-label="Toggle navigation"
                  className="icon-button mobile-menu"
                  onClick={() => setMenu(!menu)}
                >
                  <Menu size={22} />
                </button>
                <span className="building-symbol">
                  <DoorOpen size={18} />
                </span>
                <BuildingLabel />
                <span className="divider">/</span>
                <span className="muted terminal-label">Operations terminal</span>
              </div>
              <div className="topbar-right">
                <span className="online-dot" style={syncState === "current" && !reads.failed ? undefined : { background: "#AD512F" }} />
                <span className="topbar-status">{syncState === "current" && !reads.failed ? "Workspace connected" : "Workspace data may be stale"}</span>
                <button
                  className="icon-button"
                  aria-label="Refresh data"
                  onClick={refresh}
                >
                  <RefreshCw size={17} />
                </button>
                <div className="topbar-user">
                  <div className="topbar-avatar">{user.name[0]}</div>
                  <Link to="/profile" className="topbar-name">{user.name} / {user.role}</Link>
                  <button
                    className="topbar-signout"
                    onClick={() =>
                      act(async () => {
                        await post("/auth/logout");
                        setUser(null);
                      }, "Signed out")
                    }
                  >
                    <LogOut size={14} />
                    Sign out
                  </button>
                </div>
              </div>
            </div>
            {health?.demoMode && (
              <div className="simulation-bar">
                <ShieldCheck size={16} />
                <strong>
                  Simulation: time accelerated {health.timeScale}×.
                </strong>
                <span>
                  Synthetic observations and room supply actions. No physical
                  switching.
                </span>
              </div>
            )}
            <div className={`sync-status ${syncState === "current" && !reads.failed ? "" : "stale"}`} role="status" data-sync-state={syncState}>
              {syncState === "current" ? reads.failed ? "Data unavailable: some pages could not refresh" : reads.pending ? "Updating authorised data..." : "Live updates connected" : ({ connecting: "Connecting live updates...", reconciling: "Synchronising with the server...", disconnected: "Disconnected: displayed data may be stale", stale: "Updates unavailable: displayed data may be stale", background: "Background tab: data will reconcile when you return" }[syncState])}
            </div>
            <main id="main">
              <ErrorText>{error}</ErrorText>
              {notice && (
                <div className="notice" role="status">
                  <Check size={16} />
                  {notice}
                  <button
                    className="icon-button"
                    aria-label="Dismiss notification"
                    onClick={() => setNotice("")}
                  >
                    <X size={15} />
                  </button>
                </div>
              )}
              <Routes>
                <Route path="/meter-cameras" element={<MeterCameras ui={managementUI} />} />
                <Route path="/connected-devices" element={<ConnectedDevices ui={managementUI} />} />
                <Route path="/phone-demo" element={<PhoneDemo ui={managementUI} />} />
                <Route path="/profile" element={<Profile ui={managementUI} />} />
                <Route path="/" element={<Overview />} />
                <Route path="/rooms" element={<Rooms />} />
                <Route path="/energy" element={<Energy />} />
                <Route path="/timetable" element={<Timetable />} />
                <Route path="/incidents" element={<Incidents />} />
                <Route path="/recommendations" element={<Recommendations />} />
                <Route path="/access" element={<Access />} />
                <Route path="/access/:token" element={<Access />} />
                <Route
                  path="/admin/*"
                  element={
                    user.role === "admin" ? (
                      <Management ui={managementUI} />
                    ) : (
                      <Empty title="Administrator access required" />
                    )
                  }
                />
                <Route
                  path="*"
                  element={
                    <Empty title="Page not found">
                      <Link to="/">Return to overview</Link>
                    </Empty>
                  }
                />
              </Routes>
              <footer>
                Campus Energy{" "}
                <span>One building. Clear evidence. Better decisions.</span>
                <span>
                  Calendar: Asia/Kolkata · Room-master supply actions simulated
                </span>
              </footer>
            </main>
          </div>
        </div>
      )}
    </AppContext.Provider>
  );
}
function Login({ onLogin }) {
  const accessToken = useLocation().pathname.match(
      /^\/access\/([A-Za-z0-9_.-]+)$/,
    )?.[1],
    [accessRoom, setAccessRoom] = useState(null);
  useEffect(() => {
    if (accessToken)
      api(`/access/${accessToken}`)
        .then(setAccessRoom)
        .catch(() => setAccessRoom({ name: "Access URL unavailable" }));
  }, [accessToken]);
  const { act, health } = useApp(),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("login"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [confirmPassword, setConfirmPassword] = useState(""),
    [adminKey, setAdminKey] = useState(""),
    [institutionId, setInstitutionId] = useState(""),
    [institutionName, setInstitutionName] = useState(""),
    [registrationMode, setRegistrationMode] = useState("create"),
    [invitationToken, setInvitationToken] = useState(""),
    [error, setError] = useState("");

  const switchTab = (t) => {
    setTab(t);
    setError("");
    setEmail("");
    setPassword("");
    setName("");
    setConfirmPassword("");
    setAdminKey("");
    setInstitutionId(""); setInstitutionName(""); setInvitationToken(""); setRegistrationMode("create");
  };

  return (
    <div className="login-page">
      <section className="login-story">
        <div className="brand">
          <span className="brand-mark">
            <Activity />
          </span>
          campusenergy
        </div>
        <div>
          <div className="eyebrow">A MORE CONSIDERED CAMPUS</div>
          <h1>
            See the energy.
            <br />
            Make the difference.
          </h1>
          <p>
            Turn building data into clear insights, responsible action and
            measurable progress.
          </p>
          <div className="story-line" />
          <div className="story-stats">
            <span>
              <strong>01</strong>building, connected
            </span>
            <span>
              <strong>100%</strong>accountable actions
            </span>
          </div>
        </div>
        <small>LOCAL PROTOTYPE · SIMULATED HARDWARE</small>
      </section>
      <section className="login-form">
        <div className="eyebrow">CAMPUS ENERGY / OPERATIONS</div>
        <div className="login-tabs">
          <button
            className={tab === "login" ? "login-tab active" : "login-tab"}
            onClick={() => switchTab("login")}
            type="button"
          >
            Sign in
          </button>
          <button
            className={tab === "signup" ? "login-tab active" : "login-tab"}
            onClick={() => switchTab("signup")}
            type="button"
          >
            Create account
          </button>
        </div>
        {tab === "login" ? (
          <>
            <h2>Welcome back</h2>
            <p>
              {accessRoom
                ? `Room access: ${accessRoom.code ?? ""} ${accessRoom.name}. Sign in for server authorisation.`
                : "Sign in to your building workspace."}
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setError("");
                setBusy(true);
                try {
                  const result = await post("/auth/login", { email, password, ...(adminKey.trim() ? { adminKey: adminKey.trim() } : {}), ...(health?.institutionWorkspaces ? { institutionId } : {}) });
                  onLogin(result.user);
                  if (result.user.role === "admin" && !window.location.pathname.startsWith("/access/")) window.location.assign("/admin");
                } catch (err) {
                  setError(err.message || "Sign-in failed. Check your credentials and the API connection.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {health?.institutionWorkspaces && <InstitutionPicker Field={Field} onSelect={setInstitutionId} />}
              <Field label="Email address">
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </Field>
              <Field label="Password">
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </Field>
              <Field label="Admin invite key" hint="Required for administrator sign-in when configured on the server. Leave blank for ordinary login; the server checks enrollment and access.">
                <input type="password" autoComplete="off" inputMode="numeric" pattern="[0-9]{8}" maxLength={8} value={adminKey} onChange={(e) => setAdminKey(e.target.value)} placeholder="8-digit administrator key" />
              </Field>
              {health?.institutionWorkspaces && <details className="section-gap"><summary>Accept an invitation with an existing account</summary><Field label="Invitation for existing account"><input type="password" autoComplete="off" value={invitationToken} onChange={event => setInvitationToken(event.target.value)} maxLength={200} /></Field><button type="button" className="button secondary" disabled={busy || !invitationToken.trim() || !email || !password} onClick={async () => {
                setBusy(true); setError("");
                try { const result = await post("/auth/accept-invitation", { email, password, invitationToken: invitationToken.trim() });
                  if (result.user) onLogin(result.user); else { setInstitutionId(result.institution._id); setError("Membership added. Select your institution and sign in with its administrator requirements."); }
                } catch (failure) { setError(failure.message); } finally { setBusy(false); }
              }}>Accept membership invitation</button></details>}
              <ErrorText>{error}</ErrorText>
              <button className="button" disabled={busy}>
                {busy ? "Signing in…" : "Sign in to workspace"}
                <ArrowRight size={18} />
              </button>
            </form>
            <div className="login-help">
              <ShieldCheck size={20} />
              <p>
                {health?.institutionWorkspaces ? <>Select your institution before signing in. For the optional <strong>Campus Energy Demo</strong>, use the dedicated credentials supplied by your administrator.</> : <>Demo accounts use <strong>role@campus.test</strong>. Use the
                generated local <code>DEMO_PASSWORD</code> from your ignored{" "}
                <code>.env</code> file. Credentials are never embedded in the
                website.</>}
              </p>
            </div>
          </>
        ) : (
          <>
            <h2>Create account</h2>
            <p>{health?.institutionWorkspaces ? "Create an empty institution as administrator, or join an existing workspace with an invitation." : "New accounts start as viewers. Leave the admin key blank unless you have one."}</p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setError("");
                if (password !== confirmPassword) {
                  setError("Passwords do not match.");
                  return;
                }
                if (password.length < (health?.institutionWorkspaces ? 12 : 8)) {
                  setError(`Password must be at least ${health?.institutionWorkspaces ? 12 : 8} characters.`);
                  return;
                }
                setBusy(true);
                try {
                  const body = { name, email, password };
                  if (adminKey.trim()) body.adminKey = adminKey.trim();
                  if (health?.institutionWorkspaces) {
                    body.registrationMode = registrationMode;
                    if (registrationMode === "create") body.institutionName = institutionName.trim();
                    else body.invitationToken = invitationToken.trim();
                  }
                  const result = await post("/auth/register", body);
                  onLogin(result.user);
                  if (result.user.role === "admin") window.location.assign("/admin");
                } catch (err) {
                  setError(err.message || "Sign-up failed. Please try again.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {health?.institutionWorkspaces && <Field label="Account setup"><select value={registrationMode} onChange={event => { setRegistrationMode(event.target.value); setInstitutionName(""); setInvitationToken(""); setAdminKey(""); setError(""); }}><option value="create">Create a new institution (administrator)</option><option value="join">Join an existing institution (invitation)</option></select></Field>}
              <Field label="Full name">
                <input
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </Field>
              <Field label="Email address">
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </Field>
              <Field label="Password" hint={health?.institutionWorkspaces ? "Minimum 12 characters" : "Minimum 8 characters"}>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={health?.institutionWorkspaces ? 12 : 8}
                />
              </Field>
              <Field label="Confirm password">
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </Field>
              {health?.institutionWorkspaces && <>
                {registrationMode === "create" ? <Field label="Institution / building name for new administrator"><input value={institutionName} onChange={event => setInstitutionName(event.target.value)} maxLength={200} required placeholder="Your institution's single-building workspace" /></Field> : <Field label="Membership invitation (joining an existing institution)"><input type="password" value={invitationToken} onChange={event => setInvitationToken(event.target.value)} maxLength={200} required autoComplete="off" placeholder="Invitation issued by your institution administrator" /></Field>}
                <p className="caption">{registrationMode === "create" ? "Use your server admin key to create an empty, private institution. No membership invitation is needed." : "Use the membership invitation issued by that institution's administrator. This is different from the server admin key. Administrator invitations also require the admin key."}</p>
              </>}
              <Field label="Admin invite key" hint="New workspace administrator enrollment; existing-institution members use an invitation">
                <input
                  type="password"
                  autoComplete="off"
                  inputMode="numeric"
                  pattern="[0-9]{8}"
                  maxLength={8}
                  value={adminKey}
                  onChange={(e) => setAdminKey(e.target.value)}
                  required={!!health?.institutionWorkspaces && registrationMode === "create"}
                  placeholder="8-digit key to register as admin"
                />
              </Field>
              <ErrorText>{error}</ErrorText>
              <button className="button" disabled={busy}>
                {busy ? "Creating account…" : "Create account"}
                <ArrowRight size={18} />
              </button>
            </form>
            <div className="login-help">
              <ShieldCheck size={20} />
              <p>
                Already have an account?{" "}
                <button
                  type="button"
                  className="text-link"
                  style={{ display: "inline", padding: 0 }}
                  onClick={() => switchTab("login")}
                >
                  Sign in
                </button>
              </p>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function ConsumptionChart({ intervals = [], range = 7 }) {
  return (
    <React.Suspense
      fallback={<div className="empty">Loading the consumption profile…</div>}
    >
      <LazyConsumptionChart intervals={intervals} range={range} />
    </React.Suspense>
  );
}
function BuildingLabel() {
  const [settings] = useData("/settings");
  return <span>{settings?.installationName ?? "Building workspace"}</span>;
}
function Overview() {
  const { user } = useApp();
  const [summary, error] = useData("/analytics/summary"),
    [intervals, intervalError] = useData("/analytics/intervals"),
    [incidents, incidentError] = useData("/incidents"),
    [integrations] = useData("/integrations"),
    [recommendations] = useData("/recommendations"),
    [rooms] = useData("/rooms");
  const [range, setRange] = useState(7);
  const open = (incidents ?? []).filter((i) => i.active),
    latest = intervals?.at(-1);
  if (!summary || !intervals || !incidents)
    return (
      <>
        <PageHead
          title="A clearer view of your energy."
          description="Monitor consumption. Find opportunities. Keep the right people in the loop."
        />
        <ErrorText>{error || intervalError || incidentError}</ErrorText>
        <Empty
          title={
            error || intervalError || incidentError
              ? "Building data unavailable"
              : "Loading accepted building data"
          }
        >
          Checking original intervals, coverage and incident status?
        </Empty>
      </>
    );
  return (
    <>
      <PageHead
        title="A clearer view of your energy."
        description="Monitor consumption. Find opportunities. Keep the right people in the loop."
      >
        <span className="date-chip">
          <CalendarDays size={15} />
          {new Intl.DateTimeFormat("en-IN", {
            timeZone: "Asia/Kolkata",
            dateStyle: "medium",
          }).format(new Date())}
        </span>
      </PageHead>
      <ErrorText>{error}</ErrorText>
      {user.role === "admin" && <PhoneDemoSummary user={user} useData={useData} />}
      <div className="metric-grid">
        {[
          [
            PlugZap,
            "Energy today",
            `${number(summary?.todayKwh)} kWh`,
            `${number(summary?.coverageHours)} hours covered · ${summary?.partialDay ? "partial day" : "full day"}`,
          ],
          [
            ChartNoAxesCombined,
            "Average interval power",
            `${number(latest?.averagePowerKw)} kW`,
            "Latest accepted interval · not instantaneous",
          ],
          [
            TriangleAlert,
            "Open energy anomalies",
            number(summary?.anomalies, 0),
            "Evidence-led investigation required",
          ],
          [
            Bell,
            "Active incidents",
            number(open.length, 0),
            "Assigned actions across this building",
          ],
        ].map(([Icon, label, value, note], i) => (
          <section className="metric-card" key={label}>
            <div className="metric-top">
              <span>{label}</span>
              <Icon size={19} />
            </div>
            <strong>{value}</strong>
            <small>{note}</small>
            <div className={`metric-line line-${i}`} />
          </section>
        ))}
      </div>
      <div className="overview-grid">
        <section className="panel chart-panel">
          <div className="section-title">
            <div>
              <div className="eyebrow">CONSUMPTION PROFILE</div>
              <h2>Actual & expected energy</h2>
            </div>
            <div className="segmented">
              {[1, 7, 30].map((v) => (
                <button
                  key={v}
                  onClick={() => setRange(v)}
                  className={range === v ? "selected" : ""}
                >
                  {v === 1 ? "24h" : `${v}d`}
                </button>
              ))}
            </div>
          </div>
          <div className="chart-summary">
            <strong>
              {number(
                (intervals ?? [])
                  .slice(-24)
                  .reduce((s, i) => s + i.energyKwh, 0),
              )}
              <span>kWh · latest 24 intervals</span>
            </strong>
            <Badge
              tone={summary?.sourceLabel === "Simulated" ? "amber" : "sage"}
            >
              {summary?.sourceLabel ?? "Unknown"}
            </Badge>
          </div>
          <ConsumptionChart intervals={intervals ?? []} range={range} />
          <p className="caption">
            Latest accepted meter time: {date(summary.latestMeterAt)} · Today's
            energy-only cost: {money(summary.energyCost)} estimated at{" "}
            {money(summary.tariff)}/kWh.
          </p>
        </section>
        <section className="panel operation-panel">
          <div className="section-title">
            <h2>Integration health</h2>
            <Activity size={18} />
          </div>
          <p className="muted">Availability is part of the evidence.</p>
          {(integrations ?? []).slice(0, 5).map((i) => (
            <div className="health-row" key={i._id}>
              <span
                className={`health-indicator ${i.health === "online" ? "is-online" : ""}`}
              />
              <div>
                <strong>{i.name}</strong>
                <small>
                  {i.capabilities?.fixtureReplay
                    ? "Fixture replay adapter"
                    : "Optional integration"}
                </small>
              </div>
              <Badge tone={i.health === "online" ? "sage" : "neutral"}>
                {i.health}
              </Badge>
            </div>
          ))}
          <div className="callout">
            <ShieldCheck size={20} />
            <p>
              <strong>Conservative by design</strong>Unknown occupancy blocks
              automatic vacancy cutoff. Physical hardware is disconnected.
            </p>
          </div>
        </section>
      </div>
      <div className="overview-grid bottom-grid">
        <section className="panel">
          <div className="section-title">
            <div>
              <div className="eyebrow">FOLLOW THROUGH</div>
              <h2>Needs attention</h2>
            </div>
            <Link className="text-link" to="/incidents">
              View incidents <ArrowUpRight size={16} />
            </Link>
          </div>
          {open.length ? (
            open.slice(0, 4).map((i) => (
              <Link className="attention-row" key={i._id} to="/incidents">
                <span className="attention-icon">
                  <TriangleAlert size={18} />
                </span>
                <div>
                  <strong>{i.title}</strong>
                  <small>
                    {i.type === "energy"
                      ? "Building-level anomaly · cause unconfirmed"
                      : "Room-level review"}{" "}
                    · {date(i.openedAt)}
                  </small>
                </div>
                <Badge tone="amber">{i.state.replaceAll("_", " ")}</Badge>
                <ArrowRight size={17} />
              </Link>
            ))
          ) : (
            <Empty title="No open incidents">
              New evidence will appear here when investigation is needed.
            </Empty>
          )}
        </section>
        <section className="opportunity-panel">
          <div className="eyebrow">FROM INSIGHT TO IMPACT</div>
          <Lightbulb size={28} />
          <h2>
            Make the next
            <br />
            useful change.
          </h2>
          <p>
            {
              (recommendations ?? []).filter((r) => r.status === "proposed")
                .length
            }{" "}
            recommendations ready for review. Each includes evidence, an owner
            and disclosed assumptions.
          </p>
          <Link className="button" to="/recommendations">
            Explore opportunities <ArrowUpRight size={16} />
          </Link>
          <small>Estimates are not verified savings.</small>
        </section>
      </div>
      <section className="panel section-gap overview-ledger">
        <div className="section-title">
          <div><div className="eyebrow">FACILITY REGISTRY / EVIDENCE LEDGER</div><h2>Rooms & supply status</h2></div>
          <Link className="text-link" to="/rooms">Inspect all rooms <ArrowRight size={16} /></Link>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Enclosure / space</th><th>Observed occupancy</th><th>Authorised use</th><th>Room master</th><th>Action</th></tr></thead>
            <tbody>{(rooms ?? []).map((room) => <RoomLedgerRow key={room._id} room={room} />)}</tbody>
          </table>
        </div>
        {!rooms?.length && <Empty title="No registered rooms">Configure rooms in the facility registry.</Empty>}
      </section>
      <section className="section-gap">
        <div className="section-title"><h2>Active conservation directives</h2><Link className="text-link" to="/recommendations">View recommendations <ArrowRight size={16} /></Link></div>
        <div className="directive-grid">{(recommendations ?? []).filter((r) => r.status === "proposed").slice(0, 2).map((r) => (
          <Link className="panel directive-card" key={r._id} to="/recommendations"><div className="section-title"><Badge tone="sage">{r.status}</Badge><ArrowUpRight size={17} /></div><h2>{r.title}</h2><p>{r.description ?? "Review the supporting evidence, assumptions and assigned action."}</p><span className="text-link">Inspect directive <ArrowRight size={14} /></span></Link>
        ))}</div>
      </section>
    </>
  );
}

function RoomLedgerRow({ room }) {
  const [status] = useData(`/rooms/${room._id}/status`);
  return <tr><td><strong>{room.name}</strong><small>{room.code} / {room.capacity} seats</small></td><td><Badge tone={status?.observed.state === "occupied" ? "sage" : "neutral"}>{status?.observed.state ?? "unknown"}</Badge><small>{status?.observed.reason}</small></td><td>{status?.protectedBy?.replaceAll("_", " ") ?? "None active"}</td><td><Badge>{status?.breaker?.reportedSupply?.toUpperCase() ?? "UNKNOWN"}</Badge><small>Simulated / {room.roomBreakerId}</small></td><td><Link className="button secondary" to={`/rooms?room=${encodeURIComponent(room._id)}`}>Review <ArrowUpRight size={13} /></Link></td></tr>;
}

function Rooms() {
  const location = useLocation();
  const { user, act } = useApp(),
    [rooms, error] = useData("/rooms"),
    [selected, setSelected] = useState(new URLSearchParams(location.search).get("room")),
    [showAdd, setShowAdd] = useState(false),
    [query, setQuery] = useState(""),
    [policy, setPolicy] = useState("all"),
    [view, setView] = useState("grid");
  const filtered = (rooms ?? []).filter((room) =>
    `${room.name} ${room.code} ${room.roomBreakerId}`.toLowerCase().includes(query.toLowerCase()) &&
    (policy === "all" || room.controlMode === policy));
  return (
    <>
      <PageHead
        title="Rooms, with context."
        description="Occupancy, authorised use and supply state stay separate."
      >
        {user.role === "admin" && (
          <Button onClick={() => setShowAdd(true)}>
            <Plus size={17} />
            Add room
          </Button>
        )}
      </PageHead>
      <ErrorText>{error}</ErrorText>
      <section className="room-toolbar" aria-label="Room filters">
        <div className="segmented policy-filter">{[["all", "All rooms"], ["alert_only", "Alert-only"], ["simulated", "Simulated control"]].map(([value, label]) => <button key={value} onClick={() => setPolicy(value)} className={policy === value ? "selected" : ""} aria-pressed={policy === value}>{label}</button>)}</div>
        <label className="room-search"><Search size={16} /><input aria-label="Search rooms" placeholder="Filter by room, code or master…" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <div className="segmented"><button aria-label="Grid view" aria-pressed={view === "grid"} className={view === "grid" ? "selected" : ""} onClick={() => setView("grid")}><Grid2X2 size={16} /></button><button aria-label="List view" aria-pressed={view === "list"} className={view === "list" ? "selected" : ""} onClick={() => setView("list")}><List size={16} /></button></div>
      </section>
      <div className="registry-count" role="status">{filtered.length} OF {rooms?.length ?? 0} REGISTERED SPACES <span>OBSERVATION / AUTHORISED USE / SUPPLY</span></div>
      <div className={`room-grid ${view === "list" ? "room-list" : ""}`}>
        {filtered.map((room) => (
          <RoomCard
            room={room}
            key={room._id}
            onOpen={() => setSelected(room._id)}
          />
        ))}
      </div>
      {!!rooms?.length && !filtered.length && <Empty title="No matching rooms">Try another room name or control policy.</Empty>}
      {!rooms?.length && (
        <Empty title="No rooms in your scope">
          An administrator can configure rooms and assignments.
        </Empty>
      )}
      {selected && (
        <Modal title="Room details & supply" onClose={() => setSelected(null)}>
          <RoomDetail roomId={selected} />
        </Modal>
      )}
      {showAdd && (
        <Modal title="Add a room" onClose={() => setShowAdd(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.target);
              const r = await act(
                () =>
                  post("/rooms", {
                    code: f.get("code"),
                    name: f.get("name"),
                    roomBreakerId: f.get("master"),
                    capacity: Number(f.get("capacity")),
                  }),
                "Room created in alert-only mode",
              );
              if (r) setShowAdd(false);
            }}
          >
            <Field label="Room code">
              <input name="code" required maxLength={30} />
            </Field>
            <Field label="Room name">
              <input name="name" required />
            </Field>
            <Field label="Master breaker ID">
              <input name="master" required pattern="[A-Za-z0-9_-]+" />
            </Field>
            <Field label="Capacity">
              <input name="capacity" type="number" min="0" defaultValue="30" />
            </Field>
            <p className="caption">
              New rooms are alert-only. Inventory and independent supplies must
              be reviewed before simulated operation.
            </p>
            <Button>Create room</Button>
          </form>
        </Modal>
      )}
    </>
  );
}
function RoomCard({ room, onOpen }) {
  const [status] = useData(`/rooms/${room._id}/status`);
  return (
    <section className="panel room-card">
      <div className="section-title">
        <span className="room-code">{room.code}</span>
        <Badge
          tone={status?.observed.state === "occupied" ? "sage" : "neutral"}
        >
          {status?.observed.state ?? "unknown"}
        </Badge>
      </div>
      <h2>{room.name}</h2>
      <p className="muted">{room.capacity || "—"} seats · one room master</p>
      <div className="room-facts">
        <div>
          <span>Observed occupancy</span>
          <strong>{status?.observed.state ?? "Unknown"}</strong>
          <small>Presence evidence / not a headcount</small>
        </div>
        <div>
          <span>Supply · simulated</span>
          <strong>
            {status?.breaker?.reportedSupply?.toUpperCase() ?? "UNKNOWN"}
          </strong>
        </div>
        <div>
          <span>Authorised-use protection</span>
          <strong>
            {status?.protectedBy?.replaceAll("_", " ") ?? "None active"}
          </strong>
        </div>
        <div>
          <span>Control policy</span>
          <strong>{room.controlMode.replaceAll("_", " ")}</strong>
        </div>
      </div>
      <p className="caption">
        {status?.observed.reason ?? "Checking evidence…"}
      </p>
      <button className="room-open" onClick={onOpen}>
        View room & actions <ArrowRight size={16} />
      </button>
    </section>
  );
}
function RoomDetail({ roomId }) {
  const { user, act } = useApp(),
    [status, error] = useData(`/rooms/${roomId}/status`);
  if (!status) return <ErrorText>{error || "Loading room…"}</ErrorText>;
  return (
    <>
      <ErrorText>{error}</ErrorText>
      <div className="detail-header">
        <span className="room-code">{status.room.code}</span>
        <h3>{status.room.name}</h3>
        <Badge tone="amber">
          Simulated supply {status.breaker.reportedSupply.toUpperCase()}
        </Badge>
      </div>
      <p>{status.observed.reason}</p>
      <div className="detail-metrics">
        <div><span>OBSERVED OCCUPANCY</span><strong>{status.observed.state}</strong><small>Latest available evidence</small></div>
        <div><span>AUTHORISED USE</span><strong>{status.protectedBy?.replaceAll("_", " ") ?? "None active"}</strong><small>Booking, access or override</small></div>
        <div><span>MASTER SUPPLY / SIMULATED</span><strong>{status.breaker.reportedSupply.toUpperCase()}</strong><small>{status.room.roomBreakerId}</small></div>
      </div>
      <p className="caption">
        Master: {status.room.roomBreakerId}. All approved ordinary loads share
        this supply. Separately reviewed native OFF actions for existing smart
        equipment are managed under Connected devices.
      </p>
      {roleCan(user, RESPONDERS) && (
        <div className="action-row">
          {["on", "off"].map((action) => (
            <Button
              secondary
              key={action}
              onClick={() =>
                act(
                  () =>
                    post(`/rooms/${roomId}/supply-commands`, {
                      requestId: crypto.randomUUID(),
                      action,
                      reason: "staff_override",
                    }),
                  `Simulated room supply ${action.toUpperCase()}`,
                )
              }
            >
              <PlugZap size={16} />
              Supply {action.toUpperCase()}
            </Button>
          ))}
        </div>
      )}
      {user.role === "admin" && (
        <Field label="Automatic policy">
          <select
            value={status.room.controlMode}
            onChange={(e) =>
              act(
                () =>
                  patch(`/rooms/${roomId}`, { controlMode: e.target.value }),
                "Policy updated; old vacancy work cancelled",
              )
            }
          >
            <option value="alert_only">Alert-only</option>
            <option value="simulated">Simulated automatic control</option>
          </select>
        </Field>
      )}
      <h3>Registered downstream loads</h3>
      {user.role === "admin" && <InventoryForm roomId={roomId} />}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Load</th>
              <th>Rated W · estimate</th>
              <th>Shared cutoff</th>
            </tr>
          </thead>
          <tbody>
            {status.devices.map((d) => (
              <tr key={d._id}>
                <td>{d.name}</td>
                <td>{number(d.ratedWatts, 0)}</td>
                <td>
                  <Badge
                    tone={
                      d.supplyInterruptionApproved && !d.essential
                        ? "sage"
                        : "amber"
                    }
                  >
                    {d.supplyInterruptionApproved && !d.essential
                      ? "Approved fixture"
                      : "Blocked"}
                  </Badge>
                  <DevicePolicy record={d} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {roleCan(user, STAFF) && (
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.target);
            await act(
              () =>
                post(`/rooms/${roomId}/overrides`, {
                  reason: f.get("reason"),
                  durationMinutes: Number(f.get("duration")),
                }),
              "Time-limited override created",
            );
          }}
        >
          <h3>Protect authorised room use</h3>
          <Field label="Override reason">
            <input name="reason" required minLength={3} />
          </Field>
          <Field label="Duration in policy minutes">
            <input
              name="duration"
              type="number"
              defaultValue="30"
              min="1"
              max="120"
            />
          </Field>
          <Button secondary>Create override</Button>
        </form>
      )}
      {status.overrides.map((o) => (
        <div key={o._id} className="list-row">
          <span>
            {o.reason} · <Clock until={o.expiresAt} />
          </span>
          {(o.creatorId === user._id || user.role === "admin") && (
            <Button
              secondary
              onClick={() =>
                act(() => post(`/overrides/${o._id}/end`), "Override ended")
              }
            >
              End
            </Button>
          )}
        </div>
      ))}
      {user.role === "admin" && (
        <>
          <h3>Isolated demonstration</h3>
          <p className="caption">
            These scenarios generate labelled fixtures. They do not run a camera
            model.
          </p>
          <div className="action-row">
            {[
              ["normal-class", "Normal class"],
              ["forgotten-lights", "Forgotten lights"],
              ["person-returns", "Person returns"],
              ["camera-offline", "Camera offline"],
              ["unknown-cause", "Unknown cause"],
              ["building-anomaly", "Building anomaly"],
              ["optimisation", "Optimisation"],
              ["qr-access", "QR access demo"],
            ].map(([key, label]) => (
              <Button
                secondary
                key={key}
                onClick={() =>
                  act(
                    () => post(`/demo/scenarios/${key}/start`, { roomId }),
                    `${label} fixture started`,
                  )
                }
              >
                {label}
              </Button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function Energy() {
  const { user, act } = useApp(),
    [intervals, error] = useData("/analytics/intervals"),
    [readings] = useData("/meter-readings"),
    [type, setType] = useState("meter"),
    [csv, setCsv] = useState(""),
    [preview, setPreview] = useState(null),
    [range, setRange] = useState(7);
  return (
    <>
      <PageHead
        title="Every interval tells a story."
        description="Accepted meter data, transparent gaps and explainable comparisons."
      />
      <ErrorText>{error}</ErrorText>
      <section className="panel">
        <div className="section-title">
          <h2>Building consumption</h2>
          <div className="segmented">
            {[1, 7, 30].map((v) => (
              <button
                className={range === v ? "selected" : ""}
                key={v}
                onClick={() => setRange(v)}
              >
                {v}d
              </button>
            ))}
          </div>
        </div>
        <ConsumptionChart intervals={intervals ?? []} range={range} />
      </section>
      <div className="two-columns section-gap">
        {user.role === "admin" && (
          <section className="panel">
            <div className="section-title">
              <h2>Import with confidence</h2>
              <Upload size={20} />
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const result = await act(
                  () =>
                    post(
                      type === "meter"
                        ? "/imports/meter-readings"
                        : "/imports/timetable",
                      { csv, dataMode: "simulated" },
                    ),
                  "Preview ready; review before commit",
                );
                if (result) setPreview(result);
              }}
            >
              <Field label="Import format">
                <select
                  value={type}
                  onChange={(e) => {
                    setType(e.target.value);
                    setPreview(null);
                  }}
                >
                  <option value="meter">
                    Meter CSV · cumulative or interval
                  </option>
                  <option value="timetable">Timetable CSV</option>
                </select>
              </Field>
              <Field label="Choose a CSV file">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={async (e) => {
                    const f = e.target.files[0];
                    if (f) {
                      if (f.size > 1048576) {
                        await act(() =>
                          Promise.reject(new Error("CSV must be at most 1 MB")),
                        );
                        return;
                      }
                      setCsv(await f.text());
                      setPreview(null);
                    }
                  }}
                />
              </Field>
              <Field
                label="CSV content"
                hint={
                  type === "meter"
                    ? "Cumulative: meterId,capturedAt,readingKwh,register,source · Interval: meterId,intervalStart,intervalEnd,energyKwh"
                    : "roomCode,startAt,endAt,title,status · Dates require timezone offsets."
                }
              >
                <textarea
                  rows={6}
                  value={csv}
                  onChange={(e) => {
                    setCsv(e.target.value);
                    setPreview(null);
                  }}
                  required
                />
              </Field>
              <Button>
                <Upload size={16} />
                Preview import
              </Button>
            </form>
            {preview && (
              <div className="preview">
                <h3>Preview results</h3>
                <p>
                  {preview.rows.length} parsed rows · {preview.errors.length}{" "}
                  invalid · {preview.duplicates} duplicates
                </p>
                <p className="caption">
                  Explicit timestamp offsets required; default epoch initial;
                  data mode Simulated. Invalid rows block commit.
                </p>
                {preview.errors.map((e) => (
                  <ErrorText key={e.row}>
                    Row {e.row}: {e.message}
                  </ErrorText>
                ))}
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Record</th>
                        <th>Time</th>
                        <th>Value/title</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.slice(0, 8).map((r, i) => (
                        <tr key={i}>
                          <td>{r.meterId ?? r.roomId}</td>
                          <td>{date(r.capturedAt ?? r.startAt)}</td>
                          <td>{r.value ?? r.title}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Button
                  disabled={
                    !!preview.errors.length || preview.status === "committed"
                  }
                  onClick={async () => {
                    const result = await act(
                      () => post(`/imports/${preview._id}/commit`),
                      "Import committed; analytics refreshed",
                    );
                    if (result) setPreview({ ...preview, status: "committed" });
                  }}
                >
                  Commit accepted preview
                </Button>
              </div>
            )}
          </section>
        )}
        {roleCan(user, RESPONDERS) && (
          <section className="panel">
            <h2>Manual meter reading</h2>
            <p className="muted">
              Use the configured cumulative import-kWh register.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.target);
                await act(
                  () =>
                    post("/meter-readings", {
                      eventId: crypto.randomUUID(),
                      meterId: f.get("meterId"),
                      epoch: f.get("epoch"),
                      value: Number(f.get("value")),
                      capturedAt: new Date(f.get("capturedAt")).toISOString(),
                      dataMode: "simulated",
                      sourceType: "manual",
                    }),
                  "Reading submitted; review its validation state below",
                );
              }}
            >
              <div className="two-columns">
                <Field label="Meter ID">
                  <input name="meterId" defaultValue="MAIN-01" required />
                </Field>
                <Field label="Meter epoch">
                  <input name="epoch" defaultValue="initial" required />
                </Field>
              </div>
              <Field label="Cumulative import reading (kWh)">
                <input
                  name="value"
                  type="number"
                  min="0"
                  step="0.001"
                  required
                />
              </Field>
              <Field label="Capture time · your browser local time">
                <input
                  name="capturedAt"
                  type="datetime-local"
                  defaultValue={localInput()}
                  required
                />
              </Field>
              <Button>Add reading</Button>
            </form>
            <div className="callout">
              <TriangleAlert size={19} />
              <p>
                Use Meter cameras for reviewed image OCR, or enter the value manually
                after checking the register. Hourly readings show average power,
                not instantaneous demand.
              </p>
            </div>
          </section>
        )}
      </div>
      <section className="panel section-gap">
        <div className="section-title">
          <h2>Recent meter observations</h2>
          <Badge tone="amber">Provenance preserved</Badge>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Captured · pilot time</th>
                <th>Meter / epoch</th>
                <th>Input</th>
                <th>Value</th>
                <th>Validation</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {(readings ?? []).slice(0, 30).map((r) => (
                <tr key={r._id}>
                  <td>{date(r.capturedAt)}</td>
                  <td>
                    {r.meterId}
                    <small>{r.epoch}</small>
                  </td>
                  <td>{r.kind}</td>
                  <td>{number(r.value, 3)} kWh</td>
                  <td>
                    <Badge
                      tone={r.validationState === "accepted" ? "sage" : "amber"}
                    >
                      {r.validationState.replaceAll("_", " ")}
                    </Badge>
                    <small>{r.validationReason}</small>
                  </td>
                  <td>
                    <Badge tone="amber">{r.dataMode}</Badge>
                    <small>{r.sourceType}</small>
                    <ReadingReview record={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Timetable() {
  const { user, act } = useApp(),
    [rows, error] = useData("/schedules"),
    [rooms] = useData("/rooms");
  return (
    <>
      <PageHead
        title="Right room. Right time."
        description="Current bookings and preparation windows protect authorised use."
      />
      <ErrorText>{error}</ErrorText>
      {roleCan(user, STAFF) && (
        <section className="panel">
          <h2>Create a room booking</h2>
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.target);
              const result = await act(
                () =>
                  post("/schedules", {
                    roomId: f.get("roomId"),
                    title: f.get("title"),
                    startAt: new Date(f.get("start")).toISOString(),
                    endAt: new Date(f.get("end")).toISOString(),
                  }),
                "Booking saved; stale vacancy work cancelled",
              );
              if (result) e.target.reset();
            }}
          >
            <Field label="Room">
              <select name="roomId" required>
                {(rooms ?? []).map((r) => (
                  <option key={r._id} value={r._id}>
                    {r.code} · {r.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Booking title">
              <input name="title" required />
            </Field>
            <Field label="Start · browser local time">
              <input name="start" type="datetime-local" required />
            </Field>
            <Field label="End · browser local time">
              <input name="end" type="datetime-local" required />
            </Field>
            <Button>
              <Plus size={16} />
              Add booking
            </Button>
          </form>
        </section>
      )}
      <section className="panel section-gap">
        <div className="section-title">
          <h2>Room schedule</h2>
          <Badge>15-minute preparation window</Badge>
        </div>
        {rows?.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Room</th>
                  <th>Booking</th>
                  <th>Start</th>
                  <th>End</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s._id}>
                    <td>
                      {rooms?.find((r) => r._id === s.roomId)?.code ?? s.roomId}
                    </td>
                    <td>{s.title}</td>
                    <td>{date(s.startAt)}</td>
                    <td>{date(s.endAt)}</td>
                    <td>
                      <Badge
                        tone={s.status === "confirmed" ? "sage" : "neutral"}
                      >
                        {s.status}
                      </Badge>
                    </td>
                    <td>
                      {roleCan(user, STAFF) && s.status === "confirmed" && (
                        <Button
                          secondary
                          onClick={() =>
                            act(
                              () =>
                                patch(`/schedules/${s._id}`, {
                                  status: "cancelled",
                                }),
                              "Booking cancelled; current evidence will be re-evaluated",
                            )
                          }
                        >
                          Cancel
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="The timetable is ready for your first booking">
            Import a timetable CSV from Energy & imports, or add an ad hoc
            booking.
          </Empty>
        )}
      </section>
    </>
  );
}

function Incidents() {
  const [rows, error] = useData("/incidents"),
    [notifications] = useData("/notifications"),
    [selected, setSelected] = useState(null),
    [filter, setFilter] = useState("active"),
    { act } = useApp();
  const visible = (rows ?? []).filter(
    (r) => filter === "all" || (filter === "active" ? r.active : !r.active),
  );
  return (
    <>
      <PageHead
        title="A signal. An owner. An outcome."
        description="Durable escalation and an evidence trail for every investigation."
      />
      <ErrorText>{error}</ErrorText>
      <div className="two-columns">
        <section className="panel">
          <div className="section-title">
            <h2>Incident queue</h2>
            <select
              aria-label="Filter incident status"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="active">Active</option>
              <option value="closed">Closed</option>
              <option value="all">All incidents</option>
            </select>
          </div>
          {visible.length ? (
            visible.map((r) => (
              <button
                className="incident-row"
                key={r._id}
                onClick={() => setSelected(r._id)}
              >
                <span className="attention-icon">
                  <TriangleAlert size={19} />
                </span>
                <span>
                  <strong>{r.title}</strong>
                  <small>
                    {date(r.openedAt)} · {r.type.replaceAll("_", " ")}
                  </small>
                </span>
                <Badge tone={r.active ? "amber" : "sage"}>
                  {r.state.replaceAll("_", " ")}
                </Badge>
                <ArrowRight size={16} />
              </button>
            ))
          ) : (
            <Empty title="No matching incidents">
              Try a different status, or start a labelled scenario from a room.
            </Empty>
          )}
        </section>
        <section className="panel">
          <div className="section-title">
            <h2>In-app inbox</h2>
            <Bell size={19} />
          </div>
          <p className="caption">
            Persisted delivery is distinct from staff acknowledgement and
            resolution.
          </p>
          {notifications?.length ? (
            notifications.slice(0, 12).map((n) => (
              <div className="notification-row" key={n._id}>
                <Badge tone={n.state === "failed" ? "amber" : "sage"}>
                  {n.state}
                </Badge>
                <strong>{n.title}</strong>
                <p>{n.message}</p>
                <small>
                  {date(n.createdAt)} · stage {n.stage}
                </small>
                {!n.readAt && (
                  <button
                    className="text-link"
                    onClick={() =>
                      act(
                        () => post(`/notifications/${n._id}/read`),
                        "Marked read; incident remains unresolved",
                      )
                    }
                  >
                    Mark read <Check size={14} />
                  </button>
                )}
              </div>
            ))
          ) : (
            <Empty title="No notifications yet">
              The worker persists in-app alerts even when the browser is closed.
            </Empty>
          )}
        </section>
      </div>
      {selected && (
        <Modal title="Incident timeline" onClose={() => setSelected(null)}>
          <IncidentDetail incidentId={selected} />
        </Modal>
      )}
    </>
  );
}
function IncidentDetail({ incidentId }) {
  const { user, act } = useApp(),
    [incident, error] = useData(`/incidents/${incidentId}`),
    [users] = useData("/users"),
    [reason, setReason] = useState(""),
    [reassignFirst, setReassignFirst] = useState(""),
    [reassignSecond, setReassignSecond] = useState("");
  if (!incident) return <ErrorText>{error || "Loading incident…"}</ErrorText>;
  const job = incident.jobs.find((j) =>
    ["pending", "leased"].includes(j.status),
  );
  return (
    <>
      <h3>{incident.title}</h3>
      <div className="action-row">
        <Badge tone={incident.active ? "amber" : "sage"}>
          {incident.state.replaceAll("_", " ")}
        </Badge>
        <span className="caption">
          <Clock until={job?.dueAt} />
        </span>
      </div>
      <p className="caption">
        Opened {date(incident.openedAt)}. Building anomalies retain an
        unconfirmed cause until inspection establishes evidence.
      </p>
      <div className="timeline">
        {incident.timeline.map((entry, index) => (
          <div className="timeline-item" key={index}>
            <span className="timeline-dot" />
            <div>
              <strong>{entry.event.replaceAll("_", " ")}</strong>
              <small>{date(entry.at)}</small>
              {entry.reason && <p>{entry.reason}</p>}
              {entry.verification && (
                <Badge tone="amber">{entry.verification}</Badge>
              )}
            </div>
          </div>
        ))}
      </div>
      {incident.commands.map((c) => (
        <div className="callout" key={c._id}>
          <PlugZap size={18} />
          <p>
            <strong>
              Supply {c.action.toUpperCase()} ·{" "}
              {c.result?.verification ?? "unverified"}
            </strong>
            {c.result?.dataMode ?? "Unknown"} · transport{" "}
            {c.result?.transportStatus ?? "unknown"}. No independent physical
            operation is established.
          </p>
        </div>
      ))}
      {incident.active && roleCan(user, RESPONDERS) && (
        <>
          <Field label="Inspection or resolution evidence">
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Record what was inspected and what remains uncertain."
            />
          </Field>
          <div className="action-row">
            {[
              ["acknowledge", "Acknowledge"],
              ["inspect", "Inspecting"],
              ["snooze", "Snooze 5 min"],
              ["resolve", "Resolve with evidence"],
            ].map(([action, label]) => (
              <Button
                key={action}
                secondary={action !== "resolve"}
                disabled={action === "resolve" && !reason.trim()}
                onClick={() =>
                  act(
                    () =>
                      post(`/incidents/${incidentId}/${action}`, {
                        reason,
                        ...(action === "snooze" ? { durationMinutes: 5 } : {}),
                      }),
                    `${label} recorded`,
                  )
                }
              >
                {label}
              </Button>
            ))}
          </div>
          <p className="caption">
            Acknowledgement is not resolution. Snooze deadlines use persisted
            backend time.
          </p>
          {user.role === "admin" && (
            <form
              className="inline-form"
              onSubmit={async (e) => {
                e.preventDefault();
                await act(
                  () =>
                    post(`/incidents/${incidentId}/reassign`, {
                      ...(reassignFirst ? { firstResponderId: reassignFirst } : {}),
                      ...(reassignSecond ? { secondResponderId: reassignSecond } : {}),
                    }),
                  "Responders reassigned",
                );
              }}
            >
              <h3>Reassign responders</h3>
              {[
                ["First responder", reassignFirst, setReassignFirst],
                ["Second responder", reassignSecond, setReassignSecond],
              ].map(([label, val, setter]) => (
                <Field key={label} label={label}>
                  <select value={val} onChange={(e) => setter(e.target.value)}>
                    <option value="">Unchanged</option>
                    {(users ?? [])
                      .filter((u) => RESPONDERS.includes(u.role))
                      .map((u) => (
                        <option key={u._id} value={u._id}>
                          {u.name} · {u.role}
                        </option>
                      ))}
                  </select>
                </Field>
              ))}
              <Button secondary>Reassign</Button>
            </form>
          )}
        </>
      )}
    </>
  );
}

function Recommendations() {
  const [rows, error] = useData("/recommendations");
  return (
    <>
      <PageHead
        title="Insights that lead somewhere."
        description="Practical changes with evidence, an owner and transparent benefit estimates."
      />
      <ErrorText>{error}</ErrorText>
      <div className="callout wide">
        <Lightbulb size={21} />
        <p>
          Estimated benefits, observed reductions and independently verified
          savings are different outcomes. Upper bounds from anomaly intervals
          are not guaranteed savings and must not be added to overlapping room
          estimates.
        </p>
      </div>
      <div className="recommendation-grid">
        {(rows ?? []).map((r) => (
          <RecommendationCard key={r._id} record={r} />
        ))}
      </div>
      {!rows?.length && (
        <Empty title="No recommendations yet">
          Accepted energy intervals and an explainable pattern produce
          recommendations here.
        </Empty>
      )}
    </>
  );
}
function RecommendationCard({ record: r }) {
  const { user, act } = useApp(),
    [reason, setReason] = useState(""),
    [dueAt, setDueAt] = useState(localInput(new Date(Date.now() + 86400000))),
    [reduction, setReduction] = useState("");
  const actions =
    {
      proposed: [
        ["accept", "Accept"],
        ["reject", "Reject"],
      ],
      accepted: [
        ["schedule", "Schedule"],
        ["complete", "Complete"],
        ["reject", "Reject"],
      ],
      scheduled: [
        ["complete", "Complete"],
        ["reject", "Reject"],
      ],
      completed: [["verify", "Review outcome"]],
    }[r.status] ?? [];
  return (
    <section className="panel recommendation-card">
      <div className="section-title">
        <span className="recommendation-icon">
          <Lightbulb size={21} />
        </span>
        <Badge
          tone={
            ["completed", "reviewed"].includes(r.status) ? "sage" : "neutral"
          }
        >
          {r.status}
        </Badge>
      </div>
      <h2>{r.title}</h2>
      <p>{r.explanation}</p>
      <div className="estimate">
        <span>
          Potential benefit · {r.estimate?.period ?? "period not specified"}
        </span>
        <strong>
          {number(r.estimate?.lowKwh)}–{number(r.estimate?.highKwh)}
          <small> kWh estimated</small>
        </strong>
        <span>
          {money((r.estimate?.lowKwh ?? 0) * (r.estimate?.tariff ?? 0))}–
          {money((r.estimate?.highKwh ?? 0) * (r.estimate?.tariff ?? 0))} ·
          energy-only
        </span>
      </div>
      <p>
        <strong>Next action</strong>
        <br />
        {r.proposedAction}
      </p>
      <p className="caption">
        {r.estimate?.assumptions}
        <br />
        Owner: {r.ownerId ?? "Unassigned"} · Data: {r.dataMode}
      </p>
      {r.outcome && (
        <div className="callout">
          <FileCheck2 size={18} />
          <p>
            {r.outcome.label}
            <br />
            {r.outcome.reason}
            {r.outcome.observedReductionKwh !== undefined && (
              <> · {number(r.outcome.observedReductionKwh)} kWh reported</>
            )}
          </p>
        </div>
      )}
      {roleCan(user, RESPONDERS) && actions.length > 0 && (
        <>
          <Field label="Decision reason / evidence">
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          {r.status === "accepted" && (
            <Field label="Follow-up date · browser local time">
              <input
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </Field>
          )}
          {r.status === "completed" && (
            <Field label="Observed reduction in comparable kWh (optional)">
              <input
                type="number"
                step="0.01"
                value={reduction}
                onChange={(e) => setReduction(e.target.value)}
              />
            </Field>
          )}
          <div className="action-row">
            {actions.map(([action, label]) => (
              <Button
                key={action}
                secondary={action === "reject"}
                disabled={
                  ["reject", "verify"].includes(action) && !reason.trim()
                }
                onClick={() =>
                  act(
                    () =>
                      post(`/recommendations/${r._id}/${action}`, {
                        ...(reason ? { reason } : {}),
                        ...(action === "schedule"
                          ? { dueAt: new Date(dueAt).toISOString() }
                          : {}),
                        ...(action === "verify" && reduction !== ""
                          ? { observedReductionKwh: Number(reduction) }
                          : {}),
                      }),
                    `Recommendation ${label.toLowerCase()} recorded`,
                  )
                }
              >
                {label}
              </Button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Access() {
  const { token } = useParams(),
    { user, act } = useApp(),
    [rooms, error] = useData("/rooms"),
    [roomId, setRoomId] = useState(""),
    [publicRoom, setPublicRoom] = useState(null),
    [qr, setQr] = useState(null);
  useEffect(() => {
    if (token)
      api(`/access/${token}`)
        .then((r) => {
          setPublicRoom(r);
          setRoomId(r.id);
        })
        .catch(() => setPublicRoom({ error: "Room access URL was not found" }));
  }, [token]);
  useEffect(() => {
    if (!token && !roomId && rooms?.length) setRoomId(rooms[0]._id);
  }, [rooms, roomId, token]);
  return (
    <>
      <PageHead
        title="Authorised access, made simple."
        description="A QR opens this page. Sign-in and server policy authorise a temporary room-use lease."
      />
      <ErrorText>{error || publicRoom?.error}</ErrorText>
      {!roleCan(user, STAFF) ? (
        <Empty title="Staff approval is required">
          Your account has no direct room-control privilege. Contact the
          assigned staff member.
        </Empty>
      ) : (
        <div className="access-layout">
          <section className="panel">
            <Field label="Room">
              <select
                value={roomId}
                onChange={(e) => {
                  setRoomId(e.target.value);
                  setQr(null);
                }}
                disabled={!!token}
              >
                {(rooms ?? []).map((r) => (
                  <option value={r._id} key={r._id}>
                    {r.code} · {r.name}
                  </option>
                ))}
              </select>
            </Field>
            {roomId && <AccessRoom roomId={roomId} />}
          </section>
          <section className="panel qr-panel">
            <QrCode size={30} />
            <h2>A doorway to authorised use</h2>
            <p>
              Print a room access code for permitted staff. It contains an
              opaque URL, never a controller password.
            </p>
            {roomId && (
              <Button
                secondary
                onClick={async () => {
                  const result = await act(
                    () => api(`/rooms/${roomId}/qr`),
                    "Room access code ready",
                  );
                  if (result) setQr(result);
                }}
              >
                Generate room QR
              </Button>
            )}
            {qr && (
              <>
                <img
                  src={qr.image}
                  width="200"
                  height="200"
                  alt="QR code for the selected room access URL"
                />
                <a className="text-link wrap" href={qr.url}>
                  {qr.url}
                </a>
                <Button secondary onClick={() => window.print()}>
                  Print access code
                </Button>
              </>
            )}
            <div className="callout">
              <ShieldCheck size={20} />
              <p>
                Authentication does not prove physical presence. With no
                occupancy source, expiry requests staff confirmation and leaves
                occupancy unknown.
              </p>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
function AccessRoom({ roomId }) {
  const [status, error] = useData(`/rooms/${roomId}/status`),
    { act, user } = useApp(),
    [duration, setDuration] = useState(30),
    [accepted, setAccepted] = useState(false);
  return (
    <>
      <ErrorText>{error}</ErrorText>
      <h2>
        {status?.room.code} · {status?.room.name}
      </h2>
      <div className="action-row">
        <Badge>Occupancy: {status?.observed.state ?? "unknown"}</Badge>
        <Badge tone="amber">
          Simulated supply: {status?.breaker.reportedSupply ?? "unknown"}
        </Badge>
      </div>
      <form
        className="section-gap"
        onSubmit={(e) => {
          e.preventDefault();
          act(
            () =>
              post(`/rooms/${roomId}/access-leases`, {
                durationMinutes: duration,
                acceptedPolicy: true,
              }),
            "Temporary access authorised; simulated supply available",
          );
        }}
      >
        <Field label="Requested duration · policy minutes">
          <input
            type="number"
            min="1"
            max="120"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            required
          />
        </Field>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            required
          />
          <span>
            I accept the room-use policy and will request an extension before
            expiry if needed. All current supply actions are simulated.
          </span>
        </label>
        <Button disabled={!accepted}>
          <PlugZap size={17} />
          Request authorised supply
        </Button>
      </form>
      <h3 className="section-gap">Active access leases</h3>
      {status?.leases.length ? (
        status.leases.map((l) => (
          <div className="lease-card" key={l._id}>
            <div className="section-title">
              <Badge tone="sage">Authorised use</Badge>
              <Clock until={l.expiresAt} />
            </div>
            <p>Expires {date(l.expiresAt)}</p>
            {(l.requesterId === user._id || user.role === "admin") && (
              <div className="action-row">
                <Button
                  secondary
                  onClick={() =>
                    act(
                      () =>
                        post(`/access-leases/${l._id}/extend`, {
                          durationMinutes: duration,
                          acceptedPolicy: true,
                        }),
                      "Lease extended after policy checks",
                    )
                  }
                >
                  Extend {duration} min
                </Button>
                <Button
                  secondary
                  onClick={() =>
                    act(
                      () => post(`/access-leases/${l._id}/end`),
                      "Lease ended; occupancy unchanged",
                    )
                  }
                >
                  End lease
                </Button>
              </div>
            )}
          </div>
        ))
      ) : (
        <p className="muted">
          No active lease. A booking or staff override may provide separate
          protection.
        </p>
      )}
    </>
  );
}

function Admin() {
  const { act } = useApp(),
    [settings, error] = useData("/settings"),
    [integrations] = useData("/integrations"),
    [rooms] = useData("/rooms"),
    [users] = useData("/users"),
    [audit] = useData("/audit-events"),
    [selected, setSelected] = useState("room-r101");
  return (
    <>
      <PageHead
        title="Configure with confidence."
        description="Assignments, evidence quality and conservative defaults for one building."
      />
      <ErrorText>{error}</ErrorText>
      <div className="admin-setup-banner section-gap">
        <div className="admin-setup-label">
          <Settings size={15} />
          HARDWARE SETUP — START HERE
        </div>
        <div className="two-columns">
          <section className="panel panel-highlight">
            <div className="section-title">
              <Wifi size={20} />
              <h2 style={{ margin: 0 }}>Add room & Wi-Fi master breaker</h2>
            </div>
            <p className="caption" style={{ marginTop: 6 }}>
              Each room needs exactly one Wi-Fi smart circuit breaker. Enter the
              breaker's native device ID exactly as it appears in your device
              management app. New rooms start in alert-only mode.
            </p>
            <AddRoomForm />
          </section>
          <section className="panel panel-highlight">
            <div className="section-title">
              <Camera size={20} />
              <h2 style={{ margin: 0 }}>Register camera / occupancy source</h2>
            </div>
            <p className="caption" style={{ marginTop: 6 }}>
              Register each camera or presence sensor here and get a one-time
              service token to configure on the device. The token is never stored
              in plain text — copy it immediately after registration.
            </p>
            <AddIntegrationForm rooms={rooms ?? []} />
          </section>
        </div>
      </div>
      <div className="two-columns">
        <section className="panel">
          <h2>Installation & estimates</h2>
          {settings && (
            <form
              key={settings.updatedAt}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.target);
                act(
                  () =>
                    patch("/settings", {
                      installationName: f.get("name"),
                      tariff: Number(f.get("tariff")),
                      initialBaselineKwh:
                        f.get("baseline") === ""
                          ? null
                          : Number(f.get("baseline")),
                      installedCost: Number(f.get("installedCost")),
                      monthlySoftwareCost: Number(f.get("software")),
                      monthlyMaintenanceCost: Number(f.get("maintenance")),
                      addedSystemCost: Number(f.get("systemCost")),
                      holidays: f
                        .get("holidays")
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    }),
                  "Settings saved; analytics refreshed",
                );
              }}
            >
              <Field label="Building name">
                <input
                  name="name"
                  defaultValue={settings.installationName}
                  required
                />
              </Field>
              <div className="two-columns">
                <Field label="Marginal energy tariff (₹/kWh)">
                  <input
                    name="tariff"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={settings.tariff}
                    required
                  />
                </Field>
                <Field
                  label="Initial hourly baseline (kWh)"
                  hint="Leave blank to require credible historical data."
                >
                  <input
                    name="baseline"
                    type="number"
                    min="0"
                    step="0.1"
                    defaultValue={settings.initialBaselineKwh ?? ""}
                  />
                </Field>
              </div>
              <Field label="Holidays · comma-separated YYYY-MM-DD">
                <input
                  name="holidays"
                  defaultValue={(settings.holidays ?? []).join(", ")}
                />
              </Field>
              <h3>Budget assumptions · estimates only</h3>
              <div className="two-columns">
                {[
                  [
                    "installedCost",
                    "Installed quote (₹)",
                    settings.installedCost,
                  ],
                  [
                    "software",
                    "Monthly software (₹)",
                    settings.monthlySoftwareCost,
                  ],
                  [
                    "maintenance",
                    "Monthly maintenance (₹)",
                    settings.monthlyMaintenanceCost,
                  ],
                  [
                    "systemCost",
                    "Added system energy cost (₹/month)",
                    settings.addedSystemCost,
                  ],
                ].map(([name, label, value]) => (
                  <Field label={label} key={name}>
                    <input
                      name={name}
                      type="number"
                      min="0"
                      defaultValue={value ?? 0}
                    />
                  </Field>
                ))}
              </div>
              <p className="caption">
                Obtain a quote for one suitable master per room,
                feeder/protection, labour, sensing, connectivity and
                commissioning. No hardware price is assumed.
              </p>
              <Button>Save installation settings</Button>
            </form>
          )}
        </section>
        <section className="panel">
          <h2>Room policy & assignments</h2>
          <Field label="Configure room">
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {(rooms ?? []).map((r) => (
                <option value={r._id} key={r._id}>
                  {r.code}
                </option>
              ))}
            </select>
          </Field>
          {rooms?.find((r) => r._id === selected) && (
            <RoomAdmin
              key={`${selected}-${rooms.find((r) => r._id === selected).policyVersion}`}
              room={rooms.find((r) => r._id === selected)}
              users={users ?? []}
              integrations={integrations ?? []}
            />
          )}
        </section>
      </div>
      <section className="panel section-gap">
        <div className="section-title">
          <h2>Integration connection tests</h2>
          <Badge>Physical adapters disabled</Badge>
        </div>
        <div className="integration-grid">
          {(integrations ?? []).map((i) => (
            <article className="integration-card" key={i._id}>
              <div className="section-title">
                <Activity size={20} />
                <Badge tone={i.health === "online" ? "sage" : "neutral"}>
                  {i.health}
                </Badge>
              </div>
              <h3>{i.name}</h3>
              <p className="muted" style={{ fontSize: 10, margin: "2px 0 6px" }}>
                {i.type} · room {i.roomId?.slice(0, 8)}…
              </p>
              <p>
                {i.capabilities?.fixtureReplay
                  ? "Synthetic replay supported. Live inference is not implemented."
                  : "Optional adapter is unavailable until its supported configuration is provided."}
              </p>
              <div className="action-row" style={{ flexWrap: "wrap", gap: 6 }}>
                <Button
                  secondary
                  onClick={() =>
                    act(
                      async () => {
                        const r = await post(`/integrations/${i._id}/test`);
                        return r;
                      },
                      i.health === "online"
                        ? "Recent observations available; this is not a physical connection test"
                        : "Unavailable integration; no successful connection claimed",
                    )
                  }
                >
                  Test connection
                </Button>
                <Button
                  secondary
                  onClick={() =>
                    act(
                      () =>
                        patch(`/integrations/${i._id}`, {
                          coverageValidated: !i.coverageValidated,
                        }),
                      i.coverageValidated
                        ? "Coverage validation cleared"
                        : "Coverage marked validated",
                    )
                  }
                >
                  {i.coverageValidated ? "✓ Coverage validated" : "Mark coverage validated"}
                </Button>
                <Button
                  secondary
                  onClick={() =>
                    act(
                      () =>
                        patch(`/integrations/${i._id}`, { health: "unavailable" }),
                      "Source marked unavailable; room work cancelled",
                    )
                  }
                >
                  Mark unavailable
                </Button>
              </div>
            </article>
          ))}
        </div>
        <Button
          secondary
          onClick={() =>
            act(
              () => post("/demo/reset"),
              "Fixture replay stopped; rooms set alert-only and audit history preserved",
            )
          }
        >
          Stop all fixture replays
        </Button>
      </section>
      <section className="panel section-gap">
        <h2>Staff accounts</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Rooms</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {(users ?? []).map((u) => (
                <tr key={u._id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td style={{ textTransform: "capitalize" }}>{u.role}</td>
                  <td>
                    <Badge tone={u.active ? "sage" : "neutral"}>
                      {u.active ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td>{u.permittedRoomIds?.length ?? 0}</td>
                  <td>
                    <Button
                      secondary
                      onClick={() =>
                        act(
                          () =>
                            patch(`/users/${u._id}`, {
                              active: !u.active,
                            }),
                          u.active ? "Account deactivated" : "Account reactivated",
                        )
                      }
                    >
                      {u.active ? "Deactivate" : "Reactivate"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel section-gap">
        <h2>Recent audit history</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {(audit ?? []).slice(0, 30).map((a) => (
                <tr key={a._id}>
                  <td>{date(a.createdAt)}</td>
                  <td>{a.actorId}</td>
                  <td>{a.action}</td>
                  <td>{a.target}</td>
                  <td>{a.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <AdministrationExtras settings={settings} rooms={rooms ?? []} />
    </>
  );
}
function RoomAdmin({ room, users, integrations }) {
  const { act } = useApp();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        act(
          () =>
            patch(`/rooms/${room._id}`, {
              controlMode: f.get("mode"),
              firstResponderId: f.get("first") || null,
              secondResponderId: f.get("second") || null,
              backupResponderId: f.get("backup") || null,
              coverageValidated: f.get("coverage") === "on",
              independentInfrastructure: f.get("independent") === "on",
              requiredSourceIds: f.getAll("sources"),
            }),
          "Room policy saved; pending actions invalidated",
        );
      }}
    >
      <p className="caption">
        Master {room.roomBreakerId} · policy version {room.policyVersion}
      </p>
      <Field label="Control mode">
        <select name="mode" defaultValue={room.controlMode}>
          <option value="alert_only">Alert-only</option>
          <option value="simulated">Simulated automatic supply</option>
        </select>
      </Field>
      {[
        ["first", "First responder", room.firstResponderId],
        ["second", "HOD / second responder", room.secondResponderId],
        ["backup", "Backup responder", room.backupResponderId],
      ].map(([name, label, value]) => (
        <Field key={name} label={label}>
          <select name={name} defaultValue={value ?? ""}>
            <option value="">Unassigned · route to admin</option>
            {users
              .filter((u) => RESPONDERS.includes(u.role))
              .map((u) => (
                <option key={u._id} value={u._id}>
                  {u.name}
                </option>
              ))}
          </select>
        </Field>
      ))}
      <Field label="Required occupancy sources">
        <select
          multiple
          name="sources"
          defaultValue={room.requiredSourceIds}
          size={Math.max(2, Math.min(4, integrations.length))}
        >
          {integrations
            .filter((i) => i.roomId === room._id)
            .map((i) => (
              <option key={i._id} value={i._id}>
                {i.name}
              </option>
            ))}
        </select>
      </Field>
      <label className="checkbox">
        <input
          name="coverage"
          type="checkbox"
          defaultChecked={room.coverageValidated}
        />
        <span>Room coverage validated (synthetic approval in demo only)</span>
      </label>
      <label className="checkbox">
        <input
          name="independent"
          type="checkbox"
          defaultChecked={room.independentInfrastructure}
        />
        <span>Observation, network and essential supplies stay available</span>
      </label>
      <Button>Save room policy</Button>
    </form>
  );
}

function ReadingReview({ record }) {
  const { user, act } = useApp(),
    [open, setOpen] = useState(false);
  if (!roleCan(user, RESPONDERS)) return null;
  return (
    <>
      <button className="text-link" onClick={() => setOpen(true)}>
        Review reading
      </button>
      {open && (
        <Modal title="Review meter reading" onClose={() => setOpen(false)}>
          <p>
            Original source {record.sourceType} · {record.dataMode}. Manual
            confirmation retains provenance, old value and actor history. A
            reset requires a separate configured epoch.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.target);
              const result = await act(
                () =>
                  patch(`/meter-readings/${record._id}/review`, {
                    value: Number(f.get("value")),
                    reason: f.get("reason"),
                  }),
                "Review recorded; intervals and anomalies recalculated",
              );
              if (result) setOpen(false);
            }}
          >
            <Field label="Confirmed value (kWh)">
              <input
                name="value"
                type="number"
                min="0"
                step="0.001"
                defaultValue={record.value}
                required
              />
            </Field>
            <Field label="Review evidence">
              <textarea name="reason" minLength={5} required rows={3} />
            </Field>
            <Button>Save audited review</Button>
          </form>
        </Modal>
      )}
    </>
  );
}

function InventoryForm({ roomId }) {
  const { act } = useApp();
  return (
    <details className="section-gap">
      <summary className="text-link">Register a downstream load</summary>
      <form
        className="inline-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.target);
          const result = await act(
            () =>
              post("/devices", {
                roomId,
                name: f.get("name"),
                category: f.get("category"),
                ratedWatts: Number(f.get("watts")),
              }),
            "Load registered; shared cutoff stays blocked until its policy is approved",
          );
          if (result) e.target.reset();
        }}
      >
        <Field label="Inventory name">
          <input name="name" required />
        </Field>
        <div className="two-columns">
          <Field label="Category">
            <select name="category">
              {["lighting", "fan", "socket", "ac", "other"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Approximate rated watts">
            <input name="watts" type="number" min="0" required />
          </Field>
        </div>
        <Button secondary>Register inventory only</Button>
      </form>
    </details>
  );
}
function DevicePolicy({ record: d }) {
  const { user, act } = useApp(),
    [open, setOpen] = useState(false);
  if (!roleCan(user, RESPONDERS)) return null;
  return (
    <>
      <button className="text-link" onClick={() => setOpen(true)}>
        Review load policy
      </button>
      {open && (
        <Modal title={`Load policy · ${d.name}`} onClose={() => setOpen(false)}>
          <p className="caption">
            Inventory approval applies to the shared room master. No button here
            switches an individual appliance. All current approvals are
            simulation metadata, not electrical commissioning.
          </p>
          {user.role === "admin" && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.target);
                const result = await act(
                  () =>
                    patch(`/devices/${d._id}`, {
                      supplyInterruptionApproved: f.get("approved") === "on",
                      essential: f.get("essential") === "on",
                      essentialStandbyRequirement: f.get("standby") === "on",
                      requiresNormalStopBeforeCutoff: f.get("stop") === "on",
                      restartBehaviourKnown: f.get("restartKnown") === "on",
                      restartDelaySeconds: Number(f.get("delay")),
                      approvalNotes: f.get("notes"),
                    }),
                  "Load policy updated; stale actions cancelled",
                );
                if (result) setOpen(false);
              }}
            >
              {[
                [
                  "approved",
                  "Shared interruption approved",
                  d.supplyInterruptionApproved,
                ],
                [
                  "essential",
                  "Essential load — blocks entire cutoff",
                  d.essential,
                ],
                [
                  "standby",
                  "Essential standby required — blocks cutoff",
                  d.essentialStandbyRequirement,
                ],
                [
                  "stop",
                  "Normal stop required before shared cutoff",
                  d.requiresNormalStopBeforeCutoff,
                ],
                [
                  "restartKnown",
                  "Restart behaviour reviewed",
                  d.restartBehaviourKnown,
                ],
              ].map(([name, label, checked]) => (
                <label className="checkbox" key={name}>
                  <input name={name} type="checkbox" defaultChecked={checked} />
                  <span>{label}</span>
                </label>
              ))}
              <Field label="Restart delay (seconds)">
                <input
                  name="delay"
                  type="number"
                  min="0"
                  max="3600"
                  defaultValue={d.restartDelaySeconds ?? 180}
                />
              </Field>
              <Field label="Approval notes">
                <textarea
                  name="notes"
                  defaultValue={d.approvalNotes ?? ""}
                  rows={3}
                />
              </Field>
              <Button>Save load policy</Button>
            </form>
          )}
          {d.requiresNormalStopBeforeCutoff && (
            <form
              className="inline-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.target);
                const result = await act(
                  () =>
                    post(`/devices/${d._id}/confirm-stop`, {
                      reason: f.get("reason"),
                    }),
                  "Normal-stop confirmation recorded; later uncertainty or restart invalidates it",
                );
                if (result) setOpen(false);
              }}
            >
              <p>
                Current stop confirmation: {date(d.stopProcedureConfirmedAt)}
              </p>
              <Field label="Staff confirmation of the approved stop procedure">
                <textarea name="reason" minLength={5} required />
              </Field>
              <Button secondary>Confirm normal stop completed</Button>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}

function AdministrationExtras({ settings, rooms }) {
  const { act } = useApp(),
    [watts, setWatts] = useState(200),
    [hours, setHours] = useState(66);
  if (!settings) return null;
  const kwh = (watts / 1000) * hours,
    cost = kwh * settings.tariff,
    net =
      cost -
      settings.monthlySoftwareCost -
      settings.monthlyMaintenanceCost -
      settings.addedSystemCost;
  return (
    <>
      <div className="two-columns section-gap">
        <section className="panel">
          <h2>Meter coverage & replacement epochs</h2>
          <p className="caption">
            Each epoch identifies one uninterrupted counter history. Never
            difference a replacement/reset against the old register.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Meter</th>
                  <th>Epoch</th>
                  <th>Supply bound</th>
                </tr>
              </thead>
              <tbody>
                {settings.meters.map((m) => (
                  <tr key={`${m.meterId}:${m.epoch}`}>
                    <td>{m.meterId}</td>
                    <td>{m.epoch}</td>
                    <td>{m.maxPowerKw} kW</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form
            className="section-gap"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.target);
              const result = await act(
                () =>
                  patch("/settings", {
                    meters: [
                      ...settings.meters,
                      {
                        meterId: f.get("meter"),
                        epoch: f.get("epoch"),
                        register: "import_kwh",
                        maxPowerKw: Number(f.get("power")),
                      },
                    ],
                  }),
                "Meter epoch configured; historical readings preserved",
              );
              if (result) e.target.reset();
            }}
          >
            <div className="two-columns">
              <Field label="Meter ID">
                <input
                  name="meter"
                  required
                  pattern="[A-Za-z0-9_-]+"
                  defaultValue="MAIN-01"
                />
              </Field>
              <Field label="New epoch ID">
                <input name="epoch" required pattern="[A-Za-z0-9_-]+" />
              </Field>
            </div>
            <Field label="Actual supply limit (kW)">
              <input type="number" name="power" min="0.1" step="0.1" required />
            </Field>
            <Button secondary>Configure new epoch</Button>
          </form>
        </section>
        <section className="panel">
          <h2>Estimate before investing</h2>
          <p className="muted">
            Hypothetical monthly energy-only benefits; independent of meter
            totals.
          </p>
          <Field label="Rated avoidable load (W)">
            <input
              type="number"
              min="0"
              value={watts}
              onChange={(e) => setWatts(Number(e.target.value))}
            />
          </Field>
          <Field label="Avoidable hours per month">
            <input
              type="number"
              min="0"
              max="744"
              step="0.5"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            />
          </Field>
          <div className="estimate">
            <span>Estimated monthly avoidable energy</span>
            <strong>
              {number(kwh)}
              <small> kWh</small>
            </strong>
            <span>
              {money(cost)} energy cost · {money(net)} net after configured
              recurring costs
            </span>
          </div>
          <p>
            Simple payback:{" "}
            <strong>
              {net > 0 && settings.installedCost > 0
                ? `${number(settings.installedCost / net)} months`
                : "Not shown until benefit is positive and an installed quote is supplied"}
            </strong>
          </p>
          <p className="caption">
            Exclude overlapping recommendations. Estimates do not verify causal
            savings, fixed/demand charges or real installation suitability.
          </p>
        </section>
      </div>
      <section className="panel section-gap">
        <h2>Create a scoped staff account</h2>
        <form
          className="form-grid"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.target);
            const result = await act(
              () =>
                post("/users", {
                  name: f.get("name"),
                  email: f.get("email"),
                  password: f.get("password"),
                  role: f.get("role"),
                  permittedRoomIds: f.getAll("rooms"),
                }),
              "Scoped account created; credentials were not logged",
            );
            if (result) e.target.reset();
          }}
        >
          <Field label="Staff name">
            <input name="name" required />
          </Field>
          <Field label="Email">
            <input name="email" type="email" required />
          </Field>
          <Field label="Initial password">
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
            />
          </Field>
          <Field label="Role">
            <select name="role">
              <option value="teacher">Teacher</option>
              <option value="technician">Technician</option>
              <option value="hod">HOD</option>
              <option value="viewer">Viewer</option>
              <option value="admin">Administrator</option>
            </select>
          </Field>
          <Field label="Permitted rooms">
            <select multiple name="rooms">
              {rooms.map((r) => (
                <option key={r._id} value={r._id}>
                  {r.code}
                </option>
              ))}
            </select>
          </Field>
          <Button>Create account</Button>
        </form>
      </section>
    </>
  );
}

function AddRoomForm() {
  const { act } = useApp();
  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const result = await act(
          () =>
            post("/rooms", {
              code: f.get("code"),
              name: f.get("name"),
              capacity: Number(f.get("capacity")) || 0,
              roomBreakerId: f.get("breakerId"),
              controlMode: "alert_only",
              coverageValidated: false,
              independentInfrastructure: false,
              requiredSourceIds: [],
              firstResponderId: null,
              secondResponderId: null,
              backupResponderId: null,
              allowedStartHour: 7,
              allowedEndHour: 22,
            }),
          "Room and master breaker registered; control mode is alert-only until reviewed",
        );
        if (result) e.target.reset();
      }}
    >
      <Field label="Room code" hint="e.g. R-101">
        <input name="code" required maxLength={30} pattern="[A-Za-z0-9 _-]+" />
      </Field>
      <Field label="Room name">
        <input name="name" required maxLength={200} />
      </Field>
      <Field label="Capacity (seats)">
        <input name="capacity" type="number" min="0" defaultValue={0} />
      </Field>
      <Field label="Wi-Fi breaker device ID" hint="Unique — must match native device ID exactly">
        <input
          name="breakerId"
          required
          maxLength={100}
          pattern="[A-Za-z0-9_-]+"
          placeholder="e.g. breaker-r101"
        />
      </Field>
      <Button>Register room & breaker</Button>
    </form>
  );
}

function AddIntegrationForm({ rooms }) {
  const { act } = useApp(),
    [token, setToken] = useState(null),
    [tokenName, setTokenName] = useState("");
  return (
    <>
      {token && (
        <div className="callout wide" style={{ marginBottom: 16 }}>
          <ShieldCheck size={16} />
          <div>
            <strong>Service token for "{tokenName}" — copy now</strong>
            <p className="wrap" style={{ fontFamily: "monospace", fontSize: 11, userSelect: "all", wordBreak: "break-all" }}>
              {token}
            </p>
            <p style={{ margin: "6px 0 0" }}>
              Configure device: <code>Authorization: Bearer &lt;token&gt;</code>{" "}
              + <code>X-Source-Id: &lt;source-id&gt;</code>. Not shown again.
            </p>
          </div>
        </div>
      )}
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.target);
          const sourceId = f.get("sourceId").trim();
          const name = f.get("name").trim();
          const result = await act(
            () =>
              post("/integrations", {
                _id: sourceId,
                roomId: f.get("roomId"),
                type: f.get("type"),
                name,
                freshnessSeconds: Number(f.get("freshness")),
                coverageValidated: false,
              }),
            "Integration registered — copy the service token above now",
          );
          if (result) {
            setToken(result.serviceToken);
            setTokenName(name);
            e.target.reset();
          }
        }}
      >
        <Field label="Source ID" hint="Unique slug — used as device identifier">
          <input
            name="sourceId"
            required
            maxLength={100}
            pattern="[A-Za-z0-9_-]+"
            placeholder="e.g. cam-r101-01"
          />
        </Field>
        <Field label="Display name">
          <input name="name" required maxLength={200} placeholder="e.g. R-101 ceiling camera" />
        </Field>
        <Field label="Room">
          <select name="roomId" required>
            <option value="">Select room…</option>
            {rooms.map((r) => (
              <option key={r._id} value={r._id}>
                {r.code} — {r.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Source type">
          <select name="type">
            <option value="camera">Camera (video inference)</option>
            <option value="presence">Presence sensor (PIR / BLE)</option>
            <option value="meter">Meter integration</option>
          </select>
        </Field>
        <Field label="Freshness window (seconds)" hint="Max age before source is stale">
          <input name="freshness" type="number" min="1" max="300" defaultValue={120} />
        </Field>
        <Button>Register source & get token</Button>
      </form>
    </>
  );
}

const managementUI = { useApp, useData, PageHead, Field, Button, Badge, ErrorText, Empty, Modal, RoomDetail, Timetable, Access, Admin, InventoryForm, date };

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
