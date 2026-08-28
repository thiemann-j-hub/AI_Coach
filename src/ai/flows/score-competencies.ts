/**
 * @fileOverview Score leadership competencies (C1–C10) based on a transcript.
 * Output is anonymized: "Führungskraft" / "Mitarbeiter:in" in evidence.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { sanitizeForPrompt } from '@/lib/prompt-guard';
import { COMP_MODEL, COMPETENCY_DEFINITIONS } from '@/lib/competency-model';

export const ScoreCompetenciesInputSchema = z.object({
  transcriptText: z.string(),
  lang: z.string().optional(),
  leaderLabel: z.string().optional(),
  employeeLabel: z.string().optional(),
  /**
   * Kompetenzmodell v2 (Owner-GO 28.08.) — Szenario-Typ des Gesprächs.
   * Der Prompt war bis dahin HART auf Führung verdrahtet ("Leadership-Coach",
   * "Verhalten der Führungskraft", "keine Führungsleistung") und hätte ein
   * Verkaufs- oder Konfliktgespräch systematisch falsch gerahmt. Default
   * bleibt "mitarbeiterfuehrung" — damit verhält sich der Transkript-Upload
   * (/api/analyze, dort ist die Kategorie unbekannt) exakt wie bisher.
   */
  scenarioCategory: z
    .enum(["mitarbeiterfuehrung", "zusammenarbeit", "vertrieb", "stakeholder"])
    .optional(),
  // Vom Flow aus scenarioCategory abgeleitet (nicht vom Aufrufer zu setzen).
  coachRole: z.string().optional(),
  subjectLabel: z.string().optional(),
  counterpartLabel: z.string().optional(),
  nonPerformanceHint: z.string().optional(),
  competencyList: z.string().optional(),
});

/**
 * Rollen-Rahmen je Szenario-Typ. `subjectLabel` ist die BEWERTETE Person,
 * `counterpartLabel` das Gegenüber — beide gehen in die Anonymisierung der
 * Zitate ein (ein Vertriebs-Transkript zitiert "Verkäufer:in:", nicht
 * "Führungskraft:").
 */
const SCENARIO_FRAMING = {
  mitarbeiterfuehrung: {
    coachRole: "erfahrener Leadership-Coach",
    subject: "Führungskraft",
    counterpart: "Mitarbeiter:in",
    nonPerformance:
      "Reine Terminabsprachen, Logistik oder Small-Talk sind KEINE Führungsleistung.",
  },
  zusammenarbeit: {
    coachRole: "erfahrener Coach für Zusammenarbeit und Konfliktklärung",
    subject: "Teilnehmer:in",
    counterpart: "Gegenüber",
    nonPerformance:
      "Reine Terminabsprachen, Logistik oder Small-Talk sind KEINE beobachtbare Zusammenarbeits-Leistung.",
  },
  vertrieb: {
    coachRole: "erfahrener Vertriebs-Coach",
    subject: "Verkäufer:in",
    counterpart: "Kunde:in",
    nonPerformance:
      "Reine Terminabsprachen, Preislisten-Vorlesen oder Small-Talk sind KEINE Verkaufsleistung.",
  },
  stakeholder: {
    coachRole: "erfahrener Coach für Stakeholder-Kommunikation",
    subject: "Teilnehmer:in",
    counterpart: "Stakeholder",
    nonPerformance:
      "Reine Terminabsprachen, Status-Aufzählungen oder Small-Talk sind KEINE beobachtbare Leistung.",
  },
} as const;

export type ScenarioCategory = keyof typeof SCENARIO_FRAMING;

/**
 * Kompetenz-Liste MIT Ein-Satz-Definitionen. Bis v2 standen im Prompt nur die
 * nackten zehn Titel — das Modell musste raten, was z. B. "C6" konkret meint.
 */
function buildCompetencyList(): string {
  return COMP_MODEL.map(
    (c) => `${c.id} – ${c.name}: ${COMPETENCY_DEFINITIONS[c.id] ?? ""}`
  ).join("\n");
}

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
Du bist ein {{coachRole}}.

