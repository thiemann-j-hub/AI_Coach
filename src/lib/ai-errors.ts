/**
 * W1-1 (LXT-Welle W1, Owner-GO 14.10.2026): EIN KI-Fehlervertrag für alle Apps.
 *
 * Vorbild (LXT, Anhang A §1.2–1.3): jede Antwort trägt Code + Nutzdaten + Meldung; feste
 * KI-Codes (Ratenlimit, Abrechnungslimit, Schlüssel ungültig …), HTTP 404 = „KI offline“,
 * 406 = Inhaltsfilter; Drosselung ist ein Zustand, kein Fehler. Unsere Fassung: eine
 * gemeinsame Liste von Fehlerarten für jeden KI-Aufruf, je Art ein Du-Text mit nächstem
 * Schritt (in den Sprachdateien unter `aiErrors.*`), Details (Modell, Region) nur im
 * Protokoll. Dieselbe Datei liegt in Studio, Coach, Hub und Jobmap.
 *
 * Isomorph: keine Server-Importe, damit Worker, Routen und Browser dieselbe Zuordnung nutzen.
 * Rückweg: AI_ERROR_CONTRACT=off → Routen antworten wie bisher (roher Text, Status 500).
 */

export type AiErrorCode =
  /** Vertex/Gemini-Kontingent erschöpft (429 mit „quota“ / RESOURCE_EXHAUSTED). */
  | "quota_exhausted"
  /** Guthaben (Credits) leer — 402 vom Credit-Dienst. */
  | "credits_empty"
  /** Tageslimit der eigenen Kostenbremse erreicht. */
  | "daily_limit"
  /** Inhalt blockiert: Sicherheitsfilter, Ablehnung, RECITATION. */
  | "content_blocked"
  /** Modell nicht freigeschaltet oder am Standort nicht verfügbar (404/403 am Modell). */
  | "model_not_enabled"
  /** Zeitüberschreitung / Abbruch der Verbindung. */
  | "timeout"
  /** Vorübergehend gedrosselt (429 ohne Kontingent-Hinweis). */
  | "throttled"
  /** Dienst nicht erreichbar (5xx, UNAVAILABLE, OVERLOADED). */
  | "ai_unavailable"
  /** Alles andere. */
  | "ai_general";

export const AI_ERROR_CODES: readonly AiErrorCode[] = [
  "quota_exhausted",
  "credits_empty",
  "daily_limit",
  "content_blocked",
  "model_not_enabled",
  "timeout",
  "throttled",
  "ai_unavailable",
  "ai_general",
];

export function isAiErrorCode(x: unknown): x is AiErrorCode {
  return typeof x === "string" && (AI_ERROR_CODES as readonly string[]).includes(x);
}

export function aiErrorContractOn(): boolean {
  const v = typeof process !== "undefined" ? process.env?.AI_ERROR_CONTRACT : undefined;
  return (v ?? "").trim().toLowerCase() !== "off";
}

/** HTTP-Status je Fehlerart — 429 für Kontingent/Drosselung, 402 Guthaben, 422 Inhalt, 503 Dienst, 504 Zeit. */
export function aiErrorHttpStatus(code: AiErrorCode): number {
  switch (code) {
    case "quota_exhausted":
    case "throttled":
    case "daily_limit":
      return 429;
    case "credits_empty":
      return 402;
    case "content_blocked":
      return 422;
    case "model_not_enabled":
    case "ai_unavailable":
      return 503;
    case "timeout":
      return 504;
    default:
      return 500;
  }
}

/**
 * Deutsche Fallback-Texte (Du-Form) für Protokolle, Auftragsdokumente und Mails.
 * Die Oberfläche nimmt die Sprachdateien (`aiErrors.<code>.title` / `.next`).
 */
export const AI_ERROR_TEXT_DE: Record<AiErrorCode, { title: string; next: string }> = {
  quota_exhausted: {
    title: "Unser KI-Kontingent ist für den Moment erschöpft.",
    next: "Versuch es in einigen Minuten noch einmal. Dein Stand bleibt erhalten, es wird nichts doppelt berechnet.",
  },
  credits_empty: {
    title: "Dein Guthaben ist leer.",
    next: "Lade Credits auf, dann geht es an derselben Stelle weiter.",
  },
  daily_limit: {
    title: "Das Tageslimit für KI-Läufe ist erreicht.",
    next: "Morgen geht es weiter. Wenn Du heute mehr brauchst, sag Deinem Admin Bescheid.",
  },
  content_blocked: {
    title: "Die KI hat diesen Inhalt abgelehnt.",
    next: "Formuliere die Stelle um oder lass einen anderen Teil zuerst erstellen. Es wurde nichts berechnet.",
  },
  model_not_enabled: {
    title: "Dieses KI-Modell ist gerade nicht verfügbar.",
    next: "Wir kümmern uns darum. Versuch es später noch einmal oder nimm die Standard-Einstellung.",
  },
  timeout: {
    title: "Die KI hat zu lange gebraucht.",
    next: "Versuch es gleich noch einmal, meist klappt es beim zweiten Mal.",
  },
  throttled: {
    title: "Der KI-Dienst ist gerade ausgelastet.",
    next: "Warte eine Minute und versuch es dann wieder. Du musst nichts ändern.",
  },
  ai_unavailable: {
    title: "Der KI-Dienst ist gerade nicht erreichbar.",
    next: "Versuch es in ein paar Minuten noch einmal. Dein Stand bleibt erhalten.",
  },
  ai_general: {
    title: "Das hat bei der KI nicht geklappt.",
    next: "Versuch es noch einmal. Bleibt der Fehler, schick uns die Fehler-Nummer.",
  },
};

