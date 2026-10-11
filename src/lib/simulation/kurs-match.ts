/**
 * Erst Vorhandenes zeigen, dann Neues anbieten (Runde-2-Entwurf N17 / C8, Owner-GO 11.10.2026):
 * Bei einer echten Schwäche (schwächste Kompetenz ≤ 2) sucht die Auswertung zuerst einen Kurs,
 * der genau diese Kompetenz übt — aus den eigenen Kursen der Person (Hub `/api/lernbereich/courses`),
 * dann aus dem Empfehlungs-Pool des Unternehmens. Reine Funktion, geprüft in kurs-match.test.ts.
 */
export interface HubCourseLike {
  title: string;
  status: string;
  learnUrl: string;
  competencies: ReadonlyArray<string>;
}

export interface HubRecommendationLike {
  title: string;
  competencies: ReadonlyArray<string>;
}

export type CourseMatch =
  | { kind: "course"; title: string; learnUrl: string; refresh: boolean }
  | { kind: "recommendation"; title: string }
  | null;

/** Reihenfolge: begonnen → offen → fällig/abgelaufen → abgeschlossen (Auffrischen) → Empfehlung. */
const RANK: Record<string, number> = { started: 0, open: 1, recertDue: 2, expired: 2, completed: 3 };

export function matchCourse(
  cKey: string,
  courses: ReadonlyArray<HubCourseLike>,
  recommendations: ReadonlyArray<HubRecommendationLike> = []
): CourseMatch {
  const hit = courses
    .filter((c) => c.competencies.includes(cKey) && c.status in RANK && c.learnUrl)
    .sort((a, b) => RANK[a.status] - RANK[b.status]);
  if (hit[0]) return { kind: "course", title: hit[0].title, learnUrl: hit[0].learnUrl, refresh: hit[0].status === "completed" };
  const rec = recommendations.find((r) => r.competencies.includes(cKey));
  if (rec) return { kind: "recommendation", title: rec.title };
  return null;
}
