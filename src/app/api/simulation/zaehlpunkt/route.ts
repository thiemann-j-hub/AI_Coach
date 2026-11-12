import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getApiMessages } from "@/lib/server/get-request-locale";
import { zaehlpunkt } from "@/lib/server/trichter";
import { simulationEnabled } from "@/lib/simulation/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  schritt: z.enum(["briefing", "mikro_ok", "mikro_verweigert"]),
  // Nur die Zeichen der Szenario-Kennungen (sim-…, ws-…): So kommt kein freier Text ins Protokoll.
  scenarioId: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9_-]+$/),
  weg: z.enum(["sprechen", "schreiben"]).optional(),
});

/**
 * POST { schritt, scenarioId, weg? }: Zählpunkt aus dem Browser (Paket 4, S24, 12.11.2026).
 *
 * Drei der Zählpunkte entstehen im Browser: Briefing geöffnet, Mikrofon-Check bestanden, Mikrofon verweigert.
 * Die Route schreibt dafür genau eine Protokollzeile (trichter.ts), ohne Nutzertext und ohne Kennung der Person.
 * `start` und `erstes_wort` schreiben Start-Route, Zug-Route und Relais selbst. Höchstens 30 je Minute je Person.
 * Keine Ablage, keine KI, kein Credit. Antwort: `{ ok: true }`.
 */
export async function POST(req: NextRequest) {
  if (!simulationEnabled()) {
    return NextResponse.json({ ok: false, code: "SIMULATION_DISABLED" }, { status: 503 });
  }
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const rl = checkRateLimit(`sim-zaehlpunkt:${auth.uid}`, 30, 60_000, getApiMessages(req).rateLimited);
  if (rl) return rl;

  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }
  zaehlpunkt(parsed.data.schritt, parsed.data.scenarioId, parsed.data.weg);
  return NextResponse.json({ ok: true });
}
