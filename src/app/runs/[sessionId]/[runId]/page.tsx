import { notFound } from "next/navigation";

import { AuthGuard } from "@/components/auth/auth-guard";
import RunDetailClient from "./RunDetailClient";

export const dynamic = "force-dynamic";

// Security: Run-Daten werden NICHT mehr serverseitig per Admin-SDK (ohne
// Auth-Check) geladen, sondern clientseitig über /api/runs/get, das
// requireAuth + Session-Ownership erzwingt.
export default async function RunDetailPage(props: {
  params: Promise<{ sessionId: string; runId: string }>;
}) {
  const params = await props.params;
  const sessionId = params?.sessionId ?? "";
  const runId = params?.runId ?? "";

  if (!sessionId || !runId) notFound();

  return (
    <AuthGuard>
      <RunDetailClient sessionId={sessionId} runId={runId} />
    </AuthGuard>
  );
}
