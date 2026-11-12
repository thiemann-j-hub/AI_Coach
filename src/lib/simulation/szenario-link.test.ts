import { describe, expect, it } from "vitest";
import { szenarioLink } from "./szenario-link";

// S26 (Paket 5, 12.11.2026): „Link kopieren“ im Builder.
describe("szenarioLink", () => {
  it("hinter dem Front Door: …/coach?szenario=<id>", () => {
    expect(szenarioLink("https://app.example.com", "ws-preis-abc123", "/coach")).toBe("https://app.example.com/coach?szenario=ws-preis-abc123");
  });

  it("im Direkt-Modus ohne Basispfad: /?szenario=<id>", () => {
    expect(szenarioLink("https://coach.example.com", "ws-preis-abc123", "")).toBe("https://coach.example.com/?szenario=ws-preis-abc123");
  });

  it("die Id wird für die Adresse kodiert", () => {
    expect(szenarioLink("https://x.example", "ws a&b", "")).toBe("https://x.example/?szenario=ws%20a%26b");
  });
});
