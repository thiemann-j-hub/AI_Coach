import { describe, expect, it } from "vitest";
import {
  PRIVACY_EMPLOYEE_LABEL,
  PRIVACY_LEADER_LABEL,
  buildAnalyzeRoleLabels,
} from "./analyze-payload";
import { sanitizeTranscript } from "./transcript-utils";

/**
 * P1-Payload-Snapshot (COACH-UX-BLUEPRINT §6): bei privacyMode dürfen die
 * Klarnamen NICHT als Labels ins Payload — und die generischen Labels müssen
 * exakt denen entsprechen, die sanitizeTranscript ins Transkript schreibt
 * (sonst zerreißt die Rollen-Zuordnung im Prompt).
 */
describe("buildAnalyzeRoleLabels (P1)", () => {
  it("privacyMode on: generische Labels statt Klarnamen", () => {
    const out = buildAnalyzeRoleLabels({
      privacyMode: true,
      leaderLabel: "Anna Müller",
      employeeLabel: "Thomas Schmidt",
    });
    expect(out).toEqual({
      leaderLabel: PRIVACY_LEADER_LABEL,
      employeeLabel: PRIVACY_EMPLOYEE_LABEL,
    });
    expect(JSON.stringify(out)).not.toContain("Anna");
    expect(JSON.stringify(out)).not.toContain("Schmidt");
  });

  it("privacyMode off: Klarnamen unverändert (bewusste Nutzerentscheidung)", () => {
    const out = buildAnalyzeRoleLabels({
      privacyMode: false,
      leaderLabel: "Anna Müller",
      employeeLabel: "Thomas Schmidt",
    });
    expect(out).toEqual({ leaderLabel: "Anna Müller", employeeLabel: "Thomas Schmidt" });
  });

  it("Labels sind byte-identisch zu den sanitizeTranscript-Ersetzungen", () => {
    const sanitized = sanitizeTranscript("Anna Müller: Hallo!\nThomas Schmidt: Guten Tag.", {
      leaderLabel: "Anna Müller",
      employeeLabel: "Thomas Schmidt",
      detectedSpeakers: ["Anna Müller", "Thomas Schmidt"],
      extraTerms: [],
    });
    expect(sanitized).toContain(`${PRIVACY_LEADER_LABEL}: Hallo!`);
    expect(sanitized).toContain(`${PRIVACY_EMPLOYEE_LABEL}: Guten Tag.`);
  });
});
