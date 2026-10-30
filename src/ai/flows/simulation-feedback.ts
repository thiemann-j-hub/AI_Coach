import { anredeBlock } from '@/lib/anrede';
/**
 * @fileOverview Auswertung der Gesprächssimulation (SIM-2).
 *
 * Rubrik (Anker des Szenarios) + szenario-spezifische Checkpoints. Feldreihenfolge ist
 * load-bearing (Schema-Forced Reasoning wie score-competencies): erst Evidenz,
 * dann Begründung, ERST DANN der Score.
 *
 * Welle 1 (Owner-GO 30.10.2026, N4-240):
 *  - je Anker zusätzlich „Das gelang“ / „Nächstes Mal“ (je 0–2 Sätze, nur mit Beleg),
 *  - Rubrik mit vier Stufen aus der Fähigkeiten-Bibliothek bestimmt die Stufe 1–4,
 *  - Richter wählbar: Gemini (Standard) oder Claude Opus @eu (`COACH_RICHTER=opus`, Rückfall Gemini),
 *  - Gesprächsende (Rolle hat beendet) und Öffnungsverlauf (Regie) als Kontext, nie als Beleg.
 * Der Prompt ist eine reine Funktion (`buildFeedbackPrompt`), damit beide Richter denselben Text sehen.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { sanitizeForPrompt } from '@/lib/prompt-guard';
import type { SimulationScenario, SimulationTurn } from '@/lib/simulation/types';
import { coachRichter } from '@/lib/simulation/flags';
import { assembleTranscript } from '@/lib/server/simulation-store';
import { OBSERVER_CANON_DE } from '@/lib/coach-canon';
import { claudeStructured, claudeVertexConfigured } from '@/lib/server/claude-vertex';
import { logger } from '@/lib/logger';
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
  /** Welle 2: Wie das Gespräch endete (Rolle hat beendet: Grund + Art); leer = durch die lernende Person / Zeit. */
  gespraechsende: z.string(),
  /** Welle 2: Öffnungsverlauf des Regie-Beobachters (Zeilen); leer = keiner. */
  regieVerlauf: z.string(),
});
export type SimulationFeedbackInput = z.infer<typeof SimulationFeedbackInputSchema>;

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
  wentWell: z
    .array(z.string())
    .max(2)
    .describe('0–2 Sätze „Das gelang“: verb-first, Du-Form, je mit Wirkung und Bezug auf einen Moment des Gesprächs. Leer, wenn nicht beobachtbar.'),
  tryNext: z
    .array(z.string())
    .max(2)
    .describe('0–2 Sätze „Nächstes Mal“: MOMENT → WIRKUNG → WIRKSAMERER WEG, Du-Form, auf dieses Gespräch bezogen. Leer, wenn nichts zu verbessern oder nicht beobachtbar.'),
  score: z
    .number()
    .min(1)
    .max(4)
    .nullable()
    .describe('Ganzzahl 1–4 NUR wenn durch Evidenz belegt; sonst null. Mit Rubrik: die Stufe, deren Beschreibung am besten passt. Ohne Rubrik: 1=schwach … 4=vorbildlich.'),
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
  nextStepKey: z
    .string()
    .describe('key des Rubrik-Ankers, zu dem der größte Hebel gehört (genau einer aus der RUBRIK). Leer, wenn keiner passt.'),
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
 * Seit Welle 1: `judge` (welches Modell geurteilt hat) und je Anker wentWell/tryNext.
 */
export type SimulationFeedbackOutput = Omit<SimulationFeedbackRaw, 'recommendedCards'> & {
  cards: PublicCoachCard[];
  judge?: string;
};

