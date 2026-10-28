import { describe, expect, it } from "vitest";
import { liveLanguageCode, liveVoiceFor } from "./live-voice";

describe("Live-Stimmen", () => {
  it("ordnet die bestandenen Stimmen zu", () => {
    expect(liveVoiceFor("seraphina-hd")).toBe("Aoede");
    expect(liveVoiceFor("florian-hd")).toBe("Charon");
    expect(liveVoiceFor("emma-hd")).toBe("Aoede");
    expect(liveVoiceFor(undefined)).toBe("Charon");
  });

  it("spricht die Gesprächssprache", () => {
    expect(liveLanguageCode("de")).toBe("de-DE");
    expect(liveLanguageCode("en")).toBe("en-US");
    expect(liveLanguageCode("es")).toBe("es-ES");
    expect(liveLanguageCode("fr")).toBe("fr-FR");
    expect(liveLanguageCode(undefined)).toBe("de-DE");
  });
});