export interface AiErrorInfo {
  code: AiErrorCode;
  /** Kurzer technischer Grund für das Protokoll (nie für Kundentexte). */
  detail: string;
}

/** Statuscode aus SDK-Fehlern (duck-typing wie in gemini.ts) oder aus der Meldung. */
function statusOf(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { status?: unknown; statusCode?: unknown; code?: unknown; response?: { status?: unknown }; message?: unknown };
  for (const v of [e.status, e.statusCode, e.response?.status]) if (typeof v === "number") return v;
  if (typeof e.code === "number") return e.code;
  const m = typeof e.message === "string" ? /\b(400|401|402|403|404|408|413|422|429|500|502|503|504)\b/.exec(e.message) : null;
  return m ? Number(m[1]) : undefined;
}

/**
 * Ordnet einen beliebigen Fehler einer KI-Fehlerart zu. Reine Funktion, testbar.
 * Reihenfolge: eigene Codes (Credits, Tageslimit) → Inhalt → Kontingent/Drosselung →
 * Modell → Zeit → Dienst → allgemein.
 */
export function classifyAiError(err: unknown): AiErrorInfo {
  const e = (err && typeof err === "object" ? err : {}) as { message?: unknown; code?: unknown; name?: unknown; reason?: unknown };
  const msg = typeof e.message === "string" ? e.message : typeof err === "string" ? err : "";
  const up = msg.toUpperCase();
  const code = typeof e.code === "string" ? e.code.toLowerCase() : "";
  const name = typeof e.name === "string" ? e.name : "";
  const status = statusOf(err);
  const detail = (msg || name || "unbekannt").replace(/\s+/g, " ").slice(0, 160);

  if (code === "insufficient_credits" || status === 402 || up.includes("INSUFFICIENT_CREDITS")) return { code: "credits_empty", detail };
  if (name === "BudgetExceededError" || code === "quota_exceeded" || up.includes("TAGESLIMIT") || up.includes("DAILY TOKEN")) return { code: "daily_limit", detail };
  if (
    up.includes("SAFETY") || up.includes("PROHIBITED_CONTENT") || up.includes("RECITATION") || up.includes("BLOCKED") ||
    up.includes("CONTENT_POLICY") || up.includes("FINISHREASON") || status === 406
  ) return { code: "content_blocked", detail };
  if (status === 429) {
    if (up.includes("QUOTA") || up.includes("RESOURCE_EXHAUSTED") || up.includes("EXCEEDED FOR") || up.includes("KONTINGENT")) return { code: "quota_exhausted", detail };
    return { code: "throttled", detail };
  }
  if (up.includes("RESOURCE_EXHAUSTED") || up.includes("QUOTA EXCEEDED")) return { code: "quota_exhausted", detail };
  if ((status === 404 || status === 403) && (up.includes("MODEL") || up.includes("PUBLISHER") || up.includes("NOT FOUND") || up.includes("NOT ENABLED") || up.includes("PERMISSION"))) return { code: "model_not_enabled", detail };
  if (name === "AbortError" || name === "TimeoutError" || status === 504 || status === 408 || up.includes("TIMEOUT") || up.includes("TIMED OUT") || up.includes("ETIMEDOUT") || up.includes("DEADLINE")) return { code: "timeout", detail };
  if (status === 500 || status === 502 || status === 503 || up.includes("UNAVAILABLE") || up.includes("OVERLOADED") || up.includes("ECONNRESET") || up.includes("FETCH FAILED")) return { code: "ai_unavailable", detail };
  return { code: "ai_general", detail };
}

/** Du-Text (Deutsch) für Protokolle und Auftragsdokumente: Titel + nächster Schritt. */
export function aiErrorTextDe(code: AiErrorCode): string {
  const t = AI_ERROR_TEXT_DE[code];
  return `${t.title} ${t.next}`;
}
