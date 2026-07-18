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

type Msg = {
  role: "user" | "assistant";
  text: string;
  label?: string;
  citations?: { title: string; url: string }[];
  eventId?: string;
  rated?: "up" | "down";
  // Assistent-Angebot unter der Antwort: „Als Hinweis an die Entwicklung senden"
  // (gesetzt, wenn die Nutzer-Nachricht nach Problem-Sprache klingt). Trägt die
  // Vorbefüllung fürs Formular.
  offer?: { category: string; title: string; problemDesc: string };
};
type FbPrefill = { category?: string; title?: string; problemDesc?: string };
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
    fbOpen: "Feedback / Problem melden",
    fbTitle: "Feedback geben",
    fbIntro: "Ein Fehler oder eine Idee? Beschreib es kurz — der aktuelle Seiten-Kontext wird automatisch mitgeschickt.",
    fbCategory: "Art",
    fbCatBug: "Fehler / Bug",
    fbCatOpt: "Verbesserung",
    fbCatFeature: "Neue Funktion",
    fbCatUsability: "Bedienung",
    fbTitleField: "Kurz: worum geht's?",
    fbProblem: "Was ist das Problem oder dein Vorschlag?",
    fbDesired: "Wie sollte es idealerweise sein?",
    fbRepro: "Schritte zum Nachstellen (optional)",
    fbScreenshot: "Screenshot anhängen (optional)",
    fbSubmit: "Absenden",
    fbSubmitting: "Wird gesendet …",
    fbThanks: "Danke! Dein Hinweis ist angekommen — wir schauen ihn uns an.",
    fbError: "Konnte nicht gesendet werden. Bitte versuche es erneut.",
    fbBack: "Zurück zum Chat",
    fbContext: "Mitgeschickt: aktuelle Seite, Browser, App-Version.",
    fbChipIntro: "💡 Problem oder Idee melden",
    fbOffer: "→ Als Hinweis an die Entwicklung senden",
    fbDoneMsg: "✅ Danke! Dein Hinweis ist angekommen (Referenz {ref}). Wir schauen ihn uns an — bei Rückfragen melden wir uns.",
    fbDoneNoShot: "Hinweis: Der Screenshot konnte nicht übertragen werden — dein Hinweis selbst ist angekommen.",
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
    fbOpen: "Report feedback / a problem",
    fbTitle: "Give feedback",
    fbIntro: "Found a bug or have an idea? Describe it briefly — the current page context is sent automatically.",
    fbCategory: "Type",
    fbCatBug: "Bug",
    fbCatOpt: "Improvement",
    fbCatFeature: "New feature",
    fbCatUsability: "Usability",
    fbTitleField: "In short: what is it about?",
    fbProblem: "What is the problem or your suggestion?",
    fbDesired: "How should it ideally work?",
    fbRepro: "Steps to reproduce (optional)",
    fbScreenshot: "Attach a screenshot (optional)",
    fbSubmit: "Submit",
    fbSubmitting: "Sending …",
    fbThanks: "Thanks! Your note has arrived — we'll take a look.",
    fbError: "Could not be sent. Please try again.",
    fbBack: "Back to chat",
    fbContext: "Sent along: current page, browser, app version.",
    fbChipIntro: "💡 Report a problem or idea",
    fbOffer: "→ Send this as a note to the dev team",
    fbDoneMsg: "✅ Thanks! Your note has arrived (reference {ref}). We'll take a look — and get back to you if we have questions.",
    fbDoneNoShot: "Note: the screenshot could not be uploaded — your note itself has arrived.",
  },
};

/* Problem-Sprache (Client-Heuristik): löst KEIN Formular aus, sondern nur das
   Assistent-ANGEBOT unter der normalen Antwort. Fehltreffer sind billig (ein
   ignorierbarer Chip), deshalb bewusst breiter als der Server-Intent. */
