import "server-only";

import { deleteItem, queryItems, readItem, runsContainer, upsertItem } from "@/lib/cosmos";
import type { InterviewLocale, InterviewTurn } from "@/lib/interview/pilot";

/**
 * Welle 6: Interview-Docs im runs-Container (kein neuer Container, Muster Simulations-/Szenario-Docs).
 * PK `intv:${workspaceId}` — der Bericht liest alle Interviews eines Kurses im Mandanten aus EINER Partition;
 * die Person ist über uid im Doc (Löschrecht, Zuordnung), der Bericht nennt sie nie.
 */
export const INTERVIEW_DOC_TYPE = "interview" as const;
export const INTERVIEW_BERICHT_DOC_TYPE = "interview_bericht" as const;

export interface InterviewDoc {
  id: string;
  sessionId: string; // `intv:${workspaceId}`
  docType: typeof INTERVIEW_DOC_TYPE;
  workspaceId: string;
  uid: string;
  definitionId: string;
  kurs: { id: string; titel: string };
  locale: InterviewLocale;
  status: "active" | "finished";
  turns: InterviewTurn[];
  /** Aktuelle Frage (1-basiert) und Zahl der Nachfragen dazu. */
  frageNr: number;
  nachfragen: number;
  /** Alle Fragen beantwortet — wartet auf „Abschließen“. */
  fertig: boolean;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  centralSpendTxId?: string | null;
}

export interface InterviewBerichtDoc {
  id: string; // `bericht:${kursId}`
  sessionId: string;
  docType: typeof INTERVIEW_BERICHT_DOC_TYPE;
  workspaceId: string;
  kursId: string;
  /** Zahl der Interviews, aus denen der Bericht entstand — weicht sie ab, wird neu erzeugt. */
  anzahl: number;
  locale: InterviewLocale;
  bericht: unknown;
  createdAt: string;
}

export function interviewPartitionKey(workspaceId: string): string {
  return `intv:${workspaceId}`;
}

export async function createInterview(doc: Omit<InterviewDoc, "sessionId" | "docType">): Promise<InterviewDoc> {
  const full: InterviewDoc = { ...doc, sessionId: interviewPartitionKey(doc.workspaceId), docType: INTERVIEW_DOC_TYPE };
  await upsertItem(runsContainer(), full);
  return full;
}

export async function readInterview(workspaceId: string, id: string): Promise<InterviewDoc | null> {
  const doc = await readItem<InterviewDoc>(runsContainer(), id, interviewPartitionKey(workspaceId));
  return doc?.docType === INTERVIEW_DOC_TYPE ? doc : null;
}

export async function saveInterview(doc: InterviewDoc): Promise<void> {
  await upsertItem(runsContainer(), { ...doc, updatedAt: new Date().toISOString() });
}

export async function deleteInterview(workspaceId: string, id: string): Promise<void> {
  await deleteItem(runsContainer(), id, interviewPartitionKey(workspaceId));
}

/** Abgeschlossene Interviews eines Kurses (für den Bericht; nur Texte werden weitergegeben). */
export async function listFinishedInterviews(workspaceId: string, kursId: string): Promise<InterviewDoc[]> {
  return queryItems<InterviewDoc>(
    runsContainer(),
    "SELECT * FROM c WHERE c.sessionId = @pk AND c.docType = @dt AND c.status = 'finished' AND c.kurs.id = @k ORDER BY c.finishedAt ASC",
    [
      { name: "@pk", value: interviewPartitionKey(workspaceId) },
      { name: "@dt", value: INTERVIEW_DOC_TYPE },
      { name: "@k", value: kursId },
    ]
  );
}

/** Kurse mit Interviews im Workspace, mit Zählern (für die Admin-Übersicht). */
export async function listInterviewKurse(workspaceId: string): Promise<Array<{ id: string; titel: string; fertig: number; offen: number; letzte: string | null }>> {
  const rows = await queryItems<{ kurs: { id: string; titel: string }; status: string; finishedAt?: string }>(
    runsContainer(),
    "SELECT c.kurs, c.status, c.finishedAt FROM c WHERE c.sessionId = @pk AND c.docType = @dt",
    [
      { name: "@pk", value: interviewPartitionKey(workspaceId) },
      { name: "@dt", value: INTERVIEW_DOC_TYPE },
    ]
  );
  const byId = new Map<string, { id: string; titel: string; fertig: number; offen: number; letzte: string | null }>();
  for (const r of rows) {
    const e = byId.get(r.kurs.id) ?? { id: r.kurs.id, titel: r.kurs.titel, fertig: 0, offen: 0, letzte: null };
    if (r.status === "finished") {
      e.fertig++;
      if (r.finishedAt && (!e.letzte || r.finishedAt > e.letzte)) e.letzte = r.finishedAt;
    } else e.offen++;
    byId.set(r.kurs.id, e);
  }
  return [...byId.values()].sort((a, b) => b.fertig - a.fertig);
}

/** Letztes aktives Interview der Person zu einem Kurs (Wiederaufnahme statt Doppelstart). */
export async function findActiveInterview(workspaceId: string, uid: string, kursId: string): Promise<InterviewDoc | null> {
  const rows = await queryItems<InterviewDoc>(
    runsContainer(),
    "SELECT * FROM c WHERE c.sessionId = @pk AND c.docType = @dt AND c.uid = @u AND c.kurs.id = @k AND c.status = 'active' ORDER BY c.createdAt DESC",
    [
      { name: "@pk", value: interviewPartitionKey(workspaceId) },
      { name: "@dt", value: INTERVIEW_DOC_TYPE },
      { name: "@u", value: uid },
      { name: "@k", value: kursId },
    ]
  );
  return rows[0] ?? null;
}

export async function readBericht(workspaceId: string, kursId: string): Promise<InterviewBerichtDoc | null> {
  const doc = await readItem<InterviewBerichtDoc>(runsContainer(), `bericht:${kursId}`, interviewPartitionKey(workspaceId));
  return doc?.docType === INTERVIEW_BERICHT_DOC_TYPE ? doc : null;
}

export async function saveBericht(doc: Omit<InterviewBerichtDoc, "id" | "sessionId" | "docType">): Promise<InterviewBerichtDoc> {
  const full: InterviewBerichtDoc = {
    ...doc,
    id: `bericht:${doc.kursId}`,
    sessionId: interviewPartitionKey(doc.workspaceId),
    docType: INTERVIEW_BERICHT_DOC_TYPE,
  };
  await upsertItem(runsContainer(), full);
  return full;
}
