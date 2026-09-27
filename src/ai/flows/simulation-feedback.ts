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
import { OBSERVER_CANON_DE } from '@/lib/coach-canon';
import {
  buildCoachQuery,
  cardLang,
  cardsToPromptBlock,
  matchCardsByTitle,
  retrieveCoachCards,
  toPublicCard,
  type PublicCoachCard,
} from '@/lib/coach-cards';

export const SimulationFeedbackInputSchema = z.object({
  scenarioTitle: z.string(),
  personaName: z.string(),
  goalsList: z.string(),
  rubricList: z.string(),
  checkpointList: z.string(),
  transcript: z.string(),
  /** Fokus-Retry (D2): der EINE Vorsatz aus dem letzten Debrief; leer = kein Fokus. */
  focus: z.string(),
  /** Coaching-Check-in (A1): Selbsteinschätzung des Übenden; leer = übersprungen. */
  selfAssessment: z.string(),
  /** Sprache der Textausgaben (summary/why/comment/nextStep) — folgt der Gesprächssprache. */
  outputLanguage: z.string(),
  /** V2: Beobachter-Kanon (Formulierungsregeln). */
  canon: z.string(),
  /** V3: Karten aus der Coaching-Bibliothek (leer = keine verfügbar). */
  cardsBlock: z.string(),
  /** O2: Vorsatz + Rückmeldung aus dem Alltag seit dem letzten Debrief (leer = keine). */
  transferReview: z.string(),
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
    .describe(
      'Begründung als DIREKTE ANSPRACHE des Übenden (Du-Form), ausschließlich auf Basis der Evidenz: „Du hast … gesagt — das führte dazu, dass …". Nie „Der/die Übende …" oder „Der/die Teilnehmer:in …". "nicht beobachtbar", wenn keine Evidenz vorliegt.'
    ),
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
    .describe(
      'Der größte Hebel als Du-Botschaft in GENAU dieser Reihenfolge, 3–4 Sätze, max. 90 Wörter: (1) MOMENT — „In dem Moment, als …, hast du … gesagt" mit kurzem wörtlichem Zitat aus dem Gespräch; (2) WIRKUNG — „Das führte dazu, dass …"; (3) WIRKSAMERER WEG — „Ein wirksamerer Weg wäre …" mit EINEM Beispielsatz in Anführungszeichen, der im nächsten Gespräch direkt gesagt werden kann. Kein Lob-Sandwich, kein allgemeiner Rat.'
    ),
  focusReview: z
    .object({
      addressed: z.boolean().describe('true nur, wenn der Fokus-Vorsatz im Gespräch erkennbar umgesetzt wurde.'),
      comment: z.string().describe('Ein Satz mit Beleg: woran man die Umsetzung sieht — oder was stattdessen passierte.'),
    })
    .nullable()
    .describe('NUR bewerten, wenn ein FOKUS-VORSATZ vorgegeben war; sonst null.'),
  selfReview: z
    .object({
      agreement: z
        .enum(['confirms', 'partly', 'differs'])
        .describe('Deckt sich die Selbsteinschätzung mit der Auswertung? confirms = weitgehend, partly = teils, differs = klar abweichend.'),
      comment: z
        .string()
        .describe('2–3 Sätze: greife die Selbsteinschätzung wörtlich auf und bestätige oder korrigiere sie — AUSSCHLIESSLICH mit Beleg aus dem Gespräch.'),
    })
    .nullable()
    .describe('NUR bewerten, wenn eine SELBSTEINSCHÄTZUNG vorliegt; sonst null.'),
  recommendedCards: z
    .array(z.string())
    .max(2)
    .describe(
      'Wörtliche TITEL der 1–2 Karten aus dem Karten-Block, die den nextStep stützen und zur schwächsten Rubrik-Kompetenz passen. Leeres Array, wenn kein Karten-Block vorliegt oder keine passt.'
    ),
  microTransfer: z
    .object({
      step: z
        .string()
        .describe(
          'EIN On-the-job-Schritt fürs ECHTE Gespräch im Alltag, imperativ, Du-Form, max. 25 Wörter, mit konkretem Anlass („Morgen im Team-Meeting …", „Im nächsten 1:1 mit …") und dem einen Satz, den du sagst. Keine Auswahl, kein „oder". Abgeleitet aus dem größten Hebel.'
        ),
      when: z.string().describe('Kurze Zeitangabe für den Schritt: „morgen", „bis Freitag", „im nächsten 1:1" (max. 6 Wörter).'),
    })
    .describe('O2 Micro-Transfer: der Vorsatz, nach dem beim nächsten Login gefragt wird.'),
});

