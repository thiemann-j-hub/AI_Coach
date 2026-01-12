// src/app/api/runs/get/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sessionIdSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "sessionId must be url-safe (a-zA-Z0-9_-).");

const runIdSchema = z.string().min(1).max(256);

function toIso(v: any): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (v?.toDate) {
    try {
      return v.toDate().toISOString();
    } catch {
      return null;
    }
  }
  if (v instanceof Date) return v.toISOString();
  return null;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sessionId = sp.get("sessionId") ?? "";
  const runId = sp.get("runId") ?? "";

  const p1 = sessionIdSchema.safeParse(sessionId);
  if (!p1.success) {
    return NextResponse.json(
      { ok: false, error: p1.error.flatten(), code: "BAD_SESSION_ID" },
      { status: 400 }
    );
  }

  const p2 = runIdSchema.safeParse(runId);
  if (!p2.success) {
    return NextResponse.json(
      { ok: false, error: p2.error.flatten(), code: "BAD_RUN_ID" },
      { status: 400 }
    );
  }

  try {
    const db = getAdminDb();
    const ref = db
      .collection("sessions")
      .doc(sessionId)
      .collection("runs")
      .doc(runId);

    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json(
        { ok: false, error: "Run not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    const data = snap.data() as any;

    return NextResponse.json(
      {
        ok: true,
        run: {
          id: snap.id,
          createdAt: toIso(data?.createdAt),
          conversationType: data?.conversationType ?? null,
          conversationSubType: data?.conversationSubType ?? null,
          goal: data?.goal ?? null,
          lang: data?.lang ?? null,
          jurisdiction: data?.jurisdiction ?? null,
          transcriptText: data?.transcriptText ?? null,
          analysisJson: data?.analysisJson ?? null,
          ragContext: data?.ragContext ?? null,
          scoreOverall: data?.scoreOverall ?? data?.analysisJson?.scores?.overall ?? null,
          summary: data?.summary ?? data?.analysisJson?.summary ?? null,
        },
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: err?.message ?? String(err),
        code: err?.code ?? null,
        details: err?.details ?? null,
      },
      { status: 500 }
    );
  }
}
