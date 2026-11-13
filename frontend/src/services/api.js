import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const BASE = '/api/v1';

export class ApiFailure extends Error {
  constructor(status, body) {
    super(body?.error?.message ?? `Request failed (${status})`);
    this.status = status;
    this.code = body?.error?.code ?? 'unknown';
    this.details = body?.error?.details ?? null;
    this.body = body;
  }
}

// One wrapper for every request: session cookie, JSON, and a single error shape.
export async function api(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiFailure(0, { error: { code: 'network', message: 'The server could not be reached. Check that the backend is running.' } });
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const failure = new ApiFailure(res.status, data);
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('session-expired'));
    throw failure;
  }
  return data;
}

export const post = (path, body = {}) => api(path, { method: 'POST', body });
export const patch = (path, body = {}) => api(path, { method: 'PATCH', body });

// ---- live updates ----
let socket = null;
const listeners = new Set();

export function connectLive() {
  if (socket) return;
  socket = io({ withCredentials: true, transports: ['websocket', 'polling'] });
  socket.on('event', (e) => listeners.forEach((fn) => fn(e)));
}

export function disconnectLive() {
  socket?.disconnect();
  socket = null;
}

export function onLive(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Loads data, reloads it on matching live events, and falls back to a slow poll
// so the screen is still correct if the socket drops.
export function useData(path, { live = [], pollMs = 20000, enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const controller = useRef(null);
  const liveKey = live.join(',');

  const load = useCallback(async () => {
    if (!enabled || !path) return;
    controller.current?.abort();
    controller.current = new AbortController();
    try {
      const data = await api(path, { signal: controller.current.signal });
      setState({ data, error: null, loading: false });
    } catch (err) {
      if (err.name !== 'AbortError') setState((s) => ({ data: s.data, error: err, loading: false }));
    }
  }, [path, enabled]);

  useEffect(() => {
    setState((s) => ({ ...s, loading: true }));
    load();
    const timer = pollMs ? setInterval(load, pollMs) : null;
    const types = liveKey ? liveKey.split(',') : [];
    const off = types.length ? onLive((e) => types.includes(e.type) && load()) : null;
    return () => {
      controller.current?.abort();
      if (timer) clearInterval(timer);
      off?.();
    };
  }, [load, pollMs, liveKey]);

  return { ...state, reload: load };
}

// Runs a mutation and exposes its pending and error state to a form.
export function useAction() {
  const [state, setState] = useState({ pending: false, error: null, done: null });
  const run = useCallback(async (fn, doneText) => {
    setState({ pending: true, error: null, done: null });
    try {
      const result = await fn();
      setState({ pending: false, error: null, done: doneText ?? null });
      return result;
    } catch (err) {
      setState({ pending: false, error: err, done: null });
      return null;
    }
  }, []);
  return { ...state, run, clear: () => setState({ pending: false, error: null, done: null }) };
}
