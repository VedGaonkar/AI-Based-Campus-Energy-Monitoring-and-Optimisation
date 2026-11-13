import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Button, Field, Notice, cx, fmtTime } from './components/ui.jsx';
import Access from './pages/Access.jsx';
import Admin from './pages/Admin.jsx';
import Energy from './pages/Energy.jsx';
import { IncidentDetail, Incidents } from './pages/Incidents.jsx';
import Overview from './pages/Overview.jsx';
import Recommendations from './pages/Recommendations.jsx';
import { RoomDetail, Rooms } from './pages/Rooms.jsx';
import { api, connectLive, disconnectLive, post, useAction, useData } from './services/api.js';

const Session = createContext(null);
export const useSession = () => useContext(Session);

const ROLE_NAMES = { admin: 'Administrator', hod: 'HOD', first_responder: 'First responder', teacher: 'Teacher', viewer: 'Viewer' };

function SessionProvider({ children }) {
  const [state, setState] = useState({ user: null, server: null, ready: false });

  const refresh = useCallback(async () => {
    try {
      const me = await api('/auth/me');
      setState({ user: me.user, server: me.server, ready: true });
      connectLive();
    } catch {
      let server = null;
      try {
        server = (await api('/health')).server;
      } catch {
        /* backend unreachable: the sign-in form reports it */
      }
      setState({ user: null, server, ready: true });
      disconnectLive();
    }
  }, []);

  useEffect(() => {
    refresh();
    const expired = () => setState((s) => ({ ...s, user: null }));
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, [refresh]);

  const signOut = async () => {
    await post('/auth/logout').catch(() => {});
    disconnectLive();
    setState((s) => ({ ...s, user: null }));
  };

  return <Session.Provider value={{ ...state, refresh, signOut }}>{children}</Session.Provider>;
}

export function SimulationStrip() {
  const { server } = useSession();
  if (!server?.banner) return null;
  return (
    <div className="hazard p-1" role="status">
      <p className="bg-ink px-3 py-1 text-center text-[0.85rem] font-semibold text-white">{server.banner}</p>
    </div>
  );
}

export function SignIn({ compact }) {
  const { refresh, server } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const action = useAction();

  const submit = async (e) => {
    e.preventDefault();
    const ok = await action.run(() => post('/auth/login', { email, password }));
    if (ok) await refresh();
  };

  return (
    <form onSubmit={submit} className={cx('space-y-4', !compact && 'w-full max-w-sm rounded-[4px] border border-rule bg-plate p-6')}>
      {!compact && (
        <div>
          <h1>Campus Energy</h1>
          <p className="mt-1 text-muted">Sign in to see consumption, rooms and assigned tasks.</p>
        </div>
      )}
      <Field label="Email">
        <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full" />
      </Field>
      <Field label="Password">
        <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full" />
      </Field>
      {action.error && <Notice tone="bad">{action.error.message}</Notice>}
      <Button type="submit" disabled={action.pending} className="w-full">{action.pending ? 'Signing in…' : 'Sign in'}</Button>
      {server?.demoMode && (
        <p className="text-[0.85rem] text-muted">
          Demo accounts: admin, hod, tech, teacher or student <span className="whitespace-nowrap">@demo.local</span>. The password is the server's SEED_PASSWORD value.
        </p>
      )}
    </form>
  );
}

function Inbox() {
  const [open, setOpen] = useState(false);
  const inbox = useData('/notifications', { live: ['notification.created'], pollMs: 30000 });
  const navigate = useNavigate();
  const items = inbox.data?.notifications ?? [];
  const unread = inbox.data?.unread ?? 0;

  const openItem = async (n) => {
    await post(`/notifications/${n.id}/read`).catch(() => {});
    inbox.reload();
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="relative">
      <Button kind="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Alerts{unread > 0 && <span className="ml-1.5 rounded-full bg-red px-1.5 text-[0.75rem] text-white">{unread}</span>}
      </Button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 max-h-[70vh] w-[min(92vw,26rem)] overflow-auto rounded-[4px] border border-ink bg-plate shadow-lg">
          <div className="flex items-center justify-between border-b border-rule px-3 py-2">
            <strong>Alerts sent to you</strong>
            {unread > 0 && (
              <button className="text-[0.85rem] text-teal underline" onClick={async () => { await post('/notifications/read-all'); inbox.reload(); }}>
                Mark all as read
              </button>
            )}
          </div>
          {items.length === 0 && <p className="p-3 text-muted">No alerts yet. Alerts appear here when an incident is assigned to you.</p>}
          {items.map((n) => (
            <button key={n.id} onClick={() => openItem(n)} className={cx('block w-full border-b border-rule px-3 py-2 text-left hover:bg-teal-tint', !n.readAt && 'bg-amber-tint')}>
              <span className="block font-semibold">{n.title}</span>
              <span className="block text-[0.85rem] text-muted">{n.body.slice(0, 140)}{n.body.length > 140 ? '…' : ''}</span>
              <span className="num block text-[0.78rem] text-muted">{fmtTime(n.createdAt)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Shell({ children }) {
  const { user, signOut } = useSession();
  const nav = [
    ['/', 'Overview'],
    ['/rooms', 'Rooms'],
    ['/incidents', 'Incidents'],
    ['/energy', 'Energy'],
    ['/recommendations', 'Recommendations'],
    ...(user.role === 'admin' ? [['/admin', 'Admin']] : []),
  ];
  return (
    <div className="min-h-screen md:grid md:grid-cols-[13rem_1fr]">
      <aside className="border-b border-rule bg-ink text-white md:border-b-0">
        <div className="px-4 py-4">
          <Link to="/" className="block text-[1.15rem] font-bold leading-tight" style={{ fontStretch: '85%' }}>Campus Energy</Link>
          <p className="mt-0.5 text-[0.8rem] text-white/70">One building, room by room</p>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-2 pb-2 md:block md:space-y-0.5">
          {nav.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => cx('block rounded-[3px] px-3 py-2 font-semibold whitespace-nowrap', isActive ? 'bg-white text-ink' : 'text-white/85 hover:bg-white/10')}>
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-end gap-3 border-b border-rule bg-plate px-4 py-2">
          <span className="mr-auto text-[0.9rem]">
            {user.name} <span className="text-muted">({ROLE_NAMES[user.role]})</span>
          </span>
          <Inbox />
          <Button kind="secondary" onClick={signOut}>Sign out</Button>
        </div>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </div>
    </div>
  );
}

function Protected({ children, admin }) {
  const { user, ready } = useSession();
  if (!ready) return <p className="p-6 text-muted">Loading…</p>;
  if (!user) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center p-4">
        <SignIn />
      </div>
    );
  }
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  return <Shell>{children}</Shell>;
}

function NotFound() {
  const location = useLocation();
  return (
    <div className="p-6">
      <h1>Page not found</h1>
      <p className="mt-2 text-muted">Nothing lives at {location.pathname}.</p>
      <Link to="/" className="mt-3 inline-block text-teal underline">Go to the overview</Link>
    </div>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <SimulationStrip />
      <Routes>
        <Route path="/access/:token" element={<Access />} />
        <Route path="/" element={<Protected><Overview /></Protected>} />
        <Route path="/rooms" element={<Protected><Rooms /></Protected>} />
        <Route path="/rooms/:id" element={<Protected><RoomDetail /></Protected>} />
        <Route path="/incidents" element={<Protected><Incidents /></Protected>} />
        <Route path="/incidents/:id" element={<Protected><IncidentDetail /></Protected>} />
        <Route path="/energy" element={<Protected><Energy /></Protected>} />
        <Route path="/recommendations" element={<Protected><Recommendations /></Protected>} />
        <Route path="/admin" element={<Protected admin><Admin /></Protected>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </SessionProvider>
  );
}
