import { GoogleGenAI } from "@google/genai";

/**
 * Weg B „KI-Verarbeitung in der EU“ (Owner-GO 11.10.2026, Register N4-138): Mit GEMINI_BACKEND=vertex
 * sprechen alle Gemini-Aufrufe Vertex AI in einer EU-Region (Standard europe-west3 Frankfurt, auch
 * „eu“ für die EU-Mehrfachregion) statt der Entwickler-API ohne Datenstandort. Anmeldung über ein
 * Dienstkonto (GOOGLE_SA_KEY_JSON = Schlüssel-JSON als App-Setting) oder die Standard-Anmeldung der
 * Google-Bibliothek. Rückweg: Variable weglassen → wie bisher mit GEMINI_API_KEY.
 *
 * Nie einen API-Schlüssel im Vertex-Modus benutzen: Google leitet Schlüssel-Aufrufe über den
 * globalen Endpunkt (keine Standortzusage). Deshalb hier ausschließlich Dienstkonto.
 */
export function vertexOn(): boolean {
  return (process.env.GEMINI_BACKEND ?? "").trim().toLowerCase() === "vertex";
}

export function vertexLocation(): string {
  return (process.env.VERTEX_LOCATION ?? "europe-west3").trim() || "europe-west3";
}

/** Für Health-Seiten und Protokolle: wo die KI rechnet. */
export function geminiBackendLabel(): string {
  return vertexOn() ? `vertex:${vertexLocation()}` : "developer-api";
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

/** Ein Client für beide Wege. `apiKey` zählt nur ohne Vertex. */
export function createGenAI(apiKey?: string): GoogleGenAI {
  if (vertexOn()) {
    const project = (process.env.VERTEX_PROJECT ?? "").trim();
    if (!project) throw new Error("VERTEX_PROJECT fehlt (GEMINI_BACKEND=vertex)");
    const credentials = serviceAccount();
    return new GoogleGenAI({
      vertexai: true,
      project,
      location: vertexLocation(),
      ...(credentials ? { googleAuthOptions: { credentials } } : {}),
    });
  }
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  return new GoogleGenAI({ apiKey });
}
