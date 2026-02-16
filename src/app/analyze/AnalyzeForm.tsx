"use client";

import React, { useEffect, useMemo, useState } from "react";

type AnalyzeRequest = {
  conversationType: string;
  conversationSubType?: string;
  goal?: string;
  transcriptText: string;
  lang?: string;
  jurisdiction?: string;
};

type RunMeta = {
  id: string;
  createdAt: string | null;
  conversationType: string | null;
  conversationSubType: string | null;
  goal: string | null;
  rating: number | null;
  scoreOverall: number | null;
  ragCount: number | null;
};

const SESSION_KEY = "script_coach_session_id";

function safeString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asStringArray(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? "")).filter((s) => s.trim().length > 0);
}

function extractTitleFromSavedCard(c: any): string {
  // save-route speichert "title"
  const t = safeString(c?.title);
  if (t) return t;
  // fallback
  return "Card";
}

export default function AnalyzeForm() {
  const [sessionId, setSessionId] = useState<string>("");

  const [conversationType, setConversationType] = useState("feedback");
  const [conversationSubType, setConversationSubType] = useState("kritisch");
  const [goal, setGoal] = useState("klar und fair, ohne Eskalation");
  const [transcriptText, setTranscriptText] = useState("FK: Mir ist aufgefallen ...\nMA: ...");

  const [lang, setLang] = useState("de");
  const [jurisdiction, setJurisdiction] = useState("de_eu");

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [result, setResult] = useState<any>(null);
  const [lastRunId, setLastRunId] = useState<string | null>(null);

  const [autoSave, setAutoSave] = useState(true);
  const [storeTranscript, setStoreTranscript] = useState(false);

  const [runs, setRuns] = useState<RunMeta[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SESSION_KEY);
      const sid = stored || ((crypto as any)?.randomUUID?.() ?? `session_${Date.now()}_${Math.random().toString(16).slice(2)}`);
      if (!stored) {
        window.localStorage.setItem(SESSION_KEY, sid);
      }
      setSessionId(sid);
    } catch {
      // ignore
    }
  }, []);

  const requestBody: AnalyzeRequest = useMemo(
    () => ({
      conversationType: conversationType.trim(),
      conversationSubType: conversationSubType.trim() || undefined,
      goal: goal.trim() || undefined,
      transcriptText: transcriptText.trim(),
      lang: lang.trim() || undefined,
      jurisdiction: jurisdiction.trim() || undefined,
    }),
    [conversationType, conversationSubType, goal, transcriptText, lang, jurisdiction]
  );

  async function refreshRuns() {
    if (!sessionId) return;
    setRunsLoading(true);
    try {
      const res = await fetch(`/api/runs/list?sessionId=${encodeURIComponent(sessionId)}&limit=10`);
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ? JSON.stringify(json.error) : `HTTP ${res.status}`);
      setRuns(Array.isArray(json?.items) ? json.items : []);
    } catch (e: any) {
      // runs sind nice-to-have -> Fehler nur in console
      console.warn("refreshRuns failed:", e?.message ?? e);
    } finally {
      setRunsLoading(false);
    }
  }

  useEffect(() => {
    if (sessionId) refreshRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  async function saveRun(currentResult: any) {
    if (!sessionId) throw new Error("sessionId fehlt (localStorage).");

    setSaveError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/runs/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          storeTranscript,
          input: requestBody,
          result: currentResult,
        }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = json?.error ? (typeof json.error === "string" ? json.error : JSON.stringify(json.error)) : `HTTP ${res.status}`;
        throw new Error(msg);
      }

      setLastRunId(json?.runId ?? null);
      await refreshRuns();
    } catch (e: any) {
      setSaveError(e?.message ?? String(e));
      throw e;
    } finally {
      setSaving(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaveError(null);
    setLastRunId(null);
    setResult(null);

    if (!requestBody.conversationType) {
      setError("conversationType fehlt.");
      return;
    }
    if (!requestBody.transcriptText) {
      setError("transcriptText fehlt.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        const msg =
          json?.error
            ? typeof json.error === "string"
              ? json.error
              : JSON.stringify(json.error)
            : `HTTP ${res.status}`;
        throw new Error(msg);
      }

      const r = json?.result ?? json;
      setResult(r);

      if (autoSave) {
        await saveRun(r);
      }
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadRun(runId: string) {
    if (!sessionId) return;
    setError(null);
    try {
      const res = await fetch(
        `/api/runs/get?sessionId=${encodeURIComponent(sessionId)}&runId=${encodeURIComponent(runId)}`
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);

      const run = json?.run;

      // UI: input in Felder zurückladen (falls vorhanden)
      const inp = run?.input ?? {};
      setConversationType(safeString(inp?.conversationType) || "feedback");
      setConversationSubType(safeString(inp?.conversationSubType) || "");
      setGoal(safeString(inp?.goal) || "");
      setLang(safeString(inp?.lang) || "");
      setJurisdiction(safeString(inp?.jurisdiction) || "");

      const storedTranscript = safeString(inp?.transcriptText);
      const snippet = safeString(inp?.transcriptSnippet);
      setTranscriptText(storedTranscript || snippet || "");

      // Ergebnis wieder in “Analyze Result”-Shape bringen
      const analysis = run?.analysis ?? {};
      const rag = run?.rag ?? {};
      const hydrated = {
        ...analysis,
        rag_context_count: rag?.count ?? 0,
        rag_error: rag?.error ?? null,
        rag_context_cards: Array.isArray(rag?.cards)
          ? rag.cards.map((c: any) => ({
              id: c?.id,
              score: c?.score,
              metadata: {
                // wir speichern kein chunk_text; trotzdem etwas meta anzeigen
                ...c?.meta,
                chunk_text: `TITLE: ${c?.title ?? "Card"}\n\n(Saved run: chunk_text not stored)`,
              },
              title: c?.title,
            }))
          : [],
      };

      setResult(hydrated);
      setLastRunId(runId);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  function copyJson() {
    try {
      navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    } catch {
      // ignore
    }
  }

  const strengths = asStringArray(result?.strengths);
  const improvements = asStringArray(result?.improvements);
  const rewrites = asStringArray(result?.rewrites);
  const riskFlags = asStringArray(result?.riskFlags);

  return (
    <div style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 700 }}>Session</div>
          <div style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.85 }}>{sessionId || "—"}</div>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={autoSave} onChange={(e) => setAutoSave(e.target.checked)} />
            <span>Auto‑Save nach Analyse</span>
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={storeTranscript} onChange={(e) => setStoreTranscript(e.target.checked)} />
            <span>Transkript speichern</span>
          </label>
        </div>
      </div>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 600 }}>conversationType</span>
            <input
              value={conversationType}
              onChange={(e) => setConversationType(e.target.value)}
              placeholder="feedback"
              style={{ padding: 10, borderRadius: 8, border: "1px solid rgba(0,0,0,0.2)" }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 600 }}>conversationSubType (optional)</span>
            <input
              value={conversationSubType}
              onChange={(e) => setConversationSubType(e.target.value)}
              placeholder="kritisch"
              style={{ padding: 10, borderRadius: 8, border: "1px solid rgba(0,0,0,0.2)" }}
            />
          </label>
        </div>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontWeight: 600 }}>goal (optional)</span>
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="klar und fair, ohne Eskalation"
            style={{ padding: 10, borderRadius: 8, border: "1px solid rgba(0,0,0,0.2)" }}
          />
        </label>

        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 600 }}>lang (optional)</span>
            <input
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              placeholder="de"
              style={{ padding: 10, borderRadius: 8, border: "1px solid rgba(0,0,0,0.2)" }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 600 }}>jurisdiction (optional)</span>
            <input
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
              placeholder="de_eu"
              style={{ padding: 10, borderRadius: 8, border: "1px solid rgba(0,0,0,0.2)" }}
            />
          </label>
        </div>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontWeight: 600 }}>transcriptText</span>
          <textarea
            value={transcriptText}
            onChange={(e) => setTranscriptText(e.target.value)}
            rows={10}
            style={{
              padding: 10,
              borderRadius: 8,
              border: "1px solid rgba(0,0,0,0.2)",
              fontFamily: "inherit",
            }}
          />
        </label>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="submit"
            disabled={loading}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid rgba(0,0,0,0.2)",
              background: loading ? "rgba(0,0,0,0.06)" : "white",
              cursor: loading ? "not-allowed" : "pointer",
              fontWeight: 600,
            }}
          >
            {loading ? "Analysiere…" : "Analyse starten"}
          </button>

          <button
            type="button"
            onClick={() => {
              setResult(null);
              setError(null);
              setSaveError(null);
              setLastRunId(null);
            }}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid rgba(0,0,0,0.2)",
              background: "white",
              cursor: "pointer",
            }}
          >
            Clear
          </button>

          {result ? (
            <button
              type="button"
              disabled={saving}
              onClick={async () => {
                try {
                  await saveRun(result);
                } catch {}
              }}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid rgba(0,0,0,0.2)",
                background: saving ? "rgba(0,0,0,0.06)" : "white",
                cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              {saving ? "Speichere…" : "Save Run"}
            </button>
          ) : null}

          {result ? (
            <button
              type="button"
              onClick={copyJson}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid rgba(0,0,0,0.2)",
                background: "white",
                cursor: "pointer",
              }}
            >
              Copy JSON
            </button>
          ) : null}

          {lastRunId ? (
            <span style={{ fontFamily: "monospace", fontSize: 12, opacity: 0.8 }}>
              saved: {lastRunId}
            </span>
          ) : null}
        </div>

        {error ? (
          <div style={{ padding: 12, borderRadius: 10, background: "rgba(255,0,0,0.06)", border: "1px solid rgba(255,0,0,0.18)" }}>
            <b>Fehler:</b> {error}
          </div>
        ) : null}

        {saveError ? (
          <div style={{ padding: 12, borderRadius: 10, background: "rgba(255,165,0,0.10)", border: "1px solid rgba(255,165,0,0.25)" }}>
            <b>Save‑Fehler:</b> {saveError}
          </div>
        ) : null}
      </form>

      {result ? (
        <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Summary</h2>
            <div style={{ padding: 12, borderRadius: 10, background: "rgba(0,0,0,0.04)" }}>
              {safeString(result?.summary) || "—"}
            </div>
          </div>

          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
            <div style={{ padding: 12, borderRadius: 10, border: "1px solid rgba(0,0,0,0.12)" }}>
              <b>Score (overall)</b>
              <div style={{ fontSize: 22, marginTop: 6 }}>
                {result?.scores?.overall ?? "—"}
              </div>
            </div>

            <div style={{ padding: 12, borderRadius: 10, border: "1px solid rgba(0,0,0,0.12)" }}>
              <b>RAG Context Count</b>
              <div style={{ fontSize: 22, marginTop: 6 }}>
                {result?.rag_context_count ?? "—"}
              </div>
            </div>
          </div>

          {strengths.length ? (
            <div style={{ padding: 12, borderRadius: 10, border: "1px solid rgba(0,0,0,0.12)" }}>
              <b>Strengths</b>
              <ul style={{ marginTop: 10 }}>
                {strengths.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          ) : null}

          {improvements.length ? (
            <div style={{ padding: 12, borderRadius: 10, border: "1px solid rgba(0,0,0,0.12)" }}>
              <b>Improvements</b>
              <ul style={{ marginTop: 10 }}>
                {improvements.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          ) : null}

          {rewrites.length ? (
            <div style={{ padding: 12, borderRadius: 10, border: "1px solid rgba(0,0,0,0.12)" }}>
              <b>Rewrites</b>
              <ul style={{ marginTop: 10 }}>
                {rewrites.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          ) : null}

          {riskFlags.length ? (
            <div style={{ padding: 12, borderRadius: 10, border: "1px solid rgba(0,0,0,0.12)" }}>
              <b>Risk Flags</b>
              <ul style={{ marginTop: 10 }}>
                {riskFlags.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <hr style={{ margin: "18px 0" }} />

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700 }}>Saved Runs</div>
        <button
          type="button"
          onClick={refreshRuns}
          disabled={runsLoading || !sessionId}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid rgba(0,0,0,0.2)",
            background: "white",
            cursor: runsLoading ? "not-allowed" : "pointer",
          }}
        >
          {runsLoading ? "Lade…" : "Refresh"}
        </button>
      </div>

      <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
        {runs.length === 0 ? (
          <div style={{ opacity: 0.7 }}>Noch keine Runs gespeichert.</div>
        ) : (
          runs.map((r) => (
            <div key={r.id} style={{ padding: 10, borderRadius: 10, background: "rgba(0,0,0,0.03)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ fontFamily: "monospace", fontSize: 12 }}>{r.id}</div>
                <div style={{ opacity: 0.75, fontSize: 12 }}>{r.createdAt ?? "—"}</div>
              </div>

              <div style={{ marginTop: 6, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <span><b>{r.conversationType ?? "—"}</b></span>
                {r.conversationSubType ? <span style={{ opacity: 0.85 }}>({r.conversationSubType})</span> : null}
                {r.scoreOverall != null ? <span style={{ opacity: 0.85 }}>score {r.scoreOverall}</span> : null}
                {r.ragCount != null ? <span style={{ opacity: 0.85 }}>rag {r.ragCount}</span> : null}
              </div>

              {r.goal ? <div style={{ marginTop: 6, opacity: 0.85 }}>{r.goal}</div> : null}

              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => loadRun(r.id)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(0,0,0,0.2)",
                    background: "white",
                    cursor: "pointer",
                  }}
                >
                  Load
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {result ? (
        <details style={{ marginTop: 14, padding: 12, borderRadius: 10, border: "1px solid rgba(0,0,0,0.12)" }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>Raw JSON</summary>
          <pre style={{ marginTop: 10, overflow: "auto", fontSize: 12, lineHeight: 1.35 }}>
{JSON.stringify(result, null, 2)}
          </pre>
        </details>
      ) : null}

      {result?.rag_context_cards?.length ? (
        <div style={{ marginTop: 14, padding: 12, borderRadius: 10, border: "1px solid rgba(0,0,0,0.12)" }}>
          <b>Retrieved Cards (Titles)</b>
          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            {(Array.isArray(result?.rag_context_cards) ? result.rag_context_cards : []).map((c: any) => (
              <div key={c?.id} style={{ padding: 10, borderRadius: 10, background: "rgba(0,0,0,0.03)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ fontWeight: 700 }}>{c?.id ?? "—"}</div>
                  <div style={{ opacity: 0.75 }}>score {Number(c?.score ?? 0).toFixed(3)}</div>
                </div>
                <div style={{ marginTop: 6, opacity: 0.9 }}>
                  {extractTitleFromSavedCard(c)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
