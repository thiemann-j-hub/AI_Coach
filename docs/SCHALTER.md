# Schalter-Register des Coachs

Stand: 12.11.2026 (Paket 6 „Unterbau“, Befund C33). Quelle: alle Lesestellen von `process.env` in `src/` und `server/`.

Dieses Register nennt jede Umgebungsvariable, die der Coach liest: Zweck, Standard im Code, Stand im Betrieb,
Wirkung des Rückwegs und Datum des Einbaus. Werte von Zugängen und Schlüsseln stehen hier nie.

**Pflege:** Wer einen Schalter einbaut, ändert oder entfernt, trägt es hier im selben Zug ein, mit Einbaudatum.
Maßstab des Aufräumens vom 12.11.2026: Ein Rückweg wird samt altem Codeweg und Tests entfernt, wenn er im Betrieb
nicht gesetzt ist, der Standard im Code der neue Weg ist und der Umbau älter als 30 Tage ist.
`/api/version` zeigt nur Schalter, die es im Code gibt.

**Spalte „Betrieb“:** aus den App-Einstellungen gelesen am 12.11.2026. Gesetzt waren genau acht Schalter
(`COST_CAP_MODE`, `QUALITY_CHECKS_MODE`, `RADAR_EMIT`, `SCORING_CONSENSUS`, `SIMULATION_ENABLED`,
`SIMULATION_RADAR_EMIT`, `COACH_LIVE`, `COACH_RICHTER`). „nicht gesetzt“ heißt: Es gilt der Standard im Code.
„nicht bestätigt“ heißt: Die Variable gehört zu den Zugängen, ihr Wert wurde am 12.11.2026 nicht abgelesen.

**Spalte „Einbau“:** Datum aus dem Kommentar im Code; mit „(Git)“ das Datum des ersten Commits, wenn der Kommentar keines nennt.

## 1. Funktionen an- und abstellen

