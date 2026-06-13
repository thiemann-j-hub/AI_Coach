import "server-only";

import crypto from "crypto";
import {
  queryItems,
  readItem,
  runsContainer,
  sessionsContainer,
  upsertItem,
} from "@/lib/cosmos";

/**
 * Datenzugriff für Sessions + Runs (Cosmos DB, ersetzt Firestore-Subcollections).
 *
 * Modell:
 *   sessions (pk /id):        { id: sessionId, uid, updatedAt }
 *   runs     (pk /sessionId): { id: runId, sessionId, uid, createdAt(ISO), ... }
 *
 * createdAt ist ein ISO-String (Cosmos hat keinen Timestamp-Typ) — die
 * Clients verarbeiten Strings bereits (toIso-Pfade).
 */

export interface SessionDoc {
  id: string;
  uid: string;
  updatedAt: string;
}

export interface RunDoc {
  id: string;
  sessionId: string;
  uid: string;
  createdAt: string;
  conversationType: string;
  conversationSubType: string | null;
  goal: string | null;
  lang: string | null;
  jurisdiction: string | null;
  transcriptText: string | null;
  analysisJson: any;
  ragContext: any;
  summary: string | null;
  scoreOverall: number | null;
  rating?: number;
  ratedAt?: string;
}

/**
 * Ownership wie zuvor: existiert die Session und gehört einem anderen User →
 * verboten. Existiert sie nicht → erlaubt (wird beim Save angelegt).
 */
export async function checkSessionOwnership(
  sessionId: string,
  uid: string
): Promise<{ allowed: boolean }> {
  const session = await readItem<SessionDoc>(sessionsContainer(), sessionId, sessionId);
  if (session?.uid && session.uid !== uid) return { allowed: false };
  return { allowed: true };
}

export async function upsertSession(sessionId: string, uid: string): Promise<void> {
  await upsertItem(sessionsContainer(), {
    id: sessionId,
    uid,
    updatedAt: new Date().toISOString(),
  });
}

export async function createRun(
  run: Omit<RunDoc, "id" | "createdAt">
): Promise<string> {
  const id = crypto.randomUUID();
  await upsertItem(runsContainer(), {
    id,
    createdAt: new Date().toISOString(),
    ...run,
  });
  return id;
}

export async function getRun(
  sessionId: string,
  runId: string
): Promise<RunDoc | null> {
  return readItem<RunDoc>(runsContainer(), runId, sessionId);
}

/**
 * Neueste Runs einer Session, Cursor = runId des letzten Eintrags der
 * Vorseite (API-Vertrag unverändert). Positionierung über dessen createdAt.
 * Transkript wird nicht mitgeladen (RU-/Payload-Ersparnis).
 */
export async function listRuns(
  sessionId: string,
  limit: number,
  cursorRunId?: string | null
): Promise<{ runs: any[]; hasMore: boolean; nextCursor: string | null; badCursor?: boolean }> {
  let cursorCreatedAt: string | null = null;
  if (cursorRunId) {
    const cursorRun = await getRun(sessionId, cursorRunId);
    if (!cursorRun) return { runs: [], hasMore: false, nextCursor: null, badCursor: true };
    cursorCreatedAt = cursorRun.createdAt;
  }

  const where = cursorCreatedAt
    ? "c.sessionId = @sid AND c.createdAt < @cursor"
    : "c.sessionId = @sid";
  const params = cursorCreatedAt
    ? [
        { name: "@sid", value: sessionId },
        { name: "@cursor", value: cursorCreatedAt },
      ]
    : [{ name: "@sid", value: sessionId }];

  // limit+1 für hasMore; Projektion ohne transcriptText/analysisJson-Vollkörper
  const rows = await queryItems<any>(
    runsContainer(),
    `SELECT TOP ${limit + 1} c.id, c.createdAt, c.conversationType, c.conversationSubType,
            c.goal, c.lang, c.jurisdiction, c.scoreOverall, c.summary,
            c.analysisJson.scores.overall AS scoresOverall,
            c.analysisJson.summary AS analysisSummary,
            IS_STRING(c.transcriptText) AND LENGTH(c.transcriptText) > 0 AS hasTranscript
     FROM c WHERE ${where} ORDER BY c.createdAt DESC`,
    params
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const runs = page.map((r) => ({
    id: r.id,
    createdAt: r.createdAt ?? null,
    conversationType: r.conversationType ?? null,
    conversationSubType: r.conversationSubType ?? null,
    goal: r.goal ?? null,
    lang: r.lang ?? null,
    jurisdiction: r.jurisdiction ?? null,
    scoreOverall:
      typeof r.scoreOverall === "number"
        ? r.scoreOverall
        : typeof r.scoresOverall === "number"
          ? r.scoresOverall
          : null,
    summary:
      typeof r.summary === "string"
        ? r.summary
        : typeof r.analysisSummary === "string"
          ? r.analysisSummary
          : null,
    hasTranscript: r.hasTranscript === true,
  }));

  const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].id : null;
  return { runs, hasMore, nextCursor };
}

/** Rating per Read-Modify-Upsert (Cosmos hat kein Feld-merge wie Firestore). */
export async function rateRun(
  sessionId: string,
  runId: string,
  rating: number
): Promise<boolean> {
  const run = await getRun(sessionId, runId);
  if (!run) return false;
  await upsertItem(runsContainer(), {
    ...run,
    rating,
    ratedAt: new Date().toISOString(),
  });
  return true;
}
