import { describe, expect, it } from "vitest";
import { hubLoginEnabled, hubLoginUrl } from "./hub-login";

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