| Name | Zweck | Standard | Betrieb | Wirkung bei `off` | Einbau |
|---|---|---|---|---|---|
| `SIMULATION_ENABLED` | Schaltet das Rollenspiel frei. | `off` | `on` | Alle Routen unter `/api/simulation` antworten 503 `SIMULATION_DISABLED`. | 30.07.2026 (Git) |
| `COACH_LIVE` | Sprachgespräch mit der Rolle (Live-Relais). Werte: `off`, `all` oder Szenario-Kennungen mit Komma. | `off` | `all` | Kein Sprachgespräch; Schreiben und Diktat bleiben. Der Server-Mantel startet dann den unveränderten Next-Server. | 28.10.2026 |
| `COACH_LIVE_SPRECHPAUSE` | Wann das Live-Modell das Satzende annimmt: `normal` oder `kurz` (antwortet schneller, unterbricht eher). | `normal` | nicht gesetzt | Kein `off`; ohne Variable gilt `normal`. | 30.10.2026 |
| `COACH_RICHTER` | Richter der Auswertung: `gemini` (schnelles Modell) oder `opus` (starkes Modell, Rückfall auf das schnelle bei Fehler oder Frist). | `gemini` | `opus` | Kein `off`; ohne Variable urteilt das schnelle Modell. | 30.10.2026 |
| `COACH_SPIELBUCH` | Vertrauliches Spielbuch je Szenario, das ein starkes Modell vor dem Gespräch schreibt. | `on` | nicht gesetzt | Die Rolle spielt nur aus ihrer Beschreibung, ohne Spielbuch. | 28.10.2026 |
| `COACH_ENDE` | Die Rolle beendet das Gespräch selbst, wenn eine Endbedingung erfüllt ist. | `on` | nicht gesetzt | Das Gespräch endet nur durch die Person oder die Zeit. | 30.10.2026 |
| `COACH_ENDE_PRUEFUNG` | Torwächter: prüft, ob die Endbedingung wirklich erfüllt ist, bevor das Ende gilt. | `on` | nicht gesetzt | Ein Ende der Rolle gilt ungeprüft. | 01.11.2026 |
| `COACH_REGIE` | Beobachter im Hintergrund (Öffnungsstufe je Zug, Notiz an die Rolle). | `on` | nicht gesetzt | Kein Beobachter, keine Regie-Notiz, kein Öffnungsverlauf für den Richter. | 30.10.2026 |
| `COACH_VORBEREITEN` | „Mein echtes Gespräch vorbereiten“ (privates Szenario, 1 Credit). | `on` | nicht gesetzt | `/api/simulation/vorbereiten` antwortet 503 `VORBEREITEN_OFF`. | 30.10.2026 |
| `COACH_INTERVIEW` | Kurs-Interview (Pilot). Werte: `off`, `all` oder Arbeitsbereichs-Kennungen mit Komma. | nur der Arbeitsbereich des Owners | nicht gesetzt | Kein Interview für niemanden. | 30.10.2026 (Git) |
| `COACH_PREFLIGHT` | Guthaben vor dem Start des Rollenspiels prüfen (nur lesen). | `on` | nicht gesetzt | Das Gespräch startet auch mit leerem Guthaben; die Auswertung lehnt dann mit 402 ab. | 14.10.2026 |
| `KI_GATE` | KI-Schalter des Unternehmens aus dem Hub beachten (vor jedem KI-Schritt). | `on` | nicht gesetzt | Die KI ist immer erlaubt, auch wenn das Unternehmen sie ausgeschaltet hat. | 16.10.2026 (Git) |
| `CONSENT_GATE` | Einwilligung „Sprachaufnahme“ vor Sprach-Token und Live-Karte prüfen. | `on` | nicht gesetzt | Keine Prüfung der Einwilligung. | 20.10.2026 |
| `RADAR_EMIT` | Auswertungen als Messpunkte ins Radar schreiben. | `off` | `on` | Es wird nichts geschrieben. Löschen wirkt unabhängig davon. | 02.07.2026 (Git) |
| `SIMULATION_RADAR_EMIT` | Auch Rollenspiel-Auswertungen als Messpunkte schreiben (zweites Ja neben `RADAR_EMIT`). | `off` | `on` | Rollenspiele erzeugen keine Messpunkte. | 30.07.2026 (Git) |
| `SCORING_CONSENSUS` | C1 bis C10 mit drei parallelen Läufen und Mehrheitsentscheid bewerten. | `off` | `on` | Ein Lauf statt drei (günstiger, weniger stabil). | 02.07.2026 |
| `QUALITY_CHECKS_MODE` | Zitatprüfung der Auswertung: `off`, `warn` oder `enforce` (unbelegte Werte zurückhalten). | `warn` | `enforce` | `off`: keine Prüfung. `warn`: nur Vermerk. | 13.06.2026 (Git) |
| `DIAGNOSE_REPORT` | Fehlerbericht zum Herunterladen (Version, Schalterstand, letzte Fehler). | an | nicht gesetzt | `/api/version` meldet `diagnose:false`, der Dialog bleibt zu. | 14.10.2026 |

## 2. Kosten begrenzen und Fristen

