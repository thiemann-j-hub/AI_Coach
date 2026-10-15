/**
 * W1-5 (LXT-Welle W1, Owner-GO 14.10.2026): Anrede als zentraler Parameter für JEDEN KI-Aufruf.
 *
 * Vorbild LXT (Anhang A §8.2, Anhang F §4): Anrede je Inhaltssprache (Sie / Du / du), die KI und
 * die Untertitel folgen ihr — aber nur an drei Stellen, und 9 % der Texte kippen trotzdem ins Sie,
 * 24 Texte ins kleine „du“. Unsere Fassung: EIN Parameter, der an jeden KI-Aufruf geht (zentral in
 * den Modell-Hüllen), Regel „Du groß, nie Sie; Fremdsprachen in der üblichen höflichen Form“
 * (Owner-Regel). Go-Live Z1 (15.10.2026, Fahrplan-Entscheid F3): „Sie“ nur auf Kundenwunsch — dann
 * als bewusste Form über `form: "sie"` (Studio: Briefing-Anrede), nie zwei Vorgaben im selben Prompt.
 * Dieselbe Datei liegt in Studio, Coach, Hub und Jobmap. Rückweg: ADDRESS_PARAM=off.
 */

/** Die eine Anrede der Plattform (Owner-Regel: Du groß, nie Sie). */
export const ANREDE = "Du" as const;

export type AnredeForm = "du" | "sie";

export function addressParamOn(): boolean {
  const v = typeof process !== "undefined" ? process.env?.ADDRESS_PARAM : undefined;
  return (v ?? "").trim().toLowerCase() !== "off";
}

export const ANREDE_MARKER = "[ANREDE-REGEL]";

/**
 * Der Regelblock, den jeder System-Prompt bekommt. Sprachunabhängig formuliert.
 * `rollenspiel: true` (Coach-Szenarien): Die Rede einer Spielfigur bleibt so, wie es die
 * Situation verlangt (eine Kollegin darf siezen); die Regel gilt für alles, was die App
 * selbst zur übenden Person sagt.
 * `form: "sie"`: ausdrücklicher Kundenwunsch — dann durchgehend „Sie“, nie gemischt.
 */
export function anredeBlock(opts: { rollenspiel?: boolean; form?: AnredeForm } = {}): string {
  const sie = opts.form === "sie";
  const lines = [
    ANREDE_MARKER,
    sie
      ? "Deutsch: Sprich die Person durchgehend mit „Sie“ an und schreibe Sie, Ihnen, Ihr, Ihre immer groß."
      : "Deutsch: Sprich die Person durchgehend mit „Du“ an und schreibe Du, Dein, Deine, Dir, Dich immer groß.",
    sie
      ? "Verwende nie „Du“, „Dir“ oder „Dein“ als Anrede. Befehlsform höflich („Prüfen Sie …“, „Schreiben Sie …“)."
      : "Verwende nie „Sie“, „Ihnen“ oder „Ihr“ als Anrede. Befehlsform in Du-Form („Prüfe …“, „Schreib …“).",
    "Andere Sprachen: die übliche höfliche Standardform der Sprache (English „you“, français „vous“, español „usted“, italiano „Lei“, nederlands „u“, …) — konsequent, nie gemischt.",
    "Diese Regel gilt für jeden Text, den eine Person liest: Kurstexte, Fragen, Untertitel, Auswertungen, Mails, Vorschläge.",
  ];
  if (opts.rollenspiel) {
    lines.push(
      sie
        ? "Ausnahme Rollenspiel: Die wörtliche Rede einer Spielfigur folgt der Situation (eine Kollegin darf duzen); Briefing, Ziele, Hinweise und Auswertung an die übende Person bleiben in Sie-Form."
        : "Ausnahme Rollenspiel: Die wörtliche Rede einer Spielfigur folgt der Situation (eine fremde Kollegin darf siezen); Briefing, Ziele, Hinweise und Auswertung an die übende Person bleiben in Du-Form."
    );
  }
  return lines.join("\n");
}

/** Hängt den Regelblock einmal an einen System-Prompt an (idempotent). Bei ADDRESS_PARAM=off unverändert. */
export function withAnrede(systemPrompt: string, opts: { rollenspiel?: boolean; form?: AnredeForm } = {}): string {
  if (!addressParamOn()) return systemPrompt;
  if (systemPrompt.includes(ANREDE_MARKER)) return systemPrompt;
  return `${systemPrompt.trimEnd()}\n\n${anredeBlock(opts)}`;
}
