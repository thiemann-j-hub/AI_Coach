import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * Paket 4 (12.11.2026): Die neuen Ansichten rendern ohne Browser durch. Niemand in dieser Welle kann mit einem
 * echten Mikrofon testen; geprüft wird deshalb, was sich nicht still verschieben darf: Wahl im Briefing, Aufklärung
 * vor dem Mikrofon, Zustand als Text UND Form, drei Knöpfe, Kennzeichen „KI-Rolle“, eingeklappte Mitschrift.
 */
vi.mock('@/i18n/useTranslation', async () => {
  const de = (await import('@/i18n/dictionaries/de.json')).default;
  return { useTranslation: () => ({ t: de, locale: 'de' }) };
});

import de from '@/i18n/dictionaries/de.json';
import type { RolleZustand } from '@/lib/simulation/sprech-zustand';
import { MikrofonCheck } from './MikrofonCheck';
import { Sprechansicht } from './Sprechansicht';
import { WegWahl } from './WegWahl';
import { GespraechsBlasen } from './teile';

const ts = de.simulation;
const nichts = () => {};

describe('WegWahl (U1, S1)', () => {
  const render = (weg: 'sprechen' | 'schreiben') =>
    renderToStaticMarkup(
      createElement(WegWahl, {
        weg,
        onChange: nichts,
        texte: { titel: ts.wegTitle, sprechen: ts.wegSprechen, schreiben: ts.wegSchreiben, hinweis: ts.wegSchreibenNote },
      })
    );

  it('zeigt beide Wege und markiert den gewählten', () => {
    const html = render('sprechen');
    expect(html).toContain('So führst Du das Gespräch');
    expect(html).toMatch(/aria-checked="true"[^>]*>[\s\S]*Sprechen/);
    expect(html).toMatch(/aria-checked="false"[^>]*>[\s\S]*Schreiben/);
    expect(render('schreiben')).toMatch(/aria-checked="false"[^>]*>[\s\S]*Sprechen[\s\S]*aria-checked="true"/);
  });
});

describe('MikrofonCheck (S1, S2)', () => {
  it('stellt die Aufklärung vor die erste Mikrofon-Nutzung und bietet „Lieber schreiben“ an', () => {
    const html = renderToStaticMarkup(
      createElement(MikrofonCheck, {
        personaName: 'Alex Morgan',
        vorbereiten: () => null,
        ausKlick: true,
        onLos: nichts,
        onSchreiben: nichts,
        onZaehlpunkt: nichts,
      })
    );
    expect(html).toContain('Alex Morgan spricht mit Dir.');
    expect(html).toContain(ts.micNoticeTitle);
    expect(html).toContain('Verstanden, Mikro nutzen');
    expect(html).toContain('Lieber schreiben');
    // „Los geht's“ gibt es erst, wenn das Mikrofon offen ist.
    expect(html).not.toContain('Los geht');
  });
});

describe('Sprechansicht (U2, S4, S5)', () => {
  const render = (zustand: RolleZustand, extra: Partial<Parameters<typeof Sprechansicht>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(Sprechansicht, {
        name: 'Alex Morgan',
        rolle: 'Teamleiterin',
        portrait: 'sim-coaching-morgan',
        zustand,
        turns: [{ role: 'persona', text: 'Hallo, schön dass Du Zeit hast.' }],
        laufendDu: '',
        laufendRolle: '',
        pause: { onClick: nichts, disabled: false, zaehler: '0/3' },
        mikro: { an: true, disabled: false, onClick: nichts },
        beenden: { label: ts.endShort, onClick: nichts, disabled: true },
        ...extra,
      })
    );

  it('zeigt Porträt, Name mit Kennzeichen „KI-Rolle“ und die Rollenzeile', () => {
    const html = render('hoert');
    expect(html).toContain('/personas/sim-coaching-morgan.jpg');
    expect(html).toContain('Alex Morgan');
    expect(html).toContain('KI-Rolle');
    expect(html).toContain('Teamleiterin');
  });

  it('nennt jeden Zustand als Text und gibt dem Ring je Zustand eine eigene Form', () => {
    const faelle: Array<[RolleZustand, string, string]> = [
      ['hoert', 'hört zu', 'border-emerald-500'],
      ['denkt', 'denkt nach', 'border-dashed'],
      ['spricht', 'spricht', 'border-[6px]'],
      ['mikroAus', 'Mikrofon aus', 'border-2 border-border'],
      ['verbindet', ts.liveConnecting, 'border-dashed'],
    ];
    for (const [zustand, text, form] of faelle) {
      const html = render(zustand);
      expect(html, zustand).toContain(`data-zustand="${zustand}"`);
      expect(html, zustand).toContain(text);
      expect(html, zustand).toContain(form);
    }
  });

  it('bewegt den Ring nur, wenn Bewegung erwünscht ist (prefers-reduced-motion)', () => {
    const html = render('denkt') + render('spricht');
    expect(html).toContain('motion-safe:animate-');
    expect(html).not.toMatch(/(^|[\s"])animate-(spin|pulse|ping)/);
  });

  it('hat drei Knöpfe in der Leiste: Coach-Pause, Mikrofon, Beenden', () => {
    const html = render('hoert');
    expect(html).toContain('Coach-Pause');
    expect(html).toContain('0/3');
    expect(html).toContain(`aria-label="${ts.micOff}"`);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Beenden');
  });

  it('zeigt bei stummem Mikrofon „Mikrofon einschalten“ und in der Prüfung keine Coach-Pause', () => {
    const html = render('mikroAus', { pause: null, mikro: { an: false, disabled: false, onClick: nichts } });
    expect(html).toContain(`aria-label="${ts.micOn}"`);
    expect(html).not.toContain('Coach-Pause');
  });

  it('hält die Mitschrift eingeklappt und stellt Banner über die Knöpfe', () => {
    const html = render('hoert', { banner: createElement('div', { 'data-testid': 'banner' }, 'Ich höre nichts mehr.') });
    expect(html).toContain('Mitschrift zeigen');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Hallo, schön dass Du Zeit hast.');
    // Reihenfolge im Dokument: Porträt, dann Banner, dann die Knöpfe.
    expect(html.indexOf('/personas/')).toBeLessThan(html.indexOf('data-testid="banner"'));
    expect(html.indexOf('data-testid="banner"')).toBeLessThan(html.indexOf(`aria-label="${ts.micOff}"`));
  });
});

describe('GespraechsBlasen (dieselben Blasen in Chat und Mitschrift)', () => {
  it('zeigt gespeicherte Züge, die Wartezeile und den laufenden Zug', () => {
    const html = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        createElement(GespraechsBlasen, {
          turns: [
            { role: 'persona', text: 'Worum geht es?' },
            { role: 'user', text: 'Um den Monatsbericht.' },
          ],
          personaName: 'Alex Morgan',
          portrait: 'sim-coaching-morgan',
          wartet: 'Alex Morgan antwortet …',
          laufendDu: 'Ich wollte noch',
          laufendRolle: 'Ja, also',
        })
      )
    );
    for (const text of ['Worum geht es?', 'Um den Monatsbericht.', 'Alex Morgan antwortet …', 'Ich wollte noch', 'Ja, also']) {
      expect(html).toContain(text);
    }
  });
});
