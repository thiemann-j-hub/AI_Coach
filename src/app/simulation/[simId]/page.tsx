import { Suspense } from "react";
import EvalClient from "./EvalClient";
import { AuthGuard } from "@/components/auth/auth-guard";

export const dynamic = "force-dynamic";

/** Eigene Adresse je Rollenspiel-Auswertung (COACH-UX-BLUEPRINT §3/W1-7). */
export default function SimulationEvaluationPage() {
  return (
    <AuthGuard>
      <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
        <EvalClient />
      </Suspense>
    </AuthGuard>
  );
}
