import { GoogleGenAI } from "@google/genai";

/**
 * Weg B „KI-Verarbeitung in der EU“ (Owner-GO 11.10.2026, Register N4-138): Mit GEMINI_BACKEND=vertex
 * sprechen alle Gemini-Aufrufe Vertex AI in der EU statt der Entwickler-API ohne Datenstandort.
 * Anmeldung über ein Dienstkonto (GOOGLE_SA_KEY_JSON = Schlüssel-JSON als App-Setting) oder die
 * Standard-Anmeldung der Google-Bibliothek. Rückweg: Variable weglassen → wie bisher mit GEMINI_API_KEY.
 *
 * Zwei Standorte (Messung 13.10.2026, Register N4-141):
 *   VERTEX_LOCATION        Textmodelle, Standard „eu“ (EU-Mehrfachregion, Host aiplatform.eu.rep.googleapis.com):
 *                          Gemini 3.5 Flash antwortet dort so schnell wie die Entwickler-API; Frankfurt
 *                          (europe-west3) war dreimal langsamer. Die Mehrfachregion verarbeitet nur in der EU.
 *   VERTEX_EMBED_LOCATION  Einbettungen (gemini-embedding-001), Standard europe-west3: die Mehrfachregion
 *                          kennt das Einbettungsmodell (und Gemini 2.5) nicht.
 *
 * Nie einen API-Schlüssel im Vertex-Modus benutzen: Google leitet Schlüssel-Aufrufe über den
 * globalen Endpunkt (keine Standortzusage). Deshalb hier ausschließlich Dienstkonto.
 */
export function vertexOn(): boolean {
  return (process.env.GEMINI_BACKEND ?? "").trim().toLowerCase() === "vertex";
}

export function vertexLocation(): string {
  return (process.env.VERTEX_LOCATION ?? "eu").trim() || "eu";
}

export function vertexEmbedLocation(): string {
  return (process.env.VERTEX_EMBED_LOCATION ?? "europe-west3").trim() || "europe-west3";
}

/** Mehrfachregionen („eu“, „us“) haben einen eigenen Host; Einzelregionen hängen die Region vor den Host. */
export function vertexHost(location: string): string {
  if (location === "eu" || location === "us") return `aiplatform.${location}.rep.googleapis.com`;
  if (location === "global") return "aiplatform.googleapis.com";
  return `${location}-aiplatform.googleapis.com`;
}

/** Für Health-Seiten und Protokolle: wo die KI rechnet. */
export function geminiBackendLabel(): string {
  return vertexOn() ? `vertex:${vertexLocation()}+${vertexEmbedLocation()}` : "developer-api";
}

type Credentials = NonNullable<NonNullable<ConstructorParameters<typeof GoogleGenAI>[0]["googleAuthOptions"]>["credentials"]>;

function serviceAccount(): Credentials | undefined {
  const raw = (process.env.GOOGLE_SA_KEY_JSON ?? "").trim();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Credentials;
  } catch {
    throw new Error("GOOGLE_SA_KEY_JSON ist kein gültiges JSON");
  }
}

/** Ein Client für beide Wege. `apiKey` zählt nur ohne Vertex; `embed` wählt den Einbettungs-Standort. */
export function createGenAI(apiKey?: string, opts?: { embed?: boolean }): GoogleGenAI {
  if (vertexOn()) {
    const project = (process.env.VERTEX_PROJECT ?? "").trim();
    if (!project) throw new Error("VERTEX_PROJECT fehlt (GEMINI_BACKEND=vertex)");
    const credentials = serviceAccount();
    const location = opts?.embed ? vertexEmbedLocation() : vertexLocation();
    const multi = location === "eu" || location === "us";
    return new GoogleGenAI({
      vertexai: true,
      project,
      location,
      ...(multi ? { httpOptions: { baseUrl: `https://${vertexHost(location)}` } } : {}),
      ...(credentials ? { googleAuthOptions: { credentials, scopes: ["https://www.googleapis.com/auth/cloud-platform"] } } : {}),
    });
  }
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  return new GoogleGenAI({ apiKey });
}
