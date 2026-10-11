import { describe, expect, it } from "vitest";
import { matchCourse } from "./kurs-match";

const k = (title: string, status: string, comps: string[]) => ({ title, status, learnUrl: `/l/${title}`, competencies: comps });

describe("passender Kurs zur Schwäche (N17/C8)", () => {
  it("begonnen vor offen vor abgeschlossen; nur Kurse mit der Kompetenz", () => {
    const m = matchCourse("C3", [k("A", "completed", ["C3"]), k("B", "open", ["C3", "C1"]), k("C", "started", ["C3"]), k("D", "started", ["C2"])]);
    expect(m).toEqual({ kind: "course", title: "C", learnUrl: "/l/C", refresh: false });
  });
  it("abgeschlossen → Auffrischen; widerrufen zählt nicht", () => {
    expect(matchCourse("C3", [k("A", "completed", ["C3"]), k("R", "revoked", ["C3"])])).toEqual({ kind: "course", title: "A", learnUrl: "/l/A", refresh: true });
  });
  it("ohne eigenen Kurs: Empfehlung; sonst null", () => {
    expect(matchCourse("C5", [k("A", "open", ["C3"])], [{ title: "E", competencies: ["C5"] }])).toEqual({ kind: "recommendation", title: "E" });
    expect(matchCourse("C9", [k("A", "open", ["C3"])], [{ title: "E", competencies: ["C5"] }])).toBeNull();
  });
});
