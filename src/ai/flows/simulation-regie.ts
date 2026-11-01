/**
 * @fileOverview Regie-Beobachter (Welle 2, Owner-GO 30.10.2026, N4-240).
 *
 * Im Gespräch spielt ein schnelles Modell die Rolle; über zehn Minuten vergisst es, auf welcher
 * Öffnungsstufe die Rolle gerade steht. Der Beobachter prüft nach jedem Zug der lernenden Person
 * gegen die Öffnungs-Bedingungen, Eskalations-Trigger und die Freigabe-Regel der DNA und gibt der
 * Rolle eine kurze Regie-Notiz — über denselben Kanal wie die Zeit-Regie (Textweg: Marker hinter dem
 * Nutzertext, Live: Notiz an das Live-Modell). Die Lernenden sehen nichts davon; der Verlauf wird am
 * Lauf gespeichert und dient dem Richter als objektiver Öffnungsverlauf.
 *
 * Ein kleiner Aufruf ohne Denken, parallel zur Antwort der Rolle (Textweg) bzw. nach dem Zug (Live);
 * die Notiz wirkt mit einem Zug Verzögerung. Fehler → keine Notiz, nie ein blockiertes Gespräch.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { sanitizeForPrompt } from '@/lib/prompt-guard';
import type { SimulationScenario, SimulationTurn } from '@/lib/simulation/types';

export const REGIE_MAX_TURNS = 10;

export const RegieSchema = z.object({
  stufe: z.number().int().min(0).max(3).describe('Öffnungsstufe der Rolle: 0 = nichts erfüllt, 1 = erste Bedingung erfüllt, 2 = ungefähr die Hälfte, 3 = genug für volle Öffnung (nach der Zählregel der Bedingungen).'),
  erfuellt: z.array(z.string()).max(8).describe('Die erfüllten Öffnungs-Bedingungen, je in 3–8 Wörtern.'),
  eskaliert: z.boolean().describe('true, wenn im letzten Zug der lernenden Person ein Eskalations-Trigger ausgelöst wurde.'),
  notiz: z.string().max(400).describe('Regie-Notiz an die Rolle in der Autorensprache: NUR wenn sich die Stufe geändert hat oder eskaliert wurde; sonst leer. Form: ein bis zwei Sätze, was die Rolle jetzt zeigt oder preisgibt.'),
  vorschnell: z.boolean().describe('true, wenn die Rolle im letzten Zug eingelenkt, zugestimmt oder etwas preisgegeben hat, OBWOHL die dafür nötige Bedingung noch nicht erfüllt war.'),
  fehlt: z.string().max(200).describe('Was die lernende Person für die nächste Öffnungsstufe noch tun müsste, in einem Satz aus Sicht der Rolle (z. B. „nach der Ursache fragen, statt zu argumentieren“). Leer, wenn Stufe 3.'),
});

export interface RegieStand {
  stufe: number;
  erfuellt: string[];
  eskaliert: boolean;
  notiz: string;
  /** Zahl der Züge zum Zeitpunkt der Beobachtung (Index im Verlauf). */
  turn: number;
  ts: string;
  /** Notiz wurde der Rolle bereits übergeben (Textweg: beim nächsten Zug). */
  delivered?: boolean;
  /** Torwächter (01.11.2026): die Rolle hat vorschnell eingelenkt; was noch fehlt. */
  vorschnell?: boolean;
  fehlt?: string;
}

function bullets(items: string[]): string {
  return items.map((i) => `- ${i}`).join('\n');
}

