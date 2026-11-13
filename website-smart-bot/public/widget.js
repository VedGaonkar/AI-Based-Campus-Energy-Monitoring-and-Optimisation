/*
 * Floating assistant button for the website. Add ONE line to the website's page:
 *   <script src="http://localhost:5190/widget.js" defer></script>
 * It loads the assistant panel in an iframe from the assistant's own address, so the website's
 * code and styles are not touched and the panel cannot read the page.
 */
(() => {
  if (window.__campusAssistant) return;
  window.__campusAssistant = true;
  const script = document.currentScript;
  const origin = new URL(script.src, location.href).origin;
  const GREEN = '#176e57';
  const DEEP = '#123e32';

  const style = (node, rules) => Object.assign(node.style, rules);
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', 'Open assistant');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'campus-assistant-panel');
  style(button, { position: 'fixed', right: '16px', bottom: '16px', zIndex: '2147483000', width: '52px', height: '52px', borderRadius: '50%', border: '0', background: GREEN, color: '#fff', cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,0,0,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '600 13px Inter, Segoe UI, Arial, sans-serif' });
  button.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';

  const badge = document.createElement('span');
  badge.setAttribute('aria-hidden', 'true');
  style(badge, { position: 'absolute', top: '-3px', right: '-3px', minWidth: '18px', height: '18px', padding: '0 4px', borderRadius: '9px', background: '#c0392b', color: '#fff', font: '700 11px/18px Inter, Segoe UI, Arial, sans-serif', textAlign: 'center', display: 'none' });
  button.append(badge);

  const panel = document.createElement('div');
  panel.id = 'campus-assistant-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Campus Energy assistant');
  style(panel, { position: 'fixed', right: '16px', bottom: '80px', zIndex: '2147483000', width: 'min(400px, calc(100vw - 32px))', height: 'min(640px, calc(100vh - 104px))', display: 'none', border: `1px solid ${DEEP}`, borderRadius: '10px', overflow: 'hidden', background: '#fff', boxShadow: '0 12px 36px rgba(0,0,0,.28)' });

  const frame = document.createElement('iframe');
  frame.title = 'Campus Energy assistant';
  frame.setAttribute('referrerpolicy', 'no-referrer');
  style(frame, { width: '100%', height: '100%', border: '0' });
  panel.append(frame);

  const small = window.matchMedia('(max-width: 520px)');
  const layout = () => {
    if (small.matches) style(panel, { right: '0', bottom: '0', width: '100vw', height: '100dvh', borderRadius: '0' });
    else style(panel, { right: '16px', bottom: '80px', width: 'min(400px, calc(100vw - 32px))', height: 'min(640px, calc(100vh - 104px))', borderRadius: '10px' });
  };
  small.addEventListener('change', layout);

  const setOpen = (open) => {
    if (open && !frame.src) frame.src = `${origin}/chat?embedded=1`;
    panel.style.display = open ? 'block' : 'none';
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Close assistant' : 'Open assistant');
    // On a phone the panel covers the button, so hide it while open.
    button.style.display = open && small.matches ? 'none' : 'flex';
    if (open) frame.focus();
    else button.focus();
  };

  button.addEventListener('click', () => setOpen(panel.style.display === 'none'));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel.style.display !== 'none') setOpen(false); });
  window.addEventListener('message', (e) => {
    if (e.origin !== origin || e.source !== frame.contentWindow) return;
    if (e.data?.type === 'assistant:close') setOpen(false);
    if (e.data?.type === 'assistant:unread') {
      const n = Number(e.data.count) || 0;
      badge.textContent = n > 9 ? '9+' : String(n);
      badge.style.display = n > 0 ? 'block' : 'none';
      button.setAttribute('aria-label', n > 0 ? `Open assistant, ${n} new announcement${n === 1 ? '' : 's'}` : 'Open assistant');
    }
  });

  layout();
  document.body.append(panel, button);
})();
