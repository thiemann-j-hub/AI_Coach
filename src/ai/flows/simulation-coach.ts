/**
 * Time-out-Coach (Debrief 2.0, Welle D3).
 *
 * Kurzes Coach-Zwischenspiel WÄHREND der Simulation: die Szene ist angehalten,
 * der Coach gibt auf Basis des bisherigen Verlaufs EINEN konkreten, sofort
 * anwendbaren Impuls. Die Persona »hört« davon nichts (coachNotes liegen
 * getrennt von den turns), und die Auswertung bewertet nur das Gespräch.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { sanitizeForPrompt } from '@/lib/prompt-guard';
import type { SimulationScenario, SimulationTurn } from '@/lib/simulation/types';
import { assembleTranscript } from '@/lib/server/simulation-store';

const CoachTimeoutInputSchema = z.object({
  scenarioTitle: z.string(),
  personaName: z.string(),
  goalsList: z.string(),
  transcript: z.string(),
  question: z.string(),
  locale: z.string(),
});

const CoachTimeoutOutputSchema = z.object({
  tip: z
    .string()
    .describe(
      'Max. ~110 Wörter, direkte Ansprache. Aufbau: 1 Satz Beobachtung aus DIESEM Verlauf (mit kurzem Bezug), dann EIN konkreter Impuls, dann ein Formulierungsangebot in Anführungszeichen, das direkt gesagt werden kann.'
    ),
});

export type CoachTimeoutOutput = z.infer<typeof CoachTimeoutOutputSchema>;

const prompt = ai.definePrompt({
  name: 'simulationCoachTimeoutPrompt',
  input: { schema: CoachTimeoutInputSchema },
  output: { schema: CoachTimeoutOutputSchema },
  prompt: `
Du bist ein erfahrener Gesprächs-Coach. Die/der Übende hat im Szenario
"{{scenarioTitle}}" (Gespräch mit {{personaName}}) ein TIME-OUT genommen —
die Szene ist angehalten, ihr sprecht kurz unter vier Augen.

ZIELE DER/DES ÜBENDEN
{{{goalsList}}}

BISHERIGER VERLAUF
{{{transcript}}}

FRAGE DER/DES ÜBENDEN (leer = »Wie mache ich am besten weiter?«)
{{question}}

Gib EINEN Impuls nach dem Schema aus dem Output-Feld. Regeln:
- Beziehe dich konkret auf den Verlauf (kein Allgemein-Coaching).
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
}): Promise<string> {
  const rawTranscript = assembleTranscript(args.turns, args.scenario.persona.name);
  const { sanitized } = sanitizeForPrompt(rawTranscript, { label: 'VERLAUF' });
  const { sanitized: safeQuestion } = sanitizeForPrompt(args.question ?? '', {
    label: 'FRAGE',
  });

  const { output } = await prompt({
    scenarioTitle: args.scenario.title,
    personaName: args.scenario.persona.name,
    goalsList: args.scenario.candidateBriefing.goals
      .map((g, i) => `${i + 1}. ${g}`)
      .join('\n'),
    transcript: sanitized,
    question: safeQuestion.slice(0, 500),
    locale: args.scenario.locale === 'en' ? 'Englisch' : 'Deutsch',
  });
  if (!output?.tip?.trim()) throw new Error('coach timeout returned empty tip');
  return output.tip.trim();
}
