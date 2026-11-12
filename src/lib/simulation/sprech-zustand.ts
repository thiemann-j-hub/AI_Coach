/**
 * Paket 4, S4 (12.11.2026): Was tut die Rolle gerade? Reine Entscheidung für die Sprechansicht.
 *
 * Anlass: Das Sprachgespräch zeigte nur ein „Live“-Abzeichen. Die Sprechansicht hat ein Standbild; ohne Zustand
 * weiß die Person nicht, ob die Rolle zuhört, nachdenkt oder spricht. Der Browser leitet den Zustand aus dem ab,
 * was er ohnehin weiß (WELLE3-SPRECHEN.md): „spricht“, solange Ton der Rolle abgespielt wird; „denkt nach“ nach
 * `thinking` vom Relais bis zum ersten Ton; sonst „hört zu“ (Mikrofon an) oder „Mikrofon aus“.
 */

export type RolleZustand = 'verbindet' | 'hoert' | 'denkt' | 'spricht' | 'mikroAus';

export interface RolleZustandLage {
  /** Die Live-Verbindung steht. */
  verbunden: boolean;
  /** Die Verbindung baut sich gerade auf (auch: neu verbinden). */
  verbindet: boolean;
  /** Ton der Rolle wird gerade abgespielt (weiß der Tonweg im Browser). */
  ton: boolean;
  /** Die Person ist fertig, die Antwort entsteht (`thinking`), oder die Rolle eröffnet gleich. */
  denkt: boolean;
  /** Das Mikrofon ist an (nicht stumm geschaltet, keine Coach-Pause). */
  mikroAn: boolean;
}

export function rolleZustand(l: RolleZustandLage): RolleZustand {
  // Ton geht vor: Die Verabschiedung spielt noch zu Ende, auch wenn die Verbindung schon zu ist.
  if (l.ton) return 'spricht';
  if (l.denkt && (l.verbunden || l.verbindet)) return 'denkt';
  if (l.verbindet) return 'verbindet';
  if (!l.verbunden) return 'mikroAus';
  return l.mikroAn ? 'hoert' : 'mikroAus';
}
