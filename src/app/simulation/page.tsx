import { redirect } from "next/navigation";

/**
 * Alte Adresse des Rollenspiel-Katalogs — der Einstieg lebt jetzt auf `/`
 * (COACH-UX-BLUEPRINT §1/W1-3). Lesezeichen bleiben gültig.
 * /simulation/[simId] (Auswertung) bleibt eine eigene Route.
 */
export default function SimulationPage() {
  redirect("/");
}
