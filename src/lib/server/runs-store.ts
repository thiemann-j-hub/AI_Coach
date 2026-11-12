import "server-only";

import crypto from "crypto";
import {
  queryItems,
  readItem,
  replaceItemIfMatch,
  runsContainer,
  sessionsContainer,
  upsertItem,
} from "@/lib/cosmos";
import { logger } from "@/lib/logger";
import {
  hasObservableMetric,
  metricsFromCompetencyRatings,
} from "@/lib/radar-contract";

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
  /**
   * Nur Altbestand (bis 12.11.2026): „Löschen“ markierte den Lauf nur. Seit S1 entfernt /api/runs/delete das Dokument.
   * Markierte Dokumente aus der Zeit davor gelten überall als nicht vorhanden; `scripts/analysen-aufraeumen.mts`
   * räumt sie weg. `refundPending: true` hieß: Die Rückgabe beim Löschen ist gescheitert (nachgeholt hat sie nie jemand).
   */
  deleted?: boolean;
  deletedAt?: string;
  refundPending?: boolean;
  /** Workspace, dem dieser Run zugeordnet ist (fuer den Refund). */
  workspaceId?: string;
  /** transactionId der zentralen spend-Buchung (CREDITS_CENTRAL): Pflicht-Anker
   *  fuer den zentralen Refund beim Loeschen. Nur gesetzt, wenn zentral verbraucht. */
  centralSpendTxId?: string | null;
  /** Version des Dokuments (Cosmos-Systemfeld, kommt beim Lesen mit). */
  _etag?: string;
}

/**
 * Feste Partitionsnamen anderer Dokumentarten im Container `runs`, die auf das Muster einer Sitzungskennung passen
 * (B3, Go-Live-Prüfung 12.11.2026). Sie gelten nie als Sitzung. Alle übrigen Dokumentarten tragen einen Doppelpunkt
 * in der Partition (`sim:…`, `simscn:…`, `intv:…`, `wish:…`, `buchung:…`) und scheitern schon am Muster.
 * Kommt eine Dokumentart mit festem Partitionsnamen ohne Doppelpunkt dazu, gehört ihr Name hierher.
 */
const RESERVED_SESSION_IDS: ReadonlySet<string> = new Set(["spielbuch"]);

export function isReservedSessionId(sessionId: string): boolean {
  return RESERVED_SESSION_IDS.has(sessionId);
}

/**
 * Wem gehört die Sitzung? (B3) Vorher galt eine Sitzung ohne Dokument als erlaubt; über die feste Partition
 * `spielbuch` ließen sich so Kennungen fremder Szenarien lesen.
 *  - `own`      Das Sitzungsdokument existiert und trägt die Kennung der Person.
 *  - `missing`  Es gibt kein Sitzungsdokument (frische Sitzung ohne Analyse): nichts zu lesen, nichts zu ändern.
 *  - `foreign`  Die Sitzung gehört einer anderen Person, trägt keine Kennung oder ist ein reservierter Name.
 */
export type SessionAccess = "own" | "missing" | "foreign";

export async function sessionAccess(sessionId: string, uid: string): Promise<SessionAccess> {
  if (isReservedSessionId(sessionId)) return "foreign";
  const session = await readItem<SessionDoc>(sessionsContainer(), sessionId, sessionId);
  if (!session) return "missing";
  return session.uid === uid ? "own" : "foreign";
}

/**
 * Sitzung für die Person sichern: legt das Sitzungsdokument an, wenn es fehlt. NUR für die erste Analyse einer
 * neuen Sitzung (/api/analyze); kein anderer Weg legt Sitzungen an. false = die Sitzung gehört nicht der Person.
 */
export async function claimSession(sessionId: string, uid: string): Promise<boolean> {
  const access = await sessionAccess(sessionId, uid);
  if (access === "foreign") return false;
  if (access === "missing") {
    await upsertItem(sessionsContainer(), { id: sessionId, uid, updatedAt: new Date().toISOString() });
  }
  return true;
}

/**
 * Vorhandenen Lauf ersetzen, aber nur, wenn er seit dem Lesen unverändert da ist (Versionsprüfung). false = er wurde
 * inzwischen gelöscht (404) oder geändert (412). So entsteht ein zugleich gelöschter (und erstatteter) Lauf durch
 * ein spätes Schreiben nicht neu. Ohne Version (nur in Tests ohne Cosmos) wird wie früher geschrieben.
 */
async function replaceIfUnchanged<T extends { id: string }>(doc: T, sessionId: string, etag: string | undefined): Promise<boolean> {
  if (!etag) {
    await upsertItem(runsContainer(), doc);
    return true;
  }
  try {
    await replaceItemIfMatch(runsContainer(), doc, sessionId, etag);
    return true;
  } catch (err: any) {
    if (err?.code === 404 || err?.code === 412) return false;
    throw err;
  }
}

