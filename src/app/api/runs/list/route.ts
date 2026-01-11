// src/app/api/runs/list/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminDb } from "@/lib/firebase-admin";
import * as fs from "node:fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sessionIdSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "sessionId must be url-safe (a-zA-Z0-9_-).");

function getProjectId(): string | null {
  return (
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    null
  );
}

function safeServiceAccountInfo() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) return null;

  try {
    if (!fs.existsSync(credPath)) return { fileExists: false };
    const raw = fs.readFileSync(credPath, "utf8");
    const j = JSON.parse(raw);
    return {
      fileExists: true,
      project_id: j?.project_id ?? null,
      client_email: j?.client_email ?? null,
    };
  } catch (e: any) {
    return { fileExists: null, error: e?.message ?? String(e) };
  }
}

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
  const debug = sp.get("debug") === "1";

  const parsed = sessionIdSchema.safeParse(sessionId);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten(), code: "BAD_SESSION_ID" },
      { status: 400 }
    );
  }

  try {
    const db = getAdminDb();

    const snap = await db
      .collection("sessions")
      .doc(sessionId)
      .collection("runs")
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const runs = snap.docs.map((d) => {
      const data = d.data() as any;

      const analysisJson = data?.analysisJson ?? null;
      const scores = analysisJson?.scores ?? data?.scores ?? null;

      return {
        id: d.id,
        createdAt: toIso(data?.createdAt),
        conversationType: data?.conversationType ?? null,
        conversationSubType: data?.conversationSubType ?? null,
        goal: data?.goal ?? null,
        lang: data?.lang ?? null,
        jurisdiction: data?.jurisdiction ?? null,
        scoreOverall:
          typeof data?.scoreOverall === "number"
            ? data.scoreOverall
            : typeof scores?.overall === "number"
              ? scores.overall
              : null,
        summary:
          typeof data?.summary === "string"
            ? data.summary
            : typeof analysisJson?.summary === "string"
              ? analysisJson.summary
              : null,
        hasTranscript:
          typeof data?.transcriptText === "string" &&
          data.transcriptText.trim().length > 0,
      };
    });

    return NextResponse.json(
      {
        ok: true,
        runs,
        debug: debug
          ? {
              nodeEnv: process.env.NODE_ENV ?? null,
              projectId: getProjectId(),
              has_FIREBASE_PROJECT_ID: !!process.env.FIREBASE_PROJECT_ID,
              has_GOOGLE_APPLICATION_CREDENTIALS:
                !!process.env.GOOGLE_APPLICATION_CREDENTIALS,
              googleCredPath: process.env.GOOGLE_APPLICATION_CREDENTIALS ?? null,
              has_SERVICE_ACCOUNT_JSON: !!process.env.SERVICE_ACCOUNT_JSON,
              has_FIREBASE_SERVICE_ACCOUNT_JSON: !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
              serviceAccountInfo: safeServiceAccountInfo(),
            }
          : undefined,
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
