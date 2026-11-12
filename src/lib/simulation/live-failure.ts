/**
 * Paket 1, C10 und C26 (12.11.2026): Warum ist das Mikrofon aus? Reine Entscheidungen für den Rollenspiel-Client.
 *
 * Anlass: Verweigerte der Browser das Mikrofon, wertete der Client das als Verbindungsabriss, verband still neu und
 * schaltete dann ohne Satz ab. Beendete der Server die Live-Sitzung (Tagesbudget, Zuggrenze, Stille, 30 Minuten),
 * ging das Mikrofon ebenfalls ohne Satz aus. Hier steht je Grund, was der Client zeigt und ob er neu verbindet.
 *
 * Gründe des Servers: `bye`-Gründe und `error`-Codes aus src/lib/server/live/live-session.ts (samt `replaced` und
 * `not_active` aus Paket 2), Schließ-Codes ohne Abschied (4401 Karte abgelaufen, 1011 Sitzung gescheitert) aus
 * src/lib/server/live/live-accept.ts.
 */

/** Schlüssel unter `simulation.*` für alles rund ums Mikrofon. */
export type VoiceTextKey =
  | 'micDenied'
  | 'micUnavailable'
  | 'micIdleOff'
  | 'liveMaxTime'
  | 'liveReplaced'
  | 'liveEnded'
  | 'voiceLost'
  | 'turnLimit'
  | 'scenarioGone'
  | 'genericError';

export type VoiceMessage =
  | { type: 'text'; key: VoiceTextKey }
  /** Vorhandene Du-Texte aus `aiErrors.*` (Dienst nicht erreichbar, Tageslimit). */
  | { type: 'ai'; aiCode: 'ai_unavailable' | 'daily_limit' }
  /** Meldung, die der Server mitschickt (KI vom Unternehmen ausgeschaltet). */
  | { type: 'server'; text: string };

/** Der erste Grund, den eine Live-Verbindung für ihr Ende nennt. */
export type LiveEndCause =
  /** Das Mikrofon ließ sich nicht starten (getUserMedia, AudioContext). */
  | { art: 'mic'; error: unknown }
  /** Fehler-Frame des Servers. */
  | { art: 'error'; code: string; message?: string }
  /** Abschied des Servers. */
  | { art: 'bye'; reason: string }
  /** Socket zu, ohne Abschied und ohne Fehler (Netz, Schlaf, Karte abgelaufen). */
  | { art: 'close'; wsCode?: number };

export interface LiveEndDecision {
  /** Der Satz, warum das Mikrofon aus ist; null, wenn Banner oder Karte es schon sagen. */
  message: VoiceMessage | null;
  /** `timeUp` = Banner „Zeit ist um“, `ended` = Karte „Rolle hat beendet“. */
  banner: 'timeUp' | 'ended' | null;
  /** Einmal still neu verbinden — nur beim Abriss ohne Grund. */
  reconnect: boolean;
}

const text = (key: VoiceTextKey): VoiceMessage => ({ type: 'text', key });

function errorText(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const e = err as { name?: unknown; message?: unknown };
    return `${typeof e.name === 'string' ? e.name : ''} ${typeof e.message === 'string' ? e.message : ''}`.trim();
  }
  return '';
}

/** Verweigert (Browser-Freigabe fehlt) oder nicht startbar (kein Gerät, belegt)? */
export function micErrorKind(err: unknown): 'denied' | 'unavailable' {
  return /NotAllowedError|PermissionDeniedError|SecurityError|Permission denied|not-allowed/i.test(errorText(err))
    ? 'denied'
    : 'unavailable';
}

/**
 * @param cause    der erste Grund der Verbindung (Mikrofon vor Fehler vor Abschied vor bloßem Schließen)
 * @param retried  true, wenn für diesen Start schon einmal neu verbunden wurde
 */
