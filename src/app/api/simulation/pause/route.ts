import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getApiMessages } from "@/lib/server/get-request-locale";
import { updateSimulation } from "@/lib/server/simulation-store";
import { simulationEnabled } from "@/lib/simulation/flags";
import { pauseSetzen } from "@/lib/simulation/zeit";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  simId: z
    .string()
    .min(8)
    .max(64)
    .regex(/^[A-Za-z0-9-]+$/),
  on: z.boolean(),
});

/**
 * POST { simId, on }: Coach-Pause hält die Uhr an (Paket 4, C13 und U5, 12.11.2026).
 *
 * Vorher lief die Zeitbox in der Coach-Pause weiter. Jetzt merkt der Lauf die Pause: `on:true` setzt `pauseSince`
 * (wenn keine läuft), `on:false` rechnet die Dauer auf `pausedMs` und löscht `pauseSince`. Deckel: höchstens
 * 5 Minuten je Pause und 15 Minuten je Lauf, danach läuft die Uhr von selbst weiter (keine endlose Pause, auch
 * wenn jemand die Seite mit offener Pause verlässt). Gerechnet wird überall mit `gespraechsZeitMs` (zeit.ts).
 * Der Browser ruft die Route beim Öffnen und Schließen der Coach-Pause; doppelte Aufrufe ändern nichts.
 * Keine KI, kein Credit. Im Prüfungsmodus gibt es keine Coach-Pause (wie in der Coach-Route).
 * Antwort: `{ ok: true, pausedMs, pauseSince }`.
 */
export async function POST(req: NextRequest) {
  if (!simulationEnabled()) {
    return NextResponse.json({ ok: false, code: "SIMULATION_DISABLED" }, { status: 503 });
  }
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const rl = checkRateLimit(`sim-pause:${auth.uid}`, 30, 60_000, getApiMessages(req).rateLimited);
  if (rl) return rl;

  try {
    const parsed = requestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
    }
    const { simId, on } = parsed.data;

    const jetzt = Date.now();
    let sperre = null as NextResponse | null;
    const saved = await updateSimulation(auth.uid, simId, (lauf) => {
      sperre = null;
      // Ein Lauf, der ausgewertet wird oder fertig ist, nimmt weder Züge noch Pausen an.
      if (lauf.status !== "active") {
        sperre = NextResponse.json({ ok: false, code: "ALREADY_FINISHED" }, { status: 409 });
        return false;
      }
      // Beenden geht immer (z. B. die Pause des Mikrofon-Checks); beginnen kann man im Prüfungsmodus keine.
      if (on && lauf.mode === "check") {
        sperre = NextResponse.json({ ok: false, code: "CHECK_MODE" }, { status: 409 });
        return false;
      }
      if (!pauseSetzen(lauf, on, jetzt)) return false;
    });
    if (!saved) {
      return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
    }
    if (sperre) return sperre;

    logger.api("/api/simulation/pause", on ? "an" : "aus", { uid: auth.uid, simId, pausedMs: saved.pausedMs ?? 0 });
    return NextResponse.json({ ok: true, pausedMs: saved.pausedMs ?? 0, pauseSince: saved.pauseSince ?? null });
  } catch (err) {
    logger.apiError("/api/simulation/pause", err);
    return NextResponse.json({ ok: false, error: "Internal server error", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
