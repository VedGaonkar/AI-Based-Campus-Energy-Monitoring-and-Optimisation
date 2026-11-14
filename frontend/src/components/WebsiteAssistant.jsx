import React, { useEffect, useRef, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { backendUrl } from "../services/origins.js";
export default function WebsiteAssistant({ identity }) {
  const [open, setOpen] = useState(false), button = useRef(), frame = useRef();
  const close = () => { setOpen(false); button.current?.focus(); };
  useEffect(() => {
    const key = e => { if (e.key === "Escape") close(); };
    const message = e => { if (e.origin === new URL(backendUrl("/assistant/"), location.origin).origin && e.source === frame.current?.contentWindow && e.data?.type === "assistant:close") close(); };
    document.addEventListener("keydown", key); window.addEventListener("message", message);
    return () => { document.removeEventListener("keydown", key); window.removeEventListener("message", message); };
  }, []);
  return <aside className="website-assistant" aria-label="Website assistant">
    {open && <section className="assistant-window" role="dialog" aria-label="Campus Energy assistant"><header><strong>Building assistant</strong><button type="button" className="icon-button" onClick={close} aria-label="Close website assistant"><X size={18} /></button></header><iframe ref={frame} key={identity} title="Campus Energy assistant" src={backendUrl("/assistant/chat?embedded=1")} onLoad={() => frame.current?.focus()} /></section>}
    <button ref={button} className="assistant-launcher" type="button" aria-label={open ? "Close website assistant" : "Open website assistant"} aria-expanded={open} onClick={() => open ? close() : setOpen(true)}><MessageCircle size={22} /><span>Ask assistant</span></button>
  </aside>;
}
