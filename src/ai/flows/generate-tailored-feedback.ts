/**
 * @fileOverview Generates tailored coaching feedback based on input text, conversation type, and defined goals.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

export const GenerateTailoredFeedbackInputSchema = z.object({
  inputText: z.string().describe('The input text to analyze.'),
  conversationType: z.string().describe('The type of conversation (e.g., feedback, interview).'),
  conversationSubType: z.string().optional().describe('Optional subtype (e.g., kritisch).'),
  goal: z.string().describe('The defined goal for the conversation.'),

  // NEW: language / context
  lang: z.string().optional().describe('Output language (e.g., de, en).'),
  jurisdiction: z.string().optional().describe('Jurisdiction context (e.g., de_eu).'),

  // NEW: who is who in transcript
  leaderLabel: z.string().optional().describe('Speaker label for the leader (e.g., FK).'),
  employeeLabel: z.string().optional().describe('Speaker label for the employee (e.g., MA).'),

  relevantSnippets: z.array(z.string()).optional().describe('Relevant snippets retrieved from Pinecone, if any.'),
});

export type GenerateTailoredFeedbackInput = z.infer<typeof GenerateTailoredFeedbackInputSchema>;

export const GenerateTailoredFeedbackOutputSchema = z.object({
  summary: z.string().describe('A summary of the feedback.'),
  strengths: z.array(z.string()).describe('Identified strengths.'),
  improvements: z.array(z.string()).describe('Areas for improvement.'),
  rewrites: z.array(z.string()).describe('Suggested rewrites.'),
  riskFlags: z.array(z.string()).describe('Potential risks identified.'),
  scores: z
    .object({ overall: z.number().min(0).max(10).optional() })
    .catchall(z.number())
    .describe('Scores for different aspects.'),
});

export type GenerateTailoredFeedbackOutput = z.infer<typeof GenerateTailoredFeedbackOutputSchema>;

export async function generateTailoredFeedback(
  input: GenerateTailoredFeedbackInput
): Promise<GenerateTailoredFeedbackOutput> {
  return generateTailoredFeedbackFlow(input);
}

const generateTailoredFeedbackPrompt = ai.definePrompt({
  name: 'generateTailoredFeedbackPrompt',
  input: { schema: GenerateTailoredFeedbackInputSchema },
  output: { schema: GenerateTailoredFeedbackOutputSchema },
  prompt: `You are an AI-powered communication coach for leadership conversations.

IMPORTANT RULES:
- Focus your evaluation primarily on the LEADER (manager).
- The transcript uses speaker labels. If leaderLabel/employeeLabel are provided, use them to interpret who is who.
- Do NOT reveal any internal sources, cards, vector DB, Pinecone, or metadata. Use relevant snippets only as guidance.
- Do NOT use real names in quotes. Use the labels (leaderLabel / employeeLabel) or generic "Führungskraft" / "Mitarbeiter:in".
- Output language: if lang is provided (e.g., "de"), write the feedback in that language. Otherwise, default to German.

Transcript:
{{{inputText}}}

Conversation Type: {{{conversationType}}}
{{#if conversationSubType}}Conversation Subtype: {{{conversationSubType}}}{{/if}}
Goal: {{{goal}}}
{{#if lang}}Language: {{{lang}}}{{/if}}
{{#if jurisdiction}}Jurisdiction: {{{jurisdiction}}}{{/if}}
{{#if leaderLabel}}Leader Label: {{{leaderLabel}}}{{/if}}
{{#if employeeLabel}}Employee Label: {{{employeeLabel}}}{{/if}}

{{#if relevantSnippets}}
Internal Coaching Guidance (do not mention explicitly):
{{#each relevantSnippets}}
- {{{this}}}
{{/each}}
{{/if}}

Return ONLY the JSON fields required by the output schema.`,
});

const generateTailoredFeedbackFlow = ai.defineFlow(
  {
    name: 'generateTailoredFeedbackFlow',
    inputSchema: GenerateTailoredFeedbackInputSchema,
    outputSchema: GenerateTailoredFeedbackOutputSchema,
  },
  async (input) => {
    const { output } = await generateTailoredFeedbackPrompt(input);
    return output!;
  }
);

/** Compatibility export (used by generate-dynamic-feedback) */
export { generateTailoredFeedbackFlow };

/** Compatibility default export */
export { generateTailoredFeedbackFlow as default };
