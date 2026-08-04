/**
 * @fileOverview Auswertung der Gesprächssimulation (SIM-2).
 *
 * Rubrik S1–S5 + szenario-spezifische Checkpoints. Feldreihenfolge ist
 * load-bearing (Schema-Forced Reasoning wie score-competencies): erst Evidenz,
 * dann Begründung, ERST DANN der Score.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { sanitizeForPrompt } from '@/lib/prompt-guard';
import type { SimulationScenario, SimulationTurn } from '@/lib/simulation/types';
import { assembleTranscript } from '@/lib/server/simulation-store';

export const SimulationFeedbackInputSchema = z.object({
  scenarioTitle: z.string(),
  personaName: z.string(),
  goalsList: z.string(),
  rubricList: z.string(),
  checkpointList: z.string(),
  transcript: z.string(),
  /** Fokus-Retry (D2): der EINE Vorsatz aus dem letzten Debrief; leer = kein Fokus. */
  focus: z.string(),
});

const RubricRatingSchema = z.object({
  key: z.string(),
  label: z.string(),
  evidence: z
    .array(z.string())
    .max(3)
    .describe('1–2 wörtliche Zitate AUS DEM GESPRÄCH (max ~20 Wörter), mit Sprecher-Prefix. Leeres Array, wenn nicht beobachtbar.'),
  why: z
    .string()
    .describe('Begründung ausschließlich auf Basis der Evidenz; "nicht beobachtbar", wenn keine Evidenz vorliegt.'),
  score: z
    .number()
    .min(1)
    .max(4)
    .nullable()
    .describe('Ganzzahl 1–4 NUR wenn durch Evidenz belegt; sonst null. 1=schwach … 4=vorbildlich.'),
});

const CheckpointResultSchema = z.object({
  id: z.string(),
  hit: z.boolean().describe('true nur, wenn der Moment im Gespräch nachweislich stattfand.'),
  comment: z
    .string()
    .describe('Ein Satz: was passiert ist bzw. was gefehlt hat — konkret, mit Bezug auf das Gespräch.'),
});

export const SimulationFeedbackOutputSchema = z.object({
  summary: z
    .string()
    .describe('3–5 Sätze Gesamtbild: was gelang, was das zentrale Muster war. Direkte Ansprache ("Du …"), wertschätzend UND ehrlich.'),
  rubric: z.array(RubricRatingSchema),
  checkpoints: z.array(CheckpointResultSchema),
  nextStep: z
    .string()
    .describe('EIN konkreter, übbarer nächster Schritt für das nächste Gespräch (1–2 Sätze, direkt umsetzbar).'),
  focusReview: z
    .object({
      addressed: z.boolean().describe('true nur, wenn der Fokus-Vorsatz im Gespräch erkennbar umgesetzt wurde.'),
      comment: z.string().describe('Ein Satz mit Beleg: woran man die Umsetzung sieht — oder was stattdessen passierte.'),
    })
    .nullable()
    .describe('NUR bewerten, wenn ein FOKUS-VORSATZ vorgegeben war; sonst null.'),
});

export type SimulationFeedbackOutput = z.infer<typeof SimulationFeedbackOutputSchema>;