/**
 * Lauf speichern (/api/runs/save). `existing` ist der schon vorhandene Lauf derselben Kennung (meist der Schatten-Lauf
 * aus /api/analyze): Sein `createdAt` BLEIBT (B2). Vorher bekam jeder erneut gespeicherte Lauf den Zeitpunkt „jetzt“,
 * und das Rückgabe-Fenster von 10 Minuten ging für jede je bezahlte Analyse wieder auf.
 * Ein vorhandener Lauf wird nur ersetzt, wenn er seit dem Lesen unverändert da ist (Versionsprüfung): Wird er
 * zugleich gelöscht (und der Credit zurückgegeben), entsteht er hier nicht neu. Dann ist die Antwort null.
 */
export async function saveRun(
  run: Omit<RunDoc, "id" | "createdAt">,
  opts: {
    /** Optionale, serverseitig vorab erzeugte runId (bindet Buchung und Rückgabe an den Lauf). */
    runId?: string;
    existing?: RunDoc | null;
  } = {}
): Promise<string | null> {
  const existing = opts.existing ?? null;
  const id =
    existing?.id ?? (opts.runId && /^[A-Za-z0-9_-]{8,128}$/.test(opts.runId) ? opts.runId : crypto.randomUUID());
  const doc = {
    ...run,
    id,
    // Ein vorhandener Lauf behält seinen Zeitpunkt, auch wenn er (Altbestand) keinen trägt: nie „jetzt“ erfinden.
    ...(existing ? (existing.createdAt ? { createdAt: existing.createdAt } : {}) : { createdAt: new Date().toISOString() }),
  };
  if (existing) return (await replaceIfUnchanged(doc, run.sessionId, existing._etag)) ? id : null;
  await upsertItem(runsContainer(), doc);
  return id;
}

/** Roher Punkt-Lesezugriff ohne Besitzprüfung. Für Lesen, Bewerten und Löschen `getOwnRun` nehmen. */
export async function getRun(
  sessionId: string,
  runId: string
): Promise<RunDoc | null> {
  return readItem<RunDoc>(runsContainer(), runId, sessionId);
}

/**
 * Lauf der Person (B3): null, wenn es ihn nicht gibt, wenn er einer anderen Person gehört oder wenn er (Altbestand)
 * als gelöscht markiert ist. Die Sitzung prüft der Aufrufer vorher mit `sessionAccess`.
 */
