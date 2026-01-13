
/**
 * @fileOverview A Genkit flow for contextual enrichment using RAG with Pinecone.
 *
 * - contextualEnrichment - A function that enriches the context of a conversation transcript using RAG.
 * - ContextualEnrichmentInput - The input type for the contextualEnrichment function.
 * - ContextualEnrichmentOutput - The return type for the contextualEnrichment function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const ContextualEnrichmentInputSchema = z.object({
  transcript: z.string().describe('The conversation transcript to analyze.'),
  conversationType: z.string().describe('The type of conversation (e.g., sales call, customer support).'),
  goal: z.string().describe('The goal of the conversation.'),
});
export type ContextualEnrichmentInput = z.infer<typeof ContextualEnrichmentInputSchema>;

const ContextualEnrichmentOutputSchema = z.object({
  enrichedContext: z.string().describe('The enriched context for the conversation transcript.'),
});
export type ContextualEnrichmentOutput = z.infer<typeof ContextualEnrichmentOutputSchema>;

export async function contextualEnrichment(input: ContextualEnrichmentInput): Promise<ContextualEnrichmentOutput> {
  return contextualEnrichmentFlow(input);
}

const prompt = ai.definePrompt({
  name: 'contextualEnrichmentPrompt',
  input: {schema: ContextualEnrichmentInputSchema},
  output: {schema: ContextualEnrichmentOutputSchema},
  prompt: `Given the following conversation transcript, conversation type, and goal, enrich the context using relevant snippets retrieved from a vector database.

Conversation Transcript: {{{transcript}}}
Conversation Type: {{{conversationType}}}
Goal: {{{goal}}}

Enriched Context:`, // The actual RAG implementation with Pinecone would occur here, before calling the LLM.
});

const contextualEnrichmentFlow = ai.defineFlow(
  {
    name: 'contextualEnrichmentFlow',
    inputSchema: ContextualEnrichmentInputSchema,
    outputSchema: ContextualEnrichmentOutputSchema,
  },
  async input => {
    // In a real implementation, RAG with Pinecone would be performed here.
    // For this example, we'll simply return the input transcript as the enriched context.
    const {output} = await prompt(input);
    return output!;
  }
);
