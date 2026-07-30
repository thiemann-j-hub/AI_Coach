import { COMP_MODEL } from './competency-model';

/**
 * KK-1 (30.07.2026): Diese Datei war jahrelang eine ZWEITE, abweichende
 * Label-Liste (6/10 Achsen anders als das, was der Scoring-Prompt misst und
 * jeder Run persistiert) — und der Hub hatte sie kopiert. Jetzt ist sie eine
 * dünne Ableitung der Runtime-Wahrheit in competency-model.ts; die Plattform-
 * SSOT liegt in pulsenorth-ops/competency-model.json (byte-identische Kopien
 * in Hub/Jobmap/Studio, per Test gepinnt).
 */
export type Competency = {
  id: string;
  title: string;
};

export const COMPETENCIES: Competency[] = COMP_MODEL.map((c) => ({
  id: c.id,
  title: c.name,
}));

// MVP-Scoring 0–4 (0 = nicht beobachtbar).
// Die Original-Skala kennt zusätzlich "Role Model"; wir nutzen für v1 nur 1–4.
export const SCORE_LABEL_1_TO_4: Record<number, string> = {
  1: 'Awareness',
  2: 'Developing',
  3: 'Competent',
  4: 'Advanced',
};

export const SCORE_NOT_OBSERVED = 0;
