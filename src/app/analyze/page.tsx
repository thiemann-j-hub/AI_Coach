import { Suspense } from "react";
import AnalyzeClient from "./AnalyzeClient";
import { AuthGuard } from "@/components/auth/auth-guard";

export const dynamic = "force-dynamic";

export default function AnalyzePage() {
  return (
    <AuthGuard>
      <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
        <AnalyzeClient />
      </Suspense>
    </AuthGuard>
  );
}
