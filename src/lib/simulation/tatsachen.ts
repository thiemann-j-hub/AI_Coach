import type { DebriefErgebnis } from "./debrief";
import type { FactVisual } from "./types";

/**
 * Bewertung 2.0 (Owner-GO 01.11.2026): Was im Gespräch FESTSTEHT, bevor der Richter urteilt — das Ergebnis der Rolle
 * (Ziel freigegeben, verabschiedet, abgebrochen) und die Bedingungen, die die Rolle laut Regie erfüllt sah. Der Richter
 * bekommt das als Tatsachen (Konsistenzregel im Prompt); das Debrief leitet daraus das Urteil ab. Reine Funktionen.
 */
export interface TatsachenRegieEintrag {
  turn: number;
  stufe: number;
  erfuellt: string[];
  vorschnell?: boolean;
}

export interface TatsachenEnde {
  ergebnis: "ziel" | "verabschiedung" | "abbruch";
  grund: string;
}

export interface TatsachenArgs {
  personaName: string;
  locale: "de" | "en";
  regie?: TatsachenRegieEintrag[] | null;
  closedByPersona?: TatsachenEnde | null;
  closedByTime?: boolean;
}

/** Zeilen für den Richter; leer, wenn nichts feststeht. */
export function tatsachenText(a: TatsachenArgs): string {
  const en = a.locale === "en";
  const zeilen: string[] = [];
  const ende = a.closedByPersona;
  if (ende?.ergebnis === "ziel") {
    zeilen.push(en ? `${a.personaName} released the goal and ended the conversation: ${ende.grund}` : `${a.personaName} hat das Ziel freigegeben und das Gespräch beendet: ${ende.grund}`);
  } else if (ende?.ergebnis === "abbruch") {
    zeilen.push(en ? `${a.personaName} broke off the conversation: ${ende.grund}` : `${a.personaName} hat das Gespräch abgebrochen: ${ende.grund}`);
  } else if (ende?.ergebnis === "verabschiedung") {
    zeilen.push(en ? `The learner said goodbye; the goal stayed open: ${ende.grund}` : `Die lernende Person hat sich verabschiedet; das Ziel blieb offen: ${ende.grund}`);
  } else if (a.closedByTime) {
    zeilen.push(en ? "Time ran out before the goal was settled." : "Die Zeit lief ab, bevor das Ziel geklärt war.");
  }
  // Erfüllte Bedingungen: die zuletzt gültige Liste (die Regie führt sie kumulativ), ohne vorschnelle Einträge.
  const gueltig = [...(a.regie ?? [])].reverse().find((r) => !r.vorschnell && r.erfuellt.length);
  for (const b of gueltig?.erfuellt ?? []) {
    zeilen.push(en ? `Condition met (turn ${gueltig!.turn}): ${b}` : `Bedingung erfüllt (Zug ${gueltig!.turn}): ${b}`);
  }
  const vorschnell = (a.regie ?? []).filter((r) => r.vorschnell).map((r) => r.turn);
  if (vorschnell.length) {
    zeilen.push(en ? `The role gave in too early in turn(s) ${vorschnell.join(", ")} — those concessions do not count as met conditions.` : `Die Rolle lenkte in Zug ${vorschnell.join(", ")} vorschnell ein — diese Zugeständnisse zählen nicht als erfüllte Bedingungen.`);
  }
  return zeilen.join("\n");
}

/**
 * Ergebnis des Gesprächs für das Debrief: Die Rolle hat Vorrang (sie hat das Ziel freigegeben oder abgebrochen);
 * sonst entscheidet das Urteil des Richters (zielErreicht), sonst „offen“.
 * Paket 2, C6 (Owner-Entscheid 12.11.2026): Das Ergebnis ist eine Tatsache über das Gespräch. Ob „ziel“ zum
 * Bestehen reicht, entscheidet `computeDebrief` — im Prüfungsmodus nur zusammen mit der Mindestpunktzahl.
 */
export function bestimmeErgebnis(a: { closedByPersona?: TatsachenEnde | null; zielErreicht?: boolean | null }): DebriefErgebnis {
  if (a.closedByPersona?.ergebnis === "ziel") return "ziel";
  if (a.closedByPersona?.ergebnis === "abbruch") return "abbruch";
  if (a.zielErreicht === true) return "ziel";
  return "offen";
}

/** Eine beschriftete Grafik des Faktenblatts als Textzeile (Titel, Werte mit Einheit, Hinweis). */
function grafikZeile(v: FactVisual): string {
  const note = v.note?.trim() ? ` (${v.note.trim()})` : "";
  if (v.kind === "trend") {
    return `${v.title}: ${v.points.map((p) => `${p.label} ${p.approx ? "ca. " : ""}${p.value}${v.unit ?? ""}`).join(" → ")}${note}`;
  }
  if (v.kind === "bars") {
    return `${v.title}: ${v.items.map((i) => `${i.label} ${i.value}${v.unit ?? ""}`).join(" · ")}${note}`;
  }
  return `${v.title}: ${v.items.map((i) => `${i.label} ${i.value}${i.sub ? ` (${i.sub})` : ""}`).join(" · ")}${note}`;
}

export interface SzenarioFaktenQuelle {
  personaDna?: { facts?: string[] | null } | null;
  candidateBriefing?: { factSheet?: string[] | null; factVisuals?: FactVisual[] | null } | null;
}

/**
 * Paket 3, S13 (12.11.2026): Fakten des Szenarios für die Faktenprüfung des Richters — die harten Faktenanker der
 * Rolle und das Faktenblatt des Briefings (Zeilen; ohne Zeilen die beschrifteten Grafiken als Text). Je Fakt eine
 * Zeile mit Spiegelstrich, gleiche Zeilen nur einmal. Leer, wenn das Szenario keine Fakten nennt — dann prüft der
 * Richter nichts. Reine Funktion.
 */
export function szenarioFaktenText(s: SzenarioFaktenQuelle, maxChars = 2400): string {
  const blatt = s.candidateBriefing?.factSheet?.length
    ? s.candidateBriefing.factSheet
    : (s.candidateBriefing?.factVisuals ?? []).map(grafikZeile);
  const gesehen = new Set<string>();
  const zeilen: string[] = [];
  let laenge = 0;
  for (const roh of [...(s.personaDna?.facts ?? []), ...blatt]) {
    const zeile = String(roh ?? "").replace(/\s+/g, " ").trim();
    const kern = zeile.toLowerCase();
    if (!zeile || gesehen.has(kern)) continue;
    if (laenge + zeile.length > maxChars) break;
    gesehen.add(kern);
    zeilen.push(`- ${zeile}`);
    laenge += zeile.length + 3;
  }
  return zeilen.join("\n");
}
