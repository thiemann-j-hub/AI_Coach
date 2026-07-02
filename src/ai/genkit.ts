import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/google-genai';

/**
 * Modell-ID als exportierte Konstante: der Reliabilitäts-Harness protokolliert
 * sie je Messlauf, damit Modell-Drift (neues Modell) von Mess-Streuung
 * (gleiches Modell, andere Scores) trennbar bleibt.
 */
export const GENKIT_MODEL_ID = 'googleai/gemini-2.5-flash';
/** Keine explizite Temperatur konfiguriert → Provider-Default. */
export const GENKIT_TEMPERATURE = 'provider-default';

export const ai = genkit({
  plugins: [googleAI()],
  model: GENKIT_MODEL_ID,
});