/** PURE (getestet): der Auswertungs-Prompt — derselbe Text für beide Richter. */
export function buildFeedbackPrompt(i: SimulationFeedbackInput): string {
  const block = (cond: string, text: string) => (cond ? text : '');
  return `Du bist ein erfahrener Leadership-Coach und wertest eine GESPRÄCHSSIMULATION aus.
Der/die Übende ("Teilnehmer:in") hat das Szenario "${i.scenarioTitle}" trainiert und mit der
Rolle ${i.personaName} gesprochen. Bewerte AUSSCHLIESSLICH das Verhalten der/des Übenden —
nie das der Rolle.

ZIELE DES ÜBENDEN LAUT BRIEFING
${i.goalsList}

RUBRIK (bewerte genau diese Fähigkeiten, in dieser Reihenfolge, mit key und label)
${i.rubricList}

CHECKPOINTS (prüfe genau diese Momente, mit exakt diesen ids)
${i.checkpointList}

SKALA 1–4
Trägt eine Fähigkeit eine BEWERTUNGS-RUBRIK mit Stufen, dann ist der score die Stufe, deren Beschreibung
das beobachtete Verhalten am besten trifft (1 = Nicht gezeigt · 2 = Ansätze · 3 = Erfüllt · 4 = Übertroffen).
Ohne Rubrik: 1 = schwach/kontraproduktiv · 2 = erste solide Ansätze · 3 = gut und überwiegend wirksam · 4 = vorbildlich.

REIHENFOLGE (zwingend, pro Fähigkeit):
1) Sammle zuerst EVIDENCE: 1–2 wörtliche Zitate aus dem Gespräch (mit Sprecher-Prefix "Teilnehmer:in:" bzw. "${i.personaName}:").
2) Begründe (why) ausschließlich auf Basis dieser Zitate.
3) Fülle wentWell (0–2 Sätze: was gelang, verb-first, mit Wirkung) und tryNext (0–2 Sätze: MOMENT → WIRKUNG → WIRKSAMERER WEG) — beides nur mit Beleg aus dem Gespräch.
4) Vergib ERST DANN den score — nur wenn die Evidenz ihn belegt; sonst score = null und why = "nicht beobachtbar", wentWell und tryNext leer.
Erfinde KEINE Zitate; ein Zitat muss wörtlich und zusammenhängend im Gespräch stehen.
Auch kontraproduktives Verhalten in einer relevanten Situation IST Evidenz (dann score = 1).
Ein sehr kurzes Gespräch mit wenigen Beiträgen kann viele null-Werte haben — das ist korrekt und ehrlich.

CHECKPOINTS: hit = true NUR, wenn der Moment nachweislich stattfand. Im comment nenne konkret,
woran du es festmachst — oder was stattdessen passiert ist. Kein Pauschal-Lob.
${block(
  i.gespraechsende,
  `
GESPRÄCHSENDE (Kontext, kein Beleg für Scores): ${i.gespraechsende}
`
)}${block(
  i.regieVerlauf,
  `
ÖFFNUNGSVERLAUF DER ROLLE (objektiv protokolliert von der Spielleitung; Kontext, kein Beleg für Scores — Belege kommen nur aus dem Gespräch):
${i.regieVerlauf}
`
)}
${
  i.focus
    ? `FOKUS-VORSATZ DIESES VERSUCHS (aus dem letzten Debrief): "${i.focus}"
Bewerte in focusReview, ob der Vorsatz erkennbar umgesetzt wurde — mit Beleg.`
    : `Kein Fokus-Vorsatz vorgegeben → focusReview = null.`
}

${
  i.selfAssessment
    ? `SELBSTEINSCHÄTZUNG DES ÜBENDEN (direkt nach dem Gespräch, vor dieser Auswertung):
"${i.selfAssessment}"
PFLICHT: Fülle selfReview. Greife die Selbsteinschätzung inhaltlich auf ("Du meintest …")
und bestätige oder korrigiere sie — ausschließlich mit Beleg aus dem Gespräch.
Sei ehrlich: Eine zu strenge Selbstsicht verdient genauso eine Korrektur wie eine zu milde.
Die Selbsteinschätzung ist KEINE Evidenz für die Rubrik-Scores — bewertet wird nur das Gespräch.`
    : `Keine Selbsteinschätzung abgegeben → selfReview = null.`
}

${i.canon}
Gilt für summary, why, wentWell, tryNext, comment und nextStep: Entwicklungspunkte als Du-Botschaft
MOMENT → WIRKUNG → WIRKSAMERER WEG, Stärken verb-first mit Wirkung und Beleg.

${
  i.cardsBlock
    ? `KARTEN AUS DER COACHING-BIBLIOTHEK (intern — nie als Quelle nennen, nicht wörtlich zitieren)
${i.cardsBlock}
Nutze sie, um nextStep konkret und übbar zu machen (EIN Move, EINE Formulierung, an dieses
Gespräch angepasst). Trage in recommendedCards die wörtlichen Titel der 1–2 Karten ein, die zur
schwächsten Rubrik-Kompetenz passen; leer, wenn keine wirklich passt.`
    : `Kein Karten-Block vorhanden → recommendedCards = [].`
}
${block(
  i.transferReview,
  `
TRANSFER-RÜCKBLICK (aus dem echten Alltag seit dem letzten Debrief)
${i.transferReview}
Würdige das in summary in EINEM Satz: Zeigt sich dieser Vorsatz in DIESEM Gespräch? Bewerte nur das
Gespräch, nicht den Alltag.
`
)}
nextStep: der größte Hebel; nextStepKey = der key der Fähigkeit, zu der er gehört.
microTransfer: EIN Schritt für den Alltag, der aus dem größten Hebel folgt — imperativ, mit Anlass
und Zeitpunkt („Morgen im Team-Meeting sagst du zuerst: »…«"). Kein zweiter Schritt, keine Auswahl.

summary und nextStep: direkte Ansprache ("Du …"), konkret, auf DIESES Gespräch bezogen.
Alle Textausgaben (summary, why, wentWell, tryNext, comment, nextStep) auf ${i.outputLanguage} — Zitate in der EVIDENCE bleiben wörtlich in der Gesprächssprache.

GESPRÄCH
${i.transcript}

Gib ausschließlich JSON gemäß Schema zurück.`;
}

