/**
 * P1 Anonymisierungs-Leck (COACH-UX-BLUEPRINT §6): Bei aktivem privacyMode
 * wurden die Klarnamen als leaderLabel/employeeLabel mitgesendet und landeten
 * im Modell-Prompt — obwohl die UI »Geschieht im Browser …« verspricht.
 *
 * Fix: ins Payload gehen die GENERISCHEN Labels, die sanitizeTranscript ohnehin
 * ins Transkript schreibt (transcript-utils speakerMap) — die Zuordnung bleibt
 * intakt, der groundTxt-Ersatz in der Route wird zum No-Op. Pure + getestet.
 */

/** MUSS byte-identisch zu den Ersetzungen in sanitizeTranscript sein. */
export const PRIVACY_LEADER_LABEL = 'Führungskraft';
export const PRIVACY_EMPLOYEE_LABEL = 'Mitarbeiter:in';

export function buildAnalyzeRoleLabels(args: {
  privacyMode: boolean;
  leaderLabel: string;
  employeeLabel: string;
}): { leaderLabel: string; employeeLabel: string } {
  if (!args.privacyMode) {
    return { leaderLabel: args.leaderLabel, employeeLabel: args.employeeLabel };
  }
  return {
    leaderLabel: PRIVACY_LEADER_LABEL,
    employeeLabel: PRIVACY_EMPLOYEE_LABEL,
  };
}
