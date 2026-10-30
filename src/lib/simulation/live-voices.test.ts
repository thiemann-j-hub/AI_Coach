import { describe, expect, it } from "vitest";
import en from "@/i18n/dictionaries/en.json";
import de from "@/i18n/dictionaries/de.json";
import { LIVE_VOICES, defaultLiveVoice, fallbackPersonaVoice, isLiveVoice, liveVoiceSamplePath } from "./live-voices";

describe("Live-Stimmen (Builder-Katalog)", () => {
  it("führt 30 Stimmen mit eindeutigen Namen, 14 weiblich und 16 männlich", () => {
    expect(LIVE_VOICES.length).toBe(30);
    expect(new Set(LIVE_VOICES.map((v) => v.id)).size).toBe(30);
    expect(LIVE_VOICES.filter((v) => v.gender === "w").length).toBe(14);
    expect(LIVE_VOICES.filter((v) => v.gender === "m").length).toBe(16);
  });

  it("hat für jedes Charakterwort einen Wörterbuch-Text (de + en)", () => {
    for (const v of LIVE_VOICES) {
      expect(de.simulation.liveVoiceCharacter[v.character], `de ${v.id}`).toBeTruthy();
      expect(en.simulation.liveVoiceCharacter[v.character], `en ${v.id}`).toBeTruthy();
    }
  });

  it("fällt ohne eigene Live-Stimme auf Aoede (weiblich) bzw. Charon (männlich) zurück", () => {
    expect(defaultLiveVoice("seraphina-hd")).toBe("Aoede");
    expect(defaultLiveVoice("emma-hd")).toBe("Aoede");
    expect(defaultLiveVoice("florian-hd")).toBe("Charon");
    expect(defaultLiveVoice(undefined)).toBe("Charon");
    expect(isLiveVoice(defaultLiveVoice(undefined))).toBe(true);
  });

  it("leitet die Vorlesestimme für den Textweg aus Geschlecht und Sprache ab", () => {
    expect(fallbackPersonaVoice("Aoede", "de")).toBe("seraphina-hd");
    expect(fallbackPersonaVoice("Aoede", "en")).toBe("emma-hd");
    expect(fallbackPersonaVoice("Charon", "en")).toBe("florian-hd");
    expect(liveVoiceSamplePath("Achird")).toBe("/stimmen/Achird.mp3");
  });
});
