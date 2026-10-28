/**
 * Feature-Flags der Gesprächssimulation (Konvention wie RADAR_EMIT: Funktion,
 * String-Vergleich, Default AUS).
 */

/** Schaltet die Simulation frei (API-Routen antworten sonst 503 SIMULATION_DISABLED). */
export function simulationEnabled(): boolean {
  return (process.env.SIMULATION_ENABLED ?? "off").toLowerCase() === "on";
}

/**
 * Dürfen Simulations-Auswertungen als Radar-Messpunkte emittiert werden?
 * Default AUS — Owner-Entscheid steht aus, ob Übungs-Gespräche echte Messpunkte
 * werden (Blueprint §6 SIM-2). Das C1–C10-Scoring wird unabhängig davon erhoben
 * und am Simulations-Doc persistiert, damit beim Flip Historie existiert.
 */
export function simulationRadarEmitEnabled(): boolean {
  return (process.env.SIMULATION_RADAR_EMIT ?? "off").toLowerCase() === "on";
}

/**
 * Sprachmodus „Live“ (Owner-GO 28.10.2026, Register N4-231): Die Persona hört und spricht selbst über
 * Gemini Live in der EU-Mehrfachregion, statt Diktat → Text → Azure-Stimme. Zweiter Sprachweg NEBEN
 * der heutigen Kaskade; ohne Schalter oder bei Fehlern bleibt die Kaskade der Weg.
 *   COACH_LIVE = off (Standard) | all | <Szenario-IDs, kommagetrennt>
 * Rückweg: Variable weglassen.
 */
export function coachLiveScope(env: Record<string, string | undefined> = process.env): "off" | "all" | ReadonlySet<string> {
  const raw = (env.COACH_LIVE ?? "off").trim();
  if (!raw || raw.toLowerCase() === "off") return "off";
  if (raw.toLowerCase() === "all") return "all";
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return ids.length ? new Set(ids) : "off";
}

export function coachLiveEnabledFor(scenarioId: string, env: Record<string, string | undefined> = process.env): boolean {
  const scope = coachLiveScope(env);
  if (scope === "off") return false;
  if (scope === "all") return true;
  return scope.has(scenarioId);
}

/** Standort der Live-Verarbeitung: Mehrfachregion „eu“ (Host aiplatform.eu.rep.googleapis.com). */
export function coachLiveLocation(env: Record<string, string | undefined> = process.env): string {
  return (env.COACH_LIVE_LOCATION ?? "eu").trim() || "eu";
}

export function coachLiveModel(env: Record<string, string | undefined> = process.env): string {
  return (env.COACH_LIVE_MODEL ?? "gemini-3.8-live").trim() || "gemini-3.8-live";
}

/**
 * Spielbuch (Owner-GO 28.10.2026): Ein starkes Modell (Opus @eu) schreibt VOR dem Gespräch je Szenario ein
 * vertrauliches Spielbuch (Sachkern, erwartete Züge, Öffnungsverlauf), das in die Rollenanweisung wandert —
 * so argumentiert auch das schnelle Gesprächsmodell (Gemini Live / Flash) mit Substanz.
 *   COACH_SPIELBUCH = on (Standard) | off
 */
export function coachSpielbuchOn(env: Record<string, string | undefined> = process.env): boolean {
  return (env.COACH_SPIELBUCH ?? "on").trim().toLowerCase() !== "off";
}