/** PURE (getestet): Anweisung an den Beobachter. */
export function buildRegiePrompt(s: SimulationScenario, turns: SimulationTurn[], bisher: RegieStand | null): string {
  const d = s.personaDna;
  const letzte = turns.slice(-REGIE_MAX_TURNS);
  const verlauf = letzte
    .map((t) => `${t.role === 'user' ? 'LERNENDE PERSON' : d.name.toUpperCase()}: ${sanitizeForPrompt(t.text.slice(0, 1200), { label: 'ZUG' }).sanitized}`)
    .join('\n');
  const stand = bisher ? `Bisherige Stufe: ${bisher.stufe}. Bisher erfüllt: ${bisher.erfuellt.join('; ') || 'nichts'}.` : 'Bisherige Stufe: 0. Bisher erfüllt: nichts.';
  return `Du bist die Spielleitung einer Gesprächssimulation und beobachtest, ob die lernende Person die Bedingungen erfüllt, unter denen sich die Rolle ${d.name} öffnet. Du bewertest NUR das Verhalten der lernenden Person, nie die Rolle. Du erfindest nichts: Eine Bedingung gilt nur als erfüllt, wenn sie im Verlauf nachweisbar ist.

ÖFFNUNGS-BEDINGUNGEN DER ROLLE (mit ihrer eigenen Zählregel, falls genannt):
${bullets(d.concessionConditions)}
${d.freigabeRegel ? `FREIGABE-REGEL (Obergrenze der Verschlossenheit): ${d.freigabeRegel}\n` : ''}ESKALATIONS-TRIGGER:
${bullets(d.escalationTriggers)}

${stand}

VERLAUF (nur die letzten Züge):
${verlauf}

AUFGABE: Bestimme die Öffnungsstufe nach dem letzten Zug der lernenden Person. Stufe 0 = keine Bedingung erfüllt; 1 = die erste Bedingung erfüllt; 2 = ungefähr die Hälfte; 3 = so viele, wie die Zählregel der Rolle für volle Öffnung verlangt (sonst: alle wesentlichen). Eine einmal erfüllte Bedingung bleibt erfüllt, außer ein Eskalations-Trigger wirft die Rolle zurück (dann höchstens eine Stufe tiefer). Greift die Freigabe-Regel (die lernende Person hat getan, was sie verlangt), ist die darin genannte Stufe erreicht.
Prüfe außerdem den LETZTEN Zug der Rolle: Hat sie eingelenkt, zugestimmt, etwas preisgegeben oder einen Einwand fallen lassen, obwohl die zugehörige Bedingung nicht erfüllt war, dann vorschnell = true. Nenne in fehlt, was die lernende Person für die nächste Stufe noch tun müsste (Verhalten, kein Argument: nachfragen, spiegeln, belegen, konkret vereinbaren).
Schreibe die Regie-Notiz NUR bei Stufenwechsel oder Eskalation, in der Sprache der Bedingungen oben, als Anweisung an die Rolle, z. B. „Bedingung erfüllt: Anerkennung kam ehrlich. Du stehst jetzt auf Stufe 1: deute an, dass gerade viel los ist.“ oder „Eskalation: pauschaler Vorwurf. Du wirst still und formell.“ Sonst notiz = "".
Gib ausschließlich JSON gemäß Schema zurück.`;
}

const HALTE_PREFIX: Record<'de' | 'en', string> = { de: 'Halte deine Position', en: 'Hold your position' };

/** PURE (getestet): Halte-Notiz — rotes Licht der Spielleitung. */
export function halteNotiz(s: SimulationScenario, stufe: number, fehlt: string, vorschnell: boolean): string {
  const f = fehlt.trim();
  if (s.locale === 'en') {
    return `${HALTE_PREFIX.en}: ${vorschnell ? 'you gave in too early — take that back in substance and ' : ''}no condition for opening up${stufe > 0 ? ' beyond level ' + stufe : ''} is met yet. ${f ? `Still missing: ${f}. ` : ''}Keep your objections and ask for what is missing; a good argument alone is not enough.`;
  }
  return `${HALTE_PREFIX.de}: ${vorschnell ? 'du hast vorschnell eingelenkt — nimm das in der Sache zurück und ' : ''}es ist noch keine Bedingung für eine weitere Öffnung${stufe > 0 ? ' über Stufe ' + stufe : ''} erfüllt. ${f ? `Es fehlt: ${f}. ` : ''}Bleib bei deinen Einwänden und verlange, was fehlt; ein gutes Argument allein reicht nicht.`;
}

/** Regie-Marker für die Rolle (PURE): außerhalb des Nutzer-Fence, nie vorlesen. */
export function regieStageNote(s: SimulationScenario, stand: RegieStand): string {
  const n = stand.notiz.trim();
  if (!n) return '';
  return s.locale === 'en'
    ? `[STAGE NOTE — not part of the conversation, never read it out: ${n}]`
    : `[REGIE — nicht Teil des Gesprächs, nie vorlesen: ${n}]`;
}