export function decideLiveEnd(cause: LiveEndCause, retried: boolean): LiveEndDecision {
  const say = (message: VoiceMessage | null): LiveEndDecision => ({ message, banner: null, reconnect: false });
  const banner = (b: 'timeUp' | 'ended'): LiveEndDecision => ({ message: null, banner: b, reconnect: false });

  if (cause.art === 'mic') {
    // Kein Abriss: Neuverbinden hilft nicht, die Person muss das Mikrofon freigeben oder anschließen.
    return say(text(micErrorKind(cause.error) === 'denied' ? 'micDenied' : 'micUnavailable'));
  }

  if (cause.art === 'error') {
    switch (cause.code) {
      case 'KI_AUS':
        return say(cause.message?.trim() ? { type: 'server', text: cause.message.trim() } : text('genericError'));
      case 'UPSTREAM':
        return say({ type: 'ai', aiCode: 'ai_unavailable' });
      case 'TIME_UP':
        return banner('timeUp');
      case 'ENDED':
        return banner('ended');
      case 'TURN_LIMIT':
        return say(text('turnLimit'));
      case 'UNKNOWN_SCENARIO':
        return say(text('scenarioGone'));
      case 'ALREADY_FINISHED':
        return say(text('liveEnded'));
      default:
        // NOT_FOUND und Unbekanntes.
        return say(text('genericError'));
    }
  }

  if (cause.art === 'bye') {
    switch (cause.reason) {
      case 'time_up':
        return banner('timeUp');
      case 'ended_by_persona':
        return banner('ended');
      case 'turn_limit':
        return say(text('turnLimit'));
      case 'budget':
        return say({ type: 'ai', aiCode: 'daily_limit' });
      case 'idle':
        return say(text('micIdleOff'));
      case 'upstream':
        return say({ type: 'ai', aiCode: 'ai_unavailable' });
      case 'ki_aus':
        // Die Meldung kam schon mit dem Fehler-Frame; fehlt er, bleibt die allgemeine Meldung.
        return say(text('genericError'));
      case 'ended':
        // Schaltet die Person selbst ab, räumt der Client vorher auf und kommt hier nie an —
        // bleibt die 30-Minuten-Grenze des Servers.
        return say(text('liveMaxTime'));
      case 'replaced':
        // Eine neuere Verbindung (anderes Fenster) hat den Lauf übernommen — auf keinen Fall neu verbinden,
        // sonst nehmen sich zwei Fenster das Gespräch gegenseitig weg.
        return say(text('liveReplaced'));
      case 'not_active':
        // Der Lauf ist inzwischen ausgewertet, abgebrochen oder gelöscht.
        return say(text('liveEnded'));
      default:
        return say(text('voiceLost'));
    }
  }

  // Abriss ohne Grund (Netz, Schlaf, Karte abgelaufen 4401, Sitzung gescheitert 1011): einmal neu verbinden.
  if (!retried) return { message: null, banner: null, reconnect: true };
  return say(text('voiceLost'));
}

/**
 * Diktat (Azure oder Browser-Erkennung) ist zu Ende. null = die Person hat selbst gestoppt, sonst der Satz.
 * `error`: Fehlertext des Azure-SDK („Error occurred during microphone initialization: NotAllowedError …“) oder
 * der Fehlercode der Browser-Erkennung (not-allowed, audio-capture, no-speech, network …).
 */
export function dictationEndMessage(error: string | null | undefined, stoppedByUser: boolean): VoiceMessage | null {
  if (stoppedByUser) return null;
  const e = (error ?? '').trim();
  if (/microphone initialization|audio-capture|NotFoundError|NotReadableError|OverconstrainedError|not-allowed|NotAllowedError|Permission/i.test(e)) {
    return text(micErrorKind(e) === 'denied' ? 'micDenied' : 'micUnavailable');
  }
  if (/no-speech/i.test(e)) return text('micIdleOff');
  return text('voiceLost');
}
