import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Paket 2, C19 (12.11.2026): Löschlücken.
 *   (a) Spielbücher (Partition „spielbuch“, ohne Personen- und Firmenkennung) gehen mit Szenario, Konto und Firma,
 *   (b) abgelaufene private Szenarien aller Personen räumt der gelegentliche Aufräumer weg,
 *   (c) abgebrochene Läufe: die Konto-Löschung erfasst sie, der Aufräumer löscht sie nach 30 Tagen.
 * Cosmos ist ein Speicher im Arbeitsspeicher. Er versteht genau die Bedingungen, die der Code heute stellt;
 * eine unbekannte Bedingung lässt den Test scheitern, statt still ignoriert zu werden.
 */
const db = vi.hoisted(() => {
  type Doc = Record<string, unknown> & { id: string };
  type Params = Record<string, unknown>;
  const containers = new Map<string, Map<string, Doc>>();
  const of = (name: string) => {
    if (!containers.has(name)) containers.set(name, new Map());
    return containers.get(name)!;
  };
  const key = (pk: string, id: string) => `${pk}|${id}`;
  const FILTER: Record<string, (d: Doc, p: Params) => boolean> = {
    "c.uid = @uid": (d, p) => d.uid === p["@uid"],
    "c.sessionId = @pk": (d, p) => d.sessionId === p["@pk"],
    "c.docType = @dt": (d, p) => d.docType === p["@dt"],
    "c.workspaceId = @ws": (d, p) => d.workspaceId === p["@ws"],
    "c.entraOid = @oid": (d, p) => d.entraOid === p["@oid"],
    "c.id = @id": (d, p) => d.id === p["@id"],
    "c.privat = true": (d) => d.privat === true,
    "c.expiresAt <= @now": (d, p) => typeof d.expiresAt === "string" && d.expiresAt <= String(p["@now"]),
    "c.status = 'aborted'": (d) => d.status === "aborted",
    "c.updatedAt < @cutoff": (d, p) => typeof d.updatedAt === "string" && d.updatedAt < String(p["@cutoff"]),
    "(NOT IS_DEFINED(c.openCharge) OR IS_NULL(c.openCharge))": (d) => d.openCharge === undefined || d.openCharge === null,
  };
  const stand = {
    queries: [] as string[],
    /** Dokument ablegen; `pk` ist der Partitionsschlüssel (runs: sessionId, sonst die id). */
    put(container: string, doc: Doc, pk?: string) {
      of(container).set(key(pk ?? String(doc.sessionId ?? doc.id), doc.id), doc);
    },
    has: (container: string, pk: string, id: string) => of(container).has(key(pk, id)),
    ids: (container: string) => [...of(container).values()].map((d) => d.id).sort(),
    reset() {
      containers.clear();
      stand.queries = [];
    },
    cosmos: {
      runsContainer: () => ({ name: "runs" }),
      usersContainer: () => ({ name: "users" }),
      sessionsContainer: () => ({ name: "sessions" }),
      usageContainer: () => ({ name: "usage" }),
      creditTokensContainer: () => ({ name: "credit_tokens" }),
      readItem: async (c: { name: string }, id: string, pk: string) => structuredClone(of(c.name).get(key(pk, id)) ?? null),
      upsertItem: async (c: { name: string }, item: Doc) => {
        of(c.name).set(key(String(item.sessionId ?? item.id), item.id), structuredClone(item));
        return item;
      },
      deleteItem: async (c: { name: string }, id: string, pk: string) => void of(c.name).delete(key(pk, id)),
      queryItems: async (c: { name: string }, query: string, params: Array<{ name: string; value: unknown }> = []) => {
        stand.queries.push(query);
        const p: Params = Object.fromEntries(params.map((x) => [x.name, x.value]));
        const where = /WHERE (.+?)(?: ORDER BY .*)?$/.exec(query)?.[1] ?? "";
        let rows = [...of(c.name).values()];
        for (const cond of where.split(" AND ").map((x) => x.trim()).filter(Boolean)) {
          const f = FILTER[cond];
          if (!f) throw new Error(`Attrappe kennt die Bedingung nicht: ${cond}`);
          rows = rows.filter((d) => f(d, p));
        }
        const top = /SELECT TOP (\d+) /.exec(query);
        return structuredClone(top ? rows.slice(0, Number(top[1])) : rows);
      },
    },
  };
  return stand;
});

