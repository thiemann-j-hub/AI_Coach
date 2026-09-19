import { afterEach, describe, expect, it } from "vitest";
import {
  TTS_VOICES,
  azureTtsConfigured,
  bcp47ForLocale,
  buildTtsSsml,
  escapeXmlText,
  isPersonaVoice,
  prependAiId3Tag,
} from "./azure-tts";
import { PERSONA_VOICES } from "@/lib/simulation/types";

describe("azure-tts (Persona-Stimme, Owner-GO 19.09.)", () => {
  const envBackup = { key: process.env.AZURE_SPEECH_KEY, region: process.env.AZURE_SPEECH_REGION };
  afterEach(() => {
    process.env.AZURE_SPEECH_KEY = envBackup.key;
    process.env.AZURE_SPEECH_REGION = envBackup.region;
  });

  it("Whitelist: genau die drei Hörtest-Stimmen, jede mit Azure-Namen", () => {
    expect(TTS_VOICES.map((v) => v.id)).toEqual([...PERSONA_VOICES]);
    for (const v of TTS_VOICES) expect(v.azureName).toMatch(/DragonHDLatestNeural$/);
    expect(isPersonaVoice("florian-hd")).toBe(true);
    expect(isPersonaVoice("Microsoft Hedda")).toBe(false);
    expect(isPersonaVoice(undefined)).toBe(false);
  });

  it("SSML: Stimme, Sprache, Escaping — kein Markup aus dem Text passiert", () => {
    const ssml = buildTtsSsml({
      text: 'Hallo <voice name="x"> & "Tschüss"',
      voice: "florian-hd",
      locale: "de",
    });
    expect(ssml).toContain('<voice name="de-DE-Florian:DragonHDLatestNeural">');
    expect(ssml).toContain('xml:lang="de-DE"');
    expect(ssml).toContain("&lt;voice name=&quot;x&quot;&gt; &amp; &quot;Tschüss&quot;");
    expect(ssml.match(/<voice /g)?.length).toBe(1);
  });

  it("SSML: Absätze werden zu kurzen Pausen, unbekannte Stimme fällt auf die erste zurück", () => {
    const ssml = buildTtsSsml({
      text: "Erster Absatz.\n\nZweiter Absatz.",
      voice: "nicht-da" as never,
      locale: "en",
    });
    expect(ssml).toContain('<break time="400ms"/>');
    expect(ssml).toContain(TTS_VOICES[0].azureName);
    expect(ssml).toContain('xml:lang="en-GB"');
  });

  it("Locale-Abbildung: vier Coach-Sprachen, Fallback de-DE", () => {
    expect(bcp47ForLocale("fr")).toBe("fr-FR");
    expect(bcp47ForLocale("es")).toBe("es-ES");
    expect(bcp47ForLocale(undefined)).toBe("de-DE");
    expect(bcp47ForLocale("xx")).toBe("de-DE");
    expect(escapeXmlText("a'b")).toBe("a&apos;b");
  });

  it("Konfig-Check: ohne Key/Region ehrlich false (Route liefert 503)", () => {
    delete process.env.AZURE_SPEECH_KEY;
    delete process.env.AZURE_SPEECH_REGION;
    expect(azureTtsConfigured()).toBe(false);
    process.env.AZURE_SPEECH_KEY = "k";
    process.env.AZURE_SPEECH_REGION = "westeurope";
    expect(azureTtsConfigured()).toBe(true);
  });

  it("ID3-Kennzeichnung (Art. 50) steht vor den MP3-Daten und lässt sie unverändert", () => {
    const mp3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 1, 2, 3]);
    const out = prependAiId3Tag(mp3);
    expect(String.fromCharCode(out[0], out[1], out[2])).toBe("ID3");
    expect(out.slice(out.length - mp3.length)).toEqual(mp3);
    expect(new TextDecoder().decode(out)).toContain("EU AI Act Art. 50");
  });
});
