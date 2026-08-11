import { describe, expect, it } from "vitest";
import { truncateAtWord } from "./simulation-evaluation";

/**
 * W3-2: Der vorbefüllte Vorsatz steht im Eingabefeld des Nutzers — ein
 * harter Zeichen-Schnitt endete mitten im Wort (Test-Fund 11.08.).
 */
describe("truncateAtWord (Vorsatz-Vorbefüllung)", () => {
  const long =
    "Übe, wie du auf direkten Widerstand reagierst, wenn deine Vorschläge als vollendete " +
    "Tatsachen wahrgenommen werden, indem du zunächst die Bedenken verstehst, bevor du deine " +
    "Lösung anbietest. Versuche, die Themen einzeln zu verhandeln, statt alles zu bündeln.";

  it("kürzt nie mitten im Wort", () => {
    const out = truncateAtWord(long, 280);
    expect(out.length).toBeLessThanOrEqual(280);
    // Letztes Zeichen ist Wortende oder Satzzeichen, kein Wortfragment.
    expect(out).not.toMatch(/\s\S{1,3}$/);
    expect(long.startsWith(out.replace(/\.$/, "").trim().slice(0, 40))).toBe(true);
  });

  it("bevorzugt das Satzende, wenn es nicht zu früh liegt", () => {
    const out = truncateAtWord(long, 280);
    expect(out.endsWith(".")).toBe(true);
  });

  it("kurze Texte bleiben unverändert", () => {
    expect(truncateAtWord("Kurz und knapp.", 280)).toBe("Kurz und knapp.");
  });

  it("robust gegen leere/kaputte Eingaben", () => {
    expect(truncateAtWord("", 280)).toBe("");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(truncateAtWord(null as any, 280)).toBe("");
  });

  it("ohne Leerzeichen wird hart geschnitten (kein Endlos-String)", () => {
    const solid = "x".repeat(400);
    expect(truncateAtWord(solid, 280)).toHaveLength(280);
  });
});
