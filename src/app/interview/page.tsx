import { Suspense } from "react";
import InterviewClient from "./InterviewClient";

/** Welle 6 — Interview-Pilot „Kursfeedback“ (Owner-GO 30.10.2026). */
export default function InterviewPage() {
  return (
    <Suspense>
      <InterviewClient />
    </Suspense>
  );
}
