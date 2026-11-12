import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runPersonaTurn, type PersonaTimeSignal } from "@/ai/flows/simulation-persona";
import { beobachteRegie, offeneRegieNotiz, regieStageNote } from "@/ai/flows/simulation-regie";
import { endeAbgelehntNote, pruefeEnde } from "@/ai/flows/simulation-ende-pruefung";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkAndConsumeBudget, estimateTokens } from "@/lib/server/cost-cap";
import { kiSchalterBlockt } from "@/lib/server/credits/entitlement";
import { getApiMessages } from "@/lib/server/get-request-locale";
import { ensureSpielbuch } from "@/lib/server/spielbuch/store";
import { coachRegieOn, simulationEnabled } from "@/lib/simulation/flags";
import { gespraechsZeitMs, pauseSetzen } from "@/lib/simulation/zeit";
import { zaehlpunkt } from "@/lib/server/trichter";
import { getScenarioForUser } from "@/lib/server/scenario-store";
import {
  SIM_MAX_TURN_CHARS,
  SIM_MAX_USER_TURNS,
  SIM_TIME_WARN_FRACTION,
  countUserTurns,
  getSimulation,
  updateSimulation,
  type SimulationDoc,
} from "@/lib/server/simulation-store";
import { withRetry, timeoutMs } from "@/lib/with-timeout";
import { logger } from "@/lib/logger";
import { aiErrorResponse } from "@/lib/server/request-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LLM_TIMEOUT_MS = timeoutMs("LLM_TIMEOUT_MS", 45_000);

const requestSchema = z.object({
  simId: z
    .string()
    .min(8)
    .max(64)
    .regex(/^[A-Za-z0-9-]+$/),
  message: z.string().min(1).max(SIM_MAX_TURN_CHARS),
});

/**
 * Warum der Lauf keinen Zug (mehr) annimmt. Gilt beim Einstieg und noch einmal am frischen Lauf direkt vor dem
 * Speichern (Paket 2, C3, 12.11.2026): Wurde der Lauf beendet, während die Rolle antwortete, bleibt er beendet.
 */
function zugSperre(doc: SimulationDoc): NextResponse | null {
  if (doc.status !== "active") {
    return NextResponse.json({ ok: false, code: "ALREADY_FINISHED" }, { status: 409 });
  }
  // Zeit-Regie (Owner-Vorgabe 04.08.): nach der Verabschiedung der Persona
  // ist das Gespräch zu — es bleibt nur noch die Auswertung.
  if (doc.closedByTime) {
    return NextResponse.json({ ok: false, code: "TIME_UP" }, { status: 409 });
  }
  // Welle 2: die Rolle hat das Gespräch selbst beendet — es bleibt nur die Auswertung.
  if (doc.closedByPersona) {
    return NextResponse.json({ ok: false, code: "ENDED", ende: doc.closedByPersona }, { status: 409 });
  }
  if (countUserTurns(doc.turns) >= SIM_MAX_USER_TURNS) {
    return NextResponse.json({ ok: false, code: "TURN_LIMIT" }, { status: 409 });
  }
  return null;
}

