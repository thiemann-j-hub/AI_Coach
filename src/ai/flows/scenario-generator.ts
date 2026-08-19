/**
 * B3b (Welle B, Synthesia-Vergleich §7) — Concierge-Generator:
 * Freitext-Brief + optionales Kunden-Dokument → vollständiger Szenario-Entwurf
 * nach dem 13-Felder-DNA-Schema. Der Entwurf ist IMMER nur ein Entwurf:
 * das harte Zod-Schema (scenario-schema.ts) gate-t maschinell, der Betreiber
 * reviewt inhaltlich, erst dann erreicht ein Szenario per upsert-scenario.ts
 * die Workspace-Partition. (Welle C hängt später ein Self-Service-UI vor
 * genau diesen Flow.)
 *
 * Qualitätsmuster: die besten Bestands-Szenarien dienen als Stil-Vorlagen im
 * Meta-Prompt (Sparring-Beschluss 18.08.); bei Schema-Fehlern bekommt das
 * Modell EINEN zweiten Versuch mit der konkreten Fehlerliste.
 */

import { ai } from '@/ai/genkit';
import { sanitizeForPrompt } from '@/lib/prompt-guard';
import { getScenario } from '@/lib/simulation/scenarios';
import { validateScenario } from '@/lib/simulation/scenario-schema';
import type { SimulationScenario } from '@/lib/simulation/types';

/** Stil-Vorlagen: je eine starke Mitarbeiter- und eine Verhandlungs-DNA. */
const TEMPLATE_IDS = ['sim-coaching-morgan', 'sim-peer-falk'] as const;

export interface ScenarioDraftArgs {
  /** Freitext-Brief des Betreibers/Kunden: Situation, Zielgruppe, Lernziel. */
  brief: string;
  /** Ziel-Id (ws-…); der Generator übernimmt sie unverändert. */
  id: string;
  /** Optionales Kunden-Material (Produktinfos, Einwände, Preislisten …). */
  sourceDocument?: string;
  category?: 'mitarbeiterfuehrung' | 'zusammenarbeit' | 'vertrieb' | 'stakeholder';
  difficulty?: 1 | 2 | 3;
  locale?: 'de' | 'en';
  /**
   * Welle C (Überarbeitungs-Runde, Synthesia-Muster »describe any changes«):
   * der bisherige Entwurf + der Änderungswunsch des Kunden-Admins. Der
   * Generator überarbeitet den Entwurf, statt neu zu würfeln.
   */
  previousDraft?: SimulationScenario;
  reviseNote?: string;
}

