import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/google-genai';

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
function resolveModelId(): string {
  const raw = (process.env.GEMINI_TEXT_MODEL ?? '').trim();
  if (!raw) return 'googleai/gemini-2.5-flash';
  return raw.includes('/') ? raw : `googleai/${raw}`;
}
export const GENKIT_MODEL_ID = resolveModelId();
/** Keine explizite Temperatur konfiguriert → Provider-Default. */
export const GENKIT_TEMPERATURE = 'provider-default';

export const ai = genkit({
  plugins: [googleAI()],
  model: GENKIT_MODEL_ID,
});
