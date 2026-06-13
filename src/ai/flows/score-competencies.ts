/**
 * @fileOverview Score leadership competencies (C1–C10) based on a transcript.
 * Output is anonymized: "Führungskraft" / "Mitarbeiter:in" in evidence.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { sanitizeForPrompt } from '@/lib/prompt-guard';

export const ScoreCompetenciesInputSchema = z.object({
  transcriptText: z.string(),
  lang: z.string().optional(),
  leaderLabel: z.string().optional(),
  employeeLabel: z.string().optional(),
});

// WICHTIG: Feldreihenfolge ist load-bearing (Schema-Forced Reasoning aus der
// Schwester-App, §9). Das Modell füllt die Felder in dieser Reihenfolge — erst
// Evidenz sammeln, dann begründen, ERST DANN den Score vergeben. Score-vor-
// Evidenz verleitet das LLM, zuerst zu urteilen und danach zu rationalisieren.
export const CompetencyRatingSchema = z.object({
  id: z.string(),
  name: z.string(),
  evidence: z
    .array(z.string())
    .max(3)
    .describe("1–2 wörtliche, anonymisierte Zitate AUS DEM TRANSKRIPT (max ~18 Wörter). Keine Paraphrasen, keine erfundenen Zitate. Leeres Array, wenn nicht beobachtbar."),
  why: z
    .string()
    .describe("Begründung der Bewertung, ausschließlich auf die Evidenz gestützt. 'nicht ausreichend beobachtbar', wenn keine Evidenz vorliegt."),
  score: z
    .number()
    .min(1)
    .max(4)
    .nullable()
    .describe("Ganzzahl 1–4 NUR wenn durch die Evidenz belegt; sonst null. 1=schwach … 4=vorbildlich."),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .optional()
    .describe("0–1: Wie eindeutig belegt die Evidenz den Score?"),
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

SPRACHE
Verfasse alle "why"-Begründungen in der Sprache des Transkripts (Zielsprache: {{lang}}).
Bei lang="en" schreibe die Begründungen auf Englisch, bei "de" auf Deutsch usw.
Die Evidenz-Zitate bleiben immer im Originalwortlaut des Transkripts.

AUFGABE
Bewerte NUR das Verhalten der Führungskraft im Transkript entlang der Kompetenzen C1–C10.
Nutze nur Dinge, die im Transkript wirklich erkennbar sind. Keine Spekulationen.

SKALA 1–4
1 = schwach/kontraproduktiv oder kaum wirksam
2 = erste solide Ansätze
3 = gut und überwiegend wirksam
4 = sehr gut / vorbildlich in dieser Situation

REIHENFOLGE DER BEWERTUNG (zwingend, pro Kompetenz):
1) Sammle zuerst die EVIDENCE: 1–2 wörtliche Zitate aus dem Transkript (max. ~18 Wörter),
   anonymisiert mit Prefix "Führungskraft:" / "Mitarbeiter:in:" (keine echten Namen, keine Paraphrasen).
2) Begründe (why) ausschließlich auf Basis dieser Zitate.
3) Vergib ERST DANN den score — nur wenn die Evidenz ihn belegt.

WENN NICHT ERKENNBAR:
evidence = [], score = null, why = "nicht ausreichend beobachtbar".
Erfinde KEINE Zitate. Ein Zitat in evidence MUSS WÖRTLICH und ZUSAMMENHÄNGEND im Transkript stehen
(keine Fragmente aus verschiedenen Sätzen zusammensetzen).

KEIN ÜBER-SCORING:
Reine Terminabsprachen, Logistik oder Small-Talk sind KEINE Führungsleistung.
Wenn eine Kompetenz im Transkript nicht durch konkretes Führungsverhalten belegt ist,
ist score = null — vergib NIEMALS einen Score auf Basis bloßer Vermutung oder weil das
Thema „passen könnte".

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
  // Fence user-supplied transcript to reduce prompt injection risk
  const { sanitized: fencedText, injectionDetected } = sanitizeForPrompt(
    input.transcriptText,
    { label: 'TRANSCRIPT' }
  );
  if (injectionDetected) {
    console.warn(`[prompt-guard] Injection pattern detected in transcriptText: "${injectionDetected}"`);
  }

  const hardenedInput = { ...input, transcriptText: fencedText };
  const { output } = await prompt(hardenedInput);
  return output!;
}
