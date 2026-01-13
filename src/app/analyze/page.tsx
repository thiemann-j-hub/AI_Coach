import { Suspense } from "react";
import AnalyzeClient from "./AnalyzeClient";

export const dynamic = "force-dynamic";

export default function AnalyzePage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
      <AnalyzeClient />
    </Suspense>
  );
}