| Name | Zweck | Standard | Betrieb | Wirkung / Rückweg | Einbau |
|---|---|---|---|---|---|
| `COST_CAP_MODE` | Tagesbudget an Token je Person: `enforce` blockt mit 429, `off` zählt nur. | `enforce` | `enforce` | `off`: keine Sperre, nur Zählung. | 13.06.2026 (Git) |
| `DAILY_TOKEN_LIMIT` | Höhe des Tagesbudgets je Person. | `500000` | nicht gesetzt | Ohne Variable gilt der Standard. | 13.06.2026 (Git) |
| `COACH_SIM_STARTS_PER_DAY` | Rollenspiel-Starts je Person und Tag (Admins frei). | `6` | nicht gesetzt | `0`: keine Tagesgrenze. | 15.10.2026 |
| `LLM_TIMEOUT_MS` | Frist für Rolle, Coach-Impuls, Eröffnung, Analyse und C1 bis C10. | `45000` | nicht gesetzt | Ohne Variable gilt der Standard. | 17.06.2026 (Git) |
| `BUILDER_LLM_TIMEOUT_MS` | Frist für den Szenario-Generator (Builder, Vorbereiten), für beide Versuche zusammen. | `170000` | nicht gesetzt | Ohne Variable gilt der Standard. | 19.08.2026 (Git) |
| `INTERVIEW_LLM_TIMEOUT_MS` | Frist für einen Interview-Zug. | `25000` | nicht gesetzt | Ohne Variable gilt der Standard. | 30.10.2026 (Git) |
| `COACH_RICHTER_TIMEOUT_MS` | Frist des starken Richters (mindestens 30000); gilt auch für den Interview-Bericht. | `110000` | nicht gesetzt | Ohne Variable gilt der Standard. | 30.10.2026 (Git) |
| `RAG_TIMEOUT_MS` | Frist für die Kartensuche der Gesprächsanalyse. | `6000` | nicht gesetzt | Ohne Variable gilt der Standard. | 12.07.2026 (Git) |
| `CREDIT_SERVICE_TIMEOUT_MS` | Frist je Abruf beim Credit-Dienst. | `5000` | nicht gesetzt | Ohne Variable gilt der Standard. | 17.06.2026 (Git) |
| `TRANSFER_CHECK_MIN_HOURS` | Frühestens nach so vielen Stunden fragt der Coach nach dem Vorsatz. | `72` | nicht gesetzt | Ohne Variable gilt der Standard. | 27.09.2026 |

## 3. Rückwege abgeschlossener Umbauten

Jeder dieser Schalter hält nur den alten Weg eines Umbaus am Leben. Standard ist überall der neue Weg, im Betrieb ist
keiner gesetzt. Die letzte Spalte nennt den Tag, ab dem der Umbau älter als 30 Tage ist.

| Name | Umbau (neuer Weg, gilt ohne Variable) | Wirkung bei `off` (alter Weg) | Einbau | Älter als 30 Tage ab |
|---|---|---|---|---|
| `AI_ERROR_CONTRACT` | KI-Fehler mit Fehlerart und passendem Status (`AI_ERROR`, `aiCode`). | Routen antworten mit 500 `INTERNAL_ERROR`. Wirkt nicht auf die Auswertung: Der Auftrag vermerkt die Fehlerart immer am Lauf. | 14.10.2026 | 14.11.2026 |
| `REQUEST_ID_IN_UI` | Fehler-Nummer in Antwort und Kopfzeile `x-request-id`. | Die Nummer steht nur im Protokoll. Wirkt nicht auf `finishError` am Lauf. | 14.10.2026 | 14.11.2026 |
| `VERSION_BANNER` | Hinweis „neue Version“ nach einer Auslieferung. | `/api/version` meldet `banner:false`, kein Hinweis. | 14.10.2026 | 14.11.2026 |
| `TOAST_RULES` | Meldungen mit festen Regeln für Dauer und Art. | `/api/version` meldet `toastRules:false`, die Meldungen folgen den Vorgaben der Bibliothek. | 14.10.2026 | 14.11.2026 |
| `ADDRESS_PARAM` | Anrede-Regel („Du“ groß, nie „Sie“) in jedem KI-Aufruf. | Die Prompts gehen ohne den Regelblock an die KI. | 14.10.2026 | 14.11.2026 |
| `COACH_FAEHIGKEITEN` | Fähigkeiten-Bibliothek mit vier Stufen, Gewicht und Bestehensgrenze je Szenario. | Eingebaute Szenarien bewerten mit der alten Fünfer-Rubrik S1 bis S5, ohne Gewicht und Grenze, ohne Prüfungszeit. | 30.10.2026 | 30.11.2026 |
| `COACH_NO_ACCESS_PAGE` | Seite „kein Zugang“ statt der Oberfläche, wenn das Häkchen „KI-Coach“ fehlt. | Die Seiten laden wie früher, die API lehnt weiter ab. | 06.10.2026 | seit 06.11.2026 |
| `REQUIRE_VALID_LOGIN` | Abgelaufene Anmeldung führt zu „neu anmelden“, bevor das Zugangstor übersprungen wird. | Altes Verhalten: Ohne gültiges Token wird das Tor übersprungen. | 02.10.2026 | seit 02.11.2026 |
| `THEME_PLATTFORM` | Ein Hell-Dunkel-Schalter für alle vier Apps, Standard hell. | Eigener Schlüssel je App, Standard dunkel. Nur sinnvoll in allen vier Apps zugleich. | 01.11.2026 | 02.12.2026 |
| `DESIGN_KLAR` | Farbwelt „Klar“. | Die alte Farbwelt. | 30.10.2026 | 30.11.2026 |