const claude = vi.hoisted(() => ({ message: vi.fn() }));
const protokoll = vi.hoisted(() => ({ info: vi.fn(), apiError: vi.fn() }));

vi.mock("@/lib/cosmos", () => db.cosmos);
vi.mock("@/lib/server/radar-emit", () => ({ deleteCoachMeasurement: async () => ({ deleted: 0 }) }));
vi.mock("@/lib/server/credits/cs-credential", () => ({ serviceRequestOk: () => true }));
vi.mock("@/lib/server/claude-vertex", () => ({
  claudeVertexConfigured: () => true,
  claudeMessage: (...a: unknown[]) => claude.message(...a),
}));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: protokoll.info, warn: vi.fn(), error: vi.fn(), api: vi.fn(), apiError: protokoll.apiError },
}));

import { NextRequest } from "next/server";
import { POST as workspacePurge } from "@/app/api/service/workspace-purge/route";
import { POST as anonymize } from "@/app/api/service/anonymize/route";
import { getScenario } from "@/lib/simulation/scenarios";
import { deleteAccount, deleteLearningHistory } from "./account-delete";
import { ABGEBROCHEN_TAGE, AUFRAEUMEN_ABSTAND_MS, aufraeumenAnstossen, raeumeAuf } from "./aufraeumen";
import {
  deletePrivateScenario,
  deleteWorkspaceScenario,
  listPrivateScenarioDocs,
  privateScenarioPartitionKey,
  scenarioPartitionKey,
} from "./scenario-store";
import { deleteSpielbuch, ensureSpielbuch, SPIELBUCH_PARTITION, spielbuchDocId } from "./spielbuch/store";

const JETZT = new Date("2026-11-12T10:00:00.000Z");
const tage = (n: number) => new Date(JETZT.getTime() + n * 86_400_000).toISOString();

function spielbuch(scenarioId: string) {
  db.put("runs", { id: spielbuchDocId(scenarioId), sessionId: SPIELBUCH_PARTITION, docType: "sim_spielbuch", scenarioId, hash: "h", model: "m", createdAt: tage(-1), text: "…" });
}
const hatSpielbuch = (scenarioId: string) => db.has("runs", SPIELBUCH_PARTITION, spielbuchDocId(scenarioId));

/** Privates Szenario einer Person samt Spielbuch; `expiresInDays` < 0 = abgelaufen. */
function privat(uid: string, id: string, expiresInDays: number) {
  db.put("runs", { id, sessionId: privateScenarioPartitionKey(uid), docType: "sim_scenario", workspaceId: `mein:${uid}`, privat: true, uid, expiresAt: tage(expiresInDays), createdAt: tage(expiresInDays - 30), scenario: { id } });
  spielbuch(id);
}
/** Firmen-Szenario samt Spielbuch. */
function firma(workspaceId: string, id: string) {
  db.put("runs", { id, sessionId: scenarioPartitionKey(workspaceId), docType: "sim_scenario", workspaceId, createdAt: tage(-5), scenario: { id } });
  spielbuch(id);
}
function lauf(uid: string, id: string, status: "active" | "finished" | "aborted", updatedInDays: number, extra: Record<string, unknown> = {}) {
  db.put("runs", { id, sessionId: `sim:${uid}`, docType: "simulation", uid, scenarioId: "sim-coaching-morgan", status, createdAt: tage(updatedInDays), updatedAt: tage(updatedInDays), turns: [{ role: "user", text: "Gespräch", ts: "t" }], ...extra });
}
const hatLauf = (uid: string, id: string) => db.has("runs", `sim:${uid}`, id);
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  db.reset();
  claude.message.mockReset();
  protokoll.info.mockReset();
  protokoll.apiError.mockReset();
  delete (globalThis as { __coachAufraeumenAt?: number }).__coachAufraeumenAt;
});

