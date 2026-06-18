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
  /** Soft-Delete (Credit-Refund-Pfad): markiert statt hart geloescht, bis der Refund verbucht ist. */
  deleted?: boolean;
  deletedAt?: string;
  /** true, solange der Credit-Refund fuer diesen geloeschten Run noch aussteht (v1-Sweep-Backstop). */
  refundPending?: boolean;
  /** Workspace, dem dieser Run zugeordnet ist (fuer den Refund). */
  workspaceId?: string;
  /** transactionId der zentralen spend-Buchung (CREDITS_CENTRAL): Pflicht-Anker
   *  fuer den zentralen Refund beim Loeschen. Nur gesetzt, wenn zentral verbraucht. */
  centralSpendTxId?: string | null;
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
  run: Omit<RunDoc, "id" | "createdAt">,
  /** Optionale, serverseitig vorab erzeugte runId (Credit-Hold-Bindung: hold/refund:{runId}). */
  providedId?: string
): Promise<string> {
  const id = providedId && /^[A-Za-z0-9_-]{8,128}$/.test(providedId) ? providedId : crypto.randomUUID();
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
 * Schatten-Persistenz bei Credit-Verbrauch: legt den Run-Record OHNE Transkript
 * (DSGVO-Datenminimierung) unter der vorab erzeugten runId an, sofern er noch
 * nicht existiert. Garantiert die Invariante "Credit verbraucht => Run
 * existiert" und damit den universellen Delete/Refund-Pfad. Spaeteres
 * /api/runs/save reichert denselben Run idempotent an (Transkript bei Opt-in).
 *
 * Bindet zugleich runId an sessionId+uid: existiert die runId bereits unter
 * EINER ANDEREN Session/uid, wird sie verworfen (Injection-Schutz).
 */
export async function persistShadowRun(args: {
  sessionId: string;
  runId: string;
  uid: string;
  workspaceId: string;
  centralSpendTxId?: string | null;
  conversationType: string;
  conversationSubType?: string | null;
  goal?: string | null;
  lang?: string | null;
  jurisdiction?: string | null;
  analysisJson: any;
  summary?: string | null;
  scoreOverall?: number | null;
}): Promise<{ ok: boolean; reason?: "id_conflict" }> {
  const existing = await getRun(args.sessionId, args.runId);
  if (existing) {
    // Bereits vorhanden: nur fortfahren, wenn es derselbe Owner ist.
    if (existing.uid !== args.uid) return { ok: false, reason: "id_conflict" };
    return { ok: true };
  }
  await upsertItem(runsContainer(), {
    id: args.runId,
    sessionId: args.sessionId,
    uid: args.uid,
    workspaceId: args.workspaceId,
    centralSpendTxId: args.centralSpendTxId ?? null,
    createdAt: new Date().toISOString(),
    conversationType: args.conversationType,
    conversationSubType: args.conversationSubType ?? null,
    goal: args.goal ?? null,
    lang: args.lang ?? null,
    jurisdiction: args.jurisdiction ?? null,
    transcriptText: null, // Schatten: kein Transkript
    analysisJson: args.analysisJson,
    ragContext: null,
    summary: args.summary ?? null,
    scoreOverall: args.scoreOverall ?? null,
  });
  return { ok: true };
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

  // Soft-geloeschte Runs (deleted=true) NICHT listen. Aeltere Runs ohne das
  // Feld bleiben sichtbar (IS_DEFINED-Guard).
  const notDeleted = "(NOT IS_DEFINED(c.deleted) OR c.deleted = false)";
  const where = cursorCreatedAt
    ? `c.sessionId = @sid AND c.createdAt < @cursor AND ${notDeleted}`
    : `c.sessionId = @sid AND ${notDeleted}`;
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

/**
 * Soft-Delete eines Runs (Credit-Refund-Pfad). Markiert statt hart zu loeschen,
 * damit der refundPending-Sweep (v1-Backstop) einen nicht inline verbuchten
 * Refund nachholen kann. Gibt den (vorherigen) Run zurueck, oder null.
 */
export async function markRunDeleted(
  sessionId: string,
  runId: string,
  refundPending: boolean
): Promise<RunDoc | null> {
  const run = await getRun(sessionId, runId);
  if (!run) return null;
  await upsertItem(runsContainer(), {
    ...run,
    deleted: true,
    deletedAt: new Date().toISOString(),
    refundPending,
  });
  return run;
}

/** Markiert den Refund eines geloeschten Runs als verbucht (refundPending=false). */
export async function clearRunRefundPending(sessionId: string, runId: string): Promise<void> {
  const run = await getRun(sessionId, runId);
  if (!run) return;
  if (run.refundPending !== true) return;
  await upsertItem(runsContainer(), { ...run, refundPending: false });
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
