import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z
  .object({
    transcriptText: z.string().min(1),
    lang: z.string().optional(),
    leaderLabel: z.string().optional().nullable(),
    employeeLabel: z.string().optional().nullable(),
  })
  .passthrough();

export async function POST(req: Request) {
  const url = new URL(req.url);
  const debug = url.searchParams.get("debug") === "1";

  try {
    const json = await req.json();
    const parsed = requestSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const d = parsed.data;

    // Lazy import -> falls score-competencies kaputt ist, crasht nicht die ganze App beim Laden
    const mod: any = await import("../../../ai/flows/score-competencies");

    if (typeof mod.scoreCompetencies !== "function") {
      return NextResponse.json(
        { ok: false, error: "scoreCompetencies export missing" },
        { status: 500 }
      );
    }

    const result = await mod.scoreCompetencies({
      transcriptText: d.transcriptText,
      lang: d.lang,
      leaderLabel: d.leaderLabel ?? undefined,
      employeeLabel: d.employeeLabel ?? undefined,
    });

    return NextResponse.json({ ok: true, result }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: err?.message ?? String(err),
        ...(debug ? { stack: err?.stack ?? null } : {}),
      },
      { status: 500 }
    );
  }
}