/**
 * Beobachtet den Verlauf nach dem letzten Zug der lernenden Person. Fehler → null (keine Notiz).
 * `turns` enthält den aktuellen Zug der lernenden Person bereits.
 */
export async function beobachteRegie(args: {
  scenario: SimulationScenario;
  turns: SimulationTurn[];
  bisher: RegieStand | null;
  now?: () => number;
}): Promise<RegieStand | null> {
  const lastUser = [...args.turns].reverse().find((t) => t.role === 'user');
  if (!lastUser) return null;
  try {
    const response = await ai.generate({
      prompt: buildRegiePrompt(args.scenario, args.turns, args.bisher),
      output: { schema: RegieSchema },
      config: { maxOutputTokens: 400, thinkingConfig: { thinkingBudget: 0 }, temperature: 0.1 },
    });
    const out = response.output;
    if (!out) return null;
    const vorher = args.bisher?.stufe ?? 0;
    // Nie zwei Stufen auf einmal nach oben, nie weiter als eine Stufe zurück — Stabilität vor Eifer.
    const stufe = Math.max(Math.max(0, vorher - 1), Math.min(out.stufe, vorher + 1));
    const geaendert = stufe !== vorher || out.eskaliert;
    const fehlt = (out.fehlt ?? '').trim().slice(0, 200);
    let notiz = geaendert ? out.notiz.trim().slice(0, 400) : '';
    // Torwächter (01.11.2026): rote Lichter. Bisher sprach die Regie nur bei Öffnung; die Rolle lenkte dann allein ein.
    // Jetzt bekommt sie eine Halte-Notiz, wenn sie vorschnell eingelenkt hat oder nach zwei Zügen noch nichts erfüllt ist.
    const nutzerZuege = args.turns.filter((t) => t.role === 'user').length;
    const letzteHalte = args.bisher?.vorschnell || (args.bisher?.notiz ?? '').startsWith(HALTE_PREFIX[args.scenario.locale]);
    if (!notiz && stufe < 3 && (out.vorschnell || (stufe === 0 && nutzerZuege >= 2 && nutzerZuege % 2 === 0 && !letzteHalte))) {
      notiz = halteNotiz(args.scenario, stufe, fehlt, out.vorschnell);
    }
    return {
      stufe,
      erfuellt: out.erfuellt.map((x) => x.slice(0, 80)).slice(0, 8),
      eskaliert: out.eskaliert,
      notiz,
      turn: args.turns.length,
      ts: new Date((args.now ?? Date.now)()).toISOString(),
      ...(out.vorschnell ? { vorschnell: true } : {}),
      ...(fehlt ? { fehlt } : {}),
    };
  } catch (e) {
    console.warn('[regie] Beobachter fehlgeschlagen:', e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** Letzte noch nicht übergebene Regie-Notiz (Textweg: beim nächsten Zug). */
export function offeneRegieNotiz(regie: RegieStand[] | undefined): RegieStand | null {
  if (!regie?.length) return null;
  for (let i = regie.length - 1; i >= 0; i--) {
    const r = regie[i];
    if (r.notiz && !r.delivered) return r;
  }
  return null;
}

/** Verlauf der Öffnung als Zeilen für den Richter (objektiv protokolliert, kein Beleg für Scores). */
export function regieVerlaufText(regie: RegieStand[] | undefined, locale: 'de' | 'en'): string {
  if (!regie?.length) return '';
  const zeilen = regie
    .filter((r) => r.notiz || r.eskaliert || r.vorschnell)
    .map((r) =>
      locale === 'en'
        ? `turn ${r.turn}: level ${r.stufe}${r.eskaliert ? ', escalation' : ''}${r.vorschnell ? ', the role gave in too early' : ''}${r.erfuellt.length ? ` (${r.erfuellt.join('; ')})` : ''}`
        : `Zug ${r.turn}: Stufe ${r.stufe}${r.eskaliert ? ', Eskalation' : ''}${r.vorschnell ? ', Rolle lenkte vorschnell ein' : ''}${r.erfuellt.length ? ` (${r.erfuellt.join('; ')})` : ''}`
    );
  return zeilen.join('\n');
}
