import { describe, expect, it } from "vitest";
import { hubLoginEnabled, hubLoginUrl, reLoginViaHub } from "./hub-login";

describe("Eine Anmeldung im Hub", () => {
  it("gilt hinter der gemeinsamen Adresse, nicht im Direktbetrieb", () => {
    expect(hubLoginEnabled("/coach")).toBe(true);
    expect(hubLoginEnabled("")).toBe(false);
  });

  it("setzt den Basis-Pfad vor einen App-Pfad", () => {
    expect(hubLoginUrl("/analyze", "/coach")).toBe("/?next=%2Fcoach%2Fanalyze");
    expect(hubLoginUrl("analyze", "/coach")).toBe("/?next=%2Fcoach%2Fanalyze");
  });

  it("lässt einen Pfad mit Basis-Pfad unverändert (window.location.pathname)", () => {
    expect(hubLoginUrl("/coach/runs/s1/r1", "/coach")).toBe("/?next=%2Fcoach%2Fruns%2Fs1%2Fr1");
    expect(hubLoginUrl("/coach", "/coach")).toBe("/?next=%2Fcoach");
  });

  it("behält die Suche in der Adresse", () => {
    expect(hubLoginUrl("/coach/analyze?sessionId=abc", "/coach")).toBe(
      "/?next=%2Fcoach%2Fanalyze%3FsessionId%3Dabc"
    );
  });
});

describe("„Neu anmelden“ — wohin? (Anmeldung-Umbau Schritt 2c)", () => {
  const PN_ID = "ml:0b1c2d3e-0000-4000-8000-000000000001";

  it("ein PulseNorth-Konto geht immer zur Anmeldekarte im Hub, nie direkt zu Microsoft", () => {
    expect(reLoginViaHub(PN_ID, "/coach")).toBe(true);
    expect(reLoginViaHub(PN_ID, "")).toBe(true);
  });

  it("ein Microsoft-Konto meldet sich wie bisher direkt bei Microsoft neu an", () => {
    expect(reLoginViaHub("sub-1", "/coach")).toBe(false);
    expect(reLoginViaHub("11111111-2222-4333-8444-555555555555", "/coach")).toBe(false);
    expect(reLoginViaHub("sub-1", "")).toBe(false);
  });

  it("ohne bekannte Sitzung: hinter der gemeinsamen Adresse zum Hub, im Direktbetrieb wie bisher", () => {
    expect(reLoginViaHub(null, "/coach")).toBe(true);
    expect(reLoginViaHub(undefined, "/coach")).toBe(true);
    expect(reLoginViaHub("", "/coach")).toBe(true);
    expect(reLoginViaHub(null, "")).toBe(false);
    expect(reLoginViaHub(undefined, "")).toBe(false);
  });
});
