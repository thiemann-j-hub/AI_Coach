import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

/**
 * Go-Live-Prüfung 12.11.2026, S3: Buchungsvermerk. Die Wege Analyse, „Vorbereiten“ und Builder buchten mit einer
 * Kennung, die nirgends stand. Endete der Prozess während der Rechnung, antwortete der Credit-Dienst nicht klar
 * oder scheiterte die Rückbuchung, fehlte ein Credit ohne Spur. Cosmos ist ein Speicher im Arbeitsspeicher.
 */
const db = await vi.hoisted(async () => (await import("@/test/analyse-speicher")).neuerAnalyseSpeicher());
const protokoll = vi.hoisted(() => ({ api: vi.fn(), apiError: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/cosmos", () => db.cosmos);
vi.mock("@/lib/logger", () => ({ logger: protokoll }));

import {
  buchenMitVermerk,
  buchungsPartition,
  creditSchluessel,
  rueckbuchenMitVermerk,
  vermerkAnlegen,
  vermerkAustragen,
  vermerkHinweis,
  vermerkLage,
  type BuchungsArt,
  type VermerkLage,
} from "./buchungsvermerk";
import type { EntitlementResult } from "./entitlement";

const KENNUNG = "11111111-2222-3333-4444-555555555555";
const gebucht = (kennung: string): EntitlementResult => ({
  ok: true,
  grant: { runId: kennung, workspaceId: "ws-1", held: true, central: true, centralTxId: "tx-1" },
});
const abgelehnt = (unklar = false): EntitlementResult => ({
  ok: false,
  response: NextResponse.json({ ok: false, code: unklar ? "CENTRAL_UNAVAILABLE" : "INSUFFICIENT_CREDITS" }, { status: unklar ? 503 : 402 }),
  ...(unklar ? { unklar: true } : {}),
});
const vermerk = () => db.get<Record<string, unknown>>("runs", "buchung:u1", `vorbereiten:${KENNUNG}`);

beforeEach(() => {
  db.reset();
  for (const m of Object.values(protokoll)) m.mockClear();
});

describe("Vermerk anlegen und austragen", () => {
  it("liegt in der Partition der Person, trägt Art, Kennung und Zeit und keine Inhalte", async () => {
    const v = await vermerkAnlegen({ uid: "u1", art: "vorbereiten", kennung: KENNUNG });
    expect(v).not.toBeNull();
    const doc = vermerk()!;
    expect(doc).toMatchObject({ id: `vorbereiten:${KENNUNG}`, sessionId: buchungsPartition("u1"), docType: "buchungsvermerk", uid: "u1", art: "vorbereiten", kennung: KENNUNG });
    expect(Object.keys(doc).sort()).toEqual(["art", "at", "docType", "id", "kennung", "sessionId", "uid"]);
    // Die Partition passt nie auf das Muster einer Sitzungskennung (B3).
    expect(/^[A-Za-z0-9_-]+$/.test(String(doc.sessionId))).toBe(false);
    await vermerkAustragen(v);
    expect(db.vermerke()).toEqual([]);
  });

  it("fail-soft: Scheitert das Schreiben, gibt es keinen Vermerk, eine Protokollzeile und keinen Fehler", async () => {
    db.stoere((vorgang) => {
      if (vorgang === "upsert") throw new Error("Datenbank nicht erreichbar");
    });
    await expect(vermerkAnlegen({ uid: "u1", art: "analyse", kennung: KENNUNG })).resolves.toBeNull();
    expect(protokoll.apiError).toHaveBeenCalledTimes(1);
    await expect(vermerkAustragen(null)).resolves.toBeUndefined();
  });
});

describe("Buchen mit Spur", () => {
  it("der Vermerk steht VOR der Buchung; nach der Antwort trägt er Buchungsnummer und Arbeitsbereich", async () => {
    let beimBuchen: Record<string, unknown> | null = null;
    const { ent, vermerk: v } = await buchenMitVermerk({ uid: "u1", art: "vorbereiten", kennung: KENNUNG }, async (kennung) => {
      beimBuchen = vermerk();
      return gebucht(kennung);
    });
    expect(ent.ok).toBe(true);
    expect(beimBuchen).toMatchObject({ kennung: KENNUNG, uid: "u1" });
    expect(beimBuchen).not.toHaveProperty("txId");
    // Endet der Prozess jetzt (während der Rechnung), bleibt genau das stehen:
    expect(vermerk()).toMatchObject({ kennung: KENNUNG, txId: "tx-1", workspaceId: "ws-1" });
    expect(v).toMatchObject({ txId: "tx-1", workspaceId: "ws-1" });
  });

  it("die Buchung bekommt genau die Kennung des Vermerks", async () => {
    const buchen = vi.fn(async (kennung: string) => gebucht(kennung));
    await buchenMitVermerk({ uid: "u1", art: "builder", kennung: KENNUNG }, buchen);
    expect(buchen).toHaveBeenCalledWith(KENNUNG);
  });

  it("klare Ablehnung (kein Guthaben): nichts gebucht, der Vermerk ist wieder weg", async () => {
    const { ent, vermerk: v } = await buchenMitVermerk({ uid: "u1", art: "vorbereiten", kennung: KENNUNG }, async () => abgelehnt());
    expect(ent.ok).toBe(false);
    expect(v).toBeNull();
    expect(db.vermerke()).toEqual([]);
  });

  it("Antwort ohne klares Ergebnis: Der Vermerk BLEIBT (zentral kann gebucht sein), ohne Buchungsnummer", async () => {
    const { ent } = await buchenMitVermerk({ uid: "u1", art: "vorbereiten", kennung: KENNUNG }, async () => abgelehnt(true));
    expect(ent.ok).toBe(false);
    expect(vermerk()).toMatchObject({ kennung: KENNUNG });
    expect(vermerk()).not.toHaveProperty("txId");
    expect(protokoll.warn).toHaveBeenCalledTimes(1);
  });

  it("wirft die Buchung, bleibt der Vermerk stehen und der Fehler geht an den Aufrufer", async () => {
    await expect(
      buchenMitVermerk({ uid: "u1", art: "vorbereiten", kennung: KENNUNG }, async () => {
        throw new Error("Verbindung abgebrochen");
      })
    ).rejects.toThrow("Verbindung abgebrochen");
    expect(vermerk()).toMatchObject({ kennung: KENNUNG });
  });

  it("fail-soft: Lässt sich der Vermerk nicht schreiben, wird trotzdem gebucht wie zuvor", async () => {
    db.stoere((vorgang) => {
      if (vorgang === "upsert") throw new Error("Datenbank nicht erreichbar");
    });
    const { ent, vermerk: v } = await buchenMitVermerk({ uid: "u1", art: "vorbereiten", kennung: KENNUNG }, async (k) => gebucht(k));
    expect(ent.ok).toBe(true);
    expect(v).toBeNull();
  });
});

describe("Zurückbuchen mit Spur", () => {
  const mitVermerk = async () => (await buchenMitVermerk({ uid: "u1", art: "vorbereiten", kennung: KENNUNG }, async (k) => gebucht(k))).vermerk;

  it("gelungen: Der Credit ist zurück, der Vermerk ist weg", async () => {
    const v = await mitVermerk();
    await expect(rueckbuchenMitVermerk({ art: "vorbereiten", kennung: KENNUNG, vermerk: v }, async () => ({ ok: true }))).resolves.toBe(true);
    expect(db.vermerke()).toEqual([]);
  });

  it("gescheitert: Der Vermerk bleibt mit Zeitpunkt des Fehlschlags und Buchungsnummer, dazu eine Fehlerzeile", async () => {
    const v = await mitVermerk();
    await expect(rueckbuchenMitVermerk({ art: "vorbereiten", kennung: KENNUNG, vermerk: v }, async () => ({ ok: false }))).resolves.toBe(false);
    expect(vermerk()).toMatchObject({ txId: "tx-1", workspaceId: "ws-1" });
    expect(typeof vermerk()!.refundFailedAt).toBe("string");
    expect(protokoll.error).toHaveBeenCalledTimes(1);
  });

  it("wirft die Rückbuchung, gilt sie als gescheitert; die Funktion wirft nie", async () => {
    const v = await mitVermerk();
    await expect(
      rueckbuchenMitVermerk({ art: "vorbereiten", kennung: KENNUNG, vermerk: v }, async () => {
        throw new Error("Frist");
      })
    ).resolves.toBe(false);
    expect(typeof vermerk()!.refundFailedAt).toBe("string");
  });

  it("ohne Vermerk (Schreiben war gescheitert) bleibt die Fehlerzeile die einzige Spur", async () => {
    await expect(rueckbuchenMitVermerk({ art: "analyse", kennung: KENNUNG, vermerk: null }, async () => ({ ok: false }))).resolves.toBe(false);
    expect(protokoll.error).toHaveBeenCalledTimes(1);
    expect(db.vermerke()).toEqual([]);
  });
});

describe("Einordnung für den Abgleich", () => {
  const now = new Date("2026-11-12T12:00:00.000Z");
  const lage = (v: { art?: BuchungsArt; at: string; txId?: string; refundFailedAt?: string }) => vermerkLage({ art: "vorbereiten", ...v }, now, 15);

  it("jung: rechnet vermutlich noch", () => {
    expect(lage({ at: "2026-11-12T11:55:00.000Z", txId: "tx-1" })).toBe("laeuft");
  });

  it("alt ohne Buchungsnummer: unbestätigt; alt mit Buchungsnummer: gebucht ohne Ergebnis", () => {
    expect(lage({ at: "2026-11-12T10:00:00.000Z" })).toBe("unbestaetigt");
    expect(lage({ at: "2026-11-12T10:00:00.000Z", txId: "tx-1" })).toBe("gebucht-ohne-ergebnis");
  });

  it("gescheiterte Rückbuchung zählt sofort, auch wenn der Vermerk jung ist", () => {
    expect(lage({ at: "2026-11-12T11:59:00.000Z", txId: "tx-1", refundFailedAt: "2026-11-12T11:59:30.000Z" })).toBe("rueckbuchung-gescheitert");
    expect(lage({ art: "analyse-rueckgabe", at: "2026-11-12T11:59:00.000Z", txId: "tx-1", refundFailedAt: "2026-11-12T11:59:30.000Z" })).toBe("rueckbuchung-gescheitert");
  });

  it("Rückgabe beim Löschen: alt und unbestätigt heißt „Rückgabe offen“", () => {
    expect(lage({ art: "analyse-rueckgabe", at: "2026-11-12T10:00:00.000Z", txId: "tx-1" })).toBe("rueckgabe-offen");
    expect(lage({ art: "analyse-rueckgabe", at: "2026-11-12T11:58:00.000Z", txId: "tx-1" })).toBe("laeuft");
  });

  it("Schlüssel im Credit-Dienst: Buchung `spend:…`, Rückgabe beim Löschen `refund:…`", () => {
    expect(creditSchluessel("analyse", "r1")).toBe("spend:r1");
    expect(creditSchluessel("vorbereiten", "c1")).toBe("spend:c1");
    expect(creditSchluessel("builder", "c1")).toBe("spend:c1");
    expect(creditSchluessel("analyse-rueckgabe", "r1")).toBe("refund:r1");
  });

  it("jede Art und Lage hat einen Hinweis für den Betrieb", () => {
    const arten: BuchungsArt[] = ["analyse", "vorbereiten", "builder", "analyse-rueckgabe"];
    const lagen: VermerkLage[] = ["laeuft", "unbestaetigt", "gebucht-ohne-ergebnis", "rueckbuchung-gescheitert", "rueckgabe-offen"];
    for (const art of arten) for (const l of lagen) expect(vermerkHinweis(art, l).length).toBeGreaterThan(20);
  });
});
