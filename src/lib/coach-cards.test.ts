import { beforeEach, describe, expect, it, vi } from "vitest";

const searchMock = vi.fn();
vi.mock("@/lib/cosmos-cards", () => ({ searchCards: (a: unknown) => searchMock(a) }));

import {
  buildCoachQuery,
  cardLang,
  cardWhenToUse,
  cardsToPromptBlock,
  matchCardsByTitle,
  retrieveCoachCards,
  type CoachCardRef,
} from "./coach-cards";

const CHUNK =
  "TITLE: Redeanteil steuern: 40/60 statt Monolog\n\nWHEN TO USE:\nWenn du merkst, dass du mehr redest als dein Gegenüber.\n\nSTEPS:\n1. Frage stellen.\n2. Warten.\n\nEXAMPLE PHRASES:\n„Wie siehst du das?“\n";

function card(id: string, title: string): CoachCardRef {
  return { id, groupId: id, title, hint: "", cardType: "checklist", chunkText: `TITLE: ${title}\n` };
}

describe("coach-cards (V3)", () => {
  beforeEach(() => searchMock.mockReset());

  it("cardLang: Gesprächssprache de/en gewinnt, sonst Szenario-Locale", () => {
    expect(cardLang("en", "de")).toBe("en");
    expect(cardLang("fr", "de")).toBe("de");
    expect(cardLang(undefined, "en")).toBe("en");
  });

  it("buildCoachQuery: Kopf + ENDE des Verlaufs, gedeckelt", () => {
    const long = "A".repeat(5000) + " SCHLUSS";
    const q = buildCoachQuery({ conversationType: "leadership_1on1", title: "T", goals: ["g1"], transcript: long, maxChars: 800 });
    expect(q.startsWith("conversationType: leadership_1on1\nSzenario: T\nZiele: g1\n")).toBe(true);
    expect(q.endsWith("SCHLUSS")).toBe(true);
    expect(q.length).toBeLessThanOrEqual(900);
  });

  it("cardWhenToUse: zieht den WHEN-TO-USE-Absatz", () => {
    expect(cardWhenToUse(CHUNK)).toBe("Wenn du merkst, dass du mehr redest als dein Gegenüber.");
    expect(cardWhenToUse("kein Format")).toBe("");
  });

  it("matchCardsByTitle: tolerant, dublettenfrei, max 2", () => {
    const cards = [
      card("a", "Redeanteil steuern: 40/60 statt Monolog"),
      card("b", "Loops schließen: Verbindlichkeit in 5 Minuten"),
      card("c", "Dritte"),
    ];
    const hit = matchCardsByTitle(cards, [
      "redeanteil steuern",
      "Loops schließen: Verbindlichkeit in 5 Minuten",
      "Loops schließen",
      "Dritte",
    ]);
    expect(hit.map((c) => c.id)).toEqual(["a", "b"]);
    expect(matchCardsByTitle(cards, ["gibt es nicht"])).toEqual([]);
  });

  it("retrieveCoachCards: mappt Treffer und ist fail-open", async () => {
    searchMock.mockResolvedValueOnce({
      count: 1,
      results: [
        {
          id: "CARD-AC-TALK-RATIO-de",
          score: 0.1,
          metadata: {
            title: "Redeanteil steuern: 40/60 statt Monolog",
            card_group_id: "CARD-AC-TALK-RATIO",
            card_type: "checklist",
            chunk_text: CHUNK,
          },
        },
      ],
    });
    const ok = await retrieveCoachCards({ text: "Monolog", lang: "de" });
    expect(ok.error).toBeNull();
    expect(ok.cards).toHaveLength(1);
    expect(ok.cards[0].hint).toMatch(/mehr redest/);
    expect(searchMock).toHaveBeenCalledWith(expect.objectContaining({ lang: "de", topK: 5 }));
    expect(cardsToPromptBlock(ok.cards)).toMatch(/^### Redeanteil steuern/);

    searchMock.mockRejectedValueOnce(new Error("COSMOS_ENDPOINT / COSMOS_KEY not configured"));
    const bad = await retrieveCoachCards({ text: "Monolog", lang: "de" });
    expect(bad.cards).toEqual([]);
    expect(bad.error).toMatch(/not configured/);

    const empty = await retrieveCoachCards({ text: "   ", lang: "de" });
    expect(empty.cards).toEqual([]);
    expect(searchMock).toHaveBeenCalledTimes(2);
  });
});
