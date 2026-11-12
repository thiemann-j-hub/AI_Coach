import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * Paket 3 (12.11.2026): Die Auswertung rendert ohne Browser durch (alle vier Reiter sind eingehängt).
 * Geprüft wird, was sich nicht still verschieben darf: alte Läufe ohne die neuen Felder, ein Maßstab im
 * Vordergrund (C1 bis C10 eingeklappt), ein KI-Hinweis, Messlatte, „Sachlich nicht gedeckt“, Mindestpunktzahl.
 */
vi.mock('@/i18n/useTranslation', async () => {
  const de = (await import('@/i18n/dictionaries/de.json')).default;
  return { useTranslation: () => ({ t: de, locale: 'de' }) };
});
vi.mock('@/components/app/app-switcher', () => ({ useHubNav: () => ({ apps: null }) }));

import { EvalFehlschlag, EvalWarten } from './eval-warten';
import { SimulationEvaluation } from './simulation-evaluation';
import type { SimEvalDebrief, SimEvalFeedback } from './eval-teile';

const turns = [
  { role: 'persona', text: 'Ich schaffe das schon, ich brauche nur etwas mehr Zeit.' },
  { role: 'user', text: 'Du hast doch sicher zu viel auf dem Tisch, oder? Der Bericht ist seit drei Wochen überfällig.' },
  { role: 'persona', text: 'Na ja, es ist viel. Aber es ist meins.' },
];

const feedback: SimEvalFeedback = {
  summary: 'Du bist ruhig geblieben.',
  rubric: [
    {
      key: 'ursache',
      label: 'Bis zur Ursache zuhören',
      evidence: ['Teilnehmer:in: „Du hast doch sicher zu viel auf dem Tisch, oder?“'],
      why: 'Du hast die Antwort vorgegeben.',
      score: 2,
      wentWell: ['Du hast nachgefragt.'],
      tryNext: ['Frag offen.'],
    },
    { key: 'eigener-anker', label: 'Eigene Fähigkeit', evidence: [], why: 'nicht beobachtbar', score: null },
  ],
  checkpoints: [{ id: 'c1', hit: true, comment: 'Der Anlass war klar.' }],
  nextStep: 'In dem Moment hast Du „Du hast doch sicher zu viel auf dem Tisch, oder?“ gesagt. Besser: „Was hält Dich ab?“',
};

const debrief: SimEvalDebrief = {
  overall: 55,
  verdict: 'failed',
  passMarkPct: 70,
  coverage: 0.5,
  anchors: [
    { key: 'ursache', label: 'Bis zur Ursache zuhören', score: 2, pct: 33, expectation: 'approaching' },
    { key: 'eigener-anker', label: 'Eigene Fähigkeit', score: null, pct: null, expectation: 'not-observable' },
  ],
  checkpointsHit: 1,
  checkpointsTotal: 1,
};

const ratings = [{ id: 'C1', name: 'Kommunikation', score: 3, why: '', evidence: [] }];

const render = (extra: Partial<Parameters<typeof SimulationEvaluation>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(SimulationEvaluation, {
      personaName: 'Alex Morgan',
      feedback,
      debrief,
      delta: null,
      attempt: 1,
      focus: null,
      ratings,
      turns,
      convoLocale: 'de',
      onRetry: () => undefined,
      onNew: () => undefined,
      ...extra,
    })
  );
const count = (html: string, teil: string) => html.split(teil).length - 1;

