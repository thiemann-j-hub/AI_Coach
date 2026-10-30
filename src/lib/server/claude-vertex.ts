import "server-only";
import { GoogleAuth } from "google-auth-library";

/**
 * Claude über Vertex AI (rawPredict) — das starke Modell des Coaches für Arbeit VOR dem Gespräch
 * (Spielbuch, N4-231 Talker-Reasoner-Muster). Im Gespräch selbst spricht Gemini Live / Flash.
 *
 * Vorbild: Studio `ki-claude.ts` (Richter auf Opus @eu seit 27.10.2026). Dienstkonto aus
 * GOOGLE_SA_KEY_JSON, Projekt VERTEX_PROJECT (beide liegen am Coach schon für Gemini Live).
 *   COACH_SPIELBUCH_MODEL   Standard claude-opus-5-5
 *   COACH_SPIELBUCH_REGION  Standard eu (Mehrfachregion, Host aiplatform.eu.rep.googleapis.com)
 * Druckt und loggt nie Schlüssel oder Token.
 */
type Env = Record<string, string | undefined>;

export const CLAUDE_MODEL_DEFAULT = "claude-opus-5-5";
export const CLAUDE_REGION_DEFAULT = "eu";

export function claudeVertexConfigured(env: Env = process.env): boolean {
  return Boolean((env.VERTEX_PROJECT ?? "").trim()) && Boolean((env.GOOGLE_SA_KEY_JSON ?? "").trim());
}

export const claudeModel = (env: Env = process.env): string => (env.COACH_SPIELBUCH_MODEL ?? "").trim() || CLAUDE_MODEL_DEFAULT;
export const claudeRegion = (env: Env = process.env): string => (env.COACH_SPIELBUCH_REGION ?? "").trim() || CLAUDE_REGION_DEFAULT;

export function claudeHost(region: string): string {
  if (region === "eu" || region === "us") return `aiplatform.${region}.rep.googleapis.com`;
  if (region === "global") return "aiplatform.googleapis.com";
  return `${region}-aiplatform.googleapis.com`;
}

let auth: GoogleAuth | undefined;
async function accessToken(): Promise<string> {
  if (!auth) {
    const raw = (process.env.GOOGLE_SA_KEY_JSON ?? "").trim();
    if (!raw) throw new Error("GOOGLE_SA_KEY_JSON fehlt (Claude über Vertex)");
    let credentials: Record<string, unknown>;
    try {
      credentials = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error("GOOGLE_SA_KEY_JSON ist kein gültiges JSON");
    }
    auth = new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  }
  const client = await auth.getClient();
  const t = await client.getAccessToken();
  const token = typeof t === "string" ? t : t?.token;
  if (!token) throw new Error("Kein Zugangstoken für Vertex erhalten");
  return token;
}

export interface ClaudeReply {
  text: string;
  tokens: { prompt?: number; output?: number };
  model: string;
  region: string;
  ms: number;
}

/**
 * Eine Nachricht an Claude, Antwort als Text. Denken adaptiv (Modell-Standard). Bei 429/5xx ein zweiter
 * Versuch nach kurzer Pause; sonst wirft die Funktion (Aufrufer entscheiden, ob sie ohne Ergebnis weiterlaufen).
 */