/** PURE (getestet): baut den Meta-Prompt des Generators. */
export function buildScenarioGeneratorPrompt(args: ScenarioDraftArgs & {
  /** Fehlerliste des vorigen Versuchs (Retry) — leer beim ersten Lauf. */
  previousIssues?: string;
}): string {
  const templates = TEMPLATE_IDS.map((id) => getScenario(id)).filter(
    (s): s is SimulationScenario => Boolean(s)
  );
  const brief = sanitizeForPrompt(args.brief.slice(0, 4000), { label: 'BRIEF' }).sanitized;
  const doc = args.sourceDocument
    ? sanitizeForPrompt(args.sourceDocument.slice(0, 20_000), { label: 'MATERIAL' }).sanitized
    : '';

  return `Du bist Szenario-Autor:in für eine Gesprächssimulation (Führungskräfte- und Vertriebstraining).
Erstelle aus dem BRIEF (und ggf. MATERIAL) EIN vollständiges Szenario als JSON nach dem Schema der VORLAGEN.

AUTORENREGELN (hart, werden maschinell geprüft):
1. id ist exakt "${args.id}" (nicht ändern).
2. personaDna.background ist der STABILE Charakterbogen — die konkrete Situation gehört NICHT hinein (keine Formulierungen wie "gerade eben", "heute Morgen", "in diesem Gespräch").
3. Die Situation lebt in candidateBriefing (yourRole, relationship, incidents) und im objectionPlaybook.
4. objectionPlaybook: 2–6 Einträge, JEDER mit trigger (wann) und objection (wörtliche Einwand-Idee aus Persona-Sicht). Schreibe den Einwand, NIE die erwartete Antwort des Übenden.
5. candidateBriefing.goals: GENAU 3 Ziele — Beziehungsziel, Strukturziel, EIN konkretes inhaltliches Anliegen.
6. assessment.competencies: 3–5 Anker als BEOBACHTBARES Verhalten (nicht "zeigt Empathie", sondern "erkennt die Perspektive an, bevor …"), jeder mit weight (relativ) und rubric (Anweisung an den Bewerter: woran sehen 4 bzw. 1 Punkte aus?). Keys S1…S5 wiederverwenden, wo sie passen.
7. assessment.checkpoints: 3–6 prüfbare Schlüsselmomente mit ids im Muster "${args.id.replace(/^ws-/, '')}-…" (eindeutig).
8. personaDna vollständig: hiddenDrivers (nie aussprechen), positions (sagt sie offen) GETRENNT von interests (gibt sie erst bei ehrlichem Erkunden preis), concessionConditions (wann wird sie kooperativer), escalationTriggers, knowledgeBounds (was sie NICHT weiß), facts (exakte Zahlen/Namen — NUR aus BRIEF/MATERIAL, nie erfunden), openingLine.
9. Alle Inhalte auf ${args.locale === 'en' ? 'Englisch' : 'Deutsch'}; category "${args.category ?? 'mitarbeiterfuehrung'}"; difficulty ${args.difficulty ?? 2}; durationMin 15, checkDurationMin 10; timeboxMin 15.
10. persona.name === personaDna.name. Erfinde realistische, aber fiktive Namen — übernimm KEINE echten Personennamen aus dem MATERIAL.
11. Titel-Konvention: "Motto — Gesprächstyp mit <Name>".

VORLAGEN (Stil, Tiefe und Feldnutzung — NICHT den Inhalt kopieren):
${templates.map((t) => JSON.stringify(t)).join('\n---\n')}

BRIEF
${brief}
${doc ? `\nMATERIAL (Kundenunterlagen — Fakten hieraus verwenden)\n${doc}` : ''}
${args.previousDraft ? `\nBISHERIGER ENTWURF (überarbeite IHN — behalte Bewährtes, ändere nur, was der ÄNDERUNGSWUNSCH verlangt):\n${JSON.stringify(args.previousDraft)}` : ''}
${args.reviseNote ? `\nÄNDERUNGSWUNSCH DES AUTORS:\n${sanitizeForPrompt(args.reviseNote.slice(0, 2000), { label: 'WUNSCH' }).sanitized}` : ''}
${args.previousIssues ? `\nDEIN VORIGER ENTWURF SCHEITERTE AN DIESEN SCHEMA-FEHLERN — behebe genau sie:\n${args.previousIssues}` : ''}

Gib AUSSCHLIESSLICH das JSON-Objekt des Szenarios zurück (kein Markdown, keine Erklärungen).`;
}

/** Welle C: stabile ws--Id aus einem Brief ableiten (Slug + Zufallssuffix). */
export function draftIdFromBrief(brief: string, random: string): string {
  const slug = brief
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .filter(Boolean)
    .slice(0, 4)
    .join('-')
    .slice(0, 40);
  return `ws-${slug || 'szenario'}-${random}`;
}

/** Entfernt ggf. Markdown-Zäune und parst das JSON des Modells. */
export function parseDraftJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

/**
 * Erzeugt einen validierten Entwurf; bei Schema-Fehlern EIN Retry mit
 * konkreter Fehlerliste. Wirft, wenn auch der zweite Versuch scheitert —
 * lieber ein ehrlicher Fehler als ein stiller Schrott-Entwurf.
 */
export async function generateScenarioDraft(
  args: ScenarioDraftArgs
): Promise<SimulationScenario> {
  let previousIssues: string | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = await ai.generate({
      prompt: buildScenarioGeneratorPrompt({ ...args, previousIssues }),
      config: { maxOutputTokens: 16_384 },
    });
    const text = response.text ?? '';
    try {
      return validateScenario(parseDraftJson(text));
    } catch (e) {
      previousIssues = e instanceof Error ? e.message : String(e);
      if (attempt === 2) {
        throw new Error(`Generator-Entwurf auch im 2. Versuch ungültig:\n${previousIssues}`);
      }
    }
  }
  throw new Error('unreachable');
}
