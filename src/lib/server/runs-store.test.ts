import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Go-Live-Prüfung 12.11.2026 (B2, B3, S1): Datenzugriff der Transkript-Analyse.
 * Cosmos ist ein Speicher im Arbeitsspeicher (`@/test/analyse-speicher`); alles andere ist echt.
 */
const db = await vi.hoisted(async () => (await import("@/test/analyse-speicher")).neuerAnalyseSpeicher());
const protokoll = vi.hoisted(() => ({ api: vi.fn(), apiError: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/cosmos", () => db.cosmos);
vi.mock("@/lib/logger", () => ({ logger: protokoll }));
vi.mock("@/lib/server/claude-vertex", () => ({ claudeMessage: vi.fn(), claudeVertexConfigured: () => false }));

import {
  claimSession,
  deleteRun,
  getOwnRun,
  isReservedSessionId,
  listRuns,
  persistShadowRun,
  rateRun,
  saveRun,
  sessionAccess,
  type RunDoc,
} from "./runs-store";
import { SPIELBUCH_PARTITION } from "./spielbuch/store";

const SID = "sitzung-aaaa-1111";
const lauf = (id: string, extra: Record<string, unknown> = {}) =>
  db.put("runs", {
    id,
    sessionId: SID,
    uid: "u1",
    createdAt: "2026-10-20T09:00:00.000Z",
    conversationType: "feedback",
    transcriptText: null,
    analysisJson: { summary: "Zusammenfassung" },
    summary: "Zusammenfassung",
    scoreOverall: 70,
    ...extra,
  });
const neu = {
  sessionId: SID,
  uid: "u1",
  conversationType: "feedback",
  conversationSubType: null,
  goal: null,
  lang: "de",
  jurisdiction: null,
  transcriptText: null,
  analysisJson: { summary: "neu" },
  ragContext: null,
  summary: "neu",
  scoreOverall: 80,
};

beforeEach(() => {
  db.reset();
  for (const m of Object.values(protokoll)) m.mockClear();
});

describe("Sitzung: wem gehört sie? (B3)", () => {
  it("ohne Sitzungsdokument: `missing`, nicht mehr „erlaubt“", async () => {
    expect(await sessionAccess(SID, "u1")).toBe("missing");
  });

  it("eigenes Dokument: `own`; fremdes oder eines ohne Kennung: `foreign`", async () => {
    db.sitzung(SID, "u1");
    db.put("sessions", { id: "sitzung-ohne-kennung", updatedAt: "t" });
    expect(await sessionAccess(SID, "u1")).toBe("own");
    expect(await sessionAccess(SID, "u2")).toBe("foreign");
    expect(await sessionAccess("sitzung-ohne-kennung", "u1")).toBe("foreign");
  });

  it("die feste Partition der Spielbücher ist nie eine Sitzung, auch nicht mit Sitzungsdokument", async () => {
    expect(isReservedSessionId(SPIELBUCH_PARTITION)).toBe(true);
    expect(await sessionAccess(SPIELBUCH_PARTITION, "u1")).toBe("foreign");
    db.sitzung(SPIELBUCH_PARTITION, "u1");
    expect(await sessionAccess(SPIELBUCH_PARTITION, "u1")).toBe("foreign");
    expect(await claimSession(SPIELBUCH_PARTITION, "u1")).toBe(false);
  });

  it("claimSession legt eine fehlende Sitzung an, lässt eine eigene stehen und nimmt keine fremde", async () => {
    expect(await claimSession(SID, "u1")).toBe(true);
    expect(db.get("sessions", SID, SID)).toMatchObject({ id: SID, uid: "u1" });
    expect(await claimSession(SID, "u1")).toBe(true);
    expect(await claimSession(SID, "u2")).toBe(false);
    expect(db.get("sessions", SID, SID)).toMatchObject({ uid: "u1" });
  });
});

describe("Lauf: nur der eigene (B3)", () => {
  it("getOwnRun: fremder Lauf in derselben Partition und markierter Altbestand gelten als nicht vorhanden", async () => {
    lauf("lauf-meiner-01");
    lauf("lauf-fremd-0001", { uid: "u2" });
    lauf("lauf-markiert-1", { deleted: true });
    expect((await getOwnRun(SID, "lauf-meiner-01", "u1"))?.id).toBe("lauf-meiner-01");
    expect(await getOwnRun(SID, "lauf-fremd-0001", "u1")).toBeNull();
    expect(await getOwnRun(SID, "lauf-markiert-1", "u1")).toBeNull();
    expect(await getOwnRun(SID, "gibt-es-nicht", "u1")).toBeNull();
  });

  it("listRuns zeigt nur eigene, nicht markierte Läufe; ein fremder Lauf taugt nicht als Cursor", async () => {
    lauf("lauf-meiner-01", { createdAt: "2026-10-20T09:00:00.000Z" });
    lauf("lauf-meiner-02", { createdAt: "2026-10-21T09:00:00.000Z" });
    lauf("lauf-fremd-0001", { uid: "u2", createdAt: "2026-10-22T09:00:00.000Z" });
    lauf("lauf-markiert-1", { deleted: true, createdAt: "2026-10-23T09:00:00.000Z" });
    const alle = await listRuns(SID, "u1", 50);
    expect(alle.runs.map((r) => r.id)).toEqual(["lauf-meiner-02", "lauf-meiner-01"]);
    const seite2 = await listRuns(SID, "u1", 50, "lauf-meiner-02");
    expect(seite2.runs.map((r) => r.id)).toEqual(["lauf-meiner-01"]);
    expect((await listRuns(SID, "u1", 50, "lauf-fremd-0001")).badCursor).toBe(true);
  });

  it("rateRun legt eine inzwischen gelöschte Analyse nicht neu an", async () => {
    lauf("lauf-meiner-01");
    // Zwischen Lesen und Schreiben der Bewertung löscht ein zweiter Aufruf die Analyse.
    db.stoere((vorgang, container, doc) => {
      if (vorgang === "upsert" && container === "runs" && doc.id === "lauf-meiner-01") db.remove("runs", SID, "lauf-meiner-01");
    });
    expect(await rateRun(SID, "lauf-meiner-01", "u1", 4)).toBe(false);
    expect(db.has("runs", SID, "lauf-meiner-01")).toBe(false);
  });

  it("rateRun: hat inzwischen ein anderer Aufruf geschrieben, wird neu gelesen und die Bewertung gilt trotzdem", async () => {
    lauf("lauf-meiner-01");
    let einmal = true;
    db.stoere((vorgang, container, doc) => {
      if (vorgang !== "upsert" || container !== "runs" || !einmal) return;
      einmal = false;
      db.put("runs", { ...(db.get("runs", SID, String(doc.id)) as { id: string }), summary: "inzwischen geändert" });
    });
    expect(await rateRun(SID, "lauf-meiner-01", "u1", 2)).toBe(true);
    expect(db.get("runs", SID, "lauf-meiner-01")).toMatchObject({ rating: 2, summary: "inzwischen geändert" });
  });

  it("rateRun schreibt nur an den eigenen Lauf", async () => {
    lauf("lauf-meiner-01");
    lauf("lauf-fremd-0001", { uid: "u2" });
    expect(await rateRun(SID, "lauf-meiner-01", "u1", 4)).toBe(true);
    expect(db.get("runs", SID, "lauf-meiner-01")).toMatchObject({ rating: 4 });
    expect(await rateRun(SID, "lauf-fremd-0001", "u1", 1)).toBe(false);
    expect(db.get("runs", SID, "lauf-fremd-0001")).not.toHaveProperty("rating");
  });
});

describe("Speichern und Löschen (B2, S1)", () => {
  it("saveRun: ein vorhandener Lauf behält sein createdAt, ein neuer bekommt „jetzt“", async () => {
    lauf("lauf-meiner-01", { createdAt: "2026-10-20T09:00:00.000Z", centralSpendTxId: "tx-1" });
    const alt = (await getOwnRun(SID, "lauf-meiner-01", "u1"))!;
    expect(await saveRun(neu, { runId: "lauf-meiner-01", existing: alt })).toBe("lauf-meiner-01");
    expect(db.get("runs", SID, "lauf-meiner-01")).toMatchObject({ createdAt: "2026-10-20T09:00:00.000Z", summary: "neu" });

    const vor = Date.now();
    expect(await saveRun(neu, { runId: "lauf-neu-000001" })).toBe("lauf-neu-000001");
    expect(Date.parse(String(db.get<RunDoc>("runs", SID, "lauf-neu-000001")!.createdAt))).toBeGreaterThanOrEqual(vor);
  });

  it("saveRun erfindet für einen Lauf ohne Zeitpunkt (Altbestand) keinen: Das Rückgabe-Fenster bleibt zu", async () => {
    lauf("lauf-ohne-zeit-1", { createdAt: undefined });
    const alt = (await getOwnRun(SID, "lauf-ohne-zeit-1", "u1"))!;
    expect(await saveRun(neu, { runId: "lauf-ohne-zeit-1", existing: alt })).toBe("lauf-ohne-zeit-1");
    expect(db.get("runs", SID, "lauf-ohne-zeit-1")).toMatchObject({ summary: "neu" });
    expect(db.get("runs", SID, "lauf-ohne-zeit-1")).not.toHaveProperty("createdAt");
  });

  it("saveRun ersetzt einen vorhandenen Lauf nur, wenn er seit dem Lesen unverändert da ist", async () => {
    lauf("lauf-meiner-01");
    const gelesen = (await getOwnRun(SID, "lauf-meiner-01", "u1"))!;
    // Inzwischen geändert (hier: bewertet): nicht überschreiben.
    await rateRun(SID, "lauf-meiner-01", "u1", 3);
    expect(await saveRun(neu, { runId: "lauf-meiner-01", existing: gelesen })).toBeNull();
    expect(db.get("runs", SID, "lauf-meiner-01")).toMatchObject({ summary: "Zusammenfassung", rating: 3 });
    // Inzwischen gelöscht: nicht neu anlegen.
    const frisch = (await getOwnRun(SID, "lauf-meiner-01", "u1"))!;
    await deleteRun(SID, "lauf-meiner-01");
    expect(await saveRun(neu, { runId: "lauf-meiner-01", existing: frisch })).toBeNull();
    expect(db.has("runs", SID, "lauf-meiner-01")).toBe(false);
  });

  it("deleteRun entfernt das Dokument wirklich; nur der Aufruf, der es entfernt hat, bekommt true", async () => {
    lauf("lauf-meiner-01", { transcriptText: "Das ganze Gespräch" });
    expect(await deleteRun(SID, "lauf-meiner-01")).toBe(true);
    expect(db.has("runs", SID, "lauf-meiner-01")).toBe(false);
    expect(await deleteRun(SID, "lauf-meiner-01")).toBe(false);
  });

  it("persistShadowRun: Scheitert das Schreiben, bleibt kein Lauf liegen und der Fehler geht weiter", async () => {
    let geschrieben = false;
    db.stoere((vorgang, container, doc) => {
      if (vorgang !== "upsert" || container !== "runs" || geschrieben) return;
      // Die Schreibung kommt an, die Antwort nicht (Frist): Das Dokument liegt, der Aufrufer sieht einen Fehler.
      geschrieben = true;
      db.put("runs", doc as { id: string });
      throw new Error("Frist beim Schreiben");
    });
    await expect(
      persistShadowRun({ sessionId: SID, runId: "lauf-schatten-01", uid: "u1", workspaceId: "ws-1", centralSpendTxId: "tx-1", conversationType: "feedback", analysisJson: {} })
    ).rejects.toThrow("Frist beim Schreiben");
    expect(db.has("runs", SID, "lauf-schatten-01")).toBe(false);
  });
});
