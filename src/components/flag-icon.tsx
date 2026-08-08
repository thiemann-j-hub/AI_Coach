/**
 * PulseNorth FlagIcon-Kit (SSOT hier in pulsenorth-ops, Kopien in den Apps —
 * Muster wie chat-widget-kit). Inline-SVG-Flaggen für die 22 UI-Sprachen:
 * Emoji-Flaggen (Regional Indicator Symbols) rendert Windows NICHT — Chrome/
 * Edge zeigen dort nur Buchstabenkürzel. SVG sieht auf jedem OS gleich aus.
 * Vereinfachte, aber korrekte Flaggen (bei 16–20px sind Wappendetails unsichtbar):
 * en=GB, ca=Senyera (Katalonien), nb=Norwegen, el=Griechenland, ga=Irland.
 * Keine Abhängigkeiten — Datei ist 1:1 in alle Apps kopierbar.
 */
import * as React from "react";

const VB = "0 0 60 40";

/** Horizontale Streifen von oben nach unten (Anteile summieren sich zu 1). */
function rows(colors: [string, number][]): React.ReactNode {
  let y = 0;
  return colors.map(([c, h], i) => {
    const el = <rect key={i} x={0} y={y * 40} width={60} height={h * 40} fill={c} />;
    y += h;
    return el;
  });
}

/** Vertikale Streifen von links nach rechts. */
function cols(colors: [string, number][]): React.ReactNode {
  let x = 0;
  return colors.map(([c, w], i) => {
    const el = <rect key={i} x={x * 60} y={0} width={w * 60} height={40} fill={c} />;
    x += w;
    return el;
  });
}

/** Skandinavisches Kreuz: Grundfarbe + (optional zweifarbiges) Kreuz, Mast bei x=22. */
function nordic(bg: string, cross: string, cw: number, inner?: string, iw?: number): React.ReactNode {
  return (
    <>
      <rect width={60} height={40} fill={bg} />
      <rect x={22 - cw / 2} y={0} width={cw} height={40} fill={cross} />
      <rect x={0} y={20 - cw / 2} width={60} height={cw} fill={cross} />
      {inner && iw !== undefined && (
        <>
          <rect x={22 - iw / 2} y={0} width={iw} height={40} fill={inner} />
          <rect x={0} y={20 - iw / 2} width={60} height={iw} fill={inner} />
        </>
      )}
    </>
  );
}

const FLAGS: Record<string, React.ReactNode> = {
  de: rows([["#000", 1 / 3], ["#DD0000", 1 / 3], ["#FFCE00", 1 / 3]]),
  en: (
    <>
      <rect width={60} height={40} fill="#012169" />
      <path d="M0,0 60,40 M60,0 0,40" stroke="#FFF" strokeWidth={8} />
      <path d="M0,0 60,40 M60,0 0,40" stroke="#C8102E" strokeWidth={3.2} />
      <path d="M30,0 V40 M0,20 H60" stroke="#FFF" strokeWidth={13} />
      <path d="M30,0 V40 M0,20 H60" stroke="#C8102E" strokeWidth={8} />
    </>
  ),
  fr: cols([["#002395", 1 / 3], ["#FFF", 1 / 3], ["#ED2939", 1 / 3]]),
  es: rows([["#AA151B", 0.25], ["#F1BF00", 0.5], ["#AA151B", 0.25]]),
  it: cols([["#009246", 1 / 3], ["#FFF", 1 / 3], ["#CE2B37", 1 / 3]]),
  pt: (
    <>
      {cols([["#006600", 0.4], ["#FF0000", 0.6]])}
      <circle cx={24} cy={20} r={7.5} fill="#FFFF00" />
      <circle cx={24} cy={20} r={4.5} fill="#FFF" stroke="#FF0000" strokeWidth={1.5} />
    </>
  ),
  ca: (
    <>
      <rect width={60} height={40} fill="#FCDD09" />
      {[1, 3, 5, 7].map((i) => (
        <rect key={i} x={0} y={(i * 40) / 9} width={60} height={40 / 9} fill="#DA121A" />
      ))}
    </>
  ),
  nl: rows([["#AE1C28", 1 / 3], ["#FFF", 1 / 3], ["#21468B", 1 / 3]]),
  sv: nordic("#006AA7", "#FECC00", 8),
  da: nordic("#C8102E", "#FFF", 8),
  nb: nordic("#BA0C2F", "#FFF", 10, "#00205B", 5),
  fi: nordic("#FFF", "#002F6C", 10),
  et: rows([["#0072CE", 1 / 3], ["#000", 1 / 3], ["#FFF", 1 / 3]]),
  lv: rows([["#9E3039", 0.4], ["#FFF", 0.2], ["#9E3039", 0.4]]),
  pl: rows([["#FFF", 0.5], ["#DC143C", 0.5]]),
  cs: (
    <>
      {rows([["#FFF", 0.5], ["#D7141A", 0.5]])}
      <path d="M0,0 L30,20 L0,40 Z" fill="#11457E" />
    </>
  ),
  hu: rows([["#CE2939", 1 / 3], ["#FFF", 1 / 3], ["#477050", 1 / 3]]),
  ro: cols([["#002B7F", 1 / 3], ["#FCD116", 1 / 3], ["#CE1126", 1 / 3]]),
  el: (
    <>
      {Array.from({ length: 9 }, (_, i) => (
        <rect key={i} x={0} y={(i * 40) / 9} width={60} height={40 / 9} fill={i % 2 ? "#FFF" : "#0D5EAF"} />
      ))}
      <rect x={0} y={0} width={40 * (5 / 9)} height={40 * (5 / 9)} fill="#0D5EAF" />
      <rect x={0} y={40 * (2 / 9)} width={40 * (5 / 9)} height={40 / 9} fill="#FFF" />
      <rect x={40 * (2 / 9)} y={0} width={40 / 9} height={40 * (5 / 9)} fill="#FFF" />
    </>
  ),
  ru: rows([["#FFF", 1 / 3], ["#0039A6", 1 / 3], ["#D52B1E", 1 / 3]]),
  uk: rows([["#005BBB", 0.5], ["#FFD500", 0.5]]),
  ga: cols([["#169B62", 1 / 3], ["#FFF", 1 / 3], ["#FF883E", 1 / 3]]),
};

export function FlagIcon({ locale, className }: { locale: string; className?: string }) {
  const flag = FLAGS[locale];
  if (!flag) return null;
  return (
    <svg
      viewBox={VB}
      className={className ?? "h-3.5 w-[21px] shrink-0 rounded-[2px]"}
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid slice"
    >
      {flag}
    </svg>
  );
}