describe("(a) Das Spielbuch geht mit seinem Szenario", () => {
  it("Firmen-Szenario löschen (Builder) löscht auch das Spielbuch, andere bleiben", async () => {
    firma("ws1", "ws-kunde-aaa111");
    firma("ws1", "ws-kunde-bbb222");
    expect(await deleteWorkspaceScenario("ws1", "ws-kunde-aaa111")).toBe(true);
    expect(db.has("runs", scenarioPartitionKey("ws1"), "ws-kunde-aaa111")).toBe(false);
    expect(hatSpielbuch("ws-kunde-aaa111")).toBe(false);
    expect(hatSpielbuch("ws-kunde-bbb222")).toBe(true);
    expect(await deleteWorkspaceScenario("ws1", "ws-gibt-es-nicht")).toBe(false);
  });

  it("privates Szenario löschen und der Verfall beim eigenen Listenaufruf löschen auch das Spielbuch", async () => {
    privat("u1", "ws-mein-aaaa1111", 10);
    privat("u1", "ws-mein-bbbb2222", -1); // abgelaufen
    privat("u1", "ws-mein-cccc3333", 20);
    expect(await deletePrivateScenario("u1", "ws-mein-aaaa1111")).toBe(true);
    expect(hatSpielbuch("ws-mein-aaaa1111")).toBe(false);
    const liste = await listPrivateScenarioDocs("u1", JETZT);
    await tick(); // der Verfall wird neben der Liste gelöscht
    expect(liste.map((d) => d.id)).toEqual(["ws-mein-cccc3333"]);
    expect(db.has("runs", privateScenarioPartitionKey("u1"), "ws-mein-bbbb2222")).toBe(false);
    expect(hatSpielbuch("ws-mein-bbbb2222")).toBe(false);
    expect(hatSpielbuch("ws-mein-cccc3333")).toBe(true);
  });

  it("wird das Szenario gelöscht, während sein Spielbuch noch entsteht, bleibt danach nichts liegen", async () => {
    const scenario = { ...getScenario("sim-coaching-morgan")!, id: "ws-mein-dddd4444" };
    let fertig!: (v: unknown) => void;
    claude.message.mockReturnValue(new Promise((r) => (fertig = r)));
    expect(await ensureSpielbuch(scenario)).toBeNull(); // Erzeugung läuft im Hintergrund
    expect(await deleteSpielbuch(scenario.id)).toBe(true);
    const text = `1. SACHKERN\n2. ZÜGE DES GEGENÜBERS\n3. WISSEN\n4. ÖFFNUNG\n5. NIEMALS\n${"Inhalt ".repeat(300)}`;
    fertig({ text, model: "m", ms: 1, tokens: {} });
    await tick();
    await tick();
    // Die Erzeugung ist gelungen und hat gespeichert; danach wurde das Ergebnis wieder gelöscht.
    expect(protokoll.info.mock.calls.some((c) => c[0] === "[spielbuch] erzeugt")).toBe(true);
    expect(hatSpielbuch(scenario.id)).toBe(false);
  });
});