/** Deutsch formulierte Sprachnamen fuer die Ausgabesprache des Feedbacks. */
const FEEDBACK_LANGUAGE: Record<string, string> = {
  de: 'Deutsch',
  en: 'Englisch',
  es: 'Spanisch',
  fr: 'Französisch',
};

/** JSON-Fences entfernen und parsen (Opus-Antwort). */
export function parseJudgeJson(text: string): unknown {
  const t = text.trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const body = fenced ? fenced[1] : t;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return JSON.parse(start >= 0 && end > start ? body.slice(start, end + 1) : body);
}

/** Richter Gemini: Genkit-Schreibermodell mit erzwungenem Ausgabeschema (wie bisher). */
async function judgeGemini(promptText: string): Promise<SimulationFeedbackRaw> {
  const res = await ai.generate({
    // W1-5: Anrede-Regel (Du groß, nie Sie; Fremdsprachen höflich) für alles, was die App zur Person sagt.
    system: anredeBlock(),
    prompt: promptText,
    output: { schema: SimulationFeedbackOutputSchema },
  });
  if (!res.output) throw new Error('simulation feedback returned empty output');
  return res.output as SimulationFeedbackRaw;
}

/** Frist des Opus-Richters (er denkt länger als Flash); danach Rückfall auf Gemini. */
export const RICHTER_OPUS_TIMEOUT_MS = Math.max(30_000, Number(process.env.COACH_RICHTER_TIMEOUT_MS ?? 110_000) || 110_000);

/**
 * Richter Opus @eu: gleicher Prompt; die Antwort kommt als Werkzeugaufruf mit dem JSON-Schema der Auswertung
 * (gültiges JSON; ohne Aufruf wird der Text als JSON gelesen) und wird gegen das Zod-Schema geprüft.
 */
