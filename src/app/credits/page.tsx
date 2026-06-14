import { Suspense } from "react";
import CreditsClient from "./CreditsClient";
import { AuthGuard } from "@/components/auth/auth-guard";

export const dynamic = "force-dynamic";

export default function CreditsPage() {
  return (
    <AuthGuard>
      <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
        <CreditsClient />
      </Suspense>
    </AuthGuard>
  );
}
