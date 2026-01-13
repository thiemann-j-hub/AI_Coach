
/**
 * @fileOverview This file defines a Genkit flow for analyzing conversation transcripts and providing coaching feedback.
 *
 * analyzeConversationTranscript - Analyzes a conversation transcript and provides structured coaching feedback.
 * AnalyzeConversationTranscriptInput - The input type for the analyzeConversationTranscript function.
 * AnalyzeConversationTranscriptOutput - The return type for the analyzeConversationTranscript function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const AnalyzeConversationTranscriptInputSchema = z.object({
  transcript: z.string().describe('The conversation transcript to analyze.'),
  conversationType: z.string().describe('The type of conversation (e.g., sales call, customer service).'),
  goal: z.string().describe('The desired outcome of the conversation.'),
});
export type AnalyzeConversationTranscriptInput = z.infer<
  typeof AnalyzeConversationTranscriptInputSchema
>;

const AnalyzeConversationTranscriptOutputSchema = z.object({
  summary: z.string().describe('A summary of the conversation.'),
  strengths: z.array(z.string()).describe('A list of strengths demonstrated in the conversation.'),
  improvements: z
    .array(z.string())
    .describe('A list of areas for improvement in the conversation.'),
  rewrites:
    z.array(z.object({original: z.string(), rewritten: z.string()})).describe('Suggested rewrites for specific parts of the conversation.'),
  riskFlags: z
    .array(z.string())
    .describe('A list of potential risks or issues identified in the conversation.'),
  scores: z.object({
    overall: z.number().describe('An overall score for the conversation.'),
    communication: z.number().describe('A score for communication effectiveness.'),
    goalAchievement: z.number().describe('A score for how well the goal was achieved.'),
  }),
});
export type AnalyzeConversationTranscriptOutput = z.infer<
  typeof AnalyzeConversationTranscriptOutputSchema
>;

export async function analyzeConversationTranscript(
  input: AnalyzeConversationTranscriptInput
): Promise<AnalyzeConversationTranscriptOutput> {
  return analyzeConversationTranscriptFlow(input);
}

const analyzeConversationTranscriptPrompt = ai.definePrompt({
  name: 'analyzeConversationTranscriptPrompt',
  input: {schema: AnalyzeConversationTranscriptInputSchema},
  output: {schema: AnalyzeConversationTranscriptOutputSchema},
  prompt: `You are a conversation analysis expert providing coaching feedback.

  Analyze the following conversation transcript, identifying strengths, areas for improvement, and potential risks.
  Provide specific rewrites for parts of the conversation that could be improved.

  Conversation Type: {{{conversationType}}}
  Goal: {{{goal}}}
  Transcript: {{{transcript}}}
  
  Format your output as a JSON object with the following keys:
  - summary: A brief summary of the conversation.
  - strengths: A list of strengths demonstrated in the conversation.
  - improvements: A list of areas for improvement.
  - rewrites: A list of suggested rewrites for specific parts of the conversation. Each item should include the original text and the rewritten text.
  - riskFlags: A list of potential risks or issues identified in the conversation.
  - scores: An object containing the following scores:
    - overall: An overall score for the conversation.
    - communication: A score for communication effectiveness.
    - goalAchievement: A score for how well the goal was achieved.`,
});

const analyzeConversationTranscriptFlow = ai.defineFlow(
  {
    name: 'analyzeConversationTranscriptFlow',
    inputSchema: AnalyzeConversationTranscriptInputSchema,
    outputSchema: AnalyzeConversationTranscriptOutputSchema,
  },
  async input => {
    const {output} = await analyzeConversationTranscriptPrompt(input);
    return output!;
  }
);
