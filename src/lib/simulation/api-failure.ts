/**
 * Paket 1, C1 und C5 (12.11.2026): Welcher Satz und welches Verhalten gehören zu welcher Fehlerantwort?
 *
 * Anlass: Der Rollenspiel-Client las die Antwort zweimal (`res.json()` erst im Aufrufer, dann noch einmal in
 * `handleApiFailure`). Der zweite Versuch scheiterte still, der `code` blieb leer, und es griffen nur noch die
 * Zweige am HTTP-Status. Jetzt übergibt der Aufrufer den schon gelesenen Körper, und die Entscheidung steht
 * hier als reine Funktion (getestet in api-failure.test.ts). Die Texte selbst wählt der Client aus dem Wörterbuch.
 */

/** Felder, die unsere Routen im Fehlerfall schicken (alle optional, alles ungeprüft). */
export interface ApiFailureBody {
  code?: unknown;
  error?: unknown;
  topUpUrl?: unknown;
  canTopUp?: unknown;
  preflight?: unknown;
  aiCode?: unknown;
  requestId?: unknown;
  retryAfterSeconds?: unknown;
  ende?: unknown;
  /** Weitere Felder (ok, limit, used …) stören nicht. */
  [key: string]: unknown;
}

/** Schlüssel unter `simulation.*`, die eine Fehlerantwort auslösen kann. */
export type ApiFailureTextKey =
  | 'reauth'
  | 'unavailable'
  | 'notEnoughTurns'
  | 'turnLimit'
  | 'timeoutLimit'
  | 'scenarioGone'
  | 'runAborted'
  | 'genericError';

export interface PersonaEnde {
  grund: string;
  ergebnis: string;
  at?: string;
}

export type ApiFailureDecision =
  /** Guthaben leer. `member` = Mitglied ohne Kaufrecht (kein Link), sonst Satz vor oder nach dem Rollenspiel. */
  | { kind: 'credits'; text: 'member' | 'preflightPaywall' | 'paywall'; topUpUrl: string | null }
  /** KI-Fehler: Du-Text je Fehlerart plus Fehler-Nummer (aiErrorMessage). */
  | { kind: 'ai' }
  /** Das Unternehmen hat die KI ausgeschaltet: Meldung des Servers, Mikrofon aus. */
  | { kind: 'kiAus'; text: string | null }
  /** Eigener Satz des Servers (z. B. Tagesgrenze der Starts). */
  | { kind: 'server'; text: string }
  /** Zu viele Anfragen: „Bitte warte {n} Sekunden …“. */
  | { kind: 'wait'; seconds: number }
  /** Kein Fehler: die Zeit ist um (Banner statt roter Meldung). */
  | { kind: 'timeUp' }
  /** Kein Fehler: die Rolle hat das Gespräch beendet (Karte statt roter Meldung). */
  | { kind: 'ended'; ende: PersonaEnde }
  /** Kein Fehler: der Lauf wird schon ausgewertet oder ist ausgewertet. Der Client wechselt zur Auswertungsseite. */
  | { kind: 'evaluation' }
  | { kind: 'text'; key: ApiFailureTextKey };

/** Wartezeit, wenn der Server keine nennt. */
export const DEFAULT_WAIT_SECONDS = 60;

function waitSeconds(fromBody: unknown, fromHeader: string | null | undefined): number {
  for (const raw of [fromBody, fromHeader]) {
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
    if (Number.isFinite(n) && n > 0) return Math.ceil(n);
  }
  return DEFAULT_WAIT_SECONDS;
}

function endeOf(raw: unknown): PersonaEnde {
  const e = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    grund: typeof e.grund === 'string' ? e.grund : '',
    ergebnis: typeof e.ergebnis === 'string' && e.ergebnis ? e.ergebnis : 'verabschiedung',
    ...(typeof e.at === 'string' && e.at ? { at: e.at } : {}),
  };
}

/**
 * @param status      HTTP-Status der Antwort
 * @param body        der schon gelesene JSON-Körper (null, wenn die Antwort kein JSON war)
 * @param retryAfter  Kopfzeile `Retry-After`, falls vorhanden
 */
export function decideApiFailure(
  status: number,
  body: ApiFailureBody | null | undefined,
  retryAfter?: string | null
): ApiFailureDecision {
  const b: ApiFailureBody = body && typeof body === 'object' ? body : {};
  const code = typeof b.code === 'string' ? b.code : '';
  const serverText = typeof b.error === 'string' && b.error.trim() ? b.error.trim() : null;
  const text = (key: ApiFailureTextKey): ApiFailureDecision => ({ kind: 'text', key });

  if (status === 402 || code === 'INSUFFICIENT_CREDITS') {
    // B13 (01.10.2026): Mitglieder bekommen keinen Kauf-Link — Credits kauft der Admin.
    const member = b.canTopUp === false;
    return {
      kind: 'credits',
      // S4-4: vor dem Start heißt der Satz anders als nach dem Rollenspiel.
      text: member ? 'member' : b.preflight === true ? 'preflightPaywall' : 'paywall',
      topUpUrl: !member && typeof b.topUpUrl === 'string' && b.topUpUrl ? b.topUpUrl : null,
    };
  }
  // W1-1/W1-2: KI-Fehler vor allen Zweigen am Status (429 gedrosselt, 503 nicht erreichbar, 504 Zeit).
  if (code === 'AI_ERROR' || (typeof b.aiCode === 'string' && b.aiCode)) return { kind: 'ai' };
  if (code === 'CENTRAL_REAUTH') return text('reauth');
  if (code === 'KI_AUS') return { kind: 'kiAus', text: serverText };
  if (code === 'TIME_UP') return { kind: 'timeUp' };
  if (code === 'ENDED') return { kind: 'ended', ende: endeOf(b.ende) };
  // Paket 3 (12.11.2026): Der Lauf wurde inzwischen beendet (z. B. im zweiten Fenster). `turn`, `timeout` und die
  // Karte fürs Sprechen melden das beim Speichern. Dort steht „Auswertung läuft“ oder das Ergebnis.
  if (code === 'ALREADY_FINISHED') return { kind: 'evaluation' };
  // `finish` an einem abgebrochenen Lauf: eigener kurzer Satz.
  if (code === 'ABORTED') return text('runAborted');
  if (code === 'NOT_ENOUGH_TURNS') return text('notEnoughTurns');
  if (code === 'TURN_LIMIT') return text('turnLimit');
  if (code === 'TIMEOUT_LIMIT') return text('timeoutLimit');
  // Szenario fehlt: 410 im laufenden Gespräch, 404 beim Start.
  if (code === 'UNKNOWN_SCENARIO' || status === 410) return text('scenarioGone');
  if (status === 429 || code === 'RATE_LIMITED' || code === 'QUOTA_EXCEEDED') {
    // C5: Der eigene Satz des Servers (Tagesgrenze) geht vor. RATE_LIMITED bringt nur einen allgemeinen,
    // nicht übersetzten Text mit — dafür steht der Warte-Satz in allen Sprachen.
    if (code !== 'RATE_LIMITED' && serverText) return { kind: 'server', text: serverText };
    return { kind: 'wait', seconds: waitSeconds(b.retryAfterSeconds, retryAfter) };
  }
  if (code === 'CENTRAL_UNAVAILABLE' || status === 503) return text('unavailable');
  return text('genericError');
}
