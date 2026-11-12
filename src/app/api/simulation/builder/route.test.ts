import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/**
 * Paket 5 (12.11.2026): Liste des Builders. Je Szenario kommen zwei Angaben dazu:
 * `vorbereitung` (Stand der Rollen-Vorbereitung, C28) nur für freigeschaltete Szenarien, und `freeTestEval`
 * (freier Testlauf, Owner-Entscheid 12.11.2026) nur für die Person, die das Szenario gebaut hat.
 */
const h = vi.hoisted(() => ({
  docs: [] as Array<Record<string, unknown>>,
  admin: true,
  status: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({ requireAuth: async () => ({ uid: "u-ich", email: "a@example.com", oid: "oid-1" }) }));
vi.mock("@/lib/server/scenario-admin", () => ({
  requireWorkspaceAdmin: async () => (h.admin ? { workspaceId: "ws1" } : NextResponse.json({ ok: false, code: "ADMIN_ONLY" }, { status: 403 })),
}));
vi.mock("@/lib/server/scenario-store", () => ({ listWorkspaceScenarioDocs: async () => h.docs }));
vi.mock("@/lib/server/spielbuch/store", () => ({ spielbuchStatus: (...a: unknown[]) => h.status(...a) }));
vi.mock("@/lib/logger", () => ({ logger: { api: vi.fn(), apiError: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { GET } from "./route";

type Item = { id: string; status: string; vorbereitung?: string; freeTestEval?: string };
const liste = async () => {
  const res = await GET(new NextRequest("http://localhost/api/simulation/builder"));
  return { status: res.status, items: ((await res.json()).items ?? []) as Item[] };
};
const doc = (id: string, extra: Record<string, unknown> = {}) => ({ id, createdAt: "t", updatedAt: "t", scenario: { id }, ...extra });

beforeEach(() => {
  process.env.SIMULATION_ENABLED = "on";
  h.docs = [];
  h.admin = true;
  h.status.mockReset();
  h.status.mockResolvedValue("bereit");
});
afterEach(() => {
  delete process.env.SIMULATION_ENABLED;
});

describe("Builder-Liste", () => {
  it("Stand der Vorbereitung nur für freigeschaltete Szenarien; Entwürfe kosten keinen Lesezugriff", async () => {
    h.docs = [doc("ws-a", { status: "published" }), doc("ws-b", { status: "draft" }), doc("ws-alt")];
    h.status.mockImplementation(async (s: { id: string }) => (s.id === "ws-a" ? "laeuft" : "fehlgeschlagen"));
    const { items } = await liste();
    expect(items.map((i) => [i.id, i.status, i.vorbereitung])).toEqual([
      ["ws-a", "published", "laeuft"],
      ["ws-b", "draft", undefined],
      ["ws-alt", "published", "fehlgeschlagen"], // Alt-Dokument ohne Status gilt als freigeschaltet
    ]);
    expect(h.status).toHaveBeenCalledTimes(2);
  });

  it("ohne Auskunft oder bei einem Lesefehler fehlt nur die Anzeige, die Liste kommt trotzdem", async () => {
    h.docs = [doc("ws-a", { status: "published" }), doc("ws-b", { status: "published" })];
    h.status.mockImplementation(async (s: { id: string }) => {
      if (s.id === "ws-a") throw new Error("Datenbank nicht erreichbar");
      return null; // Vorbereitung abgeschaltet
    });
    const { status, items } = await liste();
    expect(status).toBe(200);
    expect(items.every((i) => !("vorbereitung" in i))).toBe(true);
  });

  it("freier Testlauf: nur die Person sieht ihn, die das Szenario gebaut hat", async () => {
    h.docs = [
      doc("ws-meins", { status: "draft", createdByUid: "u-ich", freeTestEval: "offen" }),
      doc("ws-verbraucht", { status: "draft", createdByUid: "u-ich", freeTestEval: "verbraucht" }),
      doc("ws-kollegin", { status: "draft", createdByUid: "u-andere", freeTestEval: "offen" }),
      doc("ws-alt", { status: "draft", createdByUid: "u-ich" }),
    ];
    const { items } = await liste();
    expect(items.map((i) => [i.id, i.freeTestEval])).toEqual([
      ["ws-meins", "offen"],
      ["ws-verbraucht", "verbraucht"],
      ["ws-kollegin", undefined],
      ["ws-alt", undefined],
    ]);
  });

  it("nur für Admins des Arbeitsbereichs", async () => {
    h.admin = false;
    expect((await liste()).status).toBe(403);
    expect(h.status).not.toHaveBeenCalled();
  });
});
