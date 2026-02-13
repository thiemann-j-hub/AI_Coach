import { Suspense } from "react";
import RunsDashboardClient from "./RunsDashboardClient";
import { AuthGuard } from "@/components/auth/auth-guard";

export const dynamic = "force-dynamic";

export default function RunsDashboardPage() {
  return (
    <AuthGuard>
      <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
        <RunsDashboardClient />
      </Suspense>
    </AuthGuard>
  );
}
