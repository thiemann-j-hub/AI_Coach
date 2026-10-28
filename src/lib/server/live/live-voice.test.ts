import { describe, expect, it } from "vitest";
import { liveLanguageCode, liveVoiceFor } from "./live-voice";

describe("Live-Stimmen", () => {
  it("ordnet die bestandenen Stimmen zu", () => {
    expect(liveVoiceFor("seraphina-hd")).toBe("Aoede");
    expect(liveVoiceFor("florian-hd")).toBe("Charon");
    expect(liveVoiceFor("emma-hd")).toBe("Aoede");
    expect(liveVoiceFor(undefined)).toBe("Charon");
  });

  it("gibt den acht Standard-Szenarien ihre gewählte Stimme (Owner-Wahl 28.10.)", () => {
    expect(liveVoiceFor("seraphina-hd", "sim-coaching-morgan")).toBe("Aoede");
    expect(liveVoiceFor("florian-hd", "sim-peer-lang")).toBe("Alnilam");
    expect(liveVoiceFor("florian-hd", "sim-critique-vance")).toBe("Puck");
    expect(liveVoiceFor("florian-hd", "sim-azubi-roth")).toBe("Zubenelgenubi");
    expect(liveVoiceFor("florian-hd", "sim-performance-reed")).toBe("Charon");
    expect(liveVoiceFor("florian-hd", "sim-merge-brandt")).toBe("Achird");
    expect(liveVoiceFor("florian-hd", "sim-peer-falk")).toBe("Algieba");
    expect(liveVoiceFor("florian-hd", "sim-appraisal-stone")).toBe("Iapetus");
    // Kundenszenarien aus dem Builder: Rückfall nach Persona-Stimme
    expect(liveVoiceFor("florian-hd", "custom-123")).toBe("Charon");
    expect(liveVoiceFor("emma-hd", "custom-123")).toBe("Aoede");
    // Builder-Wahl geht vor; unbekannte Namen werden ignoriert
    expect(liveVoiceFor("florian-hd", "custom-123", "Sulafat")).toBe("Sulafat");
    expect(liveVoiceFor("florian-hd", "sim-peer-lang", "Gacrux")).toBe("Gacrux");
    expect(liveVoiceFor("florian-hd", "custom-123", "Nixda")).toBe("Charon");
  });

  it("spricht die Gesprächssprache", () => {
    expect(liveLanguageCode("de")).toBe("de-DE");
    expect(liveLanguageCode("en")).toBe("en-US");
    expect(liveLanguageCode("es")).toBe("es-ES");
    expect(liveLanguageCode("fr")).toBe("fr-FR");
    expect(liveLanguageCode(undefined)).toBe("de-DE");
  });
});