Am 12.11.2026 entfernt (der neue Weg gilt jetzt fest):

| Name | Fest gilt | Einbau |
|---|---|---|
| `COMMITMENT_EXPLICIT` | Der Vorschlag des Coachs wird erst mit „Übernehmen“ zum Vorsatz, nie still beim Speichern der Auswertung. | 11.10.2026 |
| `MAIL_LINK_PN_ONLY` | Eine Sitzung aus einem Mail-Link zählt nur für Konten mit der Kennung `ml:…`. | 02.10.2026 |
| `SPEECH_INPUT` | Diktat nur über die Spracherkennung in Westeuropa. Die Erkennung des Browsers und die Browserstimme als Notnagel sind entfernt (C31). | 12.10.2026 |

## 4. KI-Anschluss, Modelle und Dienste (Stellschrauben)

| Name | Zweck | Standard | Betrieb | Rückweg | Einbau |
|---|---|---|---|---|---|
| `GEMINI_BACKEND` | `vertex` = Textmodelle über das Dienstkonto in der EU statt über die Entwickler-Schnittstelle. | leer (Entwickler-Schnittstelle mit `GEMINI_API_KEY`) | `vertex` (abgelesen 12.11.2026) | Variable weglassen. | 11.10.2026 |
| `VERTEX_LOCATION` | Standort der Textmodelle. | `eu` | `eu` (abgelesen 12.11.2026) | Ohne Variable gilt der Standard. | 13.10.2026 |
| `VERTEX_EMBED_LOCATION` | Standort der Einbettungen. | `europe-west3` | `europe-west3` (abgelesen 12.11.2026) | Ohne Variable gilt der Standard. | 13.10.2026 |
| `GEMINI_TEXT_MODEL` | Schreiber-Modell (Rolle, Coach, Generator, schneller Richter). | `gemini-2.5-flash` | `gemini-3.5-flash` (abgelesen 12.11.2026) | Anderes Modell eintragen, kein Deploy nötig. | 27.09.2026 |
| `GEMINI_EMBEDDING_MODEL` | Einbettungsmodell der Kartensuche. | `gemini-embedding-001` | nicht gesetzt (abgelesen 12.11.2026) | Ohne Variable gilt der Standard. | 11.07.2026 (Git) |
| `COACH_LIVE_MODEL` | Modell des Sprachgesprächs. | `gemini-3.8-live` | nicht gesetzt | Ohne Variable gilt der Standard. | 28.10.2026 |
| `COACH_LIVE_LOCATION` | Standort des Sprachgesprächs. | `eu` | nicht gesetzt | Ohne Variable gilt der Standard. | 28.10.2026 |
| `COACH_SPIELBUCH_MODEL` | Starkes Modell für Spielbuch, Richter `opus` und Interview-Bericht. | `claude-opus-5-5` | nicht gesetzt | Ohne Variable gilt der Standard. | 28.10.2026 |
| `COACH_SPIELBUCH_REGION` | Standort des starken Modells. | `eu` | nicht gesetzt | Ohne Variable gilt der Standard. | 28.10.2026 |
| `CREDITS_CENTRAL` | `on` = Guthaben über den zentralen Credit-Dienst; nur dann gibt es ein Guthaben-Tor. | `off` | `on` (abgelesen 12.11.2026) | `off`: kein Guthaben-Tor, nur das Tagesbudget schützt. | 17.06.2026 (Git) |
| `PN_SERVICE_AUTH` | PulseNorth-Konten (Anmeldung ohne Microsoft) und Dienst-Aufrufe vom Hub mit dem Dienst-Ausweis zulassen. | `on` | nicht gesetzt | `off`: PulseNorth-Konten werden abgewiesen, Dienst-Routen antworten 404. | 02.10.2026 |
| `CREDIT_SERVICE_URL` | Adresse des Credit-Dienstes. | Adresse im Code | nicht gesetzt (abgelesen 12.11.2026) | Ohne Variable gilt der Standard. | 17.06.2026 (Git) |
| `CREDIT_SERVICE_SCOPE` | Berechtigungsbereich für das Token des Credit-Dienstes. | Wert im Code | gesetzt (abgelesen 12.11.2026) | Ohne Variable gilt der Standard. | — |
| `CREDIT_TOPUP_URL` | Adresse der Kasse im Hinweis „Guthaben leer“. | `https://pulsenorth.ai/preise` | gesetzt (abgelesen 12.11.2026) | Ohne Variable gilt der Standard. | 18.06.2026 (Git) |
| `COSMOS_DATABASE` | Datenbank des Coachs. | `coach` | nicht bestätigt | Ohne Variable gilt der Standard. | — |
| `COSMOS_VECTOR_DATABASE` / `COSMOS_VECTOR_CONTAINER` | Ablage der Coaching-Karten für die Suche. | `coach-vec` / `cards` | nicht bestätigt | Ohne Variable gilt der Standard. | — |
| `RADAR_DATABASE` | Datenbank der Radar-Messpunkte. | `pulsecraft` | nicht bestätigt | Ohne Variable gilt der Standard. | 02.07.2026 (Git) |
| `INVOICE_BLOB_CONTAINER` | Ablage der Rechnungs-PDFs. | `invoices` | nicht bestätigt | Ohne Variable gilt der Standard. | — |

