import { anredeBlock } from '@/lib/anrede';
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
 *
 * Paket 5, S15/C39 (12.11.2026): Der Entwurf entsteht in der Sprache des Auftrags und trägt immer mindestens drei
 * echte Einwände der Rolle. Nach dem Schema prüfen einfache Regeln Sprache, Einwände und Gesprächsdauer; ein Verstoß
 * zählt wie ein Schema-Fehler (ein zweiter Versuch mit dem Befund, sonst Fehler). Id und Sprache setzt der Code, nie
 * die Modellantwort.
 */

import { ai } from '@/ai/genkit';
import { sanitizeForPrompt } from '@/lib/prompt-guard';
import { getScenario } from '@/lib/simulation/scenarios';
import { validateScenario } from '@/lib/simulation/scenario-schema';
import { ergaenzeAnker, faehigkeitenKatalog } from '@/lib/simulation/faehigkeiten';
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
  /** Gewünschte Sprache. Sie gilt nur, wenn die Sprache des Auftrags nicht eindeutig ist (siehe `zielSprache`). */
  locale?: 'de' | 'en';
  /**
   * Welle C (Überarbeitungs-Runde, Synthesia-Muster »describe any changes«):
   * der bisherige Entwurf + der Änderungswunsch des Kunden-Admins. Der
   * Generator überarbeitet den Entwurf, statt neu zu würfeln.
   */
  previousDraft?: SimulationScenario;
  reviseNote?: string;
  /**
   * Welle 4: privates Szenario aus den drei Sätzen einer lernenden Person („Mein echtes Gespräch vorbereiten“).
   * Der Generator anonymisiert: keine Namen echter Personen oder Firmen, Rollenbezeichnungen statt Namen,
   * ein erfundener Name für die Spielfigur; die vom Menschen genannten Fakten bleiben.
   */
  privat?: boolean;
}

const DE_WOERTER = new Set('der die das und ist nicht ein eine einen einem mit für auf ich sie er wir den dem des zu im von dass sich auch wird hat sind bei oder aber wenn wie noch nach über mein meine kann soll seit weil sehr nur'.split(' '));
const EN_WOERTER = new Set('the and is are of to with for you your not that this has have but when how my our their she he they who can should from at as be by does about'.split(' '));

/**
 * PURE (getestet): Sprache eines Textes grob bestimmen, über häufige Wörter und Umlaute. null = kein klares Urteil
 * (zu wenig Text oder gemischt). Reicht für die Frage „deutsch oder englisch“, mehr kann ein Szenario nicht sein.
 */
export function textSprache(text: string): 'de' | 'en' | null {
  let de = 0;
  let en = 0;
  for (const w of text.toLowerCase().split(/[^a-zäöüß]+/)) {
    if (DE_WOERTER.has(w) || /[äöüß]/.test(w)) de++;
    else if (EN_WOERTER.has(w)) en++;
  }
  if (Math.max(de, en) < 3) return null;
  if (de >= 2 * en) return 'de';
  return en >= 2 * de ? 'en' : null;
}

/**
 * PURE (getestet): In welcher Sprache der Entwurf entsteht. Überarbeitung: die Sprache des bisherigen Entwurfs.
 * Sonst die Sprache des Auftrags (deutscher Auftrag → deutsches Szenario); ist sie nicht eindeutig, die gewünschte
 * Sprache, sonst Deutsch.
 */
export function zielSprache(args: Pick<ScenarioDraftArgs, 'brief' | 'locale' | 'previousDraft'>): 'de' | 'en' {
  if (args.previousDraft) return args.previousDraft.locale;
  return textSprache(args.brief) ?? args.locale ?? 'de';
}

/** Verlangt der Änderungswunsch selbst eine andere Gesprächsdauer? */
const WUNSCH_NENNT_DAUER = /\bmin(ute[ns]?)?\b|dauer|duration|länger|kürzer|longer|shorter/i;

/**
 * PURE (getestet): Gesprächsdauer, die der Entwurf bekommen soll. `max` = „nicht länger als gewünscht“; null heißt,
 * der Änderungswunsch nennt selbst eine Dauer, dann gilt nur der Rahmen des Schemas (5 bis 60 Minuten).
 */
