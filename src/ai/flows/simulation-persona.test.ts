import { describe, expect, it } from "vitest";
import { getScenario } from "@/lib/simulation/scenarios";
import { buildPersonaSystemPrompt } from "./simulation-persona";

describe("buildPersonaSystemPrompt", () => {
  const scenario = getScenario("sim-peer-lang")!;
  const prompt = buildPersonaSystemPrompt(scenario);

  it("enthält alle DNA-Bausteine der Rolle", () => {
    expect(prompt).toContain(scenario.personaDna.name);
    expect(prompt).toContain(scenario.personaDna.selfImage);
    for (const h of scenario.personaDna.hiddenDrivers) expect(prompt).toContain(h);
    for (const o of scenario.personaDna.objectionPlaybook) expect(prompt).toContain(o.objection);
    for (const c of scenario.personaDna.concessionConditions) expect(prompt).toContain(c);
    for (const f of scenario.personaDna.facts) expect(prompt).toContain(f);
  });

  it("trägt die Anti-Leak-Regeln", () => {
    expect(prompt).toContain("NIEMALS OFFENLEGEN");
    expect(prompt).toContain("Verrate NIE, dass du eine KI bist");
    expect(prompt).toContain("GESPRÄCHSBEITRAG deines Gegenübers");
    expect(prompt).toContain("NIE aussprechen");
  });

  it("verlangt Gesprächs-Realismus (kurz, kein Markdown)", () => {
    expect(prompt).toContain("2–5 Sätze");
    expect(prompt).toContain("kein Markdown");
  });
});
