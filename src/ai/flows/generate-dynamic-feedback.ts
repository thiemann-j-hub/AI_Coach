/**
 * @fileOverview Orchestrates Pinecone retrieval + tailored feedback generation.
 *
 * We do retrieval explicitly (instead of relying on tool calls) so we can:
 * - guarantee retrieval happens
 * - return rag_context_* fields back to the UI
 */

import { pineconeSearchCards } from '@/lib/pinecone';
import { z } from 'zod';
import * as tailoredMod from './generate-tailored-feedback';

export const GenerateDynamicFeedbackInputSchema = z.object({
  conversationType: z.string(),
  conversationSubType: z.string().optional(),
  goal: z.string().optional(),
  transcriptText: z.string(),
  lang: z.string().optional(),
  jurisdiction: z.string().optional(),
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

function buildBaseFilter(input: GenerateDynamicFeedbackInput): Record<string, any> {
  const f: Record<string, any> = {};
  if (isNonEmptyString(input.conversationType)) f.conversation_type = input.conversationType;
  if (isNonEmptyString(input.jurisdiction)) f.jurisdiction = input.jurisdiction;
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

    const first = await pineconeSearchCards({
      text: query,
      topK: 8,
      lang: input.lang,
      filter,
    });

    // If lang is set but we got nothing: try again without lang
    const effective =
      isNonEmptyString(input.lang) && first.count === 0
        ? await pineconeSearchCards({ text: query, topK: 8, filter })
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
    goal: isNonEmptyString(input.goal) ? input.goal : 'Provide clear, constructive coaching feedback.',
    relevantSnippets: relevantSnippets.length ? relevantSnippets : undefined,
  });

  return {
    ...result,
    rag_context_cards: rag.cards,
    rag_context_count: rag.cards.length,
    rag_error: rag.error,
  };
}
