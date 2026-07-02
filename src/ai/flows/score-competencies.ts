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
TRENNSCHÄRFE: Bewerte je Kompetenz NUR ihren eigenen Kern und lass ihn nicht vom Gesamteindruck
einfärben — z. B. kann C2 (Klarheit/Entscheidungsstärke) hoch sein, obwohl der Ton schlecht ist
(der Ton gehört zu C5). Ein durchgängig negatives Gespräch macht nicht automatisch JEDE
beobachtbare Kompetenz zur 1.

REIHENFOLGE DER BEWERTUNG (zwingend, pro Kompetenz):
1) Sammle zuerst die EVIDENCE: 1–2 wörtliche Zitate aus dem Transkript (max. ~18 Wörter),
   anonymisiert mit Prefix "Führungskraft:" / "Mitarbeiter:in:" (keine echten Namen, keine Paraphrasen).
2) Begründe (why) ausschließlich auf Basis dieser Zitate.
3) Vergib ERST DANN den score — nur wenn die Evidenz ihn belegt.

BEOBACHTBARKEITS-TEST (zwingend VOR jedem Score, pro Kompetenz — Konsistenz vor Vollständigkeit):
Stelle GENAU diese Frage: "Gibt es mindestens EIN wörtliches Zitat, in dem die Führungskraft in einer
Situation handelt, die DIESE Kompetenz konkret fordert?"
- NEIN → evidence = [], score = null, why = "nicht ausreichend beobachtbar". IMMER. Keine Ausnahme.
- JA  → score 1–4 vergeben. Auch KONTRAPRODUKTIVES Verhalten in einer relevanten Situation IST
  Evidenz (dann score = 1) — z. B. abgeblockter Dialog belegt C5 mit 1, nicht mit null.
ABER: Das bloße FEHLEN eines Themas ist KEINE Evidenz (kein Score 1, sondern null) — wenn die
Situation die Kompetenz gar nicht fordert, wurde nichts beobachtet.
GRENZFALL-REGEL: Ist der Beleg nur indirekt, angedeutet oder müsstest du interpretieren
(confidence < 0.5), entscheide dich IMMER für null. Ein knapper Beleg, den du bei erneuter
Bewertung desselben Transkripts vielleicht nicht wiederfinden würdest, ist KEIN Beleg.
Dieselbe Transkriptstelle muss bei jeder Bewertung zur SELBEN Beobachtbarkeits-Entscheidung führen.

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

/**
 * Konsens-Scoring (flag-gated, Default AUS): SCORING_CONSENSUS=on bewertet das
 * Transkript mit n=3 PARALLELEN Läufen und mergt per Mehrheitsentscheid.
 * Grund (Reliabilitäts-Harness 2026-07-02): die Beobachtbarkeits-Entscheidung
 * bei Rand-Evidenz bleibt trotz Prompt-Härtung stochastisch (null-Flattern) —
 * eine Mehrheit ist mechanisch stabil, wo eine Einzelentscheidung würfelt.
 */
export function scoringConsensusEnabled(): boolean {
  return (process.env.SCORING_CONSENSUS ?? 'off').toLowerCase() === 'on';
}

type Rating = z.infer<typeof CompetencyRatingSchema>;

/**
 * PURE Merge-Regel (testbar): Eine Kompetenz gilt nur als beobachtbar, wenn
 * die MEHRHEIT der Läufe (>= ceil(n/2), bei n=3 also 2) sie beobachtet hat.
 * Score = Median der beobachteten Werte; evidence/why kommen aus dem Lauf,
 * dessen Score dem Median am nächsten liegt (kein synthetischer Text).
 */
export function mergeConsensusRuns(runs: Array<{ competencies: Rating[] }>): { competencies: Rating[] } {
  const byId = new Map<string, Rating[]>();
  const order: string[] = [];
  for (const run of runs) {
    for (const c of run?.competencies ?? []) {
      if (!c?.id) continue;
      if (!byId.has(c.id)) { byId.set(c.id, []); order.push(c.id); }
      byId.get(c.id)!.push(c);
    }
  }
  const majority = Math.ceil(runs.length / 2);
  const merged: Rating[] = [];
  for (const id of order) {
    const variants = byId.get(id)!;
    const observed = variants.filter((v) => typeof v.score === 'number' && v.score! >= 1);
    if (observed.length < majority) {
      // Mehrheit sagt "nicht beobachtbar" -> konsistent null (kein Flattern).
      const nullVariant = variants.find((v) => v.score == null) ?? variants[0];
      merged.push({ ...nullVariant, score: null, evidence: [], confidence: null });
      continue;
    }
    const scores = observed.map((v) => v.score as number).sort((a, b) => a - b);
    const mid = Math.floor(scores.length / 2);
    const median = scores.length % 2 ? scores[mid] : (scores[mid - 1] + scores[mid]) / 2;
    // Repraesentant = beobachteter Lauf mit minimalem Abstand zum Median
    const rep = observed.reduce((best, v) =>
      Math.abs((v.score as number) - median) < Math.abs((best.score as number) - median) ? v : best
    );
    merged.push({ ...rep, score: median });
  }
  return { competencies: merged };
}

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

  if (scoringConsensusEnabled()) {
    // n=3 parallel (kaum Latenz-Aufschlag, 3x Scoring-Tokens). Faellt ein Lauf
    // aus, tragen die verbleibenden die Mehrheit (fail-soft via allSettled).
    const settled = await Promise.allSettled([
      prompt(hardenedInput), prompt(hardenedInput), prompt(hardenedInput),
    ]);
    const ok = settled
      .filter((s): s is PromiseFulfilledResult<Awaited<ReturnType<typeof prompt>>> => s.status === 'fulfilled')
      .map((s) => s.value.output)
      .filter((o): o is NonNullable<typeof o> => !!o);
    if (ok.length === 0) throw (settled[0] as PromiseRejectedResult).reason;
    if (ok.length === 1) return ok[0];
    return mergeConsensusRuns(ok);
  }

  const { output } = await prompt(hardenedInput);
  return output!;
}
