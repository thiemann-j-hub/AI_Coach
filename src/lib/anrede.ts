/**
 * W1-5 (LXT-Welle W1, Owner-GO 14.10.2026): Anrede als zentraler Parameter für JEDEN KI-Aufruf.
 *
 * Vorbild LXT (Anhang A §8.2, Anhang F §4): Anrede je Inhaltssprache (Sie / Du / du), die KI und
 * die Untertitel folgen ihr — aber nur an drei Stellen, und 9 % der Texte kippen trotzdem ins Sie,
 * 24 Texte ins kleine „du“. Unsere Fassung: EIN Parameter, der an jeden KI-Aufruf geht (zentral in
 * den Modell-Hüllen), Regel „Du groß, nie Sie; Fremdsprachen in der üblichen höflichen Form“
 * (Owner-Regel). Eine Sie-Option je Kunde gibt es bewusst nicht (Entscheid E3 offen).
 * Dieselbe Datei liegt in Studio, Coach, Hub und Jobmap. Rückweg: ADDRESS_PARAM=off.
 */

/** Die eine Anrede der Plattform (Owner-Regel: Du groß, nie Sie). */
export const ANREDE = "Du" as const;

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
 */
export function anredeBlock(opts: { rollenspiel?: boolean } = {}): string {
  const lines = [
    ANREDE_MARKER,
    "Deutsch: Sprich die Person durchgehend mit „Du“ an und schreibe Du, Dein, Deine, Dir, Dich immer groß.",
    "Verwende nie „Sie“, „Ihnen“ oder „Ihr“ als Anrede. Befehlsform in Du-Form („Prüfe …“, „Schreib …“).",
    "Andere Sprachen: die übliche höfliche Standardform der Sprache (English „you“, français „vous“, español „usted“, italiano „Lei“, nederlands „u“, …) — konsequent, nie gemischt.",
    "Diese Regel gilt für jeden Text, den eine Person liest: Kurstexte, Fragen, Untertitel, Auswertungen, Mails, Vorschläge.",
  ];
  if (opts.rollenspiel) {
    lines.push(
      "Ausnahme Rollenspiel: Die wörtliche Rede einer Spielfigur folgt der Situation (eine fremde Kollegin darf siezen); Briefing, Ziele, Hinweise und Auswertung an die übende Person bleiben in Du-Form."
    );
  }
  return lines.join("\n");
}

/** Hängt den Regelblock einmal an einen System-Prompt an (idempotent). Bei ADDRESS_PARAM=off unverändert. */
export function withAnrede(systemPrompt: string, opts: { rollenspiel?: boolean } = {}): string {
  if (!addressParamOn()) return systemPrompt;
  if (systemPrompt.includes(ANREDE_MARKER)) return systemPrompt;
  return `${systemPrompt.trimEnd()}\n\n${anredeBlock(opts)}`;
}
