import { describe, expect, it } from "vitest";
import { buildBaseFilter } from "./generate-dynamic-feedback";

/**
 * V1 (Owner-GO 25.09., Befund N4-76): Der Kartenfilter des Kundenwegs darf die
 * Wissensbasis nicht mehr auf 10 von 209 Karten verengen.
 */
describe("buildBaseFilter (V1 Kartenfilter)", () => {
  it("jurisdiction wird als $in [eigene, global] gefiltert — nie exakt", () => {
    expect(buildBaseFilter({ jurisdiction: "de_eu" })).toEqual({ jurisdiction: { $in: ["de_eu", "global"] } });
    expect(buildBaseFilter({ jurisdiction: "en_us" })).toEqual({ jurisdiction: { $in: ["en_us", "global"] } });
  });

  it("'global' bleibt global, leer/fehlend ergibt keinen Filter", () => {
    expect(buildBaseFilter({ jurisdiction: "global" })).toEqual({ jurisdiction: "global" });
    expect(buildBaseFilter({ jurisdiction: "" })).toEqual({});
    expect(buildBaseFilter({})).toEqual({});
  });

  it("der Gespraechstyp ist KEIN harter Filter mehr (er bleibt Teil der Suchanfrage)", () => {
    const f = buildBaseFilter({ jurisdiction: "de_eu", conversationType: "feedback" } as never);
    expect(f).not.toHaveProperty("conversation_type");
  });
});
