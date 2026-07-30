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
