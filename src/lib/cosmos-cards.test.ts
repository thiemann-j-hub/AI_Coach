import { describe, expect, it } from "vitest";
import { _test } from "./cosmos-cards";

/**
 * E-4 (Owner-GO 25.09.2026): Das Retrieval liefert NUR freigegebene Karten.
 * Der WHERE-Kern muss status='published' als Pflichtprädikat tragen — auch
 * wenn ein Aufrufer 'status' im Filter mitschickt (autoritativ, nicht
 * überschreibbar). Nur der Prüfweg (includeDraft) darf Entwürfe sehen.
 */
describe("cosmos-cards — buildWhere (E-4 published-Pflicht)", () => {
  it("setzt namespace + status='published' immer", () => {
    const params: Array<{ name: string; value: unknown }> = [];
    const where = _test.buildWhere(undefined, undefined, params);
    expect(where).toBe("c.namespace = @p0 AND c.status = @p1");
    expect(params.map((p) => p.value)).toEqual([_test.NAMESPACE, "published"]);
  });

  it("ignoriert einen status-Filter des Aufrufers, behält übrige Filter + lang", () => {
    const params: Array<{ name: string; value: unknown }> = [];
    const where = _test.buildWhere(
      { status: "draft", jurisdiction: { $in: ["de_eu", "global"] }, unknown_field: "x" },
      "de",
      params
    );
    expect(where).toBe(
      "c.namespace = @p0 AND c.status = @p1 AND ARRAY_CONTAINS(@p2, c.jurisdiction) AND c.lang = @p3"
    );
    expect(params.map((p) => p.value)).toEqual([_test.NAMESPACE, "published", ["de_eu", "global"], "de"]);
  });

  it("includeDraft lässt das Statusprädikat weg (nur Prüfweg)", () => {
    const params: Array<{ name: string; value: unknown }> = [];
    const where = _test.buildWhere(undefined, "en", params, true);
    expect(where).toBe("c.namespace = @p0 AND c.lang = @p1");
    expect(params.map((p) => p.value)).toEqual([_test.NAMESPACE, "en"]);
  });
});
