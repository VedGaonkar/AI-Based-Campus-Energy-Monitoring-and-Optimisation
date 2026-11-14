// Chat panel. All text from the server is inserted with textContent, never as HTML.
(() => {
  const $ = (id) => document.getElementById(id);
  const log = $('log');
  const input = $('input');
  const form = $('form');
  const send = $('send');
  const chips = $('chips');
  const notice = $('notice');
  const embedded = new URLSearchParams(location.search).has('embedded');

  let session = null;
  let busy = false;
  const store = (() => {
    try {
      sessionStorage.setItem('assistant:probe', '1');
      return sessionStorage;
    } catch {
      return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    }
  })();
  // Saved history is kept per signed-in person, so whoever uses this tab next never sees it.
  let ns = 'assistant:anonymous';
  let conversationId = crypto.randomUUID?.() ?? String(Date.now());
  const useAccount = (id) => {
    ns = `assistant:${id}`;
    conversationId = store.getItem(`${ns}:conversation`) || conversationId;
    store.setItem(`${ns}:conversation`, conversationId);
  };

  const el = (tag, props = {}, ...kids) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null) node.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined) node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return node;
  };

  const api = async (path, body) => {
    const res = await fetch(path.replace(/^\//, ""), {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(session?.csrfToken ? { 'x-csrf-token': session.csrfToken } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  };

  const scroll = () => { log.scrollTop = log.scrollHeight; };
  const saved = () => { try { return JSON.parse(store.getItem(`${ns}:log`) || '[]'); } catch { return []; } };
  const persist = (entry) => { const all = saved().slice(-39); all.push(entry); store.setItem(`${ns}:log`, JSON.stringify(all)); };

  const SOURCES = {
    database: ['From website data', ''],
    gemini: ['AI-assisted answer', 'ai'],
    cache: ['AI answer, reused', 'ai'],
    fallback: ['AI unavailable, direct answers only', 'warn'],
    system: ['', ''],
  };

  function addMessage(who, text, extra = {}) {
    const meta = el('div', { class: 'meta' });
    const [label, kind] = SOURCES[extra.source] ?? ['', ''];
    if (who === 'bot' && label) meta.append(el('span', { class: `tag ${kind}` }, label));
    if (extra.replayed) meta.append(el('span', { class: 'tag' }, 'Already handled'));
    const item = el('li', { class: `msg ${who}${extra.error ? ' error' : ''}` }, el('div', { class: 'bubble' }, text), meta);
    if (extra.links?.length) {
      const links = el('div', { class: 'links' });
      for (const l of extra.links) {
        // Links are built by the server from record IDs on the website's own address.
        links.append(el('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, `Open ${l.label}`));
      }
      item.append(links);
    }
    if (extra.proposal) item.append(proposalCard(extra.proposal));
    log.append(item);
    scroll();
    return item;
  }

  function proposalCard(proposal) {
    const state = el('span', { class: 'state', role: 'status' });
    const card = el('section', { class: 'card', 'aria-label': proposal.title });
    const confirm = el('button', { type: 'button' }, 'Confirm and apply');
    const cancel = el('button', { type: 'button', class: 'secondary' }, 'Cancel');

    const finish = (text, cls) => { confirm.disabled = true; cancel.disabled = true; state.textContent = text; card.classList.add(cls); };

    confirm.addEventListener('click', async () => {
      confirm.disabled = true;
      cancel.disabled = true;
      state.textContent = 'Applying…';
      const { status, data } = await api('/api/confirm', { proposalId: proposal.id });
      const reply = data.reply;
      if (status === 200) {
        finish(data.replayed ? 'Already applied' : 'Applied', 'done');
        addMessage('bot', reply?.text ?? 'Done.', { source: 'database' });
      } else {
        const text = reply?.text ?? data.message ?? data.error?.message ?? 'The change could not be applied.';
        const retryable = ['pending', 'partial'].includes(data.proposal?.status);
        state.textContent = retryable ? 'Not finished. You can try again.' : 'Stopped';
        card.classList.add('stopped');
        confirm.disabled = !retryable;
        confirm.textContent = 'Try again';
        cancel.disabled = false;
        addMessage('bot', text, { error: true, source: 'database' });
      }
    });
    cancel.addEventListener('click', async () => {
      const { status, data } = await api('/api/cancel', { proposalId: proposal.id });
      if (status === 200) {
        finish('Cancelled. Nothing was changed.', 'done');
      } else {
        state.textContent = data.message ?? 'Could not cancel.';
      }
    });

    card.append(
      el('h2', {}, `${proposal.title}: nothing has changed yet`),
      el(
        'div',
        { class: 'body' },
        el('ul', {}, proposal.preview.lines.map((l) => el('li', {}, l))),
        proposal.preview.warnings.length ? el('div', { class: 'warnings' }, proposal.preview.warnings.map((w) => el('p', {}, w))) : null,
        el('div', { class: 'steps' }, `Steps: ${proposal.steps.map((s, i) => (i ? s.label.charAt(0).toLowerCase() + s.label.slice(1) : s.label)).join(', then ')}. Expires ${new Date(proposal.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`),
        el('div', { class: 'actions' }, confirm, cancel, state),
      ),
    );
    return card;
  }

  function setBusy(on) {
    busy = on;
    send.disabled = on;
    log.setAttribute('aria-busy', String(on));
  }

  async function ask(text) {
    const message = text.trim();
    if (!message || busy) return;
    addMessage('user', message);
    persist({ who: 'user', text: message });
    input.value = '';
    setBusy(true);
    const pending = addMessage('bot', 'Looking…');
    pending.querySelector('.bubble').classList.add('typing');
    const { status, data } = await api('/api/message', { message, conversationId, messageId: crypto.randomUUID?.() ?? String(Date.now()) }).catch(() => ({ status: 0, data: {} }));
    pending.remove();
    setBusy(false);
    if (status === 200) {
      const r = data.reply;
      addMessage('bot', r.text, r);
      persist({ who: 'bot', text: r.text, source: r.source, links: r.links });
      if (r.awaiting) chips.replaceChildren();
    } else if (status === 401) {
      showSignedOut(data.error?.loginUrl);
    } else {
      const why = status === 429 ? 'You are sending requests too quickly. Wait a few seconds and try again.' : (data.error?.message ?? 'The assistant could not be reached. Check that it is running, then try again.');
      addMessage('bot', why, { error: true });
    }
    input.focus();
  }

  function showSignedOut(url) {
    session = null;
    notice.hidden = false;
    notice.className = 'notice warn';
    notice.replaceChildren('You are not signed in. ', url ? el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Open the website to sign in') : '', ', then reload this panel.');
    $('mode').textContent = 'Not signed in';
    input.disabled = true;
    send.disabled = true;
    chips.replaceChildren();
  }

  function showSuggestions(list) {
    chips.replaceChildren(
      ...list.map((s) =>
        el('button', { type: 'button', class: 'chip', onclick: () => (s.endsWith(' ') ? (input.value = s, input.focus()) : ask(s)) }, s.trim() + (s.endsWith(' ') ? '…' : '')),
      ),
    );
  }

  function reportUnread(count) {
    if (embedded) parent.postMessage({ type: 'assistant:unread', count }, '*');
  }

  async function start() {
    if (embedded) {
      const close = $('close');
      close.hidden = false;
      close.addEventListener('click', () => parent.postMessage({ type: 'assistant:close' }, '*'));
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') parent.postMessage({ type: 'assistant:close' }, '*'); });
    }
    form.addEventListener('submit', (e) => { e.preventDefault(); ask(input.value); });

    // Find out who is signed in first; nothing is shown from storage until we know whose it is.
    const { status, data } = await api('/api/session').catch(() => ({ status: 0, data: {} }));
    if (status === 401) return showSignedOut(data.error?.loginUrl);
    if (status !== 200) {
      notice.hidden = false;
      notice.className = 'notice bad';
      notice.textContent = data.error?.message ?? 'The assistant could not reach the website. Is it running?';
      return;
    }
    session = data;
    useAccount(data.user.id);
    for (const m of saved()) addMessage(m.who, m.text, { source: m.source, links: m.links });
    $('mode').textContent = data.mode === 'admin' ? `Administrator assistant · ${data.user.name}` : `Viewer assistant · ${data.user.name} (read-only)`;
    if (!saved().length) {
      addMessage('bot', data.mode === 'admin'
        ? 'Hello. Ask about the building, or tell me what to change. I always show a preview and wait for your confirmation before changing anything.'
        : 'Hello. I can answer questions about the rooms, timetable and announcements you have access to.', { source: 'system' });
    }
    showSuggestions(data.suggestions);
    reportUnread(data.unreadAnnouncements);
    if (data.unreadAnnouncements > 0) {
      notice.hidden = false;
      notice.className = 'notice';
      notice.replaceChildren(`${data.unreadAnnouncements} new announcement${data.unreadAnnouncements === 1 ? '' : 's'}.`, el('button', { type: 'button', class: 'secondary', onclick: () => { notice.hidden = true; ask('Any new announcements?').then(() => reportUnread(0)); } }, 'Read now'));
    }
    input.focus();
  }

  start();
})();