const PROBLEM_RE = /(funktioniert nicht|geht nicht|klappt nicht|kaputt|fehler|bug|absturz|stürzt ab|hängt|lädt nicht|reagiert nicht|fehlt mir|vermisse|wäre schön|not working|doesn'?t work|broken|error|crash(es|ed)?|fails|stuck|missing|would be nice)/i;

/** Kategorie aus der Nutzer-Nachricht raten (Vorbefüllung; im Formular änderbar). */
function guessCategory(s: string): string {
  const x = s.toLowerCase();
  if (/(funktioniert nicht|geht nicht|klappt nicht|kaputt|fehler|bug|absturz|stürzt|hängt|lädt nicht|reagiert nicht|broken|error|crash|fails|not working|doesn'?t work|stuck)/.test(x)) return "BUG";
  if (/(fehlt|vermisse|wäre schön|wünsch|feature|neue funktion|missing|would be nice|wish|new feature)/.test(x)) return "FEATURE";
  return "OPTIMIZATION";
}

export default function ChatWidget({ endpoint = "/api/chat", surface = "hub", anon = false, lang = "de" }: Props) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Feedback-/Ticket-Formular (nur Zone A / eingeloggt; anon blendet es aus).
  const [fbOpen, setFbOpen] = useState(false);
  const [fbBusy, setFbBusy] = useState(false);
  const [fbState, setFbState] = useState<"form" | "done" | "error">("form");
  // Feature-Flag: solange dark (Server-Bit off) bleiben Einstiege + Formular AUS.
  const [fbAvailable, setFbAvailable] = useState(false);
  const [fb, setFb] = useState({ category: "OPTIMIZATION", title: "", problemDesc: "", desiredBehavior: "", reproSteps: "" });
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const t = STRINGS[lang];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, open]);

  // Fokus-Komfort: nach jeder Antwort direkt weitertippen können (Live-Testfund).
  useEffect(() => {
    if (open && !busy) inputRef.current?.focus();
  }, [open, busy]);

  // Capability-Probe: nur eingeloggte (Zone A) Widgets fragen den Server, ob das
  // Hinweis-Feature freigeschaltet ist. Solange dark → fbAvailable bleibt false.
  useEffect(() => {
    if (anon) return;
    let alive = true;
    fetch(`${endpoint}/idea`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((j) => { if (alive) setFbAvailable(j?.enabled === true); })
      .catch(() => {});
    return () => { alive = false; };
  }, [anon, endpoint]);

  async function rate(idx: number, rating: "up" | "down") {
    const m = msgs[idx];
    if (!m?.eventId || m.rated) return;
    setMsgs((arr) => arr.map((x, i) => (i === idx ? { ...x, rated: rating } : x)));
    try {
      await fetch(`${endpoint}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: anon ? "omit" : "include",
        body: JSON.stringify({ eventId: m.eventId, rating }),
      });
    } catch {
      /* Feedback ist fire-and-forget */
    }
  }

  function openFeedback(prefill?: FbPrefill) {
    setFb({
      category: prefill?.category ?? "OPTIMIZATION",
      title: prefill?.title ?? "",
      problemDesc: prefill?.problemDesc ?? "",
      desiredBehavior: "",
      reproSteps: "",
    });
    setFbState("form");
    setFbOpen(true);
  }

  // Feedback-/Ticket-Einreichung: EIN multipart-POST an /idea (Felder + optionaler
  // Screenshot) inkl. transparent mitgeschicktem Auto-Kontext (Seite/Browser/Viewport).
  async function submitFeedback() {
    if (fbBusy || !fb.title.trim()) return;
    setFbBusy(true);
    try {
      const form = new FormData();
      form.set("category", fb.category);
      form.set("title", fb.title);
      form.set("problemDesc", fb.problemDesc);
      form.set("desiredBehavior", fb.desiredBehavior);
      form.set("reproSteps", fb.reproSteps);
      form.set("surface", surface);
      form.set("pageUrl", typeof location !== "undefined" ? location.href : "");
      form.set("userAgent", typeof navigator !== "undefined" ? navigator.userAgent : "");
      form.set("viewport", typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : "");
      const file = fileRef.current?.files?.[0];
      if (file) form.set("screenshot", file);
      const res = await fetch(`${endpoint}/idea`, { method: "POST", credentials: anon ? "omit" : "include", body: form });
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json().catch(() => ({}))) as { id?: string; attachment?: boolean };
      if (j?.id) {
        // Assistent bestätigt IM GESPRÄCH mit echter Referenz (kein stilles Formular-Danke).
        const ref = j.id.slice(0, 8).toUpperCase();
        const noShot = file && j.attachment !== true ? `\n${t.fbDoneNoShot}` : "";
        setMsgs((m) => [...m, { role: "assistant", text: t.fbDoneMsg.replace("{ref}", ref) + noShot }]);
        setFbOpen(false);
      } else {
        setFbState("done"); // Fallback ohne Referenz (sollte nicht vorkommen)
      }
    } catch {
      setFbState("error");
    } finally {
      setFbBusy(false);
    }
  }

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    // Multi-Turn: die letzten Turns als Kontext mitschicken (Server sanitized hart).
    const history = msgs
      .filter((m) => m.text)
      .slice(-6)
      .map((m) => ({ role: m.role, text: m.text.slice(0, 600) }));
    setMsgs((m) => [...m, { role: "user", text: q }, { role: "assistant", text: "" }]);
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: anon ? "omit" : "include",
        body: JSON.stringify({ message: q, lang, surface, history }),
      });
      if (!res.ok || !res.body) throw new Error(String(res.status));
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let formOpened = false; // Formular bereits per Server-Intent geöffnet → kein zusätzliches Angebot
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
          let ev: { type?: string; text?: string; label?: string; citations?: { title: string; url: string }[]; message?: string; eventId?: string };
          try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
          // Klare Melde-Absicht: der Server signalisiert „öffne das Formular" statt
          // einer Text-Antwort (deterministisch, kein LLM-Verbrauch). Nur Zone A.
          // Vorbefüllt aus der Nutzer-Nachricht — der Assistent hat schon mitgedacht.
          if (ev.type === "form" && !anon && fbAvailable) {
            formOpened = true;
            openFeedback({ category: guessCategory(q), title: q.slice(0, 120), problemDesc: q });
            continue;
          }
          // Immutabel updaten (kein In-place-Mutation): sonst appended der
          // StrictMode-/Concurrent-Doppelaufruf des Updaters denselben Delta zweimal.
          setMsgs((m) => {
            const last = m[m.length - 1];
            if (last?.role !== "assistant") return m;
            const next = { ...last };
            if (ev.type === "delta") next.text = next.text + (ev.text ?? "");
            else if (ev.type === "done") {
              next.label = ev.label; next.citations = (ev.citations ?? []).filter((c) => c.title); next.eventId = ev.eventId;
              // Problem-Sprache ohne explizite Melde-Absicht: der Assistent hat normal
              // geantwortet (vielleicht half's ja) — und BIETET darunter an, den Punkt
              // als Hinweis an die Entwicklung zu geben (vorbefüllt, ein Klick).
              if (!anon && fbAvailable && !formOpened && PROBLEM_RE.test(q)) {
                next.offer = { category: guessCategory(q), title: q.slice(0, 120), problemDesc: q };
              }
            }
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
            <span className="pnchat-head-actions">
              {!anon && fbAvailable && !fbOpen && (
                <button className="pnchat-fbbtn" aria-label={t.fbOpen} title={t.fbOpen} onClick={() => openFeedback()}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5C17.7 10.2 18 9 18 8a6 6 0 0 0-12 0c0 1 .3 2.2 1.5 3.5.8.8 1.3 1.5 1.5 2.5" /><path d="M9 18h6" /><path d="M10 22h4" /></svg>
                </button>
              )}
              <button className="pnchat-x" aria-label={t.close} onClick={() => setOpen(false)}>×</button>
            </span>
          </div>
          {!fbOpen && (<>
          <div className="pnchat-body" ref={scrollRef}>
            {msgs.length === 0 && (
              <div className="pnchat-intro">
                <p>{t.intro}</p>
                <div className="pnchat-chips">
                  {t.chips.map((c) => (
                    <button key={c} className="pnchat-chip" onClick={() => send(c)}>{c}</button>
                  ))}
                  {!anon && fbAvailable && (
                    <button className="pnchat-chip pnchat-chip-fb" onClick={() => openFeedback()}>{t.fbChipIntro}</button>
                  )}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`pnchat-msg pnchat-${m.role}`}>
                <div className="pnchat-bubble">
                  {(m.role === "assistant" ? m.text.replace(/\s*\[(?:Quelle|Source):[^\]]*\]/gi, "") : m.text) ||
                    (m.role === "assistant" && busy && i === msgs.length - 1 ? <span className="pnchat-typing"><i /><i /><i /></span> : null)}
                </div>
                {m.role === "assistant" && m.offer && (
                  <button className="pnchat-offer" onClick={() => openFeedback(m.offer)}>{t.fbOffer}</button>
                )}
                {m.role === "assistant" && m.citations && m.citations.length > 0 && (
                  <div className="pnchat-cites">{t.sources}: {m.citations.map((c, j) => (
                    c.url ? <a key={j} href={c.url} target="_blank" rel="noopener noreferrer">{c.title}</a> : <span key={j}>{c.title}</span>
                  ))}</div>
                )}
                {m.role === "assistant" && m.label && (
                  <div className="pnchat-foot">
                    <span className="pnchat-label">{m.label}</span>
                    {m.eventId && (
                      <span className="pnchat-rate">
                        <button aria-label="Hilfreich" data-active={m.rated === "up"} disabled={!!m.rated} onClick={() => rate(i, "up")}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill={m.rated === "up" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" /></svg>
                        </button>
                        <button aria-label="Nicht hilfreich" data-active={m.rated === "down"} disabled={!!m.rated} onClick={() => rate(i, "down")}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill={m.rated === "down" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 14V2" /><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" /></svg>
                        </button>
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <form className="pnchat-input" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} placeholder={t.placeholder} disabled={busy} maxLength={2000} />
            <button type="submit" disabled={busy || !input.trim()} aria-label={t.send}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
            </button>
          </form>
          </>)}
          {fbOpen && (
            <div className="pnchat-fbform">
              {fbState === "done" ? (
                <div className="pnchat-fbdone">
                  <p>✅ {t.fbThanks}</p>
                  <button className="pnchat-fbsubmit" onClick={() => setFbOpen(false)}>{t.fbBack}</button>
                </div>
              ) : (
                <>
                  <p className="pnchat-fbintro">{t.fbIntro}</p>
                  <label className="pnchat-fblabel">{t.fbCategory}
                    <select value={fb.category} onChange={(e) => setFb({ ...fb, category: e.target.value })}>
                      <option value="BUG">{t.fbCatBug}</option>
                      <option value="OPTIMIZATION">{t.fbCatOpt}</option>
                      <option value="FEATURE">{t.fbCatFeature}</option>
                      <option value="USABILITY">{t.fbCatUsability}</option>
                    </select>
                  </label>
                  <input className="pnchat-fbtitle" value={fb.title} maxLength={300} placeholder={t.fbTitleField} onChange={(e) => setFb({ ...fb, title: e.target.value })} />
                  <textarea className="pnchat-fbta" rows={2} maxLength={4000} placeholder={t.fbProblem} value={fb.problemDesc} onChange={(e) => setFb({ ...fb, problemDesc: e.target.value })} />
                  <textarea className="pnchat-fbta" rows={2} maxLength={4000} placeholder={t.fbDesired} value={fb.desiredBehavior} onChange={(e) => setFb({ ...fb, desiredBehavior: e.target.value })} />
                  <textarea className="pnchat-fbta" rows={2} maxLength={4000} placeholder={t.fbRepro} value={fb.reproSteps} onChange={(e) => setFb({ ...fb, reproSteps: e.target.value })} />
                  <label className="pnchat-fbfile">{t.fbScreenshot}
                    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" />
                  </label>
                  {fbState === "error" && <p className="pnchat-fberr">{t.fbError}</p>}
                  <div className="pnchat-fbctx">{t.fbContext}</div>
                  <div className="pnchat-fbactions">
                    <button className="pnchat-fbcancel" onClick={() => setFbOpen(false)} disabled={fbBusy}>{t.fbBack}</button>
                    <button className="pnchat-fbsubmit" onClick={submitFeedback} disabled={fbBusy || !fb.title.trim()}>{fbBusy ? t.fbSubmitting : t.fbSubmit}</button>
                  </div>
                </>
              )}
            </div>
          )}
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
.pnchat-chip-fb{border-style:dashed;border-color:rgba(163,113,247,.45);background:rgba(163,113,247,.06);color:#8250df}
.pnchat-chip-fb:hover{background:rgba(163,113,247,.12)}
.pnchat-offer{display:block;margin:6px 0 0;padding:7px 10px;border:1px dashed rgba(163,113,247,.5);background:rgba(163,113,247,.06);color:#8250df;border-radius:9px;cursor:pointer;font-size:12.5px;text-align:left}
.pnchat-offer:hover{background:rgba(163,113,247,.14)}
.pnchat-msg{display:flex;flex-direction:column;gap:4px;max-width:88%}
.pnchat-user{align-self:flex-end;align-items:flex-end}
.pnchat-assistant{align-self:flex-start}
.pnchat-bubble{padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}
.pnchat-user .pnchat-bubble{background:#1f6feb;color:#fff;border-bottom-right-radius:4px}
.pnchat-assistant .pnchat-bubble{background:#f1f3f5;color:#111;border-bottom-left-radius:4px}
.pnchat-cites{font-size:11px;color:#666;display:flex;flex-wrap:wrap;gap:6px}
.pnchat-cites a{color:#1f6feb;text-decoration:underline}
.pnchat-label{font-size:10px;color:#999;font-style:italic}
.pnchat-foot{display:flex;align-items:center;gap:8px}
.pnchat-rate{display:inline-flex;gap:4px}
.pnchat-rate button{background:none;border:none;color:#999;cursor:pointer;padding:2px;line-height:0;border-radius:4px}
.pnchat-rate button:hover:not(:disabled){color:#1f6feb;background:rgba(31,111,235,.08)}
.pnchat-rate button[data-active="true"]{color:#1f6feb}
.pnchat-rate button:disabled{cursor:default;opacity:.9}
.pnchat-typing{display:inline-flex;gap:3px}
.pnchat-typing i{width:6px;height:6px;border-radius:50%;background:#999;animation:pnbounce 1.2s infinite}
.pnchat-typing i:nth-child(2){animation-delay:.2s}.pnchat-typing i:nth-child(3){animation-delay:.4s}
@keyframes pnbounce{0%,60%,100%{opacity:.3}30%{opacity:1}}
.pnchat-input{display:flex;gap:8px;padding:12px;border-top:1px solid rgba(0,0,0,.08)}
.pnchat-input input{flex:1;border:1px solid rgba(0,0,0,.15);border-radius:10px;padding:10px 12px;font-size:14px;outline:none;background:#fff;color:#111}
.pnchat-input input:focus{border-color:#1f6feb}
.pnchat-input button{width:40px;border:none;background:#1f6feb;color:#fff;border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.pnchat-input button:disabled{opacity:.4;cursor:not-allowed}
.pnchat-head-actions{margin-left:auto;display:flex;align-items:center;gap:2px}
.pnchat-fbbtn{background:none;border:none;color:#fff;cursor:pointer;padding:4px;line-height:0;border-radius:6px;opacity:.85;display:flex}
.pnchat-fbbtn:hover{opacity:1;background:rgba(255,255,255,.15)}
.pnchat-fbform{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}
.pnchat-fbintro{margin:0;color:#555;font-size:13px;line-height:1.5}
.pnchat-fblabel{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#555;font-weight:600}
.pnchat-fbform select,.pnchat-fbtitle,.pnchat-fbta{width:100%;box-sizing:border-box;border:1px solid rgba(0,0,0,.15);border-radius:9px;padding:9px 11px;font-size:13px;font-family:inherit;outline:none;background:#fff;color:#111}
.pnchat-fbform select:focus,.pnchat-fbtitle:focus,.pnchat-fbta:focus{border-color:#1f6feb}
.pnchat-fbta{resize:vertical;min-height:38px}
.pnchat-fbfile{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#555}
.pnchat-fbfile input{font-size:12px}
.pnchat-fbctx{font-size:10px;color:#999}
.pnchat-fberr{margin:0;font-size:12px;color:#d1242f}
.pnchat-fbactions{display:flex;gap:8px;margin-top:2px}
.pnchat-fbsubmit{flex:1;border:none;background:#1f6feb;color:#fff;border-radius:9px;padding:10px;font-size:13px;font-weight:600;cursor:pointer}
.pnchat-fbsubmit:disabled{opacity:.4;cursor:not-allowed}
.pnchat-fbcancel{border:1px solid rgba(0,0,0,.15);background:none;color:#555;border-radius:9px;padding:10px 14px;font-size:13px;cursor:pointer}
.pnchat-fbdone{display:flex;flex-direction:column;gap:14px;padding:20px 4px;text-align:center;color:#333;font-size:14px;line-height:1.5}
@media (prefers-color-scheme:dark){
.pnchat-fbintro,.pnchat-fblabel,.pnchat-fbfile,.pnchat-fbdone{color:#9aa4af}
.pnchat-fbform select,.pnchat-fbtitle,.pnchat-fbta{background:#0d1117;color:#e6edf3;border-color:rgba(255,255,255,.15)}
.pnchat-fbcancel{color:#9aa4af;border-color:rgba(255,255,255,.15)}
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
:root[data-theme="dark"] .pnchat-fbform select,:root[data-theme="dark"] .pnchat-fbtitle,:root[data-theme="dark"] .pnchat-fbta,html.dark .pnchat-fbform select,html.dark .pnchat-fbtitle,html.dark .pnchat-fbta{background:#0d1117;color:#e6edf3;border-color:rgba(255,255,255,.15)}
:root[data-theme="dark"] .pnchat-chip-fb,html.dark .pnchat-chip-fb,:root[data-theme="dark"] .pnchat-offer,html.dark .pnchat-offer{color:#a371f7;border-color:rgba(163,113,247,.5);background:rgba(163,113,247,.1)}
:root[data-theme="dark"] .pnchat-fbintro,:root[data-theme="dark"] .pnchat-fblabel,:root[data-theme="dark"] .pnchat-fbfile,:root[data-theme="dark"] .pnchat-fbdone,html.dark .pnchat-fbintro,html.dark .pnchat-fblabel,html.dark .pnchat-fbfile,html.dark .pnchat-fbdone{color:#9aa4af}
:root[data-theme="dark"] .pnchat-intro p,html.dark .pnchat-intro p{color:#9aa4af}
:root[data-theme="dark"] .pnchat-cites,html.dark .pnchat-cites{color:#9aa4af}
:root[data-theme="light"] .pnchat-panel,html.light .pnchat-panel{background:#fff;color:#111}
:root[data-theme="light"] .pnchat-assistant .pnchat-bubble,html.light .pnchat-assistant .pnchat-bubble{background:#f1f3f5;color:#111}
@media (prefers-reduced-motion:reduce){.pnchat-launcher,.pnchat-typing i{transition:none;animation:none}}
`;