## 5. Zugänge und Schlüssel (nur Namen)

Werte stehen nur in den App-Einstellungen, nie im Code, nie in diesem Register, nie in `.env.example`.

- Anmeldung: `AUTH_SECRET` (liest die Anmelde-Bibliothek selbst), `AUTH_URL`, `NEXTAUTH_URL`, `AUTH_MICROSOFT_ENTRA_ID_ID`,
  `AUTH_MICROSOFT_ENTRA_ID_SECRET`, `AUTH_MICROSOFT_ENTRA_ID_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_ISSUER`
- Daten: `COSMOS_ENDPOINT`, `COSMOS_KEY`, `AZURE_STORAGE_ACCOUNT`
- KI: `GEMINI_API_KEY`, `GOOGLE_SA_KEY_JSON`, `VERTEX_PROJECT`
- Sprache: `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`
- Dienste: `PN_SERVICE_SECRET`, `QUALITY_STATS_TOKEN`
- Rechte: `ADMIN_EMAILS` (Adressen ohne Tagesbudget und ohne Tagesgrenze der Starts)

## 6. Technik (setzt der Bau oder die Laufzeit)

- `NEXT_PUBLIC_BASE_PATH`: Pfad vor der App (`/coach` hinter dem Hub, leer im Direktbetrieb). Wird beim Bau eingebacken.
- `NEXT_PUBLIC_BUILD_SHA`, `BUILD_SHA`, `BUILD_BRANCH`, `BUILD_STAMPED_AT`: Stand der Auslieferung für `/api/version`.
- `PORT`, `HOSTNAME`, `KEEP_ALIVE_TIMEOUT`, `NODE_ENV`: Laufzeit des Servers (`server/live-server.js`).
- `__NEXT_PRIVATE_STANDALONE_CONFIG`: setzt der Server-Mantel selbst, keine Einstellung.

## Anzeige in `/api/version`

`switches` zeigt nur `on`, `off`, `set` oder `unset`, nie Werte: `AI_ERROR_CONTRACT`, `REQUEST_ID_IN_UI`,
`DIAGNOSE_REPORT`, `GEMINI_BACKEND`, `VERTEX_LOCATION`, `COACH_PREFLIGHT`, `CREDITS_CENTRAL`, `SIMULATION_ENABLED`.
Dazu die Felder `diagnose`, `banner` (`VERSION_BANNER`) und `toastRules` (`TOAST_RULES`).
