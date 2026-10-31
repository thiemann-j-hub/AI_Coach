import "server-only";

import { EndSensitivity, GoogleGenAI, Modality, Type, type LiveServerMessage } from "@google/genai";
import { beobachteRegie } from "@/ai/flows/simulation-regie";
import { vertexHost } from "@/ai/gemini-backend";
import { logger } from "@/lib/logger";
import { checkAndConsumeBudget } from "@/lib/server/cost-cap";
import { KI_AUS_TEXT, kiSchalterAus } from "@/lib/server/credits/entitlement";
import { ensureSpielbuch } from "@/lib/server/spielbuch/store";
import { getScenarioForUser } from "@/lib/server/scenario-store";
import { getSimulation, saveSimulation } from "@/lib/server/simulation-store";
import { coachEndeOn, coachLiveLocation, coachLiveModel, coachLiveSprechpause, coachRegieOn } from "@/lib/simulation/flags";
import {
  ENDE_WERKZEUG,
  runLiveSession,
  type ConnectUpstream,
  type LiveDeps,
  type LiveSocket,
  type Upstream,
  WS_OPEN,
} from "./live-session";
import { liveTicketStore } from "./ticket-store";

/**
 * Sprachmodus Live — Anschluss an die echte Außenwelt (N4-231):
 *   1. `createVertexLiveConnector` spricht Gemini Live auf Vertex AI (Dienstkonto, EU-Mehrfachregion,
 *      Host aiplatform.eu.rep.googleapis.com — der SDK-Standardhost antwortet dort mit 404).
 *   2. `registerLiveAccept` hängt die Annahme neuer Browser-Sockets an `globalThis`, wo der
 *      Server-Mantel (server/live-server.js) sie findet: Karte prüfen, Sitzung fahren.
 * Die Ticket-Route importiert dieses Modul — so ist die Annahme registriert, bevor der erste
 * Socket kommt (die Karte geht der Verbindung immer voraus).
 */

const CONNECT_TIMEOUT_MS = 20_000;
const HELLO_TIMEOUT_MS = 5_000;

export function liveConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean((env.VERTEX_PROJECT ?? "").trim() && (env.GOOGLE_SA_KEY_JSON ?? "").trim());
}

type Credentials = NonNullable<NonNullable<ConstructorParameters<typeof GoogleGenAI>[0]["googleAuthOptions"]>["credentials"]>;

function genAi(): GoogleGenAI {
  const project = (process.env.VERTEX_PROJECT ?? "").trim();
  if (!project) throw new Error("VERTEX_PROJECT fehlt (Sprachmodus Live)");
  const raw = (process.env.GOOGLE_SA_KEY_JSON ?? "").trim();
  if (!raw) throw new Error("GOOGLE_SA_KEY_JSON fehlt (Sprachmodus Live)");
  const credentials = JSON.parse(raw) as Credentials;
  const location = coachLiveLocation();
  return new GoogleGenAI({
    vertexai: true,
    project,
    location,
    httpOptions: { apiVersion: "v1beta1", baseUrl: `https://${vertexHost(location)}/` },
    googleAuthOptions: { credentials, scopes: ["https://www.googleapis.com/auth/cloud-platform"] },
  });
}

