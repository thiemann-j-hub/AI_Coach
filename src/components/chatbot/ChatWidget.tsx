"use client";
/**
 * PulseNorth Chat-Widget — SSOT (chat-widget-kit). Byte-identisch je Login-Repo
 * (Hub/Coach/Jobmap/Studio) + Marketing kopiert (motion-kit-Muster). NICHT
 * einzeln editieren — Quelle ist pulsenorth-ops/chat-widget-kit/ChatWidget.tsx.
 *
 * Self-contained: eigene Styles (scoped), liest Theme via prefers-color-scheme +
 * :root[data-theme]; KEINE App-Provider-Abhängigkeit. Ruft EINEN Endpoint
 * `/api/chat` ROOT-ABSOLUT (nicht basePath-präfixiert → landet im Hub-Catch-all,
 * same-origin Cookie). Marketing (separater Origin) setzt `endpoint`-Prop auf die
 * absolute Hub-URL + `anon`.
 *
 * SSE-Protokoll: data:{type:"delta",text} · data:{type:"done",citations,label,unanswered} · data:{type:"error",message}
 */
import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; text: string; label?: string; citations?: { title: string; url: string }[] };
type Props = {
  endpoint?: string; // Default "/api/chat" (same-origin). Marketing: absolute Hub-URL.
  surface?: string; // z.B. "hub" | "coach" | "marketing"
  anon?: boolean; // Zone B (kein Cookie senden)
  lang?: "de" | "en";
};

const STRINGS = {
  de: {
    title: "PulseNorth Assistent",
    placeholder: "Frag mich zu PulseNorth.AI …",
    intro: "Hi! Ich beantworte Fragen zu PulseNorth.AI, den Produkten, Preisen und Datenschutz.",
    chips: ["Was ist der Gesprächs-Coach?", "Werden meine Daten zum Training genutzt?", "Was kosten die Pakete?", "Kann ich SCORM exportieren?"],
    send: "Senden",
    open: "Chat öffnen",
    close: "Schließen",
    sources: "Quellen",
    error: "Es gab ein Problem. Bitte versuche es erneut.",
  },
  en: {
    title: "PulseNorth Assistant",
    placeholder: "Ask me about PulseNorth.AI …",
    intro: "Hi! I answer questions about PulseNorth.AI, the products, pricing and data protection.",
    chips: ["What is the Conversation Coach?", "Is my data used for training?", "What do the packages cost?", "Can I export SCORM?"],
    send: "Send",
    open: "Open chat",
    close: "Close",
    sources: "Sources",
    error: "Something went wrong. Please try again.",
  },
};

