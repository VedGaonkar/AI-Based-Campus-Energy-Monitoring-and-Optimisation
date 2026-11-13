import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export const explanations = {
  baseline: "Expected energy for this interval, using similar past use or the configured starting rule.",
  power: "Energy divided by the recorded interval length; short power spikes may be hidden.",
  savings: "A possible reduction based on assumptions, not a guaranteed or verified saving.",
  confidence: "The camera's detection score does not prove the whole room is empty or the meter value is correct.",
  stale: "The last reading is old; a connected dashboard does not mean the meter is reporting.",
  override: "A time-limited staff instruction protects authorised use and changes which automatic actions are allowed.",
  verification: "Sending a command is different from confirming its result; simulated feedback proves no physical switching.",
  anomaly: "An anomaly exceeds the configured tolerance; being above baseline alone may not trigger an alert.",
};
export default function Help({ topic, text, label }) {
  const id = useId(), anchor = useRef(), timer = useRef(), tip = useRef();
  const [open, setOpen] = useState(false), [position, setPosition] = useState({ left: 8, top: 8 });
  const cancel = () => clearTimeout(timer.current);
  const close = () => { cancel(); setOpen(false); };
  const show = () => { cancel(); setOpen(true); };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = anchor.current.getBoundingClientRect(), height = tip.current?.offsetHeight ?? 60;
      const width = Math.min(340, window.innerWidth - 16);
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top: rect.bottom + height + 12 < window.innerHeight ? rect.bottom + 8 : Math.max(8, rect.top - height - 8) });
    };
    const outside = e => { if (!anchor.current?.contains(e.target) && !tip.current?.contains(e.target)) close(); };
    const escape = e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
    place(); document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape, true); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);
  return <span className="metric-help">
    <button ref={anchor} type="button" className="help-trigger" aria-label={`Help: ${label ?? topic}`} aria-expanded={open} aria-describedby={open ? id : undefined}
      onPointerEnter={e => { if (e.pointerType !== "touch") { cancel(); timer.current = setTimeout(show, 800); } }}
      onPointerLeave={() => { cancel(); timer.current = setTimeout(() => setOpen(false), 200); }}
      onFocus={show} onBlur={close} onClick={() => { cancel(); setOpen(true); }}>?</button>
    {open && createPortal(<span id={id} ref={tip} role="tooltip" className="help-tooltip" style={position} onPointerEnter={cancel} onPointerLeave={close}>{text ?? explanations[topic]}</span>, anchor.current.closest("dialog") ?? document.body)}
  </span>;
}
