import { z } from "zod";

/**
 * Zod-Vertrag des Szenario-Wunschs (COACH-UX-BLUEPRINT §2.3) — eigenes Modul,
 * damit der Vertrag pure testbar ist (die Route hängt an Cosmos/Auth).
 */
export const scenarioWishSchema = z.object({
  wishText: z.string().trim().min(3).max(500),
  category: z
    .enum(["mitarbeiterfuehrung", "zusammenarbeit", "vertrieb", "stakeholder"])
    .nullable()
    .optional(),
  weakestC: z
    .string()
    .regex(/^C(10|[1-9])$/)
    .nullable()
    .optional(),
  locale: z.string().trim().max(8).optional(),
});

export type ScenarioWishInput = z.infer<typeof scenarioWishSchema>;
