import { Suspense } from "react";
import SimulationClient from "./simulation/SimulationClient";
import { AuthGuard } from "@/components/auth/auth-guard";

export const dynamic = "force-dynamic";

/**
 * DER Einstieg (COACH-UX-BLUEPRINT §1): ein Einstieg mit zwei Zuflüssen in
 * dieselbe Messung — Szenario-Raster (Rollenspiel) + Ablage-Leiste (Transkript).
 * Kein Redirect mehr: die Startseite IST die Seite.
 */
export default function Home() {
  return (
    <AuthGuard>
      <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
        <SimulationClient />
      </Suspense>
    </AuthGuard>
  );
}
