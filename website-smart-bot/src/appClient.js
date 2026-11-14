// The only way the assistant reads or changes website data: the website's own HTTP API,
// called with the signed-in person's session. The site therefore keeps enforcing roles,
// room scope, validation, CSRF and its audit trail exactly as if that person had clicked.

export class AppApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function createAppClient({ baseUrl, origin, fetchImpl = fetch, timeoutMs = 8000, expectedInstitutionId }) {
  async function request(cookie, method, path, { body, csrf } = {}) {
    const headers = { Cookie: cookie, Accept: 'application/json' };
    if (method !== 'GET') {
      // The site checks Origin and a per-session CSRF token on every write.
      headers.Origin = origin;
      headers['X-CSRF-Token'] = csrf ?? '';
      headers['Content-Type'] = 'application/json';
    }
    let res;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'manual',
      });
    } catch (err) {
      throw new AppApiError(503, 'APP_UNREACHABLE', 'The website API could not be reached.', { cause: err.name });
    }
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      const e = payload?.error ?? {};
      throw new AppApiError(res.status, e.code ?? 'APP_ERROR', e.message ?? `The website API answered ${res.status}.`, e.details);
    }
    return payload?.data;
  }

  return {
    // Resolves the caller from their cookie. Null means "not signed in".
    async identify(cookie) {
      if (!cookie) return null;
      try {
        const data = await request(cookie, 'GET', '/auth/me');
        if (!data?.user) return null;
        const user = data.user;
        if (expectedInstitutionId && user.institutionId !== expectedInstitutionId) return null;
        const csrf = data.csrfToken;
        return {
          user: { id: expectedInstitutionId ? `${expectedInstitutionId}:${user._id}` : String(user._id), name: user.name ?? 'User', role: user.role, permittedRoomIds: user.permittedRoomIds ?? [] },
          csrf,
          get: (path) => request(cookie, 'GET', path),
          post: (path, body) => request(cookie, 'POST', path, { body, csrf }),
          patch: (path, body) => request(cookie, 'PATCH', path, { body, csrf }),
        };
      } catch (err) {
        if (err instanceof AppApiError && (err.status === 401 || err.status === 403)) return null;
        throw err;
      }
    },
  };
}