export default function ChatWidget({ endpoint = "/api/chat", surface = "hub", anon = false, lang = "de" }: Props) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const t = STRINGS[lang];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, open]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text: q }, { role: "assistant", text: "" }]);
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: anon ? "omit" : "include",
        body: JSON.stringify({ message: q, lang, surface }),
      });
      if (!res.ok || !res.body) throw new Error(String(res.status));
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          let ev: { type?: string; text?: string; label?: string; citations?: { title: string; url: string }[]; message?: string };
          try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
          // Immutabel updaten (kein In-place-Mutation): sonst appended der
          // StrictMode-/Concurrent-Doppelaufruf des Updaters denselben Delta zweimal.
          setMsgs((m) => {
            const last = m[m.length - 1];
            if (last?.role !== "assistant") return m;
            const next = { ...last };
            if (ev.type === "delta") next.text = next.text + (ev.text ?? "");
            else if (ev.type === "done") { next.label = ev.label; next.citations = (ev.citations ?? []).filter((c) => c.title); }
            else if (ev.type === "error") next.text = next.text || t.error;
            else return m;
            return [...m.slice(0, -1), next];
          });
        }
      }
    } catch {
      setMsgs((m) => {
        const last = m[m.length - 1];
        if (last?.role !== "assistant" || last.text) return m;
        return [...m.slice(0, -1), { ...last, text: t.error }];
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pnchat-root" data-open={open}>
      <style>{CSS}</style>
      {!open && (
        <button className="pnchat-launcher" aria-label={t.open} onClick={() => setOpen(true)}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
        </button>
      )}
      {open && (
        <div className="pnchat-panel" role="dialog" aria-label={t.title}>
          <div className="pnchat-head">
            <span className="pnchat-dot" /> {t.title}
            <button className="pnchat-x" aria-label={t.close} onClick={() => setOpen(false)}>×</button>
          </div>
          <div className="pnchat-body" ref={scrollRef}>
            {msgs.length === 0 && (
              <div className="pnchat-intro">
                <p>{t.intro}</p>
                <div className="pnchat-chips">
                  {t.chips.map((c) => (
                    <button key={c} className="pnchat-chip" onClick={() => send(c)}>{c}</button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`pnchat-msg pnchat-${m.role}`}>
                <div className="pnchat-bubble">
                  {(m.role === "assistant" ? m.text.replace(/\s*\[(?:Quelle|Source):[^\]]*\]/gi, "") : m.text) ||
                    (m.role === "assistant" && busy && i === msgs.length - 1 ? <span className="pnchat-typing"><i /><i /><i /></span> : null)}
                </div>
                {m.role === "assistant" && m.citations && m.citations.length > 0 && (
                  <div className="pnchat-cites">{t.sources}: {m.citations.map((c, j) => (
                    c.url ? <a key={j} href={c.url} target="_blank" rel="noopener noreferrer">{c.title}</a> : <span key={j}>{c.title}</span>
                  ))}</div>
                )}
                {m.role === "assistant" && m.label && <div className="pnchat-label">{m.label}</div>}
              </div>
            ))}
          </div>
          <form className="pnchat-input" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={t.placeholder} disabled={busy} maxLength={2000} />
            <button type="submit" disabled={busy || !input.trim()} aria-label={t.send}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

const CSS = `
.pnchat-root{position:fixed;right:20px;bottom:20px;z-index:2147483000;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.pnchat-launcher{width:56px;height:56px;border-radius:50%;border:none;background:#1f6feb;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.25);transition:transform .15s}
.pnchat-launcher:hover{transform:scale(1.06)}
.pnchat-panel{width:min(380px,calc(100vw - 32px));height:min(560px,calc(100vh - 100px));background:#fff;color:#111;border-radius:16px;box-shadow:0 12px 48px rgba(0,0,0,.28);display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(0,0,0,.08)}
.pnchat-head{display:flex;align-items:center;gap:8px;padding:14px 16px;font-weight:600;background:#1f6feb;color:#fff}
.pnchat-dot{width:8px;height:8px;border-radius:50%;background:#4ade80;box-shadow:0 0 0 3px rgba(74,222,128,.3)}
.pnchat-x{margin-left:auto;background:none;border:none;color:#fff;font-size:22px;line-height:1;cursor:pointer;opacity:.85}
.pnchat-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px}
.pnchat-intro p{margin:0 0 12px;color:#555;font-size:14px;line-height:1.5}
.pnchat-chips{display:flex;flex-direction:column;gap:8px}
.pnchat-chip{text-align:left;padding:10px 12px;border:1px solid rgba(31,111,235,.3);background:rgba(31,111,235,.06);color:#1f6feb;border-radius:10px;cursor:pointer;font-size:13px}
.pnchat-chip:hover{background:rgba(31,111,235,.12)}
.pnchat-msg{display:flex;flex-direction:column;gap:4px;max-width:88%}
.pnchat-user{align-self:flex-end;align-items:flex-end}
.pnchat-assistant{align-self:flex-start}
.pnchat-bubble{padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}
.pnchat-user .pnchat-bubble{background:#1f6feb;color:#fff;border-bottom-right-radius:4px}
.pnchat-assistant .pnchat-bubble{background:#f1f3f5;color:#111;border-bottom-left-radius:4px}
.pnchat-cites{font-size:11px;color:#666;display:flex;flex-wrap:wrap;gap:6px}
.pnchat-cites a{color:#1f6feb;text-decoration:underline}
.pnchat-label{font-size:10px;color:#999;font-style:italic}
.pnchat-typing{display:inline-flex;gap:3px}
.pnchat-typing i{width:6px;height:6px;border-radius:50%;background:#999;animation:pnbounce 1.2s infinite}
.pnchat-typing i:nth-child(2){animation-delay:.2s}.pnchat-typing i:nth-child(3){animation-delay:.4s}
@keyframes pnbounce{0%,60%,100%{opacity:.3}30%{opacity:1}}
.pnchat-input{display:flex;gap:8px;padding:12px;border-top:1px solid rgba(0,0,0,.08)}
.pnchat-input input{flex:1;border:1px solid rgba(0,0,0,.15);border-radius:10px;padding:10px 12px;font-size:14px;outline:none;background:#fff;color:#111}
.pnchat-input input:focus{border-color:#1f6feb}
.pnchat-input button{width:40px;border:none;background:#1f6feb;color:#fff;border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.pnchat-input button:disabled{opacity:.4;cursor:not-allowed}
@media (prefers-color-scheme:dark){
.pnchat-panel{background:#161b22;color:#e6edf3;border-color:rgba(255,255,255,.1)}
.pnchat-assistant .pnchat-bubble{background:#21262d;color:#e6edf3}
.pnchat-intro p{color:#9aa4af}
.pnchat-input{border-color:rgba(255,255,255,.1)}
.pnchat-input input{background:#0d1117;color:#e6edf3;border-color:rgba(255,255,255,.15)}
.pnchat-cites{color:#9aa4af}
}
:root[data-theme="dark"] .pnchat-panel,html.dark .pnchat-panel{background:#161b22;color:#e6edf3;border-color:rgba(255,255,255,.1)}
:root[data-theme="dark"] .pnchat-assistant .pnchat-bubble,html.dark .pnchat-assistant .pnchat-bubble{background:#21262d;color:#e6edf3}
:root[data-theme="dark"] .pnchat-input input,html.dark .pnchat-input input{background:#0d1117;color:#e6edf3;border-color:rgba(255,255,255,.15)}
:root[data-theme="dark"] .pnchat-intro p,html.dark .pnchat-intro p{color:#9aa4af}
:root[data-theme="dark"] .pnchat-cites,html.dark .pnchat-cites{color:#9aa4af}
:root[data-theme="light"] .pnchat-panel,html.light .pnchat-panel{background:#fff;color:#111}
:root[data-theme="light"] .pnchat-assistant .pnchat-bubble,html.light .pnchat-assistant .pnchat-bubble{background:#f1f3f5;color:#111}
@media (prefers-reduced-motion:reduce){.pnchat-launcher,.pnchat-typing i{transition:none;animation:none}}
`;
