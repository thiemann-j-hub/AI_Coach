'use server';
/**
 * @fileOverview A Genkit flow that combines Pinecone RAG with a generation flow.
 *
 * - generateDynamicFeedback - A function that orchestrates retrieval and generation.
 * - GenerateDynamicFeedbackInput - The input type for the generateDynamicFeedback function.
 */

import { ai } from '@/ai/genkit';
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

// Helper functions
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
  if (isNonEmptyString(input.conversationSubType)) parts.push(`conversationSubType: ${input.conversationSubType}`);
  if (isNonEmptyString(input.goal)) parts.push(`goal: ${input.goal}`);
  parts.push(input.transcriptText);
  return truncate(parts.join('\n'), 4000);
}

// Define the Pinecone search as a Genkit tool
const searchCoachingCardsTool = ai.defineTool(
  {
    name: 'searchCoachingCards',
    description: 'Search for relevant coaching cards from the knowledge base (Pinecone).',
    inputSchema: z.object({
      query: z.string().describe('The search query string.'),
      lang: z.string().optional().describe('The language for the search (e.g., "de").'),
      jurisdiction: z.string().optional().describe('The jurisdiction for the search (e.g., "de_eu").'),
      conversationType: z.string().describe('The type of conversation (e.g., "feedback").'),
    }),
    outputSchema: z.array(z.string()).describe('An array of relevant snippets from the coaching cards.'),
  },
  async (input) => {
    try {
      const baseFilter: Record<string, any> = { conversation_type: input.conversationType };
      if (isNonEmptyString(input.jurisdiction)) baseFilter.jurisdiction = input.jurisdiction;

      const first = await pineconeSearchCards({
        text: input.query,
        topK: 8,
        lang: input.lang,
        filter: baseFilter,
      });

      // Fallback: if lang is set and 0 results, try again without lang
      const effective =
        isNonEmptyString(input.lang) && first.count === 0
          ? await pineconeSearchCards({ text: input.query, topK: 8, filter: baseFilter })
          : first;

      const cards = (effective.results ?? []) as Array<{ id: string; score: number; metadata: Record<string, any> }>;
      
      return cards.slice(0, 8).map((c) => {
        const id = String(c.id ?? '');
        const score = Number.isFinite(c.score) ? c.score : 0;
        const chunk = String(c.metadata?.chunk_text ?? '');
        const header = `[#${id} score=${score.toFixed(3)}]`;
        return truncate(`${header}\n${chunk}`, 1800);
      });
    } catch (e: any) {
      console.error('Pinecone tool error:', e);
      // Return empty array on error to not break the flow
      return [];
    }
  }
);

// Define a new prompt that uses the tool
const dynamicFeedbackPrompt = ai.definePrompt({
  name: 'dynamicFeedbackPrompt',
  input: { schema: tailoredMod.GenerateTailoredFeedbackInputSchema },
  output: { schema: tailoredMod.GenerateTailoredFeedbackOutputSchema },
  tools: [searchCoachingCardsTool],
  prompt: `You are an AI-powered communication coach. Analyze the provided input text, considering the conversation type and defined goal, to generate tailored feedback.
  
  IMPORTANT: Before answering, you MUST use the 'searchCoachingCards' tool to find relevant snippets from the knowledge base. Use the conversation details to form a good query for the tool.
  
  Use the retrieved snippets to inform your feedback, summary, and suggestions.
  
  Input Text: {{{inputText}}}
  Conversation Type: {{{conversationType}}}
  Goal: {{{goal}}}
  `,
});

// Main flow that calls the prompt with tools
const generateDynamicFeedbackFlow = ai.defineFlow(
  {
    name: 'generateDynamicFeedbackFlow',
    inputSchema: GenerateDynamicFeedbackInputSchema,
    outputSchema: tailoredMod.GenerateTailoredFeedbackOutputSchema,
  },
  async (input) => {
    const { output } = await dynamicFeedbackPrompt({
      inputText: input.transcriptText,
      conversationType: input.conversationType,
      goal: input.goal || 'Provide clear, constructive coaching feedback.',
      // The tool will be called automatically by the LLM based on the prompt instructions.
      // We pass the required inputs for the tool here.
      query: buildRetrievalQuery(input),
      lang: input.lang,
      jurisdiction: input.jurisdiction,
    });
    return output!;
  }
);


// The exported function that the API route will call
export async function generateDynamicFeedback(input: GenerateDynamicFeedbackInput): Promise<any> {
  const conversationType = String(input.conversationType ?? '').trim();
  const transcriptText = String(input.transcriptText ?? '').trim();

  if (!conversationType) throw new Error('Missing conversationType');
  if (!transcriptText) throw new Error('Missing transcriptText');

  // The new flow handles everything now.
  const result = await generateDynamicFeedbackFlow(input);

  // We add the `rag_` fields for compatibility with the frontend.
  // In this new setup, there's no direct access to the raw RAG results here,
  // as the tool call is managed by Genkit. We will return empty/default values.
  return {
    ...result,
    rag_context_cards: [],
    rag_context_count: 0, 
    rag_error: null,
  };
}