export async function getOwnRun(sessionId: string, runId: string, uid: string): Promise<RunDoc | null> {
  const run = await getRun(sessionId, runId);
  if (!run || run.uid !== uid || run.deleted === true) return null;
  return run;
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
}): Promise<{ ok: boolean; reason?: "id_conflict"; createdAt?: string }> {
  // createdAt wird zurueckgegeben, damit der Radar-Emit ts = runDoc.createdAt
  // setzen kann (gelockte Zeitstabilitaet — NIE Date.now im Radar-Event).
  const existing = await getRun(args.sessionId, args.runId);
  if (existing) {
    // Bereits vorhanden: nur fortfahren, wenn es derselbe Owner ist.
    if (existing.uid !== args.uid) return { ok: false, reason: "id_conflict" };
    return { ok: true, createdAt: existing.createdAt };
  }
  const createdAt = new Date().toISOString();
  try {
    await upsertItem(runsContainer(), {
      id: args.runId,
      sessionId: args.sessionId,
      uid: args.uid,
      workspaceId: args.workspaceId,
      centralSpendTxId: args.centralSpendTxId ?? null,
      createdAt,
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
  } catch (e) {
    // B1 (Go-Live-Prüfung 12.11.2026): Scheitert das Schreiben, bucht /api/analyze zurück. Kam die Schreibung trotz
    // Fehlermeldung an (Frist), läge sonst ein Lauf mit Ergebnis ohne Credit im Verlauf. Deshalb wieder entfernen;
    // der ursprüngliche Fehler geht weiter.
    await deleteRun(args.sessionId, args.runId).catch((e2) =>
      logger.error("[analyse] Schatten-Lauf nach Schreibfehler nicht entfernt – er kann ohne Buchung im Verlauf liegen", {
        runId: args.runId,
        err: e2 instanceof Error ? e2.message : String(e2),
      })
    );
    throw e;
  }
  return { ok: true, createdAt };
}

/**
 * Neueste Runs einer Session, Cursor = runId des letzten Eintrags der
 * Vorseite (API-Vertrag unverändert). Positionierung über dessen createdAt.
 * Transkript wird nicht mitgeladen (RU-/Payload-Ersparnis).
 * B3 (12.11.2026): nur Läufe der Person (`c.uid = @uid`), auch der Cursor muss ihr gehören. Die Sitzung prüft der
 * Aufrufer vorher mit `sessionAccess`.
 */
export async function listRuns(
  sessionId: string,
  uid: string,
  limit: number,
  cursorRunId?: string | null
): Promise<{ runs: any[]; hasMore: boolean; nextCursor: string | null; badCursor?: boolean }> {
  let cursorCreatedAt: string | null = null;
  if (cursorRunId) {
    const cursorRun = await getOwnRun(sessionId, cursorRunId, uid);
    if (!cursorRun) return { runs: [], hasMore: false, nextCursor: null, badCursor: true };
    cursorCreatedAt = cursorRun.createdAt;
  }

  // Altbestand: bis 12.11.2026 nur als gelöscht markierte Läufe (deleted=true) NICHT listen.
  const notDeleted = "(NOT IS_DEFINED(c.deleted) OR c.deleted = false)";
  const where = cursorCreatedAt
    ? `c.sessionId = @sid AND c.uid = @uid AND c.createdAt < @cursor AND ${notDeleted}`
    : `c.sessionId = @sid AND c.uid = @uid AND ${notDeleted}`;
  const params = [
    { name: "@sid", value: sessionId },
    { name: "@uid", value: uid },
    ...(cursorCreatedAt ? [{ name: "@cursor", value: cursorCreatedAt }] : []),
  ];

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
 * Lauf wirklich löschen (S1, 12.11.2026): Zusammenfassung, Zitate und gespeichertes Transkript sind danach weg.
 * Vorher blieb das Dokument mit `deleted: true` liegen; den in den Kommentaren genannten Nachlauf, der es später
 * weggeräumt oder eine gescheiterte Rückgabe nachgeholt hätte, gab es nie.
 * true = DIESER Aufruf hat das Dokument entfernt. false = es war schon weg (zweiter Klick, zweiter Tab): Der
 * Aufrufer gibt dann keinen Credit zurück.
 */
export async function deleteRun(sessionId: string, runId: string): Promise<boolean> {
  try {
    await runsContainer().item(runId, sessionId).delete();
    return true;
  } catch (err: any) {
    if (err?.code === 404) return false;
    throw err;
  }
}

/**
 * Rating per Lesen-Ändern-Ersetzen (Cosmos hat kein Feld-merge wie Firestore). Nur am eigenen Lauf (B3), und nur,
 * wenn er seit dem Lesen unverändert da ist: Eine zugleich gelöschte Analyse entsteht durch die Bewertung nicht neu.
 * Hat inzwischen jemand anderes geschrieben (zwei schnelle Klicks), wird neu gelesen und wiederholt.
 */
export async function rateRun(
  sessionId: string,
  runId: string,
  uid: string,
  rating: number
): Promise<boolean> {
  for (let versuch = 0; versuch < 3; versuch++) {
    const run = await getOwnRun(sessionId, runId, uid);
    if (!run) return false;
    if (await replaceIfUnchanged({ ...run, rating, ratedAt: new Date().toISOString() }, sessionId, run._etag)) return true;
  }
  return false;
}

/** Schlanke Vorgänger-Info fuer die Delta-Card (P0-1). */
export interface PreviousMeasuredRun {
  runId: string;
  createdAt: string;
  conversationType: string | null;
  conversationSubType: string | null;
  competencyRatings: unknown;
}

/**
 * Findet den VORGÄNGER-Messlauf fuer die Delta-Card — gelockte Definition
 * (Plattform-Bedingung B): der juengste Run (ohne als gelöscht markierten Altbestand) DESSELBEN Subjekts
 * (uid, nur eigene Runs) VOR dem aktuellen Lauf, der einen beobachtbaren
 * Messpunkt traegt (hasObservableMetric ueber metricsFromCompetencyRatings —
 * exakt das Kriterium, mit dem radar-emit emittiert → Report-Delta ≡
 * Radar-Delta per Konstruktion). Failed/Draft-Laeufe ohne Ratings fallen
 * dadurch automatisch heraus.
 *
 * Cross-Partition-Query (pk ist /sessionId, der Verlauf eines Subjekts spannt
 * Sessions) — TOP 15 juengste Kandidaten, dann JS-Filter auf Beobachtbarkeit.
 */
export async function findPreviousMeasuredRun(
  uid: string,
  beforeCreatedAt: string,
  excludeRunId: string
): Promise<PreviousMeasuredRun | null> {
  const rows = await queryItems<{
    id: string;
    createdAt: string;
    conversationType?: string | null;
    conversationSubType?: string | null;
    competency_ratings?: unknown;
  }>(
    runsContainer(),
    `SELECT TOP 15 c.id, c.createdAt, c.conversationType, c.conversationSubType,
            c.analysisJson.competency_ratings AS competency_ratings
     FROM c
     WHERE c.uid = @uid AND c.id != @excludeRunId AND c.createdAt < @before
       AND (NOT IS_DEFINED(c.deleted) OR c.deleted = false)
     ORDER BY c.createdAt DESC`,
    [
      { name: "@uid", value: uid },
      { name: "@excludeRunId", value: excludeRunId },
      { name: "@before", value: beforeCreatedAt },
    ]
  );
  for (const r of rows) {
    if (!r?.createdAt) continue;
    if (hasObservableMetric(metricsFromCompetencyRatings(r.competency_ratings))) {
      return {
        runId: r.id,
        createdAt: r.createdAt,
        conversationType: r.conversationType ?? null,
        conversationSubType: r.conversationSubType ?? null,
        competencyRatings: r.competency_ratings ?? [],
      };
    }
  }
  return null;
}
