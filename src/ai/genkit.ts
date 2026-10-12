import {genkit} from 'genkit';
import {googleAI, vertexAI} from '@genkit-ai/google-genai';
import {resolveWriterModelId} from './model-id';
import {vertexOn, vertexLocation} from './gemini-backend';

/**
 * Modell-ID als exportierte Konstante: der Reliabilitäts-Harness protokolliert
 * sie je Messlauf, damit Modell-Drift (neues Modell) von Mess-Streuung
 * (gleiches Modell, andere Scores) trennbar bleibt.
 */
/**
 * 27.09.2026 (Owner-GO Migrationstest): Der Schreiber ist über GEMINI_TEXT_MODEL
 * steuerbar (App-Setting in Prod steht auf gemini-2.5-flash = unverändertes
 * Verhalten). So laufen Prüfset und Golden-Set offline gegen Kandidaten
 * (gemini-3.5-flash …), und der spätere Wechsel ist ein Setting, kein Deploy.
 * Der Judge hat sein eigenes JUDGE_MODEL (scripts/quality/judge.ts).
 */
export const GENKIT_MODEL_ID = resolveWriterModelId();
/** Keine explizite Temperatur konfiguriert → Provider-Default. */
export const GENKIT_TEMPERATURE = 'provider-default';

/**
 * Weg B (Owner-GO 11.10.2026): GEMINI_BACKEND=vertex → Vertex AI EU (Dienstkonto aus GOOGLE_SA_KEY_JSON,
 * Region VERTEX_LOCATION, Standard europe-west3); das Modell heißt dann vertexai/<name>. Rückweg: Variable weglassen.
 */
function vertexPlugin() {
  const raw = (process.env.GOOGLE_SA_KEY_JSON ?? '').trim();
  const credentials = raw ? (JSON.parse(raw) as Record<string, string>) : undefined;
  return vertexAI({
    projectId: (process.env.VERTEX_PROJECT ?? '').trim(),
    location: vertexLocation(),
    ...(credentials ? {googleAuth: {credentials}} : {}),
  });
}

export const ai = genkit({
  plugins: [vertexOn() ? vertexPlugin() : googleAI()],
  model: GENKIT_MODEL_ID,
});
