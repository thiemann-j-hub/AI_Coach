import { redirect } from "next/navigation";

// Die frühere Legacy-Startseite (CommsCoach-AI-Parallel-Flow) wurde entfernt:
// ihr Server-Action-Pfad schrieb in eine von firestore.rules gesperrte
// Collection und konnte nie funktionieren. /analyze ist der kanonische Flow.
export default function Home() {
  redirect("/analyze");
}