describe("(a)+(c) Konto-Löschung", () => {
  it("löscht private Szenarien samt Spielbuch und auch abgebrochene Läufe; Fremdes bleibt", async () => {
    privat("u1", "ws-mein-aaaa1111", 10);
    privat("u2", "ws-mein-eeee5555", 10);
    firma("ws1", "ws-kunde-aaa111");
    lauf("u1", "sim-fertig01", "finished", -3);
    lauf("u1", "sim-abbruch1", "aborted", -2); // in keiner Liste sichtbar
    lauf("u2", "sim-abbruch2", "aborted", -2);
    db.put("users", { id: "u1" });
    const r = await deleteAccount("u1", "u1");
    expect(r.runsDeleted).toBe(3); // zwei Läufe und das private Szenario
    expect(hatLauf("u1", "sim-fertig01")).toBe(false);
    expect(hatLauf("u1", "sim-abbruch1")).toBe(false);
    expect(db.has("runs", privateScenarioPartitionKey("u1"), "ws-mein-aaaa1111")).toBe(false);
    expect(hatSpielbuch("ws-mein-aaaa1111")).toBe(false);
    expect(r.profileDeleted).toBe(true);
    // Die andere Person und die Firma sind unberührt.
    expect(hatLauf("u2", "sim-abbruch2")).toBe(true);
    expect(hatSpielbuch("ws-mein-eeee5555")).toBe(true);
    expect(hatSpielbuch("ws-kunde-aaa111")).toBe(true);
    // Die Abfrage der Lern-Historie kennt keinen Statusfilter: Abgebrochenes ist immer dabei.
    expect(db.queries[0]).toBe("SELECT c.id, c.sessionId, c.workspaceId FROM c WHERE c.uid = @uid");
  });

  it("„Lern-Historie löschen“ nimmt denselben Weg", async () => {
    privat("u1", "ws-mein-aaaa1111", 10);
    lauf("u1", "sim-abbruch1", "aborted", -2);
    await deleteLearningHistory("u1", null);
    expect(db.ids("runs")).toEqual([]);
  });
});

describe("(a) Firmen-Löschung", () => {
  it("löscht die Spielbücher der Firmen-Szenarien und der privaten Szenarien ihrer Konten", async () => {
    firma("ws1", "ws-kunde-aaa111");
    firma("ws1", "ws-kunde-bbb222");
    firma("ws2", "ws-andere-ccc333");
    privat("u1", "ws-mein-aaaa1111", 10);
    lauf("u1", "sim-abbruch1", "aborted", -2);
    db.put("users", { id: "u1", workspaceId: "ws1" });
    const req = new NextRequest("http://localhost/api/service/workspace-purge", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "ws1", oids: [] }),
    });
    const res = await workspacePurge(req);
    expect(await res.json()).toMatchObject({ ok: true, accountsDeleted: 1, scenariosDeleted: 2 });
    expect(db.ids("runs")).toEqual(["spielbuch:ws-andere-ccc333", "ws-andere-ccc333"]);
  });

  it("S2 (12.11.2026): findet Microsoft-Konten über `entraOid` im Profil und zählt nur, wo etwas gelöscht wurde", async () => {
    // Microsoft-Konto: Der Coach schlüsselt auf den OIDC-sub, das Register kennt nur die oid.
    db.put("users", { id: "sub-anna", entraOid: "oid-anna" });
    lauf("sub-anna", "sim-anna-1", "finished", -3);
    lauf("sub-anna", "sim-anna-2", "active", -1);
    // PulseNorth-Konto: Kennung und Nutzer-Kennung sind gleich.
    lauf("ml:bert", "sim-bert-1", "finished", -3);
    // Fremde Person einer anderen Firma bleibt.
    db.put("users", { id: "sub-fremd", entraOid: "oid-fremd" });
    lauf("sub-fremd", "sim-fremd-1", "finished", -3);
    const req = new NextRequest("http://localhost/api/service/workspace-purge", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "ws1", oids: ["oid-anna", "ml:bert", "oid-niemand"] }),
    });
    const res = await workspacePurge(req);
    expect(await res.json()).toMatchObject({ ok: true, accountsDeleted: 2, accountsEmpty: 1 });
    expect(hatLauf("sub-anna", "sim-anna-1")).toBe(false);
    expect(hatLauf("sub-anna", "sim-anna-2")).toBe(false);
    expect(hatLauf("ml:bert", "sim-bert-1")).toBe(false);
    expect(db.ids("users")).toEqual(["sub-fremd"]);
    expect(hatLauf("sub-fremd", "sim-fremd-1")).toBe(true);
  });

  it("S2: die Dienst-Löschung einer Person sagt, ob etwas zu löschen war", async () => {
    db.put("users", { id: "sub-anna", entraOid: "oid-anna" });
    lauf("sub-anna", "sim-anna-1", "finished", -3);
    const ruf = (oid: string) =>
      anonymize(new NextRequest("http://localhost/api/service/anonymize", { method: "POST", body: JSON.stringify({ oid }) }));
    expect(await (await ruf("oid-anna")).json()).toMatchObject({ ok: true, found: true, result: { runsDeleted: 1, profileDeleted: true } });
    expect(hatLauf("sub-anna", "sim-anna-1")).toBe(false);
    expect(await (await ruf("oid-niemand")).json()).toMatchObject({ ok: true, found: false, result: { runsDeleted: 0 } });
  });
});

