/**
 * Welle 6 (Owner-GO 30.10.2026, N4-240): Interview-Pilot „Kursfeedback“.
 *
 * Ein Interviewer-Agent stellt nach dem Abschluss eines Studio-Kurses fünf feste Fragen und entscheidet nach
 * jeder Antwort, ob EINE Nachfrage lohnt (Nachfragetiefe leicht). Antworten landen als Interview-Doc im
 * Workspace; der Themenbericht für Admins entsteht erst ab fünf abgeschlossenen Interviews je Kurs (Mindestgruppe
 * wie beim Team-Bild) und nennt keine Personen. Pilot nur im Owner-Workspace, bis das Produkt entschieden ist.
 *
 *   COACH_INTERVIEW = off | all | <workspaceId,workspaceId,…>   (Standard: nur der Owner-Workspace)
 *
 * Rein (kein I/O), damit Prompt und Ablauf testbar bleiben.
 */

export const INTERVIEW_MIN_ANTWORTEN = 5;
/** Zentraler Workspace des Owners (PulseNorth.AI) — Standard-Pilotraum. */
export const OWNER_WORKSPACE_ID = "00000000-0000-0000-b89a-e62ba1ab6978";
export const INTERVIEW_MAX_ANTWORT_ZEICHEN = 1500;

export type InterviewLocale = "de" | "en";

export interface InterviewFrage {
  nr: number;
  text: { de: string; en: string };
  /** Wie viele Nachfragen der Interviewer zu dieser Frage höchstens stellt (leicht = 1). */
  nachfrageMax: number;
}

export interface InterviewDefinition {
  id: string;
  titel: { de: string; en: string };
  /** Studienziel in Prosa — steuert den Interviewer (was will der Kursautor wissen). */
  ziel: { de: string; en: string };
  fragen: InterviewFrage[];
}

export const KURSFEEDBACK: InterviewDefinition = {
  id: "kursfeedback",
  titel: { de: "Kurz-Interview zum Kurs", en: "Short interview about the course" },
  ziel: {
    de: "Herausfinden, was der Kurs im Arbeitsalltag der Person bewirkt hat, wo er sie verloren hat und was fehlt, damit der Kursautor den Kurs gezielt verbessern kann. Ehrliche, konkrete Antworten sind wertvoller als freundliche.",
    en: "Find out what the course changed in the person's day-to-day work, where it lost them and what is missing, so the course author can improve it in a targeted way. Honest, concrete answers are worth more than polite ones.",
  },
  fragen: [
    { nr: 1, text: { de: "Was aus dem Kurs hat Dir am meisten gebracht, und warum gerade das?", en: "What from the course helped you most, and why that in particular?" }, nachfrageMax: 1 },
    { nr: 2, text: { de: "Gab es eine Stelle, an der Du ausgestiegen bist, Dich gelangweilt hast oder etwas nicht verstanden hast?", en: "Was there a point where you dropped out, got bored or did not understand something?" }, nachfrageMax: 1 },
    { nr: 3, text: { de: "Was wirst Du in den nächsten zwei Wochen konkret anders machen?", en: "What will you concretely do differently in the next two weeks?" }, nachfrageMax: 1 },
    { nr: 4, text: { de: "Was hat gefehlt, das Du Dir gewünscht hättest?", en: "What was missing that you would have wished for?" }, nachfrageMax: 1 },
    { nr: 5, text: { de: "Würdest Du den Kurs einer Kollegin oder einem Kollegen empfehlen? Was würdest Du dazu sagen?", en: "Would you recommend the course to a colleague? What would you say about it?" }, nachfrageMax: 0 },
  ],
};

export const INTERVIEW_DEFINITIONEN: ReadonlyArray<InterviewDefinition> = [KURSFEEDBACK];

export function interviewDefinition(id: string): InterviewDefinition | null {
  return INTERVIEW_DEFINITIONEN.find((d) => d.id === id) ?? null;
}

export function frageText(def: InterviewDefinition, nr: number, locale: InterviewLocale): string {
  const f = def.fragen.find((x) => x.nr === nr);
  return f ? f.text[locale] : "";
}

export function coachInterviewScope(env: Record<string, string | undefined> = process.env): "off" | "all" | ReadonlySet<string> {
  const raw = (env.COACH_INTERVIEW ?? "").trim();
  if (!raw) return new Set([OWNER_WORKSPACE_ID]);
  const v = raw.toLowerCase();
  if (v === "off") return "off";
  if (v === "all") return "all";
  return new Set(raw.split(",").map((x) => x.trim()).filter(Boolean));
}

export function interviewAllowedFor(workspaceId: string, env: Record<string, string | undefined> = process.env): boolean {
  const scope = coachInterviewScope(env);
  if (scope === "off") return false;
  if (scope === "all") return true;
  return scope.has(workspaceId);
}

export type InterviewRolle = "interviewer" | "person";

export interface InterviewTurn {
  role: InterviewRolle;
  text: string;
  /** Zu welcher Frage der Beitrag gehört. */
  frageNr: number;
  /** true = Nachfrage des Interviewers (nicht die Frage selbst). */
  nachfrage?: boolean;
  ts: string;
}

/** Begrüßung + erste Frage — deterministisch, kein Modellaufruf. */
export function eroeffnung(def: InterviewDefinition, kursTitel: string, locale: InterviewLocale): string {
  const first = frageText(def, 1, locale);
  return locale === "en"
    ? `Thanks for taking five minutes. I have five short questions about "${kursTitel}". There are no wrong answers; the more concrete, the more useful. First question: ${first}`
    : `Danke, dass Du Dir fünf Minuten nimmst. Ich habe fünf kurze Fragen zu „${kursTitel}“. Es gibt keine falschen Antworten; je konkreter, desto nützlicher. Erste Frage: ${first}`;
}

/** Überleitung zur nächsten Frage ohne Modell (Rückfall und Schlussfrage). */
export function ueberleitung(def: InterviewDefinition, naechsteNr: number, locale: InterviewLocale): string {
  const f = frageText(def, naechsteNr, locale);
  const dank = locale === "en" ? "Thank you." : "Danke.";
  const letzte = naechsteNr === def.fragen.length ? (locale === "en" ? " Last question: " : " Letzte Frage: ") : " ";
  return `${dank}${letzte}${f}`;
}

export function abschluss(locale: InterviewLocale): string {
  return locale === "en"
    ? "That was the last question. Thank you, your answers help improve the course. You can finish the interview now."
    : "Das war die letzte Frage. Danke, Deine Antworten helfen, den Kurs besser zu machen. Du kannst das Interview jetzt abschließen.";
}
