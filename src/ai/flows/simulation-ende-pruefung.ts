import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { logger } from '@/lib/logger';
import { sanitizeForPrompt } from '@/lib/prompt-guard';
import type { SimulationScenario, SimulationTurn } from '@/lib/simulation/types';
import { TimeoutError, withTimeout } from '@/lib/with-timeout';

/**
 * Rolle als Torwächter (Owner-GO 01.11.2026, Bewertung 2.0): Will die Rolle das Gespräch beenden, prüft die
 * Spielleitung in wenigen Sekunden gegen die Endbedingungen der DNA, ob die genannte Bedingung wirklich erfüllt
 * ist. Nicht erfüllt heißt: das Gespräch geht weiter, und die Rolle sagt, was noch fehlt. Befund 01.11.: Katja
 * Brenner beendete mit „Testphase vereinbart“, obwohl ihre Bedingung Umfang, Kosten, Erfolgskriterien und Termin
 * verlangte. Fehler oder Zeitüberschreitung → Ende wird angenommen (fail-open, nie ein hängendes Gespräch).
 *   COACH_ENDE_PRUEFUNG = on (Standard) | off
 */
export const EndePruefungSchema = z.object({
  erfuellt: z.boolean().describe('true nur, wenn die von der Rolle genannte Endbedingung im Verlauf nachweisbar vollständig erfüllt ist.'),
  fehlt: z.string().max(240).describe('Wenn nicht erfüllt: in einem Satz, was zur Endbedingung noch fehlt (aus Sicht der Rolle, ohne Bewertung der Person). Sonst leer.'),
});
export type EndePruefung = z.infer<typeof EndePruefungSchema>;

export const ENDE_PRUEFUNG_TIMEOUT_MS = 4_000;

export function coachEndePruefungOn(env: Record<string, string | undefined> = process.env): boolean {
  return (env.COACH_ENDE_PRUEFUNG ?? 'on').trim().toLowerCase() !== 'off';
}

export interface EndeAnfrage {
  grund: string;
  ergebnis: 'ziel' | 'verabschiedung' | 'abbruch';
}

/** PURE (getestet): Anweisung an die Spielleitung. */
export function buildEndePruefungPrompt(s: SimulationScenario, turns: SimulationTurn[], ende: EndeAnfrage): string {
  const d = s.personaDna;
  const verlauf = turns
    .slice(-12)
    .map((t) => `${t.role === 'user' ? 'LERNENDE PERSON' : d.name.toUpperCase()}: ${sanitizeForPrompt(t.text.slice(0, 900), { label: 'ZUG' }).sanitized}`)
    .join('\n');
  const bedingungen = (d.endbedingungen ?? []).map((b) => `- ${b}`).join('\n');
  return `Du bist die Spielleitung einer Gesprächssimulation. Die Rolle ${d.name} will das Gespräch beenden.
Angegebener Grund der Rolle: "${sanitizeForPrompt(ende.grund.slice(0, 300), { label: 'GRUND' }).sanitized}" (Art: ${ende.ergebnis}).

ENDBEDINGUNGEN DER ROLLE (nur eine davon muss gelten, aber vollständig):
${bedingungen || '- (keine hinterlegt)'}

VERLAUF (letzte Züge):
${verlauf}

AUFGABE: Prüfe streng, ob die Endbedingung, auf die sich der Grund bezieht, im Verlauf VOLLSTÄNDIG erfüllt ist. Für „Ziel erreicht“ müssen alle in der Bedingung genannten Bestandteile vorkommen (z. B. Umfang, Kriterien, Termin, Zustimmung) — eine Absichtserklärung reicht nicht. Eine Verabschiedung durch die lernende Person oder ein Abbruch nach Eskalation gelten, wenn sie im Verlauf stehen. Antworte ausschließlich als JSON gemäß Schema.`;
}

/**
 * Paket 2, C7 (12.11.2026): Gibt der Torwächter ein Ende frei, OHNE es geprüft zu haben (Frist, Fehler, leere
 * Antwort), steht das jetzt im Protokoll. Vorher war es nirgends zu sehen. Ohne Nutzertext, damit man es zählen kann.
 */
function ungeprueftFrei(anlass: 'frist' | 'fehler' | 'leer', args: { scenario: SimulationScenario; turns: SimulationTurn[]; ende: EndeAnfrage }): EndePruefung {
  logger.warn('[ende-pruefung] Ende ohne Prüfung freigegeben', { anlass, scenarioId: args.scenario.id, ergebnis: args.ende.ergebnis, turns: args.turns.length });
  return { erfuellt: true, fehlt: '' };
}

/** Prüft das gewünschte Ende. Fail-open: bei Fehler oder Frist gilt das Ende als erfüllt (mit Protokollzeile). */
export async function pruefeEnde(args: { scenario: SimulationScenario; turns: SimulationTurn[]; ende: EndeAnfrage; timeoutMs?: number }): Promise<EndePruefung> {
  if (!coachEndePruefungOn()) return { erfuellt: true, fehlt: '' };
  if (!(args.scenario.personaDna.endbedingungen?.length)) return { erfuellt: true, fehlt: '' };
  try {
    const response = await withTimeout(
      ai.generate({
        prompt: buildEndePruefungPrompt(args.scenario, args.turns, args.ende),
        output: { schema: EndePruefungSchema },
        config: { maxOutputTokens: 200, thinkingConfig: { thinkingBudget: 0 }, temperature: 0 },
      }),
      args.timeoutMs ?? ENDE_PRUEFUNG_TIMEOUT_MS,
      'ende-pruefung'
    );
    const out = response.output;
    if (!out) return ungeprueftFrei('leer', args);
    return { erfuellt: out.erfuellt, fehlt: out.erfuellt ? '' : out.fehlt.trim().slice(0, 240) };
  } catch (e) {
    return ungeprueftFrei(e instanceof TimeoutError ? 'frist' : 'fehler', args);
  }
}

/** Regie-Notiz (Kern, ohne Hülle — die kommt von regieStageNote), wenn das Ende abgelehnt wurde. */
export function endeAbgelehntNote(s: SimulationScenario, fehlt: string): string {
  const f = fehlt.trim() || (s.locale === 'en' ? 'the end condition is not fully met yet' : 'die Endbedingung ist noch nicht vollständig erfüllt');
  return s.locale === 'en'
    ? `Do not end the conversation yet. Still missing: ${f}. Stay in the conversation and ask for what is missing.`
    : `Beende das Gespräch noch nicht. Es fehlt: ${f}. Bleib im Gespräch und verlange, was fehlt.`;
}
