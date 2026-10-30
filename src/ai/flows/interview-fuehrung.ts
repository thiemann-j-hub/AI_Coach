import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { sanitizeForPrompt } from '@/lib/prompt-guard';
import { anredeBlock } from '@/lib/anrede';
import { frageText, type InterviewDefinition, type InterviewLocale, type InterviewTurn, ueberleitung } from '@/lib/interview/pilot';

/**
 * Welle 6: Interviewer-Agent — entscheidet nach jeder Antwort, ob EINE Nachfrage lohnt (Nachfragetiefe leicht),
 * sonst stellt er die nächste Frage. Kleiner Flash-Aufruf ohne Denken; fällt er aus, kommt die nächste Frage
 * deterministisch. Der Interviewer wertet nie, tröstet nie, verkauft nie — er fragt.
 */
const SchrittSchema = z.object({
  /** true = Nachfrage zur aktuellen Frage; false = weiter zur nächsten Frage. */
  nachfrage: z.boolean(),
  /** Bei Nachfrage: die Nachfrage (ein Satz). Sonst leer. */
  text: z.string().max(400),
});
export type InterviewSchritt = z.infer<typeof SchrittSchema>;

export interface FuehrungArgs {
  def: InterviewDefinition;
  locale: InterviewLocale;
  kursTitel: string;
  frageNr: number;
  nachfragenBisher: number;
  turns: InterviewTurn[];
}

/** PURE (getestet): Prompt für die Nachfrage-Entscheidung. */
export function buildFuehrungPrompt(a: FuehrungArgs): string {
  const frage = frageText(a.def, a.frageNr, a.locale);
  const verlauf = a.turns
    .filter((t) => t.frageNr === a.frageNr)
    .map((t) => `${t.role === 'interviewer' ? 'INTERVIEWER' : 'PERSON'}: ${sanitizeForPrompt(t.text.slice(0, 1500), { label: 'ANTWORT' }).sanitized}`)
    .join('\n');
  const sprache = a.locale === 'en' ? 'English' : 'Deutsch';
  return `Du führst ein kurzes Feedback-Interview nach einem E-Learning-Kurs („${sanitizeForPrompt(a.kursTitel.slice(0, 160), { label: 'KURS' }).sanitized}“).
ZIEL DES INTERVIEWS: ${a.def.ziel[a.locale]}

AKTUELLE FRAGE ${a.frageNr}: ${frage}
VERLAUF ZU DIESER FRAGE:
${verlauf || '(noch nichts)'}

Entscheide, ob EINE Nachfrage lohnt. Eine Nachfrage lohnt nur, wenn die Antwort vage, sehr kurz oder allgemein ist UND eine konkrete Nachfrage einen brauchbaren Beleg bringen würde (Beispiel, Situation, Zahl). Lohnt sie nicht, oder hat die Person klar geantwortet, dann nachfrage=false.
Regeln für die Nachfrage: ein Satz, offen, konkret, ohne Wertung, ohne Lob, ohne Vorschläge; Sprache ${sprache}; Du-Form${a.locale === 'en' ? ' (English: natural second person)' : ' mit großem Du'}. Nie etwas aus der Antwort wiederholen, was wie Bewertung klingt.
Antworte NUR als JSON {"nachfrage": boolean, "text": string}.`;
}

/**
 * Nächster Beitrag des Interviewers nach einer Antwort. Liefert {text, nachfrage, naechsteNr}:
 * naechsteNr = Frage, zu der der Beitrag gehört. Bei der letzten Frage ohne Nachfrage: null (= fertig).
 */
export async function naechsterSchritt(a: FuehrungArgs): Promise<{ text: string; nachfrage: boolean; frageNr: number } | null> {
  const aktuelle = a.def.fragen.find((f) => f.nr === a.frageNr);
  const darfNachfragen = Boolean(aktuelle) && a.nachfragenBisher < (aktuelle?.nachfrageMax ?? 0);
  if (darfNachfragen) {
    try {
      const response = await ai.generate({
        system: anredeBlock(),
        prompt: buildFuehrungPrompt(a),
        output: { schema: SchrittSchema },
        config: { maxOutputTokens: 200, thinkingConfig: { thinkingBudget: 0 }, temperature: 0.2 },
      });
      const out = response.output;
      if (out?.nachfrage && out.text.trim().length > 5) {
        return { text: out.text.trim(), nachfrage: true, frageNr: a.frageNr };
      }
    } catch {
      /* Rückfall: nächste Frage ohne Nachfrage */
    }
  }
  const naechste = a.frageNr + 1;
  if (naechste > a.def.fragen.length) return null;
  return { text: ueberleitung(a.def, naechste, a.locale), nachfrage: false, frageNr: naechste };
}
