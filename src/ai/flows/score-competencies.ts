/**
 * @fileOverview Score leadership competencies (C1–C10) based on a transcript.
 * Output is anonymized: "Führungskraft" / "Mitarbeiter:in" in evidence.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

export const ScoreCompetenciesInputSchema = z.object({
  transcriptText: z.string(),
  lang: z.string().optional(),
  leaderLabel: z.string().optional(),
  employeeLabel: z.string().optional(),
});

export const CompetencyRatingSchema = z.object({
  id: z.string(),
  name: z.string(),
  score: z.number().min(1).max(4).nullable(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  why: z.string(),
  evidence: z.array(z.string()).max(3),
});

export const ScoreCompetenciesOutputSchema = z.object({
  competencies: z.array(CompetencyRatingSchema),
});

const prompt = ai.definePrompt({
  name: 'scoreCompetenciesPrompt',
  input: { schema: ScoreCompetenciesInputSchema },
  output: { schema: ScoreCompetenciesOutputSchema },
  prompt: `
Du bist ein erfahrener Leadership‑Coach.

AUFGABE
Bewerte NUR das Verhalten der Führungskraft im Transkript entlang der Kompetenzen C1–C10.
Nutze nur Dinge, die im Transkript wirklich erkennbar sind. Keine Spekulationen.

SKALA 1–4
1 = schwach/kontraproduktiv oder kaum wirksam
2 = erste solide Ansätze
3 = gut und überwiegend wirksam
4 = sehr gut / vorbildlich in dieser Situation

WENN NICHT ERKENNBAR:
score = null und why = "nicht ausreichend beobachtbar"

EVIDENCE:
1–2 kurze Zitate (max. ~18 Wörter), anonymisiert.
Nutze Sprecher-Prefix immer "Führungskraft:" oder "Mitarbeiter:in:" (keine echten Namen).

KOMPETENZMODELL (Kurz)
C1 – Integrieren und Verbinden
C2 – Klarheit und Entscheidungsstärke
C3 – Befähigen und Entwickeln
C4 – Sicherheit und Stabilität geben
C5 – Kommunikation und Kooperation
C6 – Zielorientierte Umsetzung
C7 – Innovative Kultur fördern
C8 – Selbstreflexion und Lernmotivation
C9 – Zukunftsorientierung und strategischer Weitblick
C10 – KI- und Datenkompetenz

TRANSKRIPT
{{{transcriptText}}}

Gib ausschließlich JSON gemäß Schema zurück.
`,
});

export async function scoreCompetencies(input: z.infer<typeof ScoreCompetenciesInputSchema>) {
  const { output } = await prompt(input);
  return output!;
}
