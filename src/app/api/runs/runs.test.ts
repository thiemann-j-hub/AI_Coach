import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Go-Live-Prüfung 12.11.2026: die fünf Routen der Transkript-Analyse (speichern, löschen, listen, lesen, bewerten).
 *   B2  Das Rückgabe-Fenster ließ sich durch erneutes Speichern neu öffnen; gelöschte Läufe kamen so zurück.
 *   B3  Über die feste Partition `spielbuch` waren Kennungen fremder Szenarien lesbar; eine Sitzung ohne Dokument
 *       galt als erlaubt.
 *   S1  „Analyse gelöscht“ ließ das Dokument mit Zusammenfassung, Zitaten und Transkript liegen.
 * Echt sind die Routen, der `runs-store`, der Buchungsvermerk und die Begrenzung. Cosmos ist ein Speicher im
 * Arbeitsspeicher; Anmeldung, Credit-Dienst und Radar sind gemockt.
 */
const db = await vi.hoisted(async () => (await import("@/test/analyse-speicher")).neuerAnalyseSpeicher());
const h = vi.hoisted(() => ({
  uid: "person-0",
  central: true,
  refund: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  messpunkt: vi.fn(async (..._a: unknown[]) => ({ deleted: 0 })),
}));
vi.mock("@/lib/cosmos", () => db.cosmos);
vi.mock("@/lib/api-auth", () => ({ requireAuth: async () => ({ uid: h.uid, email: "a@example.com", oid: "oid-1" }) }));
vi.mock("@/lib/server/credits/credit-service", () => ({
  creditsCentralEnabled: () => h.central,
  centralRefund: (...a: unknown[]) => h.refund(...a),
  centralReserve: vi.fn(),
  centralWalletStatus: vi.fn(),
}));
vi.mock("@/lib/server/radar-emit", () => ({ deleteCoachMeasurement: (...a: unknown[]) => h.messpunkt(...a) }));
vi.mock("@/lib/server/credits/workspace-store", () => ({ getWorkspaceIdForUser: async () => "ws-1" }));
vi.mock("@/lib/logger", () => ({ logger: { api: vi.fn(), apiError: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { getDictionary } from "@/i18n/dictionaries";
import { POST as save } from "./save/route";
import { POST as del } from "./delete/route";
import { GET as list } from "./list/route";
import { GET as get } from "./get/route";
import { POST as rate } from "./rate/route";

const SID = "sitzung-aaaa-1111";
const RID = "lauf-0000-0001";
const ANDERE = "andere-person";
const MIN = 60_000;
const vor = (ms: number) => new Date(Date.now() - ms).toISOString();

const post = (body: unknown) =>
  new NextRequest("http://localhost/api/runs/x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-locale": "de" } });
const frage = (q: Record<string, string>) => new NextRequest(`http://localhost/api/runs/x?${new URLSearchParams(q)}`, { headers: { "x-locale": "de" } });
const antwort = async (anfrage: Promise<Response>) => {
  const res = await anfrage;
  return { status: res.status, json: (await res.json()) as Record<string, any> };
};

const speichern = (extra: Record<string, unknown> = {}) =>
  antwort(
    save(
      post({
        sessionId: SID,
        runId: RID,
        request: { conversationType: "feedback", transcriptText: null, lang: "de" },
        result: { summary: "Erneut gespeichert", scores: { overall: 70 } },
        options: { storeTranscript: false },
        ...extra,
      })
    )
  );
const loeschen = (sessionId = SID, runId = RID) => antwort(del(post({ sessionId, runId })));
const listen = (sessionId = SID) => antwort(list(frage({ sessionId, limit: "100" })));
const lesen = (sessionId = SID, runId = RID) => antwort(get(frage({ sessionId, runId })));
const bewerten = (sessionId = SID, runId = RID) => antwort(rate(post({ sessionId, runId, rating: 5 })));

/** Bezahlte Analyse der angemeldeten Person in ihrer Sitzung. */
function analyse(extra: Record<string, unknown> = {}) {
  db.sitzung(SID, h.uid);
  return db.put("runs", {
    id: RID,
    sessionId: SID,
    uid: h.uid,
    workspaceId: "ws-1",
    centralSpendTxId: "tx-1",
    createdAt: vor(2 * MIN),
    conversationType: "feedback",
    transcriptText: "FK: Das ganze Gespräch.",
    analysisJson: { summary: "Zusammenfassung", rewrites: [{ original: "Zitat" }], scores: { overall: 70 } },
    ragContext: null,
    summary: "Zusammenfassung",
    scoreOverall: 70,
    ...extra,
  });
}
const laufDoc = () => db.get<Record<string, any>>("runs", SID, RID);

let nr = 0;
beforeEach(() => {
  db.reset();
  // Jede Prüfung als eigene Person: Die echte Begrenzung zählt je Person (S4).
  h.uid = `person-${++nr}`;
  h.central = true;
  h.refund.mockReset();
  h.refund.mockImplementation(async () => ({ ok: true }));
  h.messpunkt.mockClear();
});

describe("B2 Rückgabe-Fenster", () => {
  it("Ablauf aus dem Befund: bezahlte Analyse von vor drei Wochen erneut speichern, dann löschen – kein Credit zurück", async () => {
    const alt = vor(21 * 24 * 60 * MIN);
    analyse({ createdAt: alt });

    expect((await speichern()).status).toBe(200);
    expect(laufDoc()).toMatchObject({ createdAt: alt, centralSpendTxId: "tx-1", summary: "Erneut gespeichert" });

    const r = await loeschen();
    expect(r).toMatchObject({ status: 200, json: { ok: true, deleted: true, refunded: false } });
    expect(h.refund).not.toHaveBeenCalled();
  });

  it("unverändert: Wer binnen 10 Minuten löscht, bekommt den Credit zurück – auch nach dem Speichern", async () => {
    analyse({ createdAt: vor(2 * MIN) });
    expect((await speichern()).status).toBe(200);
    const r = await loeschen();
    expect(r.json).toMatchObject({ deleted: true, refunded: true });
    expect(h.refund).toHaveBeenCalledTimes(1);
    expect(h.refund).toHaveBeenCalledWith({ amount: 1, description: "coach:refund_user_delete", spendTransactionId: "tx-1", idempotencyKey: `refund:${RID}` });
  });

  it("markierter Altbestand (gelöscht und erstattet) lässt sich nicht wiederherstellen", async () => {
    analyse({ deleted: true, deletedAt: vor(5 * MIN), refundPending: false });
    const r = await speichern();
    expect(r).toMatchObject({ status: 404, json: { code: "RUN_NOT_FOUND" } });
    expect(laufDoc()).toMatchObject({ deleted: true, summary: "Zusammenfassung" });
  });

  it("eine gelöschte Analyse kommt über Speichern nicht zurück", async () => {
    analyse();
    expect((await loeschen()).json.refunded).toBe(true);
    const r = await speichern();
    expect(r).toMatchObject({ status: 404, json: { code: "RUN_NOT_FOUND" } });
    expect(laufDoc()).toBeNull();
  });

  it("Speichern und Löschen zugleich: Der eben gelöschte, erstattete Lauf entsteht nicht neu", async () => {
    analyse();
    // Zwischen dem Lesen des Laufs und dem Schreiben löscht ein zweiter Aufruf die Analyse.
    db.stoere((vorgang, container, doc) => {
      if (vorgang === "upsert" && container === "runs" && doc.id === RID) db.remove("runs", SID, RID);
    });
    const r = await speichern();
    expect(r).toMatchObject({ status: 409, json: { ok: false, code: "RUN_CHANGED" } });
    expect(laufDoc()).toBeNull();
  });

  it("ohne Bezahlsystem legt Speichern den Lauf an wie bisher (es gibt dann keinen Schatten-Lauf und keine Rückgabe)", async () => {
    h.central = false;
    db.sitzung(SID, h.uid);
    const r = await speichern();
    expect(r).toMatchObject({ status: 200, json: { ok: true, runId: RID } });
    expect(laufDoc()).toMatchObject({ uid: h.uid, centralSpendTxId: null });
    expect((await loeschen()).json).toMatchObject({ deleted: true, refunded: false });
  });
});

describe("B3 fremde Kennungen", () => {
  const SPIELBUCH = "spielbuch";
  const BUCH_ID = "spielbuch-ws-frau-schneider-aus-dem-3fa2b1";
  const spielbuecher = () => {
    db.put("runs", { id: "spielbuch:ws-frau-schneider-aus-dem-3fa2b1", sessionId: SPIELBUCH, docType: "sim_spielbuch", scenarioId: "ws-frau-schneider-aus-dem-3fa2b1", createdAt: vor(MIN) });
    // Dasselbe mit einer Kennung, die auch auf das Muster von /api/runs/delete passt.
    db.put("runs", { id: BUCH_ID, sessionId: SPIELBUCH, docType: "sim_spielbuch", scenarioId: "ws-frau-schneider-aus-dem-3fa2b1", createdAt: vor(MIN) });
  };

  it("Ablauf aus dem Befund: sessionId=spielbuch zeigt keine Kennungen fremder Szenarien, auf keinem Weg", async () => {
    spielbuecher();
    const l = await listen(SPIELBUCH);
    expect(l).toMatchObject({ status: 403, json: { ok: false, code: "FORBIDDEN" } });
    expect(JSON.stringify(l.json)).not.toContain("frau-schneider");

    expect((await lesen(SPIELBUCH, BUCH_ID)).status).toBe(403);
    expect((await bewerten(SPIELBUCH, BUCH_ID)).status).toBe(403);
    expect(db.get("runs", SPIELBUCH, BUCH_ID)).not.toHaveProperty("rating");
    expect((await loeschen(SPIELBUCH, BUCH_ID)).status).toBe(403);
    expect(db.has("runs", SPIELBUCH, BUCH_ID)).toBe(true);
  });

  it("niemand kann sich die Partition der Spielbücher als Sitzung nehmen", async () => {
    spielbuecher();
    h.central = false; // ohne Bezahlsystem legte Speichern früher Sitzung und Lauf an
    expect((await speichern({ sessionId: SPIELBUCH })).status).toBe(403);
    expect(db.has("sessions", SPIELBUCH, SPIELBUCH)).toBe(false);
    expect(db.all("runs").length).toBe(2);
    // Selbst ein Sitzungsdokument dieses Namens (vor der Korrektur angelegt) öffnet nichts.
    db.sitzung(SPIELBUCH, h.uid);
    expect((await listen(SPIELBUCH)).status).toBe(403);
    expect((await lesen(SPIELBUCH, BUCH_ID)).status).toBe(403);
  });

  it("frische Sitzung ohne Dokument: leere Liste, kein Fehler", async () => {
    expect(await listen("frische-sitzung-0001")).toEqual({ status: 200, json: { ok: true, runs: [], hasMore: false, nextCursor: null } });
  });

  it("Speichern legt keine Sitzung an: ohne Sitzungsdokument 403, nichts geschrieben", async () => {
    h.central = false;
    expect(await speichern()).toMatchObject({ status: 403, json: { code: "FORBIDDEN" } });
    expect(db.all("sessions")).toEqual([]);
    expect(db.all("runs")).toEqual([]);
  });

  it("Sitzung einer anderen Person: 403 beim Listen, Lesen, Bewerten, Speichern und Löschen", async () => {
    analyse({ uid: ANDERE });
    db.sitzung(SID, ANDERE);
    for (const r of [await listen(), await lesen(), await bewerten(), await speichern(), await loeschen()]) {
      // Der Satz kommt aus dem Wörterbuch der Oberflächensprache (hier Deutsch).
      expect(r).toMatchObject({ status: 403, json: { code: "FORBIDDEN", error: getDictionary("de").api.accessDenied } });
    }
    expect(laufDoc()).toMatchObject({ uid: ANDERE, summary: "Zusammenfassung" });
    expect(laufDoc()).not.toHaveProperty("rating");
    expect(h.refund).not.toHaveBeenCalled();
  });

  it("eigene Sitzung, Lauf einer anderen Person in derselben Partition: nicht in der Liste, nicht lesbar, nicht änderbar", async () => {
    analyse({ uid: ANDERE });
    expect((await listen()).json.runs).toEqual([]);
    expect((await lesen()).status).toBe(404);
    expect((await bewerten()).status).toBe(404);
    expect((await loeschen()).status).toBe(404);
    expect((await speichern()).status).toBe(409);
    expect(laufDoc()).toMatchObject({ uid: ANDERE, summary: "Zusammenfassung" });
    expect(laufDoc()).not.toHaveProperty("rating");
    expect(h.refund).not.toHaveBeenCalled();
    expect(h.messpunkt).not.toHaveBeenCalled();
  });

  it("der eigene Lauf bleibt lesbar, bewertbar und in der Liste", async () => {
    analyse();
    expect((await listen()).json.runs.map((r: { id: string }) => r.id)).toEqual([RID]);
    const r = await lesen();
    expect(r.status).toBe(200);
    expect(r.json.run).toMatchObject({ id: RID, transcriptText: "FK: Das ganze Gespräch.", summary: "Zusammenfassung" });
    expect(r.json.refundOnDelete).toBe(true);
    expect((await bewerten()).json).toEqual({ ok: true, rating: 5 });
    expect(laufDoc()).toMatchObject({ rating: 5 });
  });
});

describe("S1 Löschen löscht", () => {
  it("Ablauf aus dem Befund: Nach „Analyse löschen“ ist das Dokument weg, mit Zusammenfassung, Zitaten und Transkript", async () => {
    analyse();
    expect((await loeschen()).json).toMatchObject({ ok: true, deleted: true });
    expect(laufDoc()).toBeNull();
    expect(db.all("runs")).toEqual([]);
    expect((await listen()).json.runs).toEqual([]);
    expect((await lesen()).status).toBe(404);
    expect(h.messpunkt).toHaveBeenCalledWith(RID, ["ws-1", "oid-1"]);
  });

  it("zweiter Klick: 404 und keine zweite Rückgabe", async () => {
    analyse();
    expect((await loeschen()).json.refunded).toBe(true);
    expect((await loeschen()).status).toBe(404);
    expect(h.refund).toHaveBeenCalledTimes(1);
  });

  it("zwei Aufrufe zugleich (zwei Tabs): Nur der, der das Dokument entfernt, gibt zurück", async () => {
    analyse();
    const [a, b] = await Promise.all([loeschen(), loeschen()]);
    expect([a.status, b.status].sort()).toEqual([200, 404]);
    expect(h.refund).toHaveBeenCalledTimes(1);
    expect(db.vermerke()).toEqual([]);
  });

  it("während der Rückgabe steht ein Vermerk ohne Inhalte; nach gelungener Rückgabe ist er weg", async () => {
    analyse();
    let waehrend: Record<string, unknown>[] = [];
    let dokumentNochDa = true;
    h.refund.mockImplementation(async () => {
      waehrend = db.vermerke();
      dokumentNochDa = db.has("runs", SID, RID);
      return { ok: true };
    });
    expect((await loeschen()).json.refunded).toBe(true);
    // Endete der Prozess während der Rückgabe, bliebe genau das: die Analyse gelöscht, die fällige Rückgabe vermerkt.
    expect(dokumentNochDa).toBe(false);
    expect(waehrend).toHaveLength(1);
    expect(waehrend[0]).toMatchObject({ art: "analyse-rueckgabe", kennung: RID, txId: "tx-1", workspaceId: "ws-1", uid: h.uid });
    expect(db.vermerke()).toEqual([]);
  });

  it("scheitert die Rückgabe, bleibt die Analyse gelöscht und der Vermerk steht: ohne Inhalte, mit Zeitpunkt des Fehlschlags", async () => {
    analyse();
    h.refund.mockImplementation(async () => ({ ok: false }));
    expect(await loeschen()).toMatchObject({ status: 200, json: { ok: true, deleted: true, refunded: false } });
    expect(laufDoc()).toBeNull();
    const [v] = db.vermerke();
    expect(v).toMatchObject({ art: "analyse-rueckgabe", kennung: RID, txId: "tx-1", workspaceId: "ws-1", uid: h.uid });
    expect(typeof v.refundFailedAt).toBe("string");
    expect(Object.keys(v).sort()).toEqual(["art", "at", "docType", "id", "kennung", "refundFailedAt", "sessionId", "txId", "uid", "workspaceId"]);
    expect(JSON.stringify(v)).not.toContain("Gespräch");
    // Ein weiterer Klick findet nichts mehr und versucht keine zweite Rückgabe.
    expect((await loeschen()).status).toBe(404);
    expect(h.refund).toHaveBeenCalledTimes(1);
  });

  it("außerhalb des Fensters oder ohne Buchungsnummer: gelöscht, keine Rückgabe, kein Vermerk", async () => {
    analyse({ createdAt: vor(11 * MIN) });
    expect((await loeschen()).json).toMatchObject({ deleted: true, refunded: false });
    analyse({ centralSpendTxId: null });
    expect((await loeschen()).json).toMatchObject({ deleted: true, refunded: false });
    expect(h.refund).not.toHaveBeenCalled();
    expect(db.vermerke()).toEqual([]);
    expect(db.all("runs")).toEqual([]);
  });

  it("scheitert das Löschen selbst, gibt es keine Rückgabe und keinen stehengebliebenen Vermerk", async () => {
    analyse();
    db.stoere((vorgang, container, doc) => {
      if (vorgang === "delete" && container === "runs" && doc.id === RID) throw new Error("Datenbank nicht erreichbar");
    });
    expect((await loeschen()).status).toBe(500);
    expect(h.refund).not.toHaveBeenCalled();
    expect(laufDoc()).not.toBeNull();
    expect(db.vermerke()).toEqual([]);
  });

  it("markierter Altbestand ist für die Person nicht mehr da (404), bis das Aufräum-Skript ihn löscht", async () => {
    analyse({ deleted: true, refundPending: true });
    expect((await loeschen()).status).toBe(404);
    expect((await lesen()).status).toBe(404);
    expect((await listen()).json.runs).toEqual([]);
    expect(h.refund).not.toHaveBeenCalled();
  });
});
