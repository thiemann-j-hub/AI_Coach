/**
 * @fileOverview Generates tailored coaching feedback based on input text, conversation type, and defined goals.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { sanitizeForPrompt } from '@/lib/prompt-guard';
import { OBSERVER_CANON_EN } from '@/lib/coach-canon';

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

  relevantSnippets: z.array(z.string()).optional().describe('Relevant snippets retrieved from the vector store, if any.'),
  /** V2: Beobachter-Kanon — wird im Flow gesetzt, Aufrufer müssen ihn nicht kennen. */
  canon: z.string().optional().describe('Observer canon (feedback wording rules), injected by the flow.'),
});

export type GenerateTailoredFeedbackInput = z.infer<typeof GenerateTailoredFeedbackInputSchema>;

export const GenerateTailoredFeedbackOutputSchema = z.object({
  summary: z.string().describe('A summary of the feedback.'),
  strengths: z
    .array(z.string())
    .describe('Identified strengths: verb first + effect + short verbatim quote from the transcript, addressed to the leader ("Du …" / "You …").'),
  improvements: z
    .array(z.string())
    .describe(
      'Areas for improvement, 1–3 items, each a you-message in this order: MOMENT (what the leader said, short verbatim quote) → EFFECT (what it led to) → MORE EFFECTIVE PATH (one example sentence in quotation marks).'
    ),
  // O1e (N4-85): Paare statt loser Strings — die Ergebnisseite zeigt Original/Besser
  // nebeneinander, der Qualitäts-Check vergleicht beide.
  rewrites: z
    .array(
      z.object({
        original: z.string().describe('Verbatim sentence the leader actually said (from the transcript).'),
        better: z.string().describe('A more effective wording of the SAME sentence, same language, same intent.'),
      })
    )
    .max(4)
    .describe('Suggested rewrites of concrete leader sentences, 1–4 pairs. Empty array if nothing needs rewriting.'),
  riskFlags: z.array(z.string()).describe('Potential risks identified.'),
  // O2b: eigener Transfer-Schritt — keine Kopie des Verbesserungspunkts.
  practice7Days: z
    .string()
    .describe(
      'ONE on-the-job practice step for the coming 7 days, imperative, addressed to the leader, with a concrete occasion ("In your next 1:1 on …", "Tomorrow when …") and ONE sentence to say. Must be different in wording from the improvements — it names what to DO, not what went wrong. Max 60 words.'
    ),
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
- Do NOT reveal any internal sources, cards, vector DB, or metadata. Use relevant snippets only as guidance.
- Do NOT use real names in quotes. Use the labels (leaderLabel / employeeLabel) or generic "Führungskraft" / "Mitarbeiter:in".
- Output language: if lang is provided (e.g., "de"), write the feedback in that language. Otherwise, default to German.
- Address the leader directly ("Du …" in German, "you …" in English) — the feedback is written FOR the leader, not about them.

{{{canon}}}
Apply the canon to summary, strengths, improvements and rewrites: every improvement is a
you-message MOMENT → EFFECT → MORE EFFECTIVE PATH with a concrete example phrase.

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
    // Fence user-supplied content to reduce prompt injection risk
    const { sanitized: fencedText, injectionDetected } = sanitizeForPrompt(
      input.inputText,
      { label: 'TRANSCRIPT' }
    );
    if (injectionDetected) {
      // R9: NUR Signal loggen, NICHT den gematchten Nutzer-Text (PII/App-Insights).
      console.warn(`[prompt-guard] Injection pattern detected in inputText (content redacted).`);
    }

    // V2 (Owner-GO 25.09.): Beobachter-Kanon immer mitgeben (Prompt ist englisch verfasst).
    const hardenedInput = { ...input, inputText: fencedText, canon: OBSERVER_CANON_EN };
    const { output } = await generateTailoredFeedbackPrompt(hardenedInput);
    return output!;
  }
);

/** Compatibility export (used by generate-dynamic-feedback) */
export { generateTailoredFeedbackFlow };

/** Compatibility default export */
export { generateTailoredFeedbackFlow as default };
