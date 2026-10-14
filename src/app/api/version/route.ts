/**
 * W1-3 / W1-9 (LXT-Welle W1, Owner-GO 14.10.2026): Version und Schalterstand für den
 * Fehlerbericht (und später „neue Version erkennen“). Nur Schalternamen mit on/off/set/unset,
 * nie Werte, nie Geheimnisse. Rückweg: DIAGNOSE_REPORT=off → `diagnose:false`.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SWITCHES = [
  "AI_ERROR_CONTRACT",
  "REQUEST_ID_IN_UI",
  "DIAGNOSE_REPORT",
  "GEMINI_BACKEND",
  "VERTEX_LOCATION",
  "COACH_PREFLIGHT",
  "CREDITS_CENTRAL",
  "SIMULATION_ENABLED",
];

function switchState(name: string): string {
  const v = (process.env[name] ?? "").trim().toLowerCase();
  if (!v) return "unset";
  if (v === "off" || v === "false" || v === "0") return "off";
  if (v === "on" || v === "true" || v === "1") return "on";
  return "set";
}

export function GET() {
  const diagnose = (process.env.DIAGNOSE_REPORT ?? "").trim().toLowerCase() !== "off";
  return NextResponse.json(
    {
      service: "coach",
      sha:
        process.env.BUILD_SHA ??
        (process.env.NEXT_PUBLIC_BUILD_SHA ? process.env.NEXT_PUBLIC_BUILD_SHA.slice(0, 7) : "unstamped"),
      branch: process.env.BUILD_BRANCH ?? null,
      builtAt: process.env.BUILD_STAMPED_AT ?? null,
      diagnose,
      // W1-9: Banner „neue Version“ abschaltbar (VERSION_BANNER=off).
      banner: (process.env.VERSION_BANNER ?? "").trim().toLowerCase() !== "off",
      switches: Object.fromEntries(SWITCHES.map((n) => [n, switchState(n)])),
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
