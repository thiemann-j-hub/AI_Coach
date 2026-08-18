/**
 * B3a (Welle B, Synthesia-Vergleich §7): hartes Zod-Schema für Szenarien —
 * der Autoren-Vertrag der 13-Felder-DNA wird MASCHINELL erzwungen statt
 * gehofft. Jeder Concierge-Entwurf (Owner von Hand, später Generator B3b)
 * muss dieses Schema fehlerfrei passieren, bevor er in die DB darf.
 *
 * Die Regeln spiegeln die Autoren-Erfahrung der 8 Bestands-Szenarien und
 * Synthesias Autorenregeln (Background ohne Situation, Einwand mit Auslöser,
 * beobachtbare Skills mit Gewichten, genau 3 Ziele, 5 Checkpoints).
 */
import { z } from "zod";
import type { SimulationScenario } from "./types";

const nonEmpty = (max: number) => z.string().trim().min(1).max(max);

const factVisualSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("trend"),
    title: nonEmpty(120),
    unit: z.string().max(20).optional(),
    note: z.string().max(300).optional(),
    points: z
      .array(z.object({ label: nonEmpty(40), value: z.number(), approx: z.boolean().optional() }))
      .min(2)
      .max(12),
  }),
  z.object({
    kind: z.literal("bars"),
    title: nonEmpty(120),
    min: z.number().optional(),
    max: z.number(),
    unit: z.string().max(20).optional(),
    note: z.string().max(300).optional(),
    items: z.array(z.object({ label: nonEmpty(60), value: z.number() })).min(1).max(12),
  }),
  z.object({
    kind: z.literal("kpis"),
    title: nonEmpty(120),
    note: z.string().max(300).optional(),
    items: z
      .array(z.object({ label: nonEmpty(60), value: nonEmpty(40), sub: z.string().max(120).optional() }))
      .min(1)
      .max(8),
  }),
]);

export const personaDnaSchema = z.object({
  name: nonEmpty(60),
  role: nonEmpty(120),
  background: nonEmpty(1200),
  selfImage: nonEmpty(600),
  publicBehavior: z.array(nonEmpty(300)).min(2).max(8),
  hiddenDrivers: z.array(nonEmpty(300)).min(1).max(6),
  positions: z.array(nonEmpty(300)).min(1).max(6),
  interests: z.array(nonEmpty(300)).min(1).max(6),
  objectionPlaybook: z
    .array(z.object({ trigger: nonEmpty(200), objection: nonEmpty(300) }))
    .min(2)
    .max(10),
  concessionConditions: z.array(nonEmpty(300)).min(1).max(6),
  escalationTriggers: z.array(nonEmpty(300)).min(1).max(6),
  personality: z.object({
    tone: nonEmpty(300),
    quirks: z.array(nonEmpty(400)).min(1).max(6),
  }),
  knowledgeBounds: z.array(nonEmpty(300)).min(1).max(8),
  facts: z.array(nonEmpty(300)).min(1).max(12),
  openingLine: nonEmpty(400),
});

export const candidateBriefingSchema = z.object({
  yourRole: nonEmpty(1200),
  relationship: nonEmpty(1200),
  // 800: kalibriert an den 8 Bestands-Szenarien (roth hat den längsten Vorfall).
  incidents: z.array(nonEmpty(800)).min(1).max(6),
  factSheet: z.array(nonEmpty(300)).max(12).optional(),
  factVisuals: z.array(factVisualSchema).max(6).optional(),
  // Autoren-Regel (AC-Muster): GENAU 3 Ziele — Beziehung + Struktur + Anliegen.
  goals: z.array(nonEmpty(400)).length(3),
  timeboxMin: z.number().int().min(5).max(60),
  approachHints: z.array(nonEmpty(400)).max(6).optional(),
  expectation: z.string().trim().max(400).optional(),
});

export const assessmentSchema = z
  .object({
    competencies: z
      .array(
        z.object({
          key: nonEmpty(20),
          label: nonEmpty(200),
          weight: z.number().positive().max(100).optional(),
          rubric: z.string().trim().max(800).optional(),
        })
      )
      .min(2)
      .max(6),
    // max 8: kalibriert am Bestand (einzelne Szenarien führen bis zu 7 Momente).
    checkpoints: z
      .array(z.object({ id: nonEmpty(80), description: nonEmpty(400) }))
      .min(3)
      .max(8),
    passThreshold: z.number().gt(0).lt(1).optional(),
    checkPassThreshold: z.number().gt(0).lt(1).optional(),
  })
  .superRefine((a, ctx) => {
    const keys = a.competencies.map((c) => c.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Anker-Keys müssen eindeutig sein" });
    }
    const ids = a.checkpoints.map((c) => c.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Checkpoint-IDs müssen eindeutig sein" });
    }
  });

export const scenarioSchema = z
  .object({
    // Kundenszenarien tragen das Präfix `ws-` — kollidiert nie mit `sim-…`.
    id: z.string().regex(/^ws-[a-z0-9][a-z0-9-]{2,60}$/, "id muss dem Muster ws-<kebab-case> folgen"),
    title: nonEmpty(160),
    teaser: nonEmpty(400),
    conversationType: nonEmpty(80),
    difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    durationMin: z.number().int().min(5).max(60),
    checkDurationMin: z.number().int().min(5).max(60).optional(),
    locale: z.enum(["de", "en"]),
    category: z.enum(["mitarbeiterfuehrung", "zusammenarbeit", "vertrieb", "stakeholder"]),
    competencyFocus: z
      .array(z.enum(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"]))
      .min(1)
      .max(3)
      .optional(),
    persona: z.object({ name: nonEmpty(60), role: nonEmpty(120) }),
    candidateBriefing: candidateBriefingSchema,
    personaDna: personaDnaSchema,
    assessment: assessmentSchema,
  })
  .superRefine((s, ctx) => {
    if (s.persona.name !== s.personaDna.name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "persona.name und personaDna.name müssen übereinstimmen",
      });
    }
    // Synthesia-Autorenregel »Situation raus aus dem Background«: harte
    // Heuristik gegen die häufigsten Situations-Marker im Charakterbogen.
    if (/\b(gerade eben|soeben|heute Morgen|in diesem Gespräch|gleich in diesem)\b/i.test(s.personaDna.background)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "personaDna.background enthält Situations-Marker — die konkrete Situation gehört in Briefing/Einwände, der Background ist der stabile Charakterbogen",
      });
    }
  });

export type ValidatedScenario = z.infer<typeof scenarioSchema>;

/**
 * Validiert einen Szenario-Entwurf; wirft mit lesbarer Fehlerliste.
 * Rückgabe ist strukturell ein SimulationScenario.
 */
export function validateScenario(input: unknown): SimulationScenario {
  const parsed = scenarioSchema.safeParse(input);
  if (!parsed.success) {
    const lines = parsed.error.issues
      .map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Szenario ungültig:\n${lines}`);
  }
  return parsed.data as SimulationScenario;
}
