export type Competency = {
  id: string;
  title: string;
};

export const COMPETENCIES: Competency[] = [
  { id: 'C1', title: 'Integrieren und Verbinden' },
  { id: 'C2', title: 'Inspirieren und Aktivieren' },
  { id: 'C3', title: 'Befähigen und Entwickeln' },
  { id: 'C4', title: 'Kundenorientierung' },
  { id: 'C5', title: 'Kommunikation und Kooperation' },
  { id: 'C6', title: 'Ziel- und Umsetzungsorientierung' },
  { id: 'C7', title: 'Gestaltung des Wandels' },
  { id: 'C8', title: 'Selbstreflexion und Lernmotivation' },
  { id: 'C9', title: 'Strategische AI Literacy' },
  { id: 'C10', title: 'Entscheiden, Steuern und Delegieren in Human‑AI Hybrid Teams' },
];

// MVP-Scoring 0–4 (0 = nicht beobachtbar).
// Die Original-Skala kennt zusätzlich "Role Model"; wir nutzen für v1 nur 1–4.
export const SCORE_LABEL_1_TO_4: Record<number, string> = {
  1: 'Awareness',
  2: 'Developing',
  3: 'Competent',
  4: 'Advanced',
};

export const SCORE_NOT_OBSERVED = 0;