async function judgeOpus(promptText: string): Promise<SimulationFeedbackRaw> {
  const schema = zodToJsonSchema(SimulationFeedbackOutputSchema, { target: 'openApi3', $refStrategy: 'none' }) as Record<string, unknown>;
  const reply = await claudeStructured<unknown>({
    system:
      anredeBlock() +
      '\n\nDu lieferst die Auswertung ausschließlich über das Werkzeug „auswertung“ (ein Aufruf, alle Felder nach Schema). Kein Text davor oder danach. Innerhalb von Textfeldern nur typografische Anführungszeichen („…“ oder »…«), nie gerade Anführungszeichen.',
    user: promptText.replace('Gib ausschließlich JSON gemäß Schema zurück.', 'Fülle das Werkzeug „auswertung“ vollständig aus.'),
    schema,
    toolName: 'auswertung',
    maxTokens: 8192,
    signal: AbortSignal.timeout(RICHTER_OPUS_TIMEOUT_MS),
  });
  return SimulationFeedbackOutputSchema.parse(reply.data);
}

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
  /** Welle 2: Gesprächsende durch die Rolle (Grund + Art), optional. */
  gespraechsende?: string;
  /** Welle 2: Öffnungsverlauf der Regie (Zeilen), optional. */
  regieVerlauf?: string;
  /** Richter erzwingen (Vergleichsskript); Standard: Schalter COACH_RICHTER. */
  richter?: 'gemini' | 'opus';
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

  const input: SimulationFeedbackInput = {
    scenarioTitle: scenario.title,
    personaName: scenario.persona.name,
    goalsList: scenario.candidateBriefing.goals.map((g, i) => `${i + 1}. ${g}`).join('\n'),
    // B1/Welle 1: szenariospezifische Rubrik je Anker — Anweisung an den Bewerter; ohne rubric bleibt die 1–4-Skala.
    rubricList: scenario.assessment.competencies
      .map((c) => `- ${c.key}: ${c.label}${c.rubric ? `\n  BEWERTUNGS-RUBRIK:\n  ${c.rubric.replace(/\n/g, '\n  ')}` : ''}`)
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
    gespraechsende: (args.gespraechsende ?? '').slice(0, 400),
    regieVerlauf: (args.regieVerlauf ?? '').slice(0, 1200),
  };
  const promptText = buildFeedbackPrompt(input);

  // Welle 1: Richter wählen — Opus @eu nur, wenn konfiguriert; bei Fehler Rückfall auf Gemini.
  let output: SimulationFeedbackRaw | null = null;
  let judge = 'gemini';
  const wunsch = args.richter ?? coachRichter();
  if (wunsch === 'opus' && claudeVertexConfigured()) {
    try {
      output = await judgeOpus(promptText);
      judge = 'opus';
    } catch (e) {
      logger.apiError('simulation-feedback/opus', e, { scenarioId: scenario.id });
      output = null;
    }
  }
  if (!output) output = await judgeGemini(promptText);

  // Ergebnis gegen die Szenario-Definition normalisieren: fehlende Rubrik-Keys/
  // Checkpoints ergänzen (ehrlich als nicht beobachtbar/nicht getroffen),
  // erfundene ids verwerfen — die UI rendert damit immer ein vollständiges Bild.
  const rubricByKey = new Map(output.rubric.map((r) => [r.key, r]));
  const clip = (xs: string[] | undefined, n: number) => (xs ?? []).map((x) => String(x).trim()).filter(Boolean).slice(0, n);
  const rubric = scenario.assessment.competencies.map((c) => {
    const r = rubricByKey.get(c.key);
    if (!r) return { key: c.key, label: c.label, evidence: [], why: 'nicht beobachtbar', wentWell: [], tryNext: [], score: null };
    const score = typeof r.score === 'number' && r.score >= 1 && r.score <= 4 ? Math.round(r.score) : null;
    return {
      key: c.key,
      label: c.label,
      evidence: r.evidence.slice(0, 2),
      why: r.why,
      wentWell: score == null ? [] : clip(r.wentWell, 2),
      tryNext: score == null ? [] : clip(r.tryNext, 2),
      score,
    };
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
  const keys = new Set(scenario.assessment.competencies.map((c) => c.key));

  return {
    summary: output.summary,
    rubric,
    checkpoints,
    nextStep: output.nextStep,
    nextStepKey: keys.has(output.nextStepKey) ? output.nextStepKey : '',
    // focusReview nur, wenn wirklich ein Fokus vorgegeben war (kein LLM-Eigenleben).
    focusReview: args.focus ? (output.focusReview ?? null) : null,
    // selfReview nur bei tatsächlich abgegebener Selbsteinschätzung (A1).
    selfReview: args.selfAssessment ? (output.selfReview ?? null) : null,
    cards: cardRefs,
    microTransfer: {
      step: String(output.microTransfer?.step ?? '').trim().slice(0, 300),
      when: String(output.microTransfer?.when ?? '').trim().slice(0, 60),
    },
    judge,
  };
}
