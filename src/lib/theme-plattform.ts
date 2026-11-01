/**
 * EIN Hell/Dunkel-Schalter für die ganze Plattform (Owner 01.11.2026: „nach Wechsel auf Dunkel wird es
 * nicht beibehalten, wenn ich in eine andere der drei Apps wechsle“).
 *
 * Hub, /coach, /jobmap und /studio teilen sich die Origin app.pulsenorth.ai und damit localStorage. Bisher
 * hatte jede App ihren eigenen Schlüssel (hub_theme, coach_theme, jobmap_theme, studio_theme) und ihren
 * eigenen Standard (Hub hell, sonst dunkel) — die Wahl galt nur in der App, in der sie fiel. Jetzt nutzen
 * alle vier denselben Schlüssel pn_theme und denselben Standard „hell“ (Owner 02.10.2026: Hell ist der
 * Standard für neue Besucher). Bewusste Ausnahme vom Präfix-Vertrag: pn_ = plattformweit geteilt.
 *
 * Gleiche Datei in Hub, Coach, Jobmap und Studio. Rückweg: App-Einstellung THEME_PLATTFORM=off in allen
 * vier Apps → wieder je App eigener Schlüssel und Standard (die alten Schlüssel bleiben unangetastet).
 */

export const PLATTFORM_THEME_KEY = "pn_theme";

/** Nur für Server-Code (Layouts). */
export function themePlattformAn(): boolean {
  return (process.env.THEME_PLATTFORM ?? "on").trim().toLowerCase() !== "off";
}

/**
 * Läuft vor next-themes (das Layout setzt es vor den ThemeProvider): Fehlt pn_theme, gilt einmalig die
 * bisherige Wahl dieses Browsers — zuerst die im Hub, dann Studio, Coach, Jobmap. „system“ zählte schon
 * bisher als dunkel.
 */
export const THEME_UEBERNAHME_SKRIPT =
  'try{var k="pn_theme";if(localStorage.getItem(k)===null){var a=["hub_theme","studio_theme","coach_theme","jobmap_theme"];' +
  'for(var i=0;i<a.length;i++){var v=localStorage.getItem(a[i]);if(v){localStorage.setItem(k,v==="light"?"light":"dark");break;}}}}catch(e){}';
