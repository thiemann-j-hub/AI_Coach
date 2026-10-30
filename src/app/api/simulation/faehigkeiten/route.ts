import { NextRequest, NextResponse } from "next/server";
import { FAEHIGKEITEN, faehigkeitText } from "@/lib/simulation/faehigkeiten";
import { SIMULATION_SCENARIOS } from "@/lib/simulation/scenarios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Welle 5 (Owner-GO 30.10.2026, N4-240): öffentliche, statische Fähigkeiten-Bibliothek für den Hub
 * (Team-Bild: Titel je Fähigkeit und die Standard-Szenarien, die sie üben). Keine Nutzerdaten, keine DNA —
 * nur Katalogwissen, deshalb ohne Anmeldung und cachebar. SSOT bleibt `faehigkeiten.ts`.
 *   GET /api/simulation/faehigkeiten?locale=de|en
 */
export async function GET(req: NextRequest) {
  // 22 Sprachen: de/en aus der Bibliothek, die übrigen aus faehigkeiten-i18n.json (Rückfall Englisch).
  const locale = (req.nextUrl.searchParams.get("locale") ?? "de").trim().toLowerCase().slice(0, 2) || "de";
  const szenarienJe = new Map<string, Array<{ id: string; title: string; category: string; difficulty: number }>>();
  for (const s of SIMULATION_SCENARIOS) {
    if (s.variante) continue; // Varianten teilen die Anker ihres Grundszenarios
    for (const c of s.assessment.competencies) {
      const list = szenarienJe.get(c.key) ?? [];
      list.push({ id: s.id, title: s.title, category: s.category, difficulty: s.difficulty });
      szenarienJe.set(c.key, list);
    }
  }
  const faehigkeiten = FAEHIGKEITEN.map((f) => ({
    id: f.id,
    gruppe: f.gruppe,
    ...faehigkeitText(f, locale),
    szenarien: (szenarienJe.get(f.id) ?? []).sort((a, b) => a.difficulty - b.difficulty),
  }));
  return NextResponse.json(
    { ok: true, locale, faehigkeiten },
    { headers: { "Cache-Control": "public, max-age=600, s-maxage=600" } }
  );
}
