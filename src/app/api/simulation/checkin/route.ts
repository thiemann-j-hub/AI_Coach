import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getApiMessages } from "@/lib/server/get-request-locale";
import { simulationEnabled } from "@/lib/simulation/flags";
import { updateSimulation } from "@/lib/server/simulation-store";
import {
  checkinAntwort,
  checkinSelfAssessment,
  imHintergrund,
  runSelfReview,
} from "@/lib/server/simulation-finish-job";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Je Antwort zählen höchstens 400 Zeichen (checkinAntwort kürzt). Das Schema lässt etwas mehr durch, damit ein
// Ausreißer aus dem Diktat nicht den ganzen Check-in mit einem Fehler verliert.
const requestSchema = z.object({
  simId: z.string().min(8).max(64).regex(/^[A-Za-z0-9-]+$/),
  gut: z.string().max(2_000).optional(),
  anders: z.string().max(2_000).optional(),
  skipped: z.boolean().optional(),
});

/**
 * POST: Check-in speichern (Paket 3, S8, 12.11.2026) — die zwei Antworten „Was ist Dir gut gelungen?“ und „Was
 * würdest Du beim nächsten Mal anders machen?“. Körper `{ simId, gut?, anders?, skipped? }`.
 *
 * Der Check-in läuft, WÄHREND die Auswertung rechnet; er ist keine Eingabe des Richters mehr. Gespeichert wird
 * höchstens einmal je Lauf — ein zweiter Aufruf überschreibt nichts (auch nicht das Selbstbild eines Alt-Laufs)
 * und antwortet trotzdem mit 200. Angenommen wird er, solange es eine Auswertung gibt oder geben soll:
 * `finishing`, `finished` und `active` mit `finishError` (die Rechnung scheiterte, bevor die Antworten kamen —
 * sie zählen dann für den nächsten Versuch). Sonst 409.
 *
 * Abgleich „Selbstbild und Auswertung“: ein kleiner zweiter KI-Schritt, sobald BEIDES da ist. Ist die Auswertung
 * beim Speichern schon fertig, stößt diese Route ihn an (neben der Antwort); rechnet sie noch, tut es der Auftrag
 * nach dem Speichern. Übersprungen oder ohne Antwort → kein Abgleich.
 * Antwort: `{ ok: true, status }` — der Status des Laufs beim Speichern.
 */
export async function POST(req: NextRequest) {
  if (!simulationEnabled()) {
    return NextResponse.json({ ok: false, code: "SIMULATION_DISABLED" }, { status: 503 });
  }
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const rl = checkRateLimit(`sim-checkin:${auth.uid}`, 10, 60_000, getApiMessages(req).rateLimited);
  if (rl) return rl;

  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
    }
    const { simId } = parsed.data;
    const gut = checkinAntwort(parsed.data.gut);
    const anders = checkinAntwort(parsed.data.anders);
    // Maßgeblich sind die Antworten: „übersprungen“ heißt, es steht keine da.
    const skipped = !gut && !anders;

    const st = { erlaubt: false, gespeichert: false, abgleich: false };
    const doc = await updateSimulation(auth.uid, simId, (d) => {
      st.gespeichert = false;
      st.abgleich = false;
      st.erlaubt = d.status === "finishing" || d.status === "finished" || (d.status === "active" && !!d.finishError);
      // Höchstens einmal: Ein vorhandener Check-in bleibt, ebenso das Selbstbild eines Alt-Laufs.
      if (!st.erlaubt || d.checkin || d.selfAssessment) return false;
      d.checkin = { gut, anders, skipped, at: new Date().toISOString() };
      // Alt-Feld für die Karte „Selbstbild und Auswertung“: aus den zwei Antworten zusammengesetzt.
      d.selfAssessment = checkinSelfAssessment(gut, anders);
      st.gespeichert = true;
      // Wer zuletzt schreibt, sieht beides: Steht die Auswertung schon, stößt dieser Aufruf den Abgleich an.
      st.abgleich = d.status === "finished" && !skipped;
    });
    if (!doc) {
      return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
    }
    if (!st.erlaubt) {
      return NextResponse.json({ ok: false, code: doc.status === "aborted" ? "ABORTED" : "NOT_FINISHING" }, { status: 409 });
    }
    if (st.gespeichert) {
      // Keine Inhalte ins Protokoll — nur, ob etwas beantwortet wurde.
      logger.api("/api/simulation/checkin", "saved", { simId, skipped, status: doc.status });
    }
    if (st.abgleich) imHintergrund("/api/simulation/checkin/self-review", () => runSelfReview({ uid: auth.uid, simId }));
    return NextResponse.json({ ok: true, status: doc.status });
  } catch (err) {
    logger.apiError("/api/simulation/checkin", err);
    return NextResponse.json({ ok: false, error: "Internal server error", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
