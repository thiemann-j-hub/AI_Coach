import { Suspense } from "react";
import RunsDashboardClient from "./RunsDashboardClient";

export const dynamic = "force-dynamic";

export default function RunsDashboardPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
      <RunsDashboardClient />
    </Suspense>
  );
}
