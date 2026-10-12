/**
 * Schreiber-Modell des Coaches (27.09.2026, Owner-GO Migrationstest + Wechsel).
 *
 * Quelle ist das App-Setting GEMINI_TEXT_MODEL (Prod seit 27.09.: gemini-3.5-flash;
 * Rückweg: gemini-2.5-flash). Kein Genkit-Import — damit /api/health die Kennung
 * zeigen kann, ohne die KI-Laufzeit zu laden. Genkit selbst nutzt dieselbe Funktion.
 */
export const DEFAULT_WRITER_MODEL_ID = 'googleai/gemini-2.5-flash';

export function resolveWriterModelId(env: NodeJS.ProcessEnv = process.env): string {
  // Weg B (11.10.2026): mit GEMINI_BACKEND=vertex trägt das Modell den Vertex-Präfix.
  const prefix = (env.GEMINI_BACKEND ?? '').trim().toLowerCase() === 'vertex' ? 'vertexai' : 'googleai';
  const raw = (env.GEMINI_TEXT_MODEL ?? '').trim();
  if (!raw) return prefix === 'vertexai' ? 'vertexai/gemini-2.5-flash' : DEFAULT_WRITER_MODEL_ID;
  if (raw.includes('/')) return raw;
  return `${prefix}/${raw}`;
}
