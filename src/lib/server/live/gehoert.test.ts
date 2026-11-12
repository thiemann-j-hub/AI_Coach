import { describe, expect, it } from "vitest";
import { gehoertVomBrowser, kuerzeAufGehoertes, schaetzeGehoertMs, textstandBei, tonMs, type TextMarke } from "./gehoert";

/** Paket 4, S31 (12.11.2026): Zuordnung „Ton-Millisekunden → Textstand“ und Kürzen an der Wortgrenze. */
const TEXT = "Das sehe ich anders. Ich habe drei Kunden gleichzeitig, und keiner wartet gern.";
// Mitschrift in vier Stücken; dahinter jeweils der Ton, der bis dahin unterwegs war.
const MARKEN: TextMarke[] = [
  { ms: 400, zeichen: 20 }, // „Das sehe ich anders.“
  { ms: 1_500, zeichen: 40 }, // „… Ich habe drei Kunde“ (Stück endet mitten im Wort)
  { ms: 2_600, zeichen: 56 }, // „…n gleichzeitig,“
  { ms: 4_000, zeichen: TEXT.length },
];

describe("tonMs", () => {
  it("PCM 24 kHz, 16 Bit, Mono: 48 Bytes je Millisekunde", () => {
    expect(tonMs(48_000)).toBe(1_000);
    expect(tonMs(0)).toBe(0);
  });
});

describe("textstandBei", () => {
  it("nimmt den Stand der letzten Marke, deren Ton schon gespielt war", () => {
    expect(textstandBei(MARKEN, 0)).toBe(0);
    expect(textstandBei(MARKEN, 399)).toBe(0);
    expect(textstandBei(MARKEN, 400)).toBe(20);
    expect(textstandBei(MARKEN, 2_000)).toBe(40);
    expect(textstandBei(MARKEN, 99_000)).toBe(TEXT.length);
    expect(textstandBei([], 5_000)).toBe(0);
  });

  it("Text, der vor dem ersten Ton ankam, zählt erst, wenn Ton gespielt wurde", () => {
    const frueh: TextMarke[] = [{ ms: 0, zeichen: 12 }];
    expect(textstandBei(frueh, 0)).toBe(0);
    expect(textstandBei(frueh, 50)).toBe(12);
  });
});

describe("kuerzeAufGehoertes", () => {
  it("Unterbrechung früh: nur der erste Satz bleibt, „…“ steht für sich", () => {
    const r = kuerzeAufGehoertes(TEXT, MARKEN, 900);
    expect(r.text).toBe("Das sehe ich anders. …");
    expect(r.gekuerzt).toBe(TEXT.length - 20);
  });

  it("Unterbrechung mitten im Wort: zurück bis zum letzten ganzen Wort", () => {
    const r = kuerzeAufGehoertes(TEXT, MARKEN, 1_600);
    expect(r.text).toBe("Das sehe ich anders. Ich habe drei…");
    expect(r.text).not.toContain("Kunde");
  });

  it("Unterbrechung spät: ein Komma vor dem „…“ fällt weg", () => {
    const r = kuerzeAufGehoertes(TEXT, MARKEN, 3_000);
    expect(r.text).toBe("Das sehe ich anders. Ich habe drei Kunden gleichzeitig…");
    expect(r.gekuerzt).toBeGreaterThan(0);
  });

  it("alles gehört: der Text bleibt unverändert, ohne „…“", () => {
    expect(kuerzeAufGehoertes(TEXT, MARKEN, 4_000)).toEqual({ text: TEXT, gekuerzt: 0 });
    expect(kuerzeAufGehoertes(TEXT, MARKEN, 60_000)).toEqual({ text: TEXT, gekuerzt: 0 });
  });

  it("nichts gehört: kein Text der Rolle", () => {
    expect(kuerzeAufGehoertes(TEXT, MARKEN, 0)).toEqual({ text: "", gekuerzt: TEXT.length });
    expect(kuerzeAufGehoertes(TEXT, MARKEN, 200)).toEqual({ text: "", gekuerzt: TEXT.length });
  });

  it("ein einziges angefangenes Wort wird nicht halb gespeichert", () => {
    expect(kuerzeAufGehoertes("Selbstverständlich", [{ ms: 100, zeichen: 6 }, { ms: 900, zeichen: 18 }], 300)).toEqual({ text: "", gekuerzt: 18 });
  });
});

describe("schaetzeGehoertMs (alter Client ohne heard)", () => {
  it("Zeit seit dem ersten Ton, höchstens der Ton, der unterwegs war", () => {
    expect(schaetzeGehoertMs({ ersterTonAt: 10_000, jetzt: 11_200, tonMsGesamt: 8_000 })).toBe(1_200);
    expect(schaetzeGehoertMs({ ersterTonAt: 10_000, jetzt: 30_000, tonMsGesamt: 8_000 })).toBe(8_000);
    expect(schaetzeGehoertMs({ ersterTonAt: null, jetzt: 30_000, tonMsGesamt: 0 })).toBe(0);
    expect(schaetzeGehoertMs({ ersterTonAt: 10_000, jetzt: 9_000, tonMsGesamt: 8_000 })).toBe(0);
  });
});

describe("gehoertVomBrowser", () => {
  it("nimmt nur endliche Zahlen ab 0", () => {
    expect(gehoertVomBrowser(850)).toBe(850);
    expect(gehoertVomBrowser(0)).toBe(0);
    expect(gehoertVomBrowser(-1)).toBeNull();
    expect(gehoertVomBrowser("850")).toBeNull();
    expect(gehoertVomBrowser(Number.NaN)).toBeNull();
    expect(gehoertVomBrowser(undefined)).toBeNull();
  });
});
