import { describe, expect, it } from "vitest";
import { coachLiveEnabledFor, coachLiveLocation, coachLiveModel, coachLiveScope } from "./flags";

describe("COACH_LIVE (Sprachmodus Live)", () => {
  it("ist ohne Variable aus", () => {
    expect(coachLiveScope({})).toBe("off");
    expect(coachLiveEnabledFor("sim-coaching-morgan", {})).toBe(false);
    expect(coachLiveEnabledFor("sim-coaching-morgan", { COACH_LIVE: "off" })).toBe(false);
    expect(coachLiveEnabledFor("sim-coaching-morgan", { COACH_LIVE: "  " })).toBe(false);
  });

  it("all schaltet jedes Szenario frei", () => {
    expect(coachLiveScope({ COACH_LIVE: "ALL" })).toBe("all");
    expect(coachLiveEnabledFor("ws-123", { COACH_LIVE: "all" })).toBe(true);
  });

  it("eine Liste schaltet genau die genannten Szenarien frei", () => {
    const env = { COACH_LIVE: "sim-coaching-morgan, ws-abc ," };
    expect(coachLiveEnabledFor("sim-coaching-morgan", env)).toBe(true);
    expect(coachLiveEnabledFor("ws-abc", env)).toBe(true);
    expect(coachLiveEnabledFor("sim-peer-lang", env)).toBe(false);
  });

  it("Standort und Modell haben EU-Standards", () => {
    expect(coachLiveLocation({})).toBe("eu");
    expect(coachLiveLocation({ COACH_LIVE_LOCATION: "europe-west1" })).toBe("europe-west1");
    expect(coachLiveModel({})).toBe("gemini-3.8-live");
  });
});
