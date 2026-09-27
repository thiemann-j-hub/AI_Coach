import { describe, expect, it } from "vitest";
import { buildTransferReviewText, isTransferOutcome, transferCheckMinHours } from "./transfer";

describe("transfer (O2 Micro-Transfer)", () => {
  it("baut die Kontextzeile de/en, ohne dismissed", () => {
    expect(
      buildTransferReviewText({ lang: "de", commitmentText: "Morgen im 1:1 zuerst fragen, dann vorschlagen.", outcome: "partly", note: "nur beim ersten Thema" })
    ).toBe("Vorsatz nach dem letzten Debrief: „Morgen im 1:1 zuerst fragen, dann vorschlagen.“ — der/die Lernende meldet zurück: hat es teilweise ausprobiert („nur beim ersten Thema“).");
    expect(buildTransferReviewText({ lang: "en", commitmentText: "Ask first.", outcome: "done" })).toBe(
      'Intention after the last debrief: "Ask first." — the learner reports: tried it.'
    );
    expect(buildTransferReviewText({ lang: "de", commitmentText: "x", outcome: "dismissed" })).toBe("");
    expect(buildTransferReviewText({ lang: "de", commitmentText: "  ", outcome: "done" })).toBe("");
  });

  it("Outcome-Guard und Mindestalter", () => {
    expect(isTransferOutcome("done")).toBe(true);
    expect(isTransferOutcome("later")).toBe(false);
    const prev = process.env.TRANSFER_CHECK_MIN_HOURS;
    delete process.env.TRANSFER_CHECK_MIN_HOURS;
    expect(transferCheckMinHours()).toBe(72);
    process.env.TRANSFER_CHECK_MIN_HOURS = "0";
    expect(transferCheckMinHours()).toBe(0);
    if (prev === undefined) delete process.env.TRANSFER_CHECK_MIN_HOURS;
    else process.env.TRANSFER_CHECK_MIN_HOURS = prev;
  });
});