/** POST: ein Gesprächszug — Persona antwortet, beide Turns werden persistiert. */
export async function POST(req: NextRequest) {
  if (!simulationEnabled()) {
    return NextResponse.json(
      { ok: false, code: "SIMULATION_DISABLED" },
      { status: 503 }
    );
  }
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  // Paket 1, C5 (12.11.2026): Begrenzung je Person statt je Adresse (eine Gruppe hinter einer Firmenadresse teilte sich 20 Züge).
  const rl = checkRateLimit(`sim-turn:${auth.uid}`, 20, 60_000, getApiMessages(req).rateLimited);
  if (rl) return rl;
  // A4 (31.10.2026): KI-Schalter des Unternehmens vor JEDEM Gesprächszug, nicht nur beim Start.
  const ki = await kiSchalterBlockt("/api/simulation/turn");
  if (ki) return ki;

  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const d = parsed.data;

    const doc = await getSimulation(auth.uid, d.simId);
    if (!doc) {
      return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
    }
    const gesperrt = zugSperre(doc);
    if (gesperrt) return gesperrt;
    const scenario = await getScenarioForUser(auth.uid, doc.scenarioId, auth.oid);
    if (!scenario) {
      return NextResponse.json({ ok: false, code: "UNKNOWN_SCENARIO" }, { status: 410 });
    }

    // Zeitbox (Synthesia-Muster): ab ~80 % streut die Persona EINMAL beiläufig
    // ein, dass sie gleich los muss; ist die Zeit um, beantwortet sie den
    // letzten Beitrag kurz, verabschiedet sich (Folgetermin) — Zwangsende.
    // Paket 4, C13 (12.11.2026): gerechnet wird mit der gemeinsamen Uhr; Coach-Pausen zählen nicht zur Gesprächszeit.
    const eingangMs = Date.now();
    const elapsedMs = gespraechsZeitMs(doc, eingangMs);
    // B2: im Prüfungsmodus gilt die (meist kürzere) Check-Zeitbox.
    const durationMin =
      doc.mode === "check"
        ? (scenario.checkDurationMin ?? scenario.durationMin)
        : scenario.durationMin;
    const limitMs = durationMin * 60_000;
    let timeSignal: PersonaTimeSignal | undefined;
    if (elapsedMs >= limitMs) {
      timeSignal = "farewell";
    } else if (elapsedMs >= limitMs * SIM_TIME_WARN_FRACTION && !doc.timeWarned) {
      timeSignal = "closing";
    }

    // Pro-User-Token-Budget: Kontext (System-Prompt + Verlauf) + neue Nachricht.
    const historyText = doc.turns.map((t) => t.text).join("\n");
    const budget = await checkAndConsumeBudget({
      uid: auth.uid,
      email: auth.email,
      estimatedTokens: estimateTokens(historyText, d.message),
    });
    if (!budget.allowed && budget.response) return budget.response;

    // Spielbuch (Owner-GO 28.10.): aus dem Zwischenspeicher; fehlt es, entsteht es im Hintergrund.
    const spielbuch = await ensureSpielbuch(scenario);
    // Welle 2: Regie-Notiz des Beobachters vom VORIGEN Zug (ein Zug Verzögerung, keine Wartezeit).
    const offeneNotiz = offeneRegieNotiz(doc.regie);
    const regieNotiz = offeneNotiz ? regieStageNote(scenario, offeneNotiz) : null;
    const now = new Date().toISOString();
    const turnsMitNutzer = [...doc.turns, { role: "user" as const, text: d.message, ts: now }];
    const [result, regie] = await Promise.all([
      withRetry(
        () =>
          runPersonaTurn({
            scenario,
            turns: doc.turns,
            userMessage: d.message,
            convoLocale: doc.convoLocale,
            timeSignal,
            hardness: doc.hardness,
            spielbuch,
            regieNotiz,
          }),
        { ms: LLM_TIMEOUT_MS, label: "gemini-sim-turn", retries: 1 }
      ),
      // Beobachter parallel zur Antwort; sein Ergebnis wirkt beim nächsten Zug. Fehler → null.
      // Paket 1, C14 (12.11.2026): Er trägt seine eigene Frist (REGIE_TIMEOUT_MS). Hängt er, geht die Antwort
      // der Rolle trotzdem raus, und die Regie-Notiz dieses Zugs entfällt.
      coachRegieOn()
        ? beobachteRegie({ scenario, turns: turnsMitNutzer, bisher: doc.regie?.length ? doc.regie[doc.regie.length - 1] : null })
        : Promise.resolve(null),
    ]);
    let reply = result.reply;
    let ende = result.ende ?? null;
    let abgelehnt: string | null = null;
    // Torwächter (01.11.2026): Das Ende gilt nur, wenn die Endbedingung wirklich erfüllt ist. Sonst wird der Zug mit der
    // Regie-Notiz einmal wiederholt (eine zusätzliche Antwort, nur in diesem Fall), damit der Abschied die Person nie erreicht.
    if (ende) {
      const pruefung = await pruefeEnde({ scenario, turns: [...turnsMitNutzer, { role: "persona" as const, text: reply, ts: now }], ende });
      if (!pruefung.erfuellt) {
        abgelehnt = pruefung.fehlt;
        ende = null;
        const notiz = regieStageNote(scenario, { stufe: 0, erfuellt: [], eskaliert: false, notiz: endeAbgelehntNote(scenario, pruefung.fehlt), turn: turnsMitNutzer.length, ts: now });
        try {
          const wieder = await withRetry(
            () => runPersonaTurn({ scenario, turns: doc.turns, userMessage: d.message, convoLocale: doc.convoLocale, timeSignal, hardness: doc.hardness, spielbuch, regieNotiz: notiz }),
            { ms: LLM_TIMEOUT_MS, label: "gemini-sim-turn-wdh", retries: 0 }
          );
          reply = wieder.reply;
        } catch (e) {
          logger.apiError("/api/simulation/turn/wdh", e, { simId: d.simId });
        }
        logger.api("/api/simulation/turn", "ende-abgelehnt", { uid: auth.uid, simId: d.simId, fehlt: pruefung.fehlt.slice(0, 120) });
      }
    }

    // Paket 2, C3 (12.11.2026): Die Rolle hat Sekunden gebraucht; in der Zeit kann eine Coach-Pause, das Live-Gespräch
    // oder die Auswertung den Lauf geändert haben. Deshalb wird nicht die alte Kopie zurückgeschrieben, sondern dieser
    // Zug an den frischen Lauf angehängt. Ein beendeter Lauf bleibt beendet (dann wird nichts gespeichert).
    const antwort = reply;
    const geprueftesEnde = ende;
    const fehlt = abgelehnt;
    const antwortTs = new Date().toISOString();
    let sperre = null as NextResponse | null;
    let erstesWort = false;
    const saved = await updateSimulation(auth.uid, d.simId, (lauf) => {
      sperre = zugSperre(lauf);
      if (sperre) return false;
      erstesWort = countUserTurns(lauf.turns) === 0;
      lauf.turns.push({ role: "user", text: d.message, ts: now }, { role: "persona", text: antwort, ts: antwortTs });
      // C13: Wer schreibt, pausiert nicht. Eine offen gebliebene Coach-Pause endet mit dem Eingang dieses Zugs.
      pauseSetzen(lauf, false, eingangMs);
      if (timeSignal === "closing") lauf.timeWarned = true;
      if (timeSignal === "farewell") lauf.closedByTime = true;
      if (offeneNotiz) {
        // Die übergebene Notiz am frischen Lauf abhaken (derselbe Eintrag: Zug und Zeitstempel).
        const uebergeben = lauf.regie?.find((r) => r.turn === offeneNotiz.turn && r.ts === offeneNotiz.ts);
        if (uebergeben) uebergeben.delivered = true;
      }
      if (regie) lauf.regie = [...(lauf.regie ?? []).slice(-40), regie];
      if (geprueftesEnde) lauf.closedByPersona = { ...geprueftesEnde, at: antwortTs };
      if (fehlt !== null) {
        const letzte = lauf.regie?.[lauf.regie.length - 1];
        lauf.regie = [
          ...(lauf.regie ?? []).slice(-40),
          { stufe: letzte?.stufe ?? 0, erfuellt: letzte?.erfuellt ?? [], eskaliert: false, notiz: endeAbgelehntNote(scenario, fehlt), turn: lauf.turns.length, ts: antwortTs, delivered: true, fehlt },
        ];
      }
    });
    if (!saved) {
      return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
    }
    if (sperre) {
      logger.api("/api/simulation/turn", "nicht-gespeichert", { uid: auth.uid, simId: d.simId, status: saved.status });
      return sperre;
    }
    // Paket 4, S24: Zählpunkt „erstes Wort“ (Textweg), ohne Nutzertext.
    if (erstesWort) zaehlpunkt("erstes_wort", scenario.id, "schreiben");

    // Paket 1, C2 (12.11.2026): Antwort und Protokoll nennen das GEPRÜFTE Ende. Bis heute stand hier das ungeprüfte
    // Ende der Rolle (Fehler vom 01.11.2026): Ein vom Torwächter abgelehntes Ende erschien im Browser als beendet.
    logger.api("/api/simulation/turn", "ok", {
      uid: auth.uid,
      simId: d.simId,
      turns: saved.turns.length,
      ...(timeSignal ? { timeSignal } : {}),
      ...(geprueftesEnde ? { ende: geprueftesEnde.ergebnis } : {}),
      ...(regie ? { regieStufe: regie.stufe } : {}),
    });
    return NextResponse.json({
      ok: true,
      reply: antwort,
      turnCount: saved.turns.length,
      userTurnsLeft: SIM_MAX_USER_TURNS - countUserTurns(saved.turns),
      timeUp: saved.closedByTime === true,
      // Welle 2: die Rolle hat das Gespräch beendet — der Client zeigt den Hinweis und geht zur Auswertung.
      ...(geprueftesEnde ? { ende: geprueftesEnde } : {}),
    });
  } catch (err) {
    // W1-1/W1-2: KI-Fehlerart + Fehler-Nr. statt „Internal server error“ (Rückweg AI_ERROR_CONTRACT=off).
    return aiErrorResponse(err, req, "/api/simulation/turn");
  }
}