/** Rohausgabe des Modells (inkl. recommendedCards-Titel). */
export type SimulationFeedbackRaw = z.infer<typeof SimulationFeedbackOutputSchema>;

/**
 * Persistierter Vertrag (feedbackJson): normalisierte Rubrik/Checkpoints,
 * seit V3 zusätzlich `cards` — die aufgelösten Merkkarten (ohne Volltext).
 */
export type SimulationFeedbackOutput = Omit<SimulationFeedbackRaw, 'recommendedCards'> & {
  cards: PublicCoachCard[];
};

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

{{#if selfAssessment}}
SELBSTEINSCHÄTZUNG DES ÜBENDEN (direkt nach dem Gespräch, vor dieser Auswertung):
"{{selfAssessment}}"
PFLICHT: Fülle selfReview. Greife die Selbsteinschätzung inhaltlich auf ("Du meintest …")
und bestätige oder korrigiere sie — ausschließlich mit Beleg aus dem Gespräch.
Sei ehrlich: Eine zu strenge Selbstsicht verdient genauso eine Korrektur wie eine zu milde.
Die Selbsteinschätzung ist KEINE Evidenz für die Rubrik-Scores — bewertet wird nur das Gespräch.
{{else}}
Keine Selbsteinschätzung abgegeben → selfReview = null.
{{/if}}

{{{canon}}}
Gilt für summary, why, comment und nextStep: Entwicklungspunkte als Du-Botschaft
MOMENT → WIRKUNG → WIRKSAMERER WEG, Stärken verb-first mit Wirkung und Beleg.

{{#if cardsBlock}}
KARTEN AUS DER COACHING-BIBLIOTHEK (intern — nie als Quelle nennen, nicht wörtlich zitieren)
{{{cardsBlock}}}
Nutze sie, um nextStep konkret und übbar zu machen (EIN Move, EINE Formulierung, an dieses
Gespräch angepasst). Trage in recommendedCards die wörtlichen Titel der 1–2 Karten ein, die zur
schwächsten Rubrik-Kompetenz passen; leer, wenn keine wirklich passt.
{{else}}
Kein Karten-Block vorhanden → recommendedCards = [].
{{/if}}

{{#if transferReview}}
TRANSFER-RÜCKBLICK (aus dem echten Alltag seit dem letzten Debrief)
{{transferReview}}
Würdige das in summary in EINEM Satz: Zeigt sich dieser Vorsatz in DIESEM Gespräch? Bewerte nur das
Gespräch, nicht den Alltag.
{{/if}}

microTransfer: EIN Schritt für den Alltag, der aus dem größten Hebel folgt — imperativ, mit Anlass
und Zeitpunkt („Morgen im Team-Meeting sagst du zuerst: »…«"). Kein zweiter Schritt, keine Auswahl.

summary und nextStep: direkte Ansprache ("Du …"), konkret, auf DIESES Gespräch bezogen.
Alle Textausgaben (summary, why, comment, nextStep) auf {{outputLanguage}} — Zitate in der EVIDENCE bleiben wörtlich in der Gesprächssprache.

GESPRÄCH
{{{transcript}}}

Gib ausschließlich JSON gemäß Schema zurück.
`,
});

/** Deutsch formulierte Sprachnamen fuer die Ausgabesprache des Feedbacks. */
const FEEDBACK_LANGUAGE: Record<string, string> = {
  de: 'Deutsch',
  en: 'Englisch',
  es: 'Spanisch',
  fr: 'Französisch',
};

export async function generateSimulationFeedback(args: {
  scenario: SimulationScenario;
  turns: SimulationTurn[];
  /** Fokus-Retry (D2): Vorsatz aus dem letzten Debrief, optional. */
  focus?: string;
  /** Gesprächssprache — Feedback-Texte folgen ihr (Default: Szenario-Locale). */
  convoLocale?: string;
  /** Coaching-Check-in (A1): Selbsteinschätzung des Übenden, optional. */
  selfAssessment?: string;
  /** O2: Vorsatz + Rückmeldung aus dem Alltag (buildTransferReviewText), optional. */
  transferReview?: string;
}): Promise<SimulationFeedbackOutput> {
  const { scenario, turns } = args;
  const rawTranscript = assembleTranscript(turns, scenario.persona.name);
  const { sanitized, injectionDetected } = sanitizeForPrompt(rawTranscript, {
    label: 'GESPRÄCH',
  });
  if (injectionDetected) {
    console.warn('[prompt-guard] Injection pattern detected in simulation transcript (content redacted).');
  }

  // V3 (Owner-GO 25.09., N4-77): Karten für den nächsten Schritt — Suchtext aus
  // Gesprächstyp, Zielen, Rubrik und dem Ende des Gesprächs. Fail-open.
  const lang = cardLang(args.convoLocale, scenario.locale);
  const { cards } = await retrieveCoachCards({
    text: buildCoachQuery({
      conversationType: scenario.conversationType,
      title: scenario.title,
      goals: scenario.candidateBriefing.goals,
      rubricLabels: scenario.assessment.competencies.map((c) => c.label),
      transcript: sanitized,
      maxChars: 3500,
    }),
    lang,
    topK: 6,
    label: 'debrief-cards',
  });

  const { output } = await prompt({
    scenarioTitle: scenario.title,
    personaName: scenario.persona.name,
    goalsList: scenario.candidateBriefing.goals.map((g, i) => `${i + 1}. ${g}`).join('\n'),
    // B1: szenariospezifische Rubrik je Anker — Anweisung an den Bewerter
    // (Synthesia-Muster »Rubrik je Skill«); ohne rubric bleibt die 1–4-Skala.
    rubricList: scenario.assessment.competencies
      .map((c) => `- ${c.key}: ${c.label}${c.rubric ? ` — BEWERTUNGS-RUBRIK: ${c.rubric}` : ''}`)
      .join('\n'),
    checkpointList: scenario.assessment.checkpoints
      .map((c) => `- id "${c.id}": ${c.description}`)
      .join('\n'),
    transcript: sanitized,
    focus: (args.focus ?? '').slice(0, 300),
    // A1: Nutzertext → derselbe Injection-Schutz wie das Transkript.
    selfAssessment: args.selfAssessment
      ? sanitizeForPrompt(args.selfAssessment.slice(0, 600), {
          label: 'SELBSTEINSCHÄTZUNG',
        }).sanitized
      : '',
    outputLanguage:
      FEEDBACK_LANGUAGE[args.convoLocale ?? scenario.locale] ?? 'Deutsch',
    // V2: Der Prompt ist deutsch verfasst → deutscher Kanon; die Ausgabe folgt outputLanguage.
    canon: OBSERVER_CANON_DE,
    cardsBlock: cards.length ? cardsToPromptBlock(cards, 900) : '',
    transferReview: (args.transferReview ?? '').slice(0, 600),
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

  // V3: gewählte Karten auflösen. Nennt das Modell keine, fällt auf die
  // bestpassende Karte des Retrievals zurück (Vektorsuche hat bereits nach
  // Nähe zu diesem Gespräch sortiert) — der Übende bekommt immer EINE Karte
  // zum nächsten Schritt, sofern die Bibliothek erreichbar war.
  const picked = matchCardsByTitle(cards, output.recommendedCards ?? [], 2);
  const cardRefs = (picked.length ? picked : cards.slice(0, 1)).map(toPublicCard);

  return {
    summary: output.summary,
    rubric,
    checkpoints,
    nextStep: output.nextStep,
    // focusReview nur, wenn wirklich ein Fokus vorgegeben war (kein LLM-Eigenleben).
    focusReview: args.focus ? (output.focusReview ?? null) : null,
    // selfReview nur bei tatsächlich abgegebener Selbsteinschätzung (A1).
    selfReview: args.selfAssessment ? (output.selfReview ?? null) : null,
    cards: cardRefs,
    microTransfer: {
      step: String(output.microTransfer?.step ?? '').trim().slice(0, 300),
      when: String(output.microTransfer?.when ?? '').trim().slice(0, 60),
    },
  };
}
