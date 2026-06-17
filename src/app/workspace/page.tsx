import { Suspense } from "react";
import WorkspaceClient from "./WorkspaceClient";
import { AuthGuard } from "@/components/auth/auth-guard";

export const dynamic = "force-dynamic";

export default function WorkspacePage() {
  return (
    <AuthGuard>
      <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
        <WorkspaceClient />
      </Suspense>
    </AuthGuard>
  );
}
