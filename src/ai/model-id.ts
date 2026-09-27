/**
 * Schreiber-Modell des Coaches (27.09.2026, Owner-GO Migrationstest + Wechsel).
 *
 * Quelle ist das App-Setting GEMINI_TEXT_MODEL (Prod seit 27.09.: gemini-3.5-flash;
 * Rückweg: gemini-2.5-flash). Kein Genkit-Import — damit /api/health die Kennung
 * zeigen kann, ohne die KI-Laufzeit zu laden. Genkit selbst nutzt dieselbe Funktion.
 */
export const DEFAULT_WRITER_MODEL_ID = 'googleai/gemini-2.5-flash';

export function resolveWriterModelId(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.GEMINI_TEXT_MODEL ?? '').trim();
  if (!raw) return DEFAULT_WRITER_MODEL_ID;
  return raw.includes('/') ? raw : `googleai/${raw}`;
}
