import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { claudeStructured, claudeVertexConfigured } from '@/lib/server/claude-vertex';
import { sanitizeForPrompt } from '@/lib/prompt-guard';
import { anredeBlock } from '@/lib/anrede';
import type { InterviewDefinition, InterviewLocale } from '@/lib/interview/pilot';
import { logger } from '@/lib/logger';

/**
 * Welle 6: Themenbericht aus abgeschlossenen Interviews eines Kurses — erst ab der Mindestgruppe, ohne Namen,
 * mit wörtlichen, anonymen Zitaten. Opus @eu als Zusammenfasser (wie der Richter), Rückfall Gemini.
 */
export const BerichtSchema = z.object({
  kurzfassung: z.string().max(600),
  themen: z
    .array(
      z.object({
        titel: z.string().max(80),
        beschreibung: z.string().max(400),
        /** Wie viele der Interviews das Thema tragen. */
        anzahl: z.number().int().min(1),
        zitate: z.array(z.string().max(240)).max(3),
      })
    )
    .max(6),
  staerken: z.array(z.string().max(200)).max(5),
  verbesserungen: z.array(z.string().max(200)).max(5),
  /** Was Lernende konkret vorhaben (Frage 3) — verdichtet. */
  vorhaben: z.array(z.string().max(200)).max(5),
});
export type InterviewBericht = z.infer<typeof BerichtSchema>;

export interface BerichtArgs {
  def: InterviewDefinition;
  locale: InterviewLocale;
  kursTitel: string;
  /** Je Interview die Antworten in Reihenfolge (nur Texte der Person, ohne Namen). */
  interviews: Array<Array<{ frageNr: number; text: string }>>;
}

export function buildBerichtPrompt(a: BerichtArgs): string {
  const sprache = a.locale === 'en' ? 'English' : 'Deutsch';
  const block = a.interviews
    .map((iv, i) =>
      [`INTERVIEW ${i + 1}`, ...iv.map((x) => `F${x.frageNr}: ${sanitizeForPrompt(x.text.slice(0, 1500), { label: 'ANTWORT' }).sanitized}`)].join('\n')
    )
    .join('\n\n');
  const fragen = a.def.fragen.map((f) => `F${f.nr}: ${f.text[a.locale]}`).join('\n');
  return `Du fasst ${a.interviews.length} kurze Feedback-Interviews zum E-Learning-Kurs „${sanitizeForPrompt(a.kursTitel.slice(0, 160), { label: 'KURS' }).sanitized}“ für den Kursautor zusammen.
ZIEL: ${a.def.ziel[a.locale]}

FRAGEN:
${fragen}

REGELN: Sprache ${sprache}. Keine Namen, keine Rückschlüsse auf Einzelpersonen, keine Zahlen erfinden. Themen nur, wenn sie in mindestens zwei Interviews vorkommen (anzahl ehrlich zählen). Zitate wörtlich aus den Antworten, höchstens drei je Thema, ohne Namen; Zitate dürfen gekürzt, aber nicht umformuliert werden. Stärken und Verbesserungen als konkrete Sätze für den Kursautor. Vorhaben: was Lernende laut F3 konkret tun wollen, verdichtet.

${block}`;
}

export async function erstelleBericht(a: BerichtArgs): Promise<InterviewBericht> {
  const prompt = buildBerichtPrompt(a);
  if (claudeVertexConfigured()) {
    try {
      const r = await claudeStructured<unknown>({
        system: 'Du bist eine sorgfältige Auswerterin qualitativer Interviews. Du antwortest ausschließlich über das Werkzeug.',
        user: prompt,
        schema: zodToJsonSchema(BerichtSchema, { target: 'jsonSchema7', $refStrategy: 'none' }) as Record<string, unknown>,
        toolName: 'bericht',
        maxTokens: 6000,
      });
      return BerichtSchema.parse(r.data);
    } catch (e) {
      logger.apiError('interview-bericht/opus', e);
    }
  }
  const response = await ai.generate({ system: anredeBlock(), prompt, output: { schema: BerichtSchema }, config: { maxOutputTokens: 4000, temperature: 0.2 } });
  if (!response.output) throw new Error('Bericht ohne Ausgabe');
  return BerichtSchema.parse(response.output);
}