export function wunschDauer(args: Pick<ScenarioDraftArgs, 'privat' | 'previousDraft' | 'reviseNote'>): { dauer: number; pruefung: number; max: number | null } {
  const alt = args.previousDraft;
  if (alt) {
    const frei = WUNSCH_NENNT_DAUER.test(args.reviseNote ?? '');
    return { dauer: alt.durationMin, pruefung: alt.checkDurationMin ?? alt.durationMin, max: frei ? null : alt.durationMin };
  }
  return args.privat ? { dauer: 10, pruefung: 8, max: 10 } : { dauer: 15, pruefung: 10, max: 15 };
}

/** Ein Einwand, der die Rolle von außen beschreibt („Sie wendet ein, dass …“), statt sie sprechen zu lassen. */
const EINWAND_VON_AUSSEN = /^(er|sie|die rolle|die persona|he|she|the persona)\s+(wendet|argumentiert|entgegnet|verweist|weist|betont|sagt|meint|objects|argues|points|pushes|says)\b/i;

/**
 * PURE (getestet): einfache Regeln über das Schema hinaus (Paket 5, S15). Gibt die Verstöße als lesbare Liste zurück;
 * sie geht beim zweiten Versuch als Befund an das Modell.
 */
export function regelVerstoesse(
  draft: SimulationScenario,
  soll: { locale: 'de' | 'en'; maxDauerMin: number | null }
): string[] {
  const v: string[] = [];
  const b = draft.candidateBriefing;
  const d = draft.personaDna;
  const sprache = soll.locale === 'en' ? 'Englisch' : 'Deutsch';
  const gruppen: Array<[string, string[]]> = [
    ['title/teaser', [draft.title, draft.teaser]],
    ['persona.role/personaDna.background', [draft.persona.role, d.background, d.selfImage]],
    ['candidateBriefing (yourRole, relationship, incidents)', [b.yourRole, b.relationship, ...b.incidents]],
    ['candidateBriefing.goals', b.goals],
    ['personaDna.objectionPlaybook/openingLine', [...d.objectionPlaybook.flatMap((o) => [o.trigger, o.objection]), d.openingLine]],
  ];
  for (const [feld, texte] of gruppen) {
    const ist = textSprache(texte.join(' '));
    if (ist && ist !== soll.locale) v.push(`${feld}: muss auf ${sprache} geschrieben sein`);
  }
  if (d.objectionPlaybook.length < 3) {
    v.push(`personaDna.objectionPlaybook: mindestens 3 Einwände der Rolle, es sind ${d.objectionPlaybook.length}`);
  }
  d.objectionPlaybook.forEach((o, i) => {
    if (EINWAND_VON_AUSSEN.test(o.objection.trim()) || o.objection.includes(d.name)) {
      v.push(`personaDna.objectionPlaybook.${i}.objection: schreibe den Einwand als wörtliche Rede der Rolle (Ich-Form), nicht als Beschreibung von außen`);
    }
  });
  if (soll.maxDauerMin !== null && draft.durationMin > soll.maxDauerMin) {
    v.push(`durationMin: ${draft.durationMin} ist länger als gewünscht (höchstens ${soll.maxDauerMin})`);
  }
  if (draft.checkDurationMin !== undefined && draft.checkDurationMin > draft.durationMin) {
    v.push(`checkDurationMin: ${draft.checkDurationMin} darf nicht länger sein als durationMin (${draft.durationMin})`);
  }
  return v;
}