export function createVertexLiveConnector(): ConnectUpstream {
  return async (cfg, ev) => {
    const ai = genAi();
    let closedByUs = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frist = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error("Live-Verbindung: keine Antwort in 20 s")), CONNECT_TIMEOUT_MS);
    });
    const verbinden = ai.live.connect({
      model: cfg.model,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: cfg.voice } },
          languageCode: cfg.languageCode,
        },
        systemInstruction: { parts: [{ text: cfg.systemInstruction }] },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        // Wiederaufnahme-Marke + gleitendes Fenster: Gespräche über der Sitzungsgrenze laufen weiter.
        sessionResumption: cfg.resumeHandle ? { handle: cfg.resumeHandle } : {},
        contextWindowCompression: { slidingWindow: {} },
        // Welle 2: die Rolle beendet das Gespräch selbst (Endbedingungen) über ein Werkzeug.
        ...(cfg.endeWerkzeug
          ? {
              tools: [
                {
                  functionDeclarations: [
                    {
                      name: ENDE_WERKZEUG,
                      description:
                        "Beendet das Gespräch, NACHDEM du dich verabschiedet hast und eine Endbedingung erfüllt ist. grund: ein Satz, warum. ergebnis: ziel (Ergebnis erreicht), verabschiedung (das Gegenüber hat beendet) oder abbruch (du brichst nach einem Eskalations-Trigger ab).",
                      parameters: {
                        type: Type.OBJECT,
                        properties: {
                          grund: { type: Type.STRING, description: "Ein Satz, warum das Gespräch zu Ende ist." },
                          ergebnis: { type: Type.STRING, enum: ["ziel", "verabschiedung", "abbruch"] },
                        },
                        required: ["grund", "ergebnis"],
                      },
                    },
                  ],
                },
              ],
            }
          : {}),
        // Welle 2: Sprechpausen-Erkennung — „kurz“ nimmt das Satzende früher an (schneller, eher Unterbrechung).
        ...(cfg.sprechpause === "kurz"
          ? { realtimeInputConfig: { automaticActivityDetection: { endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH, silenceDurationMs: 500 } } }
          : {}),
      },
      callbacks: {
        onopen: () => {},
        onmessage: (m: LiveServerMessage) => {
          const sc = m.serverContent;
          if (sc) {
            for (const p of sc.modelTurn?.parts ?? []) {
              if (p.inlineData?.data) ev.onAudio(Buffer.from(p.inlineData.data, "base64"));
            }
            if (sc.inputTranscription?.text) ev.onInputText(sc.inputTranscription.text);
            if (sc.outputTranscription?.text) ev.onOutputText(sc.outputTranscription.text);
            if (sc.interrupted) ev.onInterrupted();
            if (sc.turnComplete) ev.onTurnComplete();
          }
          if (m.sessionResumptionUpdate?.resumable && m.sessionResumptionUpdate.newHandle) {
            ev.onResumptionHandle(m.sessionResumptionUpdate.newHandle);
          }
          if (m.goAway) ev.onGoAway();
          const calls = m.toolCall?.functionCalls;
          if (calls?.length) {
            ev.onToolCall(calls.map((c) => ({ id: c.id, name: c.name ?? "", args: (c.args ?? {}) as Record<string, unknown> })));
          }
        },
        onerror: (e) => ev.onError(e instanceof Error ? e : new Error(String((e as { message?: string })?.message ?? e))),
        onclose: (e) => {
          if (!closedByUs) ev.onClose(`${e?.code ?? ""} ${e?.reason ?? ""}`.trim());
        },
      },
    });
    let session: Awaited<typeof verbinden>;
    try {
      session = await Promise.race([frist, verbinden]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    const up: Upstream = {
      sendAudio: (pcm) => session.sendRealtimeInput({ audio: { data: pcm.toString("base64"), mimeType: "audio/pcm;rate=16000" } }),
      sendText: (text, turnComplete) => session.sendClientContent({ turns: [{ role: "user", parts: [{ text }] }], turnComplete }),
      sendHistory: (turns) =>
        session.sendClientContent({ turns: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })), turnComplete: false }),
      sendToolResponse: (responses) =>
        session.sendToolResponse({ functionResponses: responses.map((r) => ({ id: r.id, name: r.name, response: r.response })) }),
      close: () => {
        closedByUs = true;
        try {
          session.close();
        } catch {
          /* schon zu */
        }
      },
    };
    return up;
  };
}

function realDeps(): LiveDeps {
  return {
    connect: createVertexLiveConnector(),
    loadSim: (uid, simId) => getSimulation(uid, simId),
    saveSim: (doc) => saveSimulation(doc),
    loadScenario: (uid, scenarioId, oid) => getScenarioForUser(uid, scenarioId, oid),
    loadSpielbuch: (scenario) => ensureSpielbuch(scenario),
    regie: (scenario, turns, bisher) => (coachRegieOn() ? beobachteRegie({ scenario, turns, bisher }) : Promise.resolve(null)),
    endeOn: coachEndeOn(),
    sprechpause: coachLiveSprechpause(),
    budget: async (a) => ({ allowed: (await checkAndConsumeBudget(a)).allowed }),
    // A4 (31.10.2026): derselbe Schalter wie in den API-Routen, hier mit der Kennung aus der Karte.
    kiAusMeldung: async (oid) => ((await kiSchalterAus(oid, "/api/simulation/live/ws")) ? KI_AUS_TEXT : null),
    now: () => Date.now(),
    log: (level, msg, meta) => logger[level](`[live] ${msg}`, meta),
    model: coachLiveModel(),
  };
}

/** Erste Nachricht eines frischen Sockets: die Karte. Dann läuft die Sitzung. */
export async function acceptLiveSocket(ws: LiveSocket, deps: LiveDeps = realDeps()): Promise<void> {
  const ticketId = await new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), HELLO_TIMEOUT_MS);
    ws.on("message", function erste(data, isBinary) {
      clearTimeout(timer);
      if (isBinary) return resolve(null);
      try {
        const raw = Buffer.isBuffer(data) ? data.toString("utf8") : Array.isArray(data) ? Buffer.concat(data).toString("utf8") : typeof data === "string" ? data : Buffer.from(data).toString("utf8");
        const msg = JSON.parse(raw) as { t?: string; ticket?: string };
        resolve(msg.t === "hello" && typeof msg.ticket === "string" ? msg.ticket : null);
      } catch {
        resolve(null);
      }
    });
    ws.on("close", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
  const ticket = ticketId ? liveTicketStore().redeem(ticketId) : null;
  if (!ticket) {
    if (ws.readyState === WS_OPEN) ws.close(4401, "UNAUTHORIZED");
    return;
  }
  await runLiveSession(ws, ticket, deps);
}

/** Vom Server-Mantel erwartete Form. */
export interface LiveAcceptor {
  accept(ws: LiveSocket): void;
}

export function registerLiveAccept(): void {
  const g = globalThis as typeof globalThis & { __coachLive?: LiveAcceptor };
  if (g.__coachLive) return;
  g.__coachLive = {
    accept: (ws) => {
      void acceptLiveSocket(ws).catch((e) => {
        logger.error("[live] accept", { err: e instanceof Error ? e.message : String(e) });
        try {
          ws.close(1011, "live-failed");
        } catch {
          /* schon zu */
        }
      });
    },
  };
}
