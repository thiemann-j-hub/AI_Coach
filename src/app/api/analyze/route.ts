// src/app/api/analyze/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { generateDynamicFeedback } from "../../../ai/flows/generate-dynamic-feedback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  conversationType: z.string().min(1),
  conversationSubType: z.string().optional().nullable(),
  goal: z.string().optional().nullable(),
  transcriptText: z.string().min(1),
  lang: z.string().optional(),
  jurisdiction: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const parsed = requestSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const {
      conversationType,
      conversationSubType,
      goal,
      transcriptText,
      lang,
      jurisdiction,
    } = parsed.data;

    const result = await generateDynamicFeedback({
      conversationType,
      conversationSubType: conversationSubType ?? undefined,
      goal: goal ?? undefined,
      transcriptText,
      lang,
      jurisdiction,
    });

    return NextResponse.json({ ok: true, result }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