describe('SimulationEvaluation (vier Reiter)', () => {
  it('alter Lauf ohne die neuen Felder: vier Reiter, ein KI-Hinweis, nichts Neues ohne Daten', () => {
    const html = render();
    for (const name of ['Überblick', 'Fähigkeiten', 'Gespräch', 'Weiter üben']) expect(html).toContain(`>${name}</button>`);
    expect(count(html, 'role="tabpanel"')).toBe(4);
    expect(count(html, 'data-testid="ai-limit"')).toBe(1);
    expect(html).not.toContain('Transkript wird dafür an ein KI-Modell');
    expect(html).not.toContain('Sachlich nicht gedeckt');
    expect(html).not.toContain('data-testid="self-review"');
    expect(html).not.toContain('data-testid="ziel-ohne-mindestpunkte"');
    expect(html).toContain('Du bist ruhig geblieben.');
  });

  it('ein Maßstab vorn: C1 bis C10 ist eingeklappt, x/4 steht nicht auf der Seite', () => {
    const html = render();
    expect(html).toContain('data-testid="c10-toggle"');
    expect(html).not.toContain('3 / 4');
    expect(html).toContain('55 %');
    expect(html).toContain('Ansätze erkennbar');
  });

  it('Messlatte: Stufe und nächste Stufe aus der Bibliothek, bei freier Fähigkeit keine', () => {
    const html = render();
    expect(count(html, 'data-testid="messlatte"')).toBe(1);
    expect(html).toContain('Deine Stufe');
    expect(html).toContain('So sieht die nächste aus');
    expect(html).toContain('Höchstens eine Alibi-Frage');
    // Seit 12.11.2026 gibt es die Stufentexte auch auf Französisch und Spanisch; andere Gesprächssprachen gibt es nicht.
    expect(count(render({ convoLocale: 'fr' }), 'data-testid="messlatte"')).toBe(1);
    expect(render({ convoLocale: 'it' })).not.toContain('data-testid="messlatte"');
  });

  it('Gespräch: alle Züge stehen da, der Beleg ist markiert und Zitate führen zur Stelle', () => {
    const html = render();
    expect(count(html, 'data-zug=')).toBe(3);
    expect(html).toContain('<mark');
    expect(html).toContain('Beleg: Bis zur Ursache zuhören');
    // Zitat im Reiter „Fähigkeiten“ (Knopf) und im „Größten Hebel“ (Sprungmarke).
    expect(count(html, 'Zur Stelle im Gespräch')).toBe(2);
    expect(html).toContain('href="#gespraech"');
    expect(render({ turns: null })).not.toContain('Zur Stelle im Gespräch');
  });

  it('S13: „Sachlich nicht gedeckt“ steht im Überblick und an der Stelle im Gespräch', () => {
    const html = render({
      feedback: { ...feedback, sachlichNichtGedeckt: [{ zitat: 'seit drei Wochen überfällig', warum: 'Im Briefing stehen zwei Wochen.' }] },
    });
    expect(html).toContain('data-testid="sachlich-liste"');
    expect(html).toContain('Sachlich nicht gedeckt: Im Briefing stehen zwei Wochen.');
    expect(render({ feedback: { ...feedback, sachlichNichtGedeckt: [] } })).not.toContain('Sachlich nicht gedeckt');
  });

  it('Prüfung: Ziel erreicht, aber die Mindestpunktzahl fehlt → der Satz steht beim Urteil', () => {
    const html = render({ mode: 'check', debrief: { ...debrief, ergebnis: 'ziel', verdictGrund: 'punkte' } });
    expect(html).toContain('data-testid="ziel-ohne-mindestpunkte"');
    expect(html).toContain('mindestens 70 %');
    expect(render({ debrief: { ...debrief, ergebnis: 'offen', verdictGrund: 'punkte' } })).not.toContain('ziel-ohne-mindestpunkte');
  });

  it('Selbstbild: Antworten des Check-ins; solange der Abgleich aussteht, steht die Karte schon da', () => {
    const checkin = { gut: 'Ich bin ruhig geblieben.', anders: 'Offener fragen.', skipped: false };
    const wartend = render({ checkin, selfReviewPending: true });
    expect(wartend).toContain('data-testid="self-review"');
    expect(wartend).toContain('»Ich bin ruhig geblieben.«');
    const fertig = render({ checkin, feedback: { ...feedback, selfReview: { agreement: 'partly', comment: 'Teils richtig.' } } });
    expect(fertig).toContain('Teils richtig.');
    expect(fertig).toContain('»Offener fragen.«');
    // Alter Lauf: Freitext statt der zwei Antworten.
    const alt = render({ selfAssessment: 'Lief ganz gut.', feedback: { ...feedback, selfReview: { agreement: 'confirms', comment: 'Stimmt.' } } });
    expect(alt).toContain('»Lief ganz gut.«');
  });

  it('U15: „Weiter üben“ nennt die schwächste Fähigkeit, nicht eine Lücke aus C1 bis C10', () => {
    const katalog = [{ id: 'sim-a', title: 'Zuhören — Gespräch mit Kim', difficulty: 1 as const, competencies: [{ key: 'ursache' }] }];
    const html = render({ scenarios: katalog, onOpenScenario: () => undefined });
    expect(html).toContain('„Bis zur Ursache zuhören“ zeigt aktuell Deine größte Lücke.');
    expect(html).toContain('»Zuhören« zielt genau darauf.');
    expect(html).not.toContain('Kommunikation');
    // Die Studio-Brücke löst wie bisher über C1 bis C10 aus (≤ 2) und verlinkt die Kompetenz, benennt aber die Fähigkeit.
    expect(html).not.toContain('Learning Studio');
    const schwach = render({ ratings: [{ id: 'C1', name: 'Kommunikation', score: 2, why: '', evidence: [] }] });
    expect(schwach).toContain('zugeschnitten auf „Bis zur Ursache zuhören“.');
    expect(schwach).toContain('intent=gap&amp;c=C1&amp;t=3&amp;i=2');
  });
});

describe('Warteansicht und Fehlschlag', () => {
  it('zeigt den Fortschritt und das Gespräch zum Nachlesen', () => {
    const html = renderToStaticMarkup(
      createElement(EvalWarten, { startedAt: new Date(Date.now() - 5_000).toISOString(), typicalMs: 20_000, offsetMs: 0, turns, personaName: 'Alex Morgan' })
    );
    expect(html).toContain('Deine Auswertung entsteht');
    expect(html).toContain('Meist noch etwa 15 Sekunden.');
    expect(html).toContain('role="progressbar"');
    expect(count(html, 'data-zug=')).toBe(3);
  });

  it('ohne Angaben vom Server keine Zahl; länger als üblich → „Gleich fertig.“', () => {
    const ohne = renderToStaticMarkup(createElement(EvalWarten, { startedAt: null, typicalMs: null, offsetMs: 0, turns: [], personaName: null }));
    expect(ohne).not.toContain('Sekunden');
    const spaet = renderToStaticMarkup(
      createElement(EvalWarten, { startedAt: new Date(Date.now() - 60_000).toISOString(), typicalMs: 20_000, offsetMs: 0, turns: [], personaName: null })
    );
    expect(spaet).toContain('Gleich fertig.');
  });

  it('Fehlschlag: klarer Satz, „Noch einmal auswerten“ und der Weg zurück ins Gespräch', () => {
    const html = renderToStaticMarkup(
      createElement(EvalFehlschlag, { detail: 'Fehler-Nr. abc', error: null, topUpUrl: null, busy: false, onRetry: () => undefined, onBack: () => undefined })
    );
    expect(html).toContain('Dir wurde kein Credit berechnet.');
    expect(html).toContain('Noch einmal auswerten (1 Credit)');
    expect(html).toContain('Zurück ins Gespräch');
    expect(html).toContain('Fehler-Nr. abc');
  });
});