describe("(b)+(c) Gelegentlicher Aufräumer", () => {
  function bestand() {
    privat("u1", "ws-mein-aaaa1111", -1); // abgelaufen
    privat("u2", "ws-mein-bbbb2222", -40); // abgelaufen, Person kam nie wieder
    privat("u3", "ws-mein-cccc3333", 5); // gilt noch
    firma("ws1", "ws-kunde-aaa111");
    lauf("u1", "sim-abbruch-alt", "aborted", -(ABGEBROCHEN_TAGE + 1));
    lauf("u2", "sim-abbruch-neu", "aborted", -(ABGEBROCHEN_TAGE - 1));
    // Offene Credit-Buchung (C8): Der Lauf bleibt als Spur für den Abgleich liegen, auch nach 30 Tagen.
    lauf("u3", "sim-abbruch-offen", "aborted", -(ABGEBROCHEN_TAGE + 5), { openCharge: { key: "sim-finish:sim-abbruch-offen:0", at: "t" } });
    lauf("u2", "sim-aktiv-alt1", "active", -90);
    lauf("u3", "sim-fertig-alt", "finished", -90);
  }

  it("löscht abgelaufene private Szenarien aller Personen samt Spielbuch und abgebrochene Läufe nach 30 Tagen, sonst nichts", async () => {
    bestand();
    expect(await raeumeAuf(JETZT)).toEqual({ szenarien: 2, laeufe: 1 });
    expect(db.ids("runs")).toEqual(
      ["sim-abbruch-neu", "sim-abbruch-offen", "sim-aktiv-alt1", "sim-fertig-alt", "spielbuch:ws-kunde-aaa111", "spielbuch:ws-mein-cccc3333", "ws-kunde-aaa111", "ws-mein-cccc3333"].sort()
    );
    expect(await raeumeAuf(JETZT)).toEqual({ szenarien: 0, laeufe: 0 });
  });

  it("scheitert ein Teil, läuft der andere trotzdem, und nichts wirft", async () => {
    bestand();
    const echt = db.cosmos.queryItems;
    db.cosmos.queryItems = async (c, query, params) => {
      if (query.includes("c.privat = true")) throw new Error("Cosmos nicht erreichbar");
      return echt(c, query, params);
    };
    try {
      expect(await raeumeAuf(JETZT)).toEqual({ szenarien: null, laeufe: 1 });
      expect(protokoll.apiError).toHaveBeenCalledTimes(1);
    } finally {
      db.cosmos.queryItems = echt;
    }
  });

  it("läuft höchstens einmal pro Stunde je Prozess, blockiert den Aufrufer nicht und schreibt eine Protokollzeile", async () => {
    bestand();
    const t0 = JETZT.getTime();
    aufraeumenAnstossen(t0);
    expect(hatLauf("u1", "sim-abbruch-alt")).toBe(true); // noch nichts gelöscht: der Aufrufer wartet nicht
    await tick();
    await tick();
    expect(hatLauf("u1", "sim-abbruch-alt")).toBe(false);
    expect(protokoll.info).toHaveBeenCalledTimes(1);
    expect(protokoll.info.mock.calls[0][1]).toMatchObject({ szenarien: 2, laeufe: 1 });

    const abfragen = db.queries.length;
    aufraeumenAnstossen(t0 + AUFRAEUMEN_ABSTAND_MS - 1);
    await tick();
    expect(db.queries.length).toBe(abfragen); // innerhalb der Stunde: kein zweiter Durchgang
    aufraeumenAnstossen(t0 + AUFRAEUMEN_ABSTAND_MS);
    await tick();
    await tick();
    expect(db.queries.length).toBe(abfragen + 2);
    expect(protokoll.info).toHaveBeenCalledTimes(2);
  });
});