SPRACHE
Verfasse alle "why"-Begründungen in der Sprache des Transkripts (Zielsprache: {{lang}}).
Bei lang="en" schreibe die Begründungen auf Englisch, bei "de" auf Deutsch usw.
Die Evidenz-Zitate bleiben immer im Originalwortlaut des Transkripts.

AUFGABE
Bewerte NUR das Verhalten der Person „{{subjectLabel}}" im Transkript entlang der Kompetenzen C1–C10.
Das Gegenüber („{{counterpartLabel}}") wird NICHT bewertet.
Nutze nur Dinge, die im Transkript wirklich erkennbar sind. Keine Spekulationen.

SKALA 1–4
1 = schwach/kontraproduktiv oder kaum wirksam
2 = erste solide Ansätze
3 = gut und überwiegend wirksam
4 = sehr gut / vorbildlich in dieser Situation
TRENNSCHÄRFE: Bewerte je Kompetenz NUR ihren eigenen Kern (s. Definitionen unten) und lass ihn
nicht vom Gesamteindruck einfärben — z. B. kann C2 (Problemlösung/Entscheidungsfindung) hoch sein,
obwohl der Ton schlecht ist (der Ton gehört zu C5). Ein durchgängig negatives Gespräch macht nicht automatisch JEDE
beobachtbare Kompetenz zur 1.

REIHENFOLGE DER BEWERTUNG (zwingend, pro Kompetenz):
1) Sammle zuerst die EVIDENCE: 1–2 wörtliche Zitate aus dem Transkript (max. ~18 Wörter),
   anonymisiert mit Prefix "{{subjectLabel}}:" / "{{counterpartLabel}}:" (keine echten Namen, keine Paraphrasen).
2) Begründe (why) ausschließlich auf Basis dieser Zitate.
3) Vergib ERST DANN den score — nur wenn die Evidenz ihn belegt.

BEOBACHTBARKEITS-TEST (zwingend VOR jedem Score, pro Kompetenz — Konsistenz vor Vollständigkeit):
Stelle GENAU diese Frage: "Gibt es mindestens EIN wörtliches Zitat, in dem „{{subjectLabel}}" in einer
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
{{nonPerformanceHint}}
Wenn eine Kompetenz im Transkript nicht durch konkretes, beobachtbares Verhalten belegt ist,
ist score = null — vergib NIEMALS einen Score auf Basis bloßer Vermutung oder weil das
Thema „passen könnte".

KOMPETENZMODELL (C1–C10 mit Definitionen — bewerte GENAU diese Bedeutung)
{{competencyList}}

WICHTIG zu C3, C4, C7, C9 (Führungskompetenzen): Diese vier setzen echte
Führungs-/Verantwortungssituationen voraus. Zeigt das Transkript keine solche
Situation (z. B. ein reines Verkaufs- oder Kollegengespräch), sind sie
"nicht ausreichend beobachtbar" (score = null) — konstruiere daraus NIE
Führungsverhalten.

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
    // R9: NUR Signal loggen, NICHT den gematchten Nutzer-Text (PII/App-Insights).
    console.warn(`[prompt-guard] Injection pattern detected in transcriptText (content redacted).`);
  }

  // V2: Rollen-Rahmen + Kompetenz-Definitionen ableiten. Der Default
  // "mitarbeiterfuehrung" haelt den Transkript-Upload verhaltensgleich.
  const framing =
    SCENARIO_FRAMING[input.scenarioCategory ?? 'mitarbeiterfuehrung'] ??
    SCENARIO_FRAMING.mitarbeiterfuehrung;
  const hardenedInput = {
    ...input,
    transcriptText: fencedText,
    coachRole: framing.coachRole,
    // Sprecher-Labels des Transkripts gewinnen, wenn der Aufrufer sie kennt —
    // sonst der generische Rollen-Begriff des Szenario-Typs.
    subjectLabel: input.leaderLabel || framing.subject,
    counterpartLabel: input.employeeLabel || framing.counterpart,
    nonPerformanceHint: framing.nonPerformance,
    competencyList: buildCompetencyList(),
  };

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
