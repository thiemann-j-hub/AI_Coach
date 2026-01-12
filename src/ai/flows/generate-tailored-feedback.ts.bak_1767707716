'use server';

/**
 * @fileOverview Generates tailored coaching feedback based on input text, conversation type, and defined goals.
 *
 * - generateTailoredFeedback - A function that generates tailored coaching feedback.
 * - GenerateTailoredFeedbackInput - The input type for the generateTailoredFeedback function.
 * - GenerateTailoredFeedbackOutput - The return type for the generateTailoredFeedback function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GenerateTailoredFeedbackInputSchema = z.object({
  inputText: z.string().describe('The input text to analyze.'),
  conversationType: z
    .string()
    .describe('The type of conversation (e.g., interview, presentation).'),
  goal: z.string().describe('The defined goal for the conversation.'),
  relevantSnippets: z
    .array(z.string())
    .optional()
    .describe('Relevant snippets retrieved from Pinecone, if any.'),
});
export type GenerateTailoredFeedbackInput = z.infer<
  typeof GenerateTailoredFeedbackInputSchema
>;

const GenerateTailoredFeedbackOutputSchema = z.object({
  summary: z.string().describe('A summary of the feedback.'),
  strengths: z.array(z.string()).describe('Identified strengths.'),
  improvements: z.array(z.string()).describe('Areas for improvement.'),
  rewrites: z.array(z.string()).describe('Suggested rewrites.'),
  riskFlags: z.array(z.string()).describe('Potential risks identified.'),
  scores: z.record(z.number()).describe('Scores for different aspects.'),
});
export type GenerateTailoredFeedbackOutput = z.infer<
  typeof GenerateTailoredFeedbackOutputSchema
>;

export async function generateTailoredFeedback(
  input: GenerateTailoredFeedbackInput
): Promise<GenerateTailoredFeedbackOutput> {
  return generateTailoredFeedbackFlow(input);
}

const generateTailoredFeedbackPrompt = ai.definePrompt({
  name: 'generateTailoredFeedbackPrompt',
  input: {schema: GenerateTailoredFeedbackInputSchema},
  output: {schema: GenerateTailoredFeedbackOutputSchema},
  prompt: `You are an AI-powered communication coach. Analyze the provided input text, considering the conversation type and defined goal, to generate tailored feedback.

Input Text: {{{inputText}}}
Conversation Type: {{{conversationType}}}
Goal: {{{goal}}}

{{#if relevantSnippets}}
Relevant Snippets from Vector DB:
{{#each relevantSnippets}}
- {{{this}}}
{{/each}}
{{/if}}

Provide feedback in the following structure:

Summary: [A brief summary of the overall feedback]
Strengths: [A list of identified strengths]
Improvements: [A list of areas for improvement]
Rewrites: [Suggested rewrites for specific phrases or sentences]
Risk Flags: [A list of potential risks identified]
Scores: [Scores for different aspects of the conversation, such as clarity, engagement, etc.]`,
});

const generateTailoredFeedbackFlow = ai.defineFlow(
  {
    name: 'generateTailoredFeedbackFlow',
    inputSchema: GenerateTailoredFeedbackInputSchema,
    outputSchema: GenerateTailoredFeedbackOutputSchema,
  },
  async input => {
    const {output} = await generateTailoredFeedbackPrompt(input);
    return output!;
  }
);