const prompt = ai.definePrompt({
  name: 'simulationFeedbackPrompt',
  input: { schema: SimulationFeedbackInputSchema },
  output: { schema: SimulationFeedbackOutputSchema },
  prompt: `
Du bist ein erfahrener Leadership-Coach und wertest eine GESPRÄCHSSIMULATION aus.
Der/die Übende ("Teilnehmer:in") hat das Szenario "{{scenarioTitle}}" trainiert und mit der
Rolle {{personaName}} gesprochen. Bewerte AUSSCHLIESSLICH das Verhalten der/des Übenden —
nie das der Rolle.

ZIELE DES ÜBENDEN LAUT BRIEFING
{{{goalsList}}}

RUBRIK (bewerte genau diese Kompetenzen, in dieser Reihenfolge, mit key und label)
{{{rubricList}}}

CHECKPOINTS (prüfe genau diese Momente, mit exakt diesen ids)
{{{checkpointList}}}

SKALA 1–4
1 = schwach/kontraproduktiv · 2 = erste solide Ansätze · 3 = gut und überwiegend wirksam · 4 = vorbildlich

REIHENFOLGE (zwingend, pro Rubrik-Kompetenz):
1) Sammle zuerst EVIDENCE: 1–2 wörtliche Zitate aus dem Gespräch (mit Sprecher-Prefix "Teilnehmer:in:" bzw. "{{personaName}}:").
2) Begründe (why) ausschließlich auf Basis dieser Zitate.
3) Vergib ERST DANN den score — nur wenn die Evidenz ihn belegt; sonst score = null und why = "nicht beobachtbar".
Erfinde KEINE Zitate; ein Zitat muss wörtlich und zusammenhängend im Gespräch stehen.
Auch kontraproduktives Verhalten in einer relevanten Situation IST Evidenz (dann score = 1).
Ein sehr kurzes Gespräch mit wenigen Beiträgen kann viele null-Werte haben — das ist korrekt und ehrlich.

CHECKPOINTS: hit = true NUR, wenn der Moment nachweislich stattfand. Im comment nenne konkret,
woran du es festmachst — oder was stattdessen passiert ist. Kein Pauschal-Lob.

{{#if focus}}
FOKUS-VORSATZ DIESES VERSUCHS (aus dem letzten Debrief): "{{focus}}"
Bewerte in focusReview, ob der Vorsatz erkennbar umgesetzt wurde — mit Beleg.
{{else}}
Kein Fokus-Vorsatz vorgegeben → focusReview = null.
{{/if}}

summary und nextStep: direkte Ansprache ("Du …"), konkret, auf DIESES Gespräch bezogen.
Alles auf Deutsch.

GESPRÄCH
{{{transcript}}}

Gib ausschließlich JSON gemäß Schema zurück.
`,
});

export async function generateSimulationFeedback(args: {
  scenario: SimulationScenario;
  turns: SimulationTurn[];
  /** Fokus-Retry (D2): Vorsatz aus dem letzten Debrief, optional. */
  focus?: string;
}): Promise<SimulationFeedbackOutput> {
  const { scenario, turns } = args;
  const rawTranscript = assembleTranscript(turns, scenario.persona.name);
  const { sanitized, injectionDetected } = sanitizeForPrompt(rawTranscript, {
    label: 'GESPRÄCH',
  });
  if (injectionDetected) {
    console.warn('[prompt-guard] Injection pattern detected in simulation transcript (content redacted).');
  }

  const { output } = await prompt({
    scenarioTitle: scenario.title,
    personaName: scenario.persona.name,
    goalsList: scenario.candidateBriefing.goals.map((g, i) => `${i + 1}. ${g}`).join('\n'),
    rubricList: scenario.assessment.competencies
      .map((c) => `- ${c.key}: ${c.label}`)
      .join('\n'),
    checkpointList: scenario.assessment.checkpoints
      .map((c) => `- id "${c.id}": ${c.description}`)
      .join('\n'),
    transcript: sanitized,
    focus: (args.focus ?? '').slice(0, 300),
  });
  if (!output) throw new Error('simulation feedback returned empty output');

  // Ergebnis gegen die Szenario-Definition normalisieren: fehlende Rubrik-Keys/
  // Checkpoints ergänzen (ehrlich als nicht beobachtbar/nicht getroffen),
  // erfundene ids verwerfen — die UI rendert damit immer ein vollständiges Bild.
  const rubricByKey = new Map(output.rubric.map((r) => [r.key, r]));
  const rubric = scenario.assessment.competencies.map((c) => {
    const r = rubricByKey.get(c.key);
    if (!r) return { key: c.key, label: c.label, evidence: [], why: 'nicht beobachtbar', score: null };
    const score = typeof r.score === 'number' && r.score >= 1 && r.score <= 4 ? Math.round(r.score) : null;
    return { key: c.key, label: c.label, evidence: r.evidence.slice(0, 2), why: r.why, score };
  });
  const cpById = new Map(output.checkpoints.map((c) => [c.id, c]));
  const checkpoints = scenario.assessment.checkpoints.map((c) => {
    const r = cpById.get(c.id);
    return r
      ? { id: c.id, hit: r.hit, comment: r.comment }
      : { id: c.id, hit: false, comment: 'Im Gespräch nicht erkennbar.' };
  });

  return {
    summary: output.summary,
    rubric,
    checkpoints,
    nextStep: output.nextStep,
    // focusReview nur, wenn wirklich ein Fokus vorgegeben war (kein LLM-Eigenleben).
    focusReview: args.focus ? (output.focusReview ?? null) : null,
  };
}
