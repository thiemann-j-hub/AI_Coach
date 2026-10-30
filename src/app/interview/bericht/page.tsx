import { Suspense } from "react";
import BerichtClient from "./BerichtClient";

/** Welle 6 — Themenbericht der Kurs-Interviews (nur Workspace-Admins, ab fünf Antworten je Kurs). */
export default function InterviewBerichtPage() {
  return (
    <Suspense>
      <BerichtClient />
    </Suspense>
  );
}
