/**
 * Time-out-Coach (Debrief 2.0, Welle D3) — seit V3 mit Karten (Owner-GO 25.09.2026).
 *
 * Kurzes Coach-Zwischenspiel WÄHREND der Simulation: die Szene ist angehalten,
 * der Coach gibt auf Basis des bisherigen Verlaufs EINEN konkreten, sofort
 * anwendbaren Impuls. Die Persona »hört« davon nichts (coachNotes liegen
 * getrennt von den turns), und die Auswertung bewertet nur das Gespräch.
 *
 * V3: Vor dem Impuls werden bis zu 5 passende Karten aus der Coaching-
 * Bibliothek geholt (fail-open). Der Coach baut den Impuls auf GENAU EINER
 * Karte auf (Move + Formulierungsangebot) und nennt sie — die UI zeigt sie
 * als Merkkarte. Formulierung nach dem Beobachter-Kanon (V2).
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { sanitizeForPrompt } from '@/lib/prompt-guard';
import type { SimulationScenario, SimulationTurn } from '@/lib/simulation/types';
import { assembleTranscript } from '@/lib/server/simulation-store';
import {
  buildCoachQuery,
  cardLang,
  cardsToPromptBlock,
  matchCardsByTitle,
  retrieveCoachCards,
  toPublicCard,
  type PublicCoachCard,
} from '@/lib/coach-cards';

const CoachTimeoutInputSchema = z.object({
  scenarioTitle: z.string(),
  personaName: z.string(),
  goalsList: z.string(),
  transcript: z.string(),
  question: z.string(),
  locale: z.string(),
  /** V3: Karten-Block (leer = keine Karten verfügbar). */
  cardsBlock: z.string(),
});

const CoachTimeoutOutputSchema = z.object({
  tip: z
    .string()
    .describe(
      'Max. ~110 Wörter, direkte Ansprache als Du-Botschaft. Aufbau: 1 Satz MOMENT aus DIESEM Verlauf (kurzer Bezug, was du gesagt hast) + WIRKUNG, dann EIN konkreter Impuls (wirksamerer Weg), dann ein Formulierungsangebot in Anführungszeichen, das direkt gesagt werden kann.'
    ),
  cardTitle: z
    .string()
    .nullable()
    .describe(
      'Wörtlicher Titel der EINEN Karte aus dem Karten-Block, auf der der Impuls aufbaut; null, wenn kein Karten-Block vorliegt oder keine Karte passt.'
    ),
});

export type CoachTimeoutOutput = z.infer<typeof CoachTimeoutOutputSchema>;

export interface CoachTimeoutResult {
  tip: string;
  /** V3: die Merkkarte, auf der der Impuls aufbaut (null = frei formuliert). */
  card: PublicCoachCard | null;
}

const prompt = ai.definePrompt({
  name: 'simulationCoachTimeoutPrompt',
  input: { schema: CoachTimeoutInputSchema },
  output: { schema: CoachTimeoutOutputSchema },
  prompt: `
Du bist ein erfahrener Gesprächs-Coach — Begleiter:in, nicht Richter:in. Die/der Übende hat im Szenario
"{{scenarioTitle}}" (Gespräch mit {{personaName}}) ein TIME-OUT genommen —
die Szene ist angehalten, ihr sprecht kurz unter vier Augen.

ZIELE DER/DES ÜBENDEN
{{{goalsList}}}

BISHERIGER VERLAUF
{{{transcript}}}

FRAGE DER/DES ÜBENDEN (leer = »Wie mache ich am besten weiter?«)
{{question}}

{{#if cardsBlock}}
KARTEN AUS DER COACHING-BIBLIOTHEK (intern — nicht als Quelle nennen, nicht vorlesen)
{{{cardsBlock}}}

Wähle GENAU EINE Karte, die zur Frage und zum Verlauf passt, und baue deinen Impuls darauf:
der konkrete Move aus ihren STEPS und ein Formulierungsangebot im Sinn ihrer EXAMPLE PHRASES,
angepasst an DIESES Gespräch. Trage ihren Titel wörtlich in cardTitle ein.
Passt keine Karte wirklich, dann cardTitle = null und Impuls frei.
{{else}}
Kein Karten-Block vorhanden → cardTitle = null.
{{/if}}

Gib EINEN Impuls nach dem Schema aus dem Output-Feld. Regeln:
- Beziehe dich konkret auf den Verlauf (kein Allgemein-Coaching): MOMENT → WIRKUNG → WIRKSAMERER WEG.
- Beschreibe Verhalten und Wirkung, nie die Person („Du bist …“ ist tabu).
- Verrate NICHTS über innere Beweggründe der Rolle, die im Gespräch nicht
  sichtbar wurden — coache Verhalten, nicht Geheimwissen.
- Kein Urteil, keine Note, kein Lob-Sandwich. Ein Impuls, sofort anwendbar.
- Antworte auf {{locale}}.
`,
});

export async function runCoachTimeout(args: {
  scenario: SimulationScenario;
  turns: SimulationTurn[];
  question?: string;
  /** Gesprächssprache (de/en/es/fr); Karten gibt es de/en. */
  convoLocale?: string;
}): Promise<CoachTimeoutResult> {
  const rawTranscript = assembleTranscript(args.turns, args.scenario.persona.name);
  const { sanitized } = sanitizeForPrompt(rawTranscript, { label: 'VERLAUF' });
  const { sanitized: safeQuestion } = sanitizeForPrompt(args.question ?? '', {
    label: 'FRAGE',
  });
  const question = safeQuestion.slice(0, 500);

  // V3: Karten holen (fail-open) — Suchtext aus Szenario, Zielen, Frage und
  // dem ENDE des Verlaufs (dort liegt der Moment, um den es geht).
  const lang = cardLang(args.convoLocale, args.scenario.locale);
  const { cards } = await retrieveCoachCards({
    text: buildCoachQuery({
      conversationType: args.scenario.conversationType,
      title: args.scenario.title,
      goals: args.scenario.candidateBriefing.goals,
      transcript: sanitized,
      question,
      maxChars: 2500,
    }),
    lang,
    topK: 5,
    label: 'coach-timeout-cards',
  });

  const { output } = await prompt({
    scenarioTitle: args.scenario.title,
    personaName: args.scenario.persona.name,
    goalsList: args.scenario.candidateBriefing.goals
      .map((g, i) => `${i + 1}. ${g}`)
      .join('\n'),
    transcript: sanitized,
    question,
    locale: args.scenario.locale === 'en' ? 'Englisch' : 'Deutsch',
    cardsBlock: cards.length ? cardsToPromptBlock(cards, 1000) : '',
  });
  if (!output?.tip?.trim()) throw new Error('coach timeout returned empty tip');

  // Gewählte Karte auflösen; nennt das Modell keine, fällt die Karte weg
  // (kein Raten — die UI zeigt nur, worauf der Impuls wirklich aufbaut).
  const picked = output.cardTitle ? matchCardsByTitle(cards, [output.cardTitle], 1) : [];
  return {
    tip: output.tip.trim(),
    card: picked[0] ? toPublicCard(picked[0]) : null,
  };
}