/** PURE (getestet): baut den Meta-Prompt des Generators. */
export function buildScenarioGeneratorPrompt(args: ScenarioDraftArgs & {
  /** Fehlerliste des vorigen Versuchs (Retry) — leer beim ersten Lauf. */
  previousIssues?: string;
}): string {
  const templates = TEMPLATE_IDS.map((id) => getScenario(id)).filter(
    (s): s is SimulationScenario => Boolean(s)
  );
  const locale = zielSprache(args);
  const sprache = locale === 'en' ? 'Englisch' : 'Deutsch';
  const zeit = wunschDauer(args);
  // Überarbeitung: Kategorie und Stufe des bisherigen Entwurfs gelten weiter (vorher fiel der Prompt auf die Standardwerte zurück).
  const category = args.category ?? args.previousDraft?.category ?? 'mitarbeiterfuehrung';
  const difficulty = args.difficulty ?? args.previousDraft?.difficulty ?? 2;
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
4. objectionPlaybook: 3–6 Einträge, JEDER mit trigger (wann) und objection: ein echter Einwand der Rolle in IHREN Worten (wörtliche Rede in Ich-Form, so wie sie ihn im Gespräch sagt). Schreibe den Einwand, NIE die erwartete Antwort des Übenden und keine Beschreibung von außen (»sie wendet ein, dass …«).
5. candidateBriefing.goals: GENAU 3 Ziele — Beziehungsziel, Strukturziel, EIN konkretes inhaltliches Anliegen.
6. assessment.competencies: 3–5 Anker. BEVORZUGT Fähigkeiten aus der BIBLIOTHEK (unten): dann ist key exakt die Bibliotheks-Id, label der Titel, rubric leer (wird ergänzt) — gleiche Fähigkeit, gleiche Messlatte über alle Szenarien. Nur wenn keine passt: eigener key, label als BEOBACHTBARES Verhalten (nicht "zeigt Empathie", sondern "erkennt die Perspektive an, bevor …") und rubric (Anweisung an den Bewerter: woran erkennt man Stufe 1 bis 4?). Jeder Anker mit weight (relativ, z. B. 15–30).
12. personaDna.freigabeRegel: die Obergrenze der Verschlossenheit in 2–3 Sätzen („nie von selbst … spätestens nach …“), damit das Gespräch gewinnbar ist. personaDna.endbedingungen: 2–4 Momente, in denen die Rolle das Gespräch selbst beendet (Ziel erreicht, Gegenüber verabschiedet sich, Abbruch nach Eskalations-Trigger).
7. assessment.checkpoints: 3–6 prüfbare Schlüsselmomente mit ids im Muster "${args.id.replace(/^ws-/, '')}-…" (eindeutig).
8. personaDna vollständig: hiddenDrivers (nie aussprechen), positions (sagt sie offen) GETRENNT von interests (gibt sie erst bei ehrlichem Erkunden preis), concessionConditions (wann wird sie kooperativer — JEDE Bedingung verlangt BEOBACHTBARES VERHALTEN des Übenden: nachfragen, spiegeln, konkret vereinbaren, belegen; nie nur „überzeugend argumentiert“ oder „Nutzen erklärt“), escalationTriggers, knowledgeBounds (was sie NICHT weiß), facts (exakte Zahlen/Namen — NUR aus BRIEF/MATERIAL, nie erfunden), openingLine.
9. SPRACHE: Schreibe ALLE Inhalte auf ${sprache}, auch wenn VORLAGEN oder MATERIAL in einer anderen Sprache vorliegen: Titel, Teaser, Rollenbezeichnung, Briefing, Ziele, Einwände, Eröffnungssatz. locale "${locale}"; category "${category}"; difficulty ${difficulty}; durationMin ${zeit.dauer}${zeit.max === null ? ' (oder die Dauer aus dem ÄNDERUNGSWUNSCH)' : ' (nie länger)'}, checkDurationMin ${zeit.pruefung} (nie länger als durationMin); timeboxMin ${zeit.dauer}.
10. persona.name === personaDna.name. Erfinde realistische, aber fiktive Namen — übernimm KEINE echten Personennamen aus dem MATERIAL.
11. Titel-Konvention: "Motto — Gesprächstyp mit <Name>".
13. persona.firma: ${args.privat ? 'weglassen (privates Szenario, keine Firmennamen).' : 'die Firma, bei der die ROLLE arbeitet (höchstens 80 Zeichen), NUR wenn BRIEF oder MATERIAL sie nennen; sonst das Feld weglassen. Erfinde keine Firma und übernimm keine aus den VORLAGEN.'}${args.privat ? `
14. PRIVATES SZENARIO (die Person bereitet ihr echtes Gespräch vor): Übernimm KEINE Namen echter Personen oder Firmen aus dem BRIEF — ersetze sie durch Rollenbezeichnungen (»mein Projektleiter«, »die Kundin«, »das Unternehmen«) und gib der Spielfigur einen erfundenen, zur Rolle passenden Namen. Die vom Menschen beschriebenen Verhaltensweisen, Zahlen und Anlässe bleiben erhalten; erfinde nur, was für eine spielbare Rolle fehlt (Hintergrund, verdeckte Motive, Einwände, Freigabe-Regel, Endbedingungen). candidateBriefing in der Du-Form aus Sicht der Person.` : ''}

BIBLIOTHEK DER FÄHIGKEITEN (Id in Klammern der Titel):
${faehigkeitenKatalog(locale)}

VORLAGEN (Stil, Tiefe und Feldnutzung — NICHT den Inhalt kopieren):
${templates.map((t) => JSON.stringify(t)).join('\n---\n')}

BRIEF
${brief}
${doc ? `\nMATERIAL (Kundenunterlagen — Fakten hieraus verwenden)\n${doc}` : ''}
${args.previousDraft ? `\nBISHERIGER ENTWURF (überarbeite IHN — behalte Bewährtes, ändere nur, was der ÄNDERUNGSWUNSCH verlangt):\n${JSON.stringify(args.previousDraft)}` : ''}
${args.reviseNote ? `\nÄNDERUNGSWUNSCH DES AUTORS:\n${sanitizeForPrompt(args.reviseNote.slice(0, 2000), { label: 'WUNSCH' }).sanitized}` : ''}
${args.previousIssues ? `\nDEIN VORIGER ENTWURF SCHEITERTE AN DIESEN FEHLERN — behebe genau sie:\n${args.previousIssues}` : ''}

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
 * PURE (getestet): macht aus der Modellantwort den fertigen Entwurf oder wirft mit lesbarer Fehlerliste.
 * Paket 5, C39: Id und Sprache kommen vom Auftrag, nie aus der Modellantwort (vorher konnte das Modell die Id ändern,
 * und der Entwurf landete unter einer fremden Id). Danach Schema, dann die einfachen Regeln (`regelVerstoesse`).
 */
export function fertigerEntwurf(raw: unknown, args: ScenarioDraftArgs): SimulationScenario {
  const locale = zielSprache(args);
  const fest = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw, id: args.id, locale } : raw;
  const draft = validateScenario(fest);
  const verstoesse = regelVerstoesse(draft, { locale, maxDauerMin: wunschDauer(args).max });
  if (verstoesse.length) {
    throw new Error(`Entwurf verletzt die Autorenregeln:\n${verstoesse.map((x) => `- ${x}`).join('\n')}`);
  }
  // Firma der Rolle (Paket 5, S19): nur, wenn Auftrag, Material oder der bisherige Entwurf sie nennen. Sonst bleibt
  // das Feld leer, damit keine erfundene oder aus den Vorlagen übernommene Firma im Rollen-Prompt landet.
  const { firma: genannt, ...persona } = draft.persona;
  const firma = genannt?.trim();
  const quelle = [args.brief, args.sourceDocument, args.reviseNote, args.previousDraft?.persona.firma].join('\n').toLowerCase();
  const behalten = firma && !args.privat && quelle.includes(firma.toLowerCase()) ? firma : null;
  return {
    ...draft,
    persona: behalten ? { ...persona, firma: behalten } : persona,
    // Welle 1: Bibliotheks-Anker bekommen Titel und Vier-Stufen-Rubrik aus der Bibliothek.
    assessment: { ...draft.assessment, competencies: ergaenzeAnker(draft.assessment.competencies, draft.locale) },
  };
}

/**
 * Erzeugt einen validierten Entwurf; bei Schema-Fehlern oder Regelverstößen EIN
 * Retry mit konkreter Fehlerliste. Wirft, wenn auch der zweite Versuch scheitert —
 * lieber ein ehrlicher Fehler als ein stiller Schrott-Entwurf.
 */
export async function generateScenarioDraft(
  args: ScenarioDraftArgs
): Promise<SimulationScenario> {
  let previousIssues: string | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = await ai.generate({
      // W1-5: Briefing, Ziele, Hinweise in Du-Form; die Rede der Spielfigur folgt der Situation.
      system: anredeBlock({ rollenspiel: true }),
      prompt: buildScenarioGeneratorPrompt({ ...args, previousIssues }),
      config: { maxOutputTokens: 16_384 },
    });
    const text = response.text ?? '';
    try {
      return fertigerEntwurf(parseDraftJson(text), args);
    } catch (e) {
      previousIssues = e instanceof Error ? e.message : String(e);
      if (attempt === 2) {
        throw new Error(`Generator-Entwurf auch im 2. Versuch ungültig:\n${previousIssues}`);
      }
    }
  }
  throw new Error('unreachable');
}
