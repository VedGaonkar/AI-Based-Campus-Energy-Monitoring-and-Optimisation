// Real-browser check of the chat page and the floating widget, against the REAL website backend.
// Needs Chrome or Edge installed. Run: npm run check:ui   (screenshots go to UI_CHECK_OUT or the OS temp folder)
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freePort, scriptedGemini, startAssistant, startWebsite } from '../test/harness.js';

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p));
if (!CHROME) {
  console.error('No Chrome or Edge found. Set CHROME_PATH.');
  process.exit(2);
}
const out = process.env.UI_CHECK_OUT ?? join(tmpdir(), 'campus-assistant-ui');
await mkdir(out, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${detail}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, what, ms = 8000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
};

function connect(url) {
  const ws = new WebSocket(url);
  let n = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(new Error(`${m.error.message}`));
      else p.resolve(m.result);
    } else listeners.forEach((l) => l(m));
  });
  return {
    ready: new Promise((r) => ws.addEventListener('open', r)),
    on: (l) => listeners.push(l),
    send: (method, params = {}) => new Promise((resolve, reject) => { const id = ++n; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }),
    close: () => ws.close(),
  };
}

let site, bot, hostServer, chrome, profile, cdp;
const consoleErrors = [];
try {
  const botPort = await freePort();
  const hostPort = await freePort();
  site = await startWebsite();
  const hostOrigin = `http://127.0.0.1:${hostPort}`;
  bot = await startAssistant({
    website: site,
    fake: scriptedGemini(),
    port: botPort,
    env: { ASSISTANT_PUBLIC_URL: `http://127.0.0.1:${botPort}`, APP_PUBLIC_URL: hostOrigin, APP_ORIGIN: 'http://localhost:5000' },
  });
  const admin = await site.login('admin');
  const viewer = await site.login('viewer');

  // Stand-in for the website's own page: one extra script tag is all the widget needs.
  hostServer = http.createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><html><body><h1>Host website</h1><p>Existing page content.</p><script src="${bot.base}/widget.js" defer></script></body></html>`);
  });
  await new Promise((r) => hostServer.listen(hostPort, '127.0.0.1', r));

  const debugPort = await freePort();
  profile = await mkdtemp(join(tmpdir(), 'assistant-chrome-'));
  chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-gpu', '--window-size=1000,800', 'about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    return list.find((t) => t.type === 'page');
  }, 'Chrome to start', 20000);
  cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;
  const send = cdp.send;
  cdp.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleErrors.push(`${m.params.entry.text} ${m.params.entry.url ?? ''}`);
  });
  await Promise.all([send('Page.enable'), send('Runtime.enable'), send('Network.enable'), send('Log.enable')]);

  const ev = async (expression, contextId) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, ...(contextId ? { contextId } : {}) });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const signInAs = async (session) => {
    await send('Network.clearBrowserCookies');
    for (const pair of session.cookie.split('; ')) {
      const i = pair.indexOf('=');
      await send('Network.setCookie', { name: pair.slice(0, i), value: pair.slice(i + 1), domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' });
    }
  };
  const open = async (url) => {
    await send('Page.navigate', { url });
    await waitFor(() => ev("document.readyState === 'complete'"), 'page load');
  };
  const shot = async (name) => writeFile(join(out, `${name}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  const say = async (text) => {
    const before = await ev("document.querySelectorAll('#log .msg.bot').length");
    await ev(`(() => { const i = document.getElementById('input'); i.value = ${JSON.stringify(text)}; document.getElementById('form').requestSubmit(); })()`);
    await waitFor(() => ev(`document.querySelectorAll('#log .msg.bot').length > ${before} && !document.querySelector('#log .typing')`), `a reply to "${text}"`);
  };
  const lastBot = () => ev("[...document.querySelectorAll('#log .msg.bot')].at(-1)?.innerText ?? ''");

  // ---- administrator ----
  await signInAs(admin);
  await open(`${bot.base}/chat`);
  await waitFor(() => ev("document.getElementById('mode').textContent.includes('Administrator')"), 'admin session');
  check('admin sees the administrator assistant with their name', (await ev("document.getElementById('mode').textContent")).includes('Administrator assistant'));
  check('suggested commands are shown', (await ev("document.querySelectorAll('#chips .chip').length")) >= 3);
  check('the log is a live region and the field has a label', await ev("document.getElementById('log').getAttribute('aria-live') === 'polite' && document.querySelector('label[for=input]') !== null"));

  await say('Create a floor named U1 with 3 rooms');
  const card = await waitFor(() => ev("document.querySelector('.card')?.innerText"), 'a proposal card');
  check('a change shows a preview card and says nothing has changed yet', /nothing has changed yet/i.test(card) && /U1-001, U1-002, U1-003/.test(card), card);
  check('nothing exists in the website before confirming', (await site.models.Floor.countDocuments({ code: 'U1' })) === 0);
  await shot('admin-preview-desktop');

  await ev("[...document.querySelectorAll('.card button')].find((b) => /Confirm/.test(b.textContent)).click()");
  await waitFor(() => ev("document.querySelector('.card.done') !== null"), 'the change to apply');
  check('confirming applies it and reports the real result', /Floor U1 was created with 3 rooms/.test(await lastBot()), await lastBot());
  check('the website now really has floor U1 and its rooms', (await site.models.Floor.countDocuments({ code: 'U1' })) === 1 && (await site.models.Room.countDocuments({ code: /^U1-/ })) === 3);
  check('the buttons are disabled after applying', await ev("[...document.querySelectorAll('.card button')].every((b) => b.disabled)"));

  await say('How many floors are there?');
  check('the next question sees the new floor immediately', /U1/.test(await lastBot()), await lastBot());
  await say('Send an alert to all viewers that the lab opens at 9');
  await ev("[...document.querySelectorAll('.card')].at(-1).querySelector('button.secondary').click()");
  await waitFor(() => ev("[...document.querySelectorAll('.card')].at(-1).innerText.includes('Cancelled')"), 'cancel');
  check('cancelling leaves the website unchanged', bot.store.db.prepare('SELECT COUNT(*) AS n FROM announcements').get().n === 0);
  await say('Which room has the largest capacity?');
  check('an open question uses the (scripted) model and is labelled as AI-assisted', await ev("[...document.querySelectorAll('#log .msg.bot')].at(-1).querySelector('.tag.ai') !== null"));

  const sessionKeys = await ev('Object.keys(sessionStorage).filter((k) => k.includes("demo-admin")).length');
  check('saved history is stored under the signed-in person only', sessionKeys > 0 && (await ev('Object.keys(sessionStorage).some((k) => k === "assistant:log")')) === false);

  // Reload: history comes back for the same person.
  await open(`${bot.base}/chat`);
  await waitFor(() => ev("document.querySelectorAll('#log .msg').length > 3"), 'saved history');
  check('history is restored after a reload', true);

  // ---- phone width ----
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 2, mobile: true });
  await sleep(300);
  check('no horizontal scroll at phone width', await ev('document.documentElement.scrollWidth <= window.innerWidth'));
  await shot('admin-phone');
  await send('Emulation.clearDeviceMetricsOverride');

  // ---- a different person in the same tab ----
  await signInAs(viewer);
  await open(`${bot.base}/chat`);
  await waitFor(() => ev("document.getElementById('mode').textContent.includes('Viewer')"), 'viewer session');
  check('a different person on the same tab sees none of the previous conversation', (await ev("document.querySelectorAll('#log .msg').length")) === 1);
  check('the viewer panel says it is read-only', (await ev("document.getElementById('mode').textContent")).includes('read-only'));
  await say('Create a floor named V1 with 2 rooms');
  check('a viewer asking for a change is refused with no card', /Only administrators/.test(await lastBot()) && (await ev("document.querySelector('.card')")) === null);
  await say('Which rooms can I see?');
  const rooms = await lastBot();
  check('a viewer sees only their rooms, with links to the website', /R101/.test(rooms) && !/U1-001/.test(rooms) && (await ev("[...document.querySelectorAll('#log .links a')].every((a) => a.href.startsWith('http://127.0.0.1:') || a.href.startsWith('" + hostOrigin + "'))")));
  await shot('viewer-desktop');

  // ---- signed out ----
  await send('Network.clearBrowserCookies');
  await open(`${bot.base}/chat`);
  await waitFor(() => ev("document.getElementById('mode').textContent === 'Not signed in'"), 'signed-out state');
  check('without a website session it asks the person to sign in and disables input', await ev("document.getElementById('input').disabled === true && document.querySelector('#notice a') !== null"));

  // ---- the floating widget on a page of the website ----
  await signInAs(admin);
  await open(hostOrigin);
  await waitFor(() => ev("document.querySelector('button[aria-controls=campus-assistant-panel]') !== null"), 'the widget button');
  check('the widget adds a labelled button without disturbing the page', await ev("document.querySelector('h1').textContent === 'Host website' && document.querySelector('button[aria-controls=campus-assistant-panel]').getAttribute('aria-label') === 'Open assistant'"));
  await ev("document.querySelector('button[aria-controls=campus-assistant-panel]').click()");
  await waitFor(() => ev("document.querySelector('#campus-assistant-panel iframe').src.includes('/chat?embedded=1')"), 'the panel to open');
  check('opening shows the panel and updates aria-expanded', await ev("document.getElementById('campus-assistant-panel').style.display === 'block' && document.querySelector('button[aria-controls=campus-assistant-panel]').getAttribute('aria-expanded') === 'true'"));
  let tree;
  const child = await waitFor(async () => {
    tree = await send('Page.getFrameTree');
    return tree.frameTree.childFrames?.find((f) => f.frame.url.includes('/chat?embedded=1'));
  }, 'the embedded chat frame to load').catch(() => null);
  check('the assistant loads inside the website page (framing allowed for the website)', Boolean(child), JSON.stringify(tree?.frameTree.childFrames?.map((f) => f.frame.url)));
  if (child) {
    const world = await send('Page.createIsolatedWorld', { frameId: child.frame.id, worldName: 'check' });
    const inFrame = (expr) => ev(expr, world.executionContextId);
    await waitFor(() => inFrame("document.getElementById('mode').textContent.includes('Administrator')"), 'the embedded chat to sign in');
    check('inside the page it recognises the same signed-in administrator', true);
    check('the embedded chat shows its close button', await inFrame("document.getElementById('close').hidden === false"));
    await sleep(300);
    await shot('widget-open-desktop');
    await inFrame("document.getElementById('close').click()");
    await waitFor(() => ev("document.getElementById('campus-assistant-panel').style.display === 'none'"), 'the panel to close');
    check('its close button closes the panel and returns focus to the launcher', await ev("document.activeElement?.getAttribute('aria-controls') === 'campus-assistant-panel'"));
  }
  await ev("document.querySelector('button[aria-controls=campus-assistant-panel]').click()");
  await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
  check('Escape closes the panel', await ev("document.getElementById('campus-assistant-panel').style.display === 'none'"));

  // The embedding page is refused to anyone else.
  const stranger = http.createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<iframe id="f" src="${bot.base}/chat?embedded=1"></iframe>`); });
  const strangerPort = await freePort();
  await new Promise((r) => stranger.listen(strangerPort, '127.0.0.1', r));
  await open(`http://localhost:${strangerPort}/`);
  await sleep(600);
  const strangerTree = await send('Page.getFrameTree');
  const blocked = !strangerTree.frameTree.childFrames?.some((f) => f.frame.url.startsWith(bot.base) && !f.frame.unreachableUrl);
  check('another site cannot embed the assistant panel', blocked, JSON.stringify(strangerTree.frameTree.childFrames?.map((f) => [f.frame.url, f.frame.unreachableUrl])));
  stranger.close();

  check('no script errors or failed requests were logged in the browser', consoleErrors.filter((e) => !/frame-ancestors|Refused to frame|401|ERR_BLOCKED|favicon/i.test(e)).length === 0, consoleErrors.join(' | '));
} catch (err) {
  check('UI check ran to completion', false, err.stack);
} finally {
  cdp?.close();
  chrome?.kill();
  await new Promise((r) => hostServer?.close(r) ?? r());
  await bot?.close();
  await site?.close();
  await sleep(500);
  if (profile) await rm(profile, { recursive: true, force: true }).catch(() => {});
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots: ${out}`);
process.exit(failed ? 1 : 0);
