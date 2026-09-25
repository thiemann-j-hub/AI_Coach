/**
 * @fileOverview Orchestrates vector retrieval (Cosmos) + tailored feedback generation.
 *
 * We do retrieval explicitly (instead of relying on tool calls) so we can:
 * - guarantee retrieval happens
 * - return rag_context_* fields back to the UI
 */

// Retrieval über Cosmos-Vektor (gemini-768).
import { searchCards } from '@/lib/cosmos-cards';
import { withTimeout, timeoutMs } from '@/lib/with-timeout';
import { z } from 'zod';
import * as tailoredMod from './generate-tailored-feedback';

/** Hartes Timeout fuer den Vektor-Retrieval (Default 6s). Bei Ueberschreitung
 *  degradiert retrieveCards sauber auf leeres RAG (try/catch), statt zu haengen. */
const RAG_TIMEOUT_MS = timeoutMs('RAG_TIMEOUT_MS', 6_000);

export const GenerateDynamicFeedbackInputSchema = z.object({
  conversationType: z.string(),
  conversationSubType: z.string().optional(),
  goal: z.string().optional(),
  transcriptText: z.string(),
  lang: z.string().optional(),
  jurisdiction: z.string().optional(),

  // NEW: speaker labels (who is leader / employee in transcript)
  leaderLabel: z.string().optional(),
  employeeLabel: z.string().optional(),
});
export type GenerateDynamicFeedbackInput = z.infer<typeof GenerateDynamicFeedbackInputSchema>;

type RagCard = { id: string; score: number; metadata: Record<string, any> };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function truncate(s: string, maxChars: number): string {
  const t = String(s ?? '');
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars) + '…';
}

function buildRetrievalQuery(input: GenerateDynamicFeedbackInput): string {
  const parts: string[] = [];
  parts.push(`conversationType: ${input.conversationType}`);
  if (isNonEmptyString(input.conversationSubType))
    parts.push(`conversationSubType: ${input.conversationSubType}`);
  if (isNonEmptyString(input.goal)) parts.push(`goal: ${input.goal}`);
  parts.push(input.transcriptText);
  return truncate(parts.join('\n'), 4000);
}

/**
 * V1 (Owner-GO 25.09., Befund N4-76): Der Kundenweg sendet fest
 * conversationType 'feedback' + jurisdiction 'de_eu'. Als EXAKTER Filter
 * matchte das 10 von 209 deutschen Karten und 0 englische — 14 echte Läufe
 * bekamen insgesamt 9 verschiedene Karten. Die Karten tragen ueberwiegend
 * jurisdiction 'global' und fuenf Gespraechstypen (leadership_1on1, conflict,
 * feedback, annual_review, job_interview), die der Transkript-Weg nicht kennt.
 * Deshalb: jurisdiction als $in [eigene, 'global']; der Gespraechstyp bleibt
 * Teil der Suchanfrage (buildRetrievalQuery), aber KEIN harter Filter mehr —
 * die Vektorsuche entscheidet.
 */
export function buildBaseFilter(input: Pick<GenerateDynamicFeedbackInput, 'jurisdiction'>): Record<string, any> {
  const f: Record<string, any> = {};
  if (isNonEmptyString(input.jurisdiction)) {
    const j = input.jurisdiction.trim();
    f.jurisdiction = j === 'global' ? 'global' : { $in: [j, 'global'] };
  }
  return f;
}

function cardsToSnippets(cards: RagCard[]): string[] {
  return (cards ?? []).slice(0, 8).map((c) => {
    const id = String((c as any)?.id ?? '');
    const score = Number.isFinite((c as any)?.score) ? Number((c as any).score) : 0;
    const chunk = String((c as any)?.metadata?.chunk_text ?? '');
    const header = `[#${id} score=${score.toFixed(3)}]`;
    return truncate(`${header}\n${chunk}`, 1800);
  });
}

async function retrieveCards(
  input: GenerateDynamicFeedbackInput
): Promise<{ cards: RagCard[]; error: string | null }> {
  try {
    const query = buildRetrievalQuery(input);
    const baseFilter = buildBaseFilter(input);
    const filter = Object.keys(baseFilter).length ? baseFilter : undefined;

    const first = await withTimeout(
      searchCards({ text: query, topK: 8, lang: input.lang, filter }),
      RAG_TIMEOUT_MS,
      'rag-search'
    );

    // If lang is set but we got nothing: try again without lang
    const effective =
      isNonEmptyString(input.lang) && first.count === 0
        ? await withTimeout(
            searchCards({ text: query, topK: 8, filter }),
            RAG_TIMEOUT_MS,
            'rag-search-fallback'
          )
        : first;

    const cards = (effective.results ?? []) as RagCard[];
    return { cards: cards.slice(0, 8), error: null };
  } catch (e: any) {
    return { cards: [], error: e?.message ?? String(e) };
  }
}

export async function generateDynamicFeedback(input: GenerateDynamicFeedbackInput): Promise<any> {
  const conversationType = String(input.conversationType ?? '').trim();
  const transcriptText = String(input.transcriptText ?? '').trim();

  if (!conversationType) throw new Error('Missing conversationType');
  if (!transcriptText) throw new Error('Missing transcriptText');

  const rag = await retrieveCards(input);
  const relevantSnippets = cardsToSnippets(rag.cards);

  const result = await tailoredMod.generateTailoredFeedback({
    inputText: transcriptText,
    conversationType,
    conversationSubType: input.conversationSubType,
    goal: isNonEmptyString(input.goal) ? input.goal : 'Provide clear, constructive coaching feedback.',
    lang: input.lang,
    jurisdiction: input.jurisdiction,
    leaderLabel: input.leaderLabel,
    employeeLabel: input.employeeLabel,
    relevantSnippets: relevantSnippets.length ? relevantSnippets : undefined,
  });

  return {
    ...result,
    rag_context_cards: rag.cards,
    rag_context_count: rag.cards.length,
    rag_error: rag.error,
  };
}