export async function claudeMessage(p: {
  system: string;
  user: string;
  maxTokens?: number;
  model?: string;
  region?: string;
  signal?: AbortSignal;
}): Promise<ClaudeReply> {
  const model = p.model ?? claudeModel();
  const region = p.region ?? claudeRegion();
  const project = (process.env.VERTEX_PROJECT ?? "").trim();
  if (!project) throw new Error("VERTEX_PROJECT fehlt (Claude über Vertex)");
  const url = `https://${claudeHost(region)}/v1/projects/${project}/locations/${region}/publishers/anthropic/models/${model}:rawPredict`;
  const body = JSON.stringify({
    anthropic_version: "vertex-2023-10-16",
    max_tokens: p.maxTokens ?? 4096,
    system: p.system,
    messages: [{ role: "user", content: [{ type: "text", text: p.user }] }],
    thinking: { type: "adaptive" },
  });
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = Date.now();
    const token = await accessToken();
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body,
      signal: p.signal,
    });
    const raw = await res.text();
    if (res.ok) {
      const j = JSON.parse(raw) as {
        content?: Array<{ type: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = (j.content ?? [])
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("\n")
        .trim();
      return { text, tokens: { prompt: j.usage?.input_tokens, output: j.usage?.output_tokens }, model, region, ms: Date.now() - t0 };
    }
    lastError = `HTTP ${res.status}: ${raw.replace(/\s+/g, " ").slice(0, 200)}`;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === 2) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Claude ${model}@${region}: ${lastError}`);
}

/**
 * Strukturierte Antwort (Welle 1, Richter): Claude bekommt ein Werkzeug mit dem gegebenen JSON-Schema.
 * Erzwungener Aufruf (tool_choice tool/any) ist bei Opus 5.5 mit Denken nicht erlaubt (HTTP 400, 30.10.),
 * deshalb: Werkzeug angeboten + Anweisung; kommt kein Werkzeugaufruf, wird der Text als JSON gelesen.
 * Denken adaptiv; ein zweiter Versuch bei 429/5xx wie bei claudeMessage.
 */
export async function claudeStructured<T = unknown>(p: {
  system: string;
  user: string;
  /** JSON-Schema (Draft 7 / OpenAPI-3-Stil) des erwarteten Objekts. */
  schema: Record<string, unknown>;
  toolName?: string;
  maxTokens?: number;
  model?: string;
  region?: string;
  signal?: AbortSignal;
}): Promise<{ data: T; tokens: { prompt?: number; output?: number }; model: string; region: string; ms: number }> {
  const model = p.model ?? claudeModel();
  const region = p.region ?? claudeRegion();
  const toolName = p.toolName ?? "ergebnis";
  const project = (process.env.VERTEX_PROJECT ?? "").trim();
  if (!project) throw new Error("VERTEX_PROJECT fehlt (Claude über Vertex)");
  const url = `https://${claudeHost(region)}/v1/projects/${project}/locations/${region}/publishers/anthropic/models/${model}:rawPredict`;
  const body = JSON.stringify({
    anthropic_version: "vertex-2023-10-16",
    max_tokens: p.maxTokens ?? 8192,
    system: p.system,
    messages: [{ role: "user", content: [{ type: "text", text: p.user }] }],
    tools: [{ name: toolName, description: "Liefert das Ergebnis in genau dieser Struktur.", input_schema: p.schema }],
    tool_choice: { type: "auto" },
    thinking: { type: "adaptive" },
  });
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = Date.now();
    const token = await accessToken();
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body,
      signal: p.signal,
    });
    const raw = await res.text();
    if (res.ok) {
      const j = JSON.parse(raw) as {
        content?: Array<{ type: string; name?: string; input?: unknown; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
        stop_reason?: string;
      };
      const use = (j.content ?? []).find((b) => b.type === "tool_use" && b.name === toolName);
      let data: unknown = use?.input;
      if (data == null) {
        // Kein Werkzeugaufruf: den Text als JSON lesen (Zaun und Vortext entfernen).
        const text = (j.content ?? []).filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text as string).join("\n").trim();
        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        const body = fenced ? fenced[1] : text;
        const start = body.indexOf("{");
        const end = body.lastIndexOf("}");
        if (start < 0 || end <= start) throw new Error(`Claude ${model}@${region}: weder Werkzeugaufruf noch JSON in der Antwort (stop_reason ${j.stop_reason ?? "?"})`);
        data = JSON.parse(body.slice(start, end + 1));
      }
      return { data: data as T, tokens: { prompt: j.usage?.input_tokens, output: j.usage?.output_tokens }, model, region, ms: Date.now() - t0 };
    }
    lastError = `HTTP ${res.status}: ${raw.replace(/\s+/g, " ").slice(0, 200)}`;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === 2) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Claude ${model}@${region}: ${lastError}`);
}
