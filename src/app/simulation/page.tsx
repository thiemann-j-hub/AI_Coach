import { Suspense } from "react";
import SimulationClient from "./SimulationClient";
import { AuthGuard } from "@/components/auth/auth-guard";

export const dynamic = "force-dynamic";

export default function SimulationPage() {
  return (
    <AuthGuard>
      <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
        <SimulationClient />
      </Suspense>
    </AuthGuard>
  );
}
