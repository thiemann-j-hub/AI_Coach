import "server-only";
import { createHash } from "node:crypto";
import { deleteItem, readItem, runsContainer, upsertItem } from "@/lib/cosmos";
import { claudeMessage, claudeVertexConfigured } from "@/lib/server/claude-vertex";
import { coachSpielbuchOn } from "@/lib/simulation/flags";
import { buildSpielbuchPrompt, buildSpielbuchSystem, spielbuchPlausibel, SPIELBUCH_VERSION } from "@/lib/simulation/spielbuch";
import { SPIELBUECHER_BUILTIN } from "@/lib/simulation/spielbuecher";
import type { SimulationScenario } from "@/lib/simulation/types";
import { logger } from "@/lib/logger";

/**
 * Zwischenspeicher der Spielbücher.
 *  1. Standard-Szenarien: im Repo (`spielbuecher/index.ts`), gebunden an den DNA-Hash.
 *  2. Alle anderen (Builder-Szenarien, veraltete Standard-Einträge): Cosmos-Dokument im runs-Container,
 *     Partition „spielbuch“, ein Dokument je Szenario, überschrieben, wenn der Hash nicht mehr passt.
 *  3. Fehlt ein passendes Spielbuch, startet die Erzeugung im Hintergrund (einmal je Schlüssel) und das
 *     laufende Gespräch kommt ohne aus — nie wartet eine Person auf Opus. `ensureSpielbuch(…, { wait: true })`
 *     wartet (Skript, Veröffentlichung im Builder).
 *  4. Gelöscht wird ein Spielbuch mit seinem Szenario (`deleteSpielbuch`, Paket 2, C19).
 *  5. Scheitert die Erzeugung, merkt sich das Dokument den Fehlschlag (`failedAt`): 30 Minuten lang startet kein
 *     neuer Versuch (Paket 5, C28). `spielbuchStatus` sagt dem Builder, wie es um die Vorbereitung steht.
 */
export const SPIELBUCH_DOC_TYPE = "sim_spielbuch" as const;
export const SPIELBUCH_PARTITION = "spielbuch";

export interface SpielbuchDoc {
  id: string; // `spielbuch:${scenarioId}`
  sessionId: typeof SPIELBUCH_PARTITION; // PK
  docType: typeof SPIELBUCH_DOC_TYPE;
  scenarioId: string;
  hash: string;
  model: string;
  createdAt: string;
  text: string;
  /** Paket 5, C28 (12.11.2026): Zeitpunkt (ISO), zu dem die Erzeugung für diesen Hash gescheitert ist; `text` ist dann leer. */
  failedAt?: string;
}

/** Paket 5, C28: So lange startet nach einem Fehlschlag kein neuer Versuch. Vorher: bei jedem Zug ein neuer teurer Aufruf. */
export const SPIELBUCH_FEHLER_PAUSE_MS = 30 * 60_000;

/** Die Anrede in Großschreibung, als ganze Wörter. */
const ANREDE_GROSS = /(?<![\p{L}\p{N}])(?:Du|Dir|Dich|Dein(?:e|er|em|en|es)?)(?![\p{L}\p{N}])/gu;

/** Bindet das Spielbuch an Titel, Sprache und Rollen-DNA: ändert sich davon etwas, gilt es nicht mehr. */
export function spielbuchHash(s: SimulationScenario): string {
  // Paket 5, U8 (12.11.2026): Titel und Ziele der eingebauten Szenarien schreiben die Anrede jetzt groß („Du“). Die
  // mitgelieferten Spielbücher entstanden mit kleiner Anrede; am Inhalt ändert die Schreibweise nichts. Deshalb zählt
  // sie bei eingebauten Szenarien nicht mit, sonst entstünden die betroffenen Spielbücher neu. Kunden-Szenarien
  // (`ws-`) bleiben gebunden wie bisher: Ihre gespeicherten Spielbücher gelten weiter.
  const fest = (t: string) => (s.id.startsWith("ws-") ? t : t.replace(ANREDE_GROSS, (m) => m.toLowerCase()));
  const basis = JSON.stringify({ v: SPIELBUCH_VERSION, title: fest(s.title), locale: s.locale, goals: s.candidateBriefing.goals?.map(fest), dna: s.personaDna });
  return createHash("sha256").update(basis).digest("hex").slice(0, 16);
}

export function spielbuchDocId(scenarioId: string): string {
  return `spielbuch:${scenarioId}`;
}

/** Erzeugt ein Spielbuch mit dem starken Modell (ohne Zwischenspeicher). Wirft bei Fehler oder unplausiblem Text. */
export async function generateSpielbuch(s: SimulationScenario): Promise<{ text: string; model: string; ms: number; tokens: { prompt?: number; output?: number } }> {
  const reply = await claudeMessage({ system: buildSpielbuchSystem(s.locale), user: buildSpielbuchPrompt(s), maxTokens: 6000 });
  if (!spielbuchPlausibel(reply.text, s.locale)) {
    throw new Error(`Spielbuch unplausibel (${reply.text.length} Zeichen, Abschnitte fehlen). Anfang: ${reply.text.slice(0, 300).replace(/\s+/g, " ")}`);
  }
  return { text: reply.text, model: reply.model, ms: reply.ms, tokens: reply.tokens };
}

type Inflight = Map<string, Promise<string | null>>;
function inflight(): Inflight {
  const g = globalThis as unknown as { __coachSpielbuchInflight?: Inflight };
  if (!g.__coachSpielbuchInflight) g.__coachSpielbuchInflight = new Map();
  return g.__coachSpielbuchInflight;
}

/** Was zu diesem Stand des Szenarios vorliegt: der Text, ein gemerkter Fehlschlag oder nichts. */
async function readCached(s: SimulationScenario, hash: string): Promise<{ text: string | null; failedAt: string | null }> {
  const builtin = SPIELBUECHER_BUILTIN[s.id];
  if (builtin && builtin.hash === hash) return { text: builtin.text, failedAt: null };
  try {
    const doc = await readItem<SpielbuchDoc>(runsContainer(), spielbuchDocId(s.id), SPIELBUCH_PARTITION);
    if (doc?.docType === SPIELBUCH_DOC_TYPE && doc.hash === hash) return { text: doc.text || null, failedAt: doc.failedAt ?? null };
  } catch (e) {
    logger.apiError("spielbuch/readCached", e, { scenarioId: s.id });
  }
  return { text: null, failedAt: null };
}

function spielbuchDoc(s: SimulationScenario, hash: string, rest: Pick<SpielbuchDoc, "model" | "text" | "failedAt">): SpielbuchDoc {
  return { id: spielbuchDocId(s.id), sessionId: SPIELBUCH_PARTITION, docType: SPIELBUCH_DOC_TYPE, scenarioId: s.id, hash, createdAt: new Date().toISOString(), ...rest };
}

async function generateAndStore(s: SimulationScenario, hash: string): Promise<string | null> {
  const t0 = Date.now();
  try {
    const r = await generateSpielbuch(s);
    await upsertItem(runsContainer(), spielbuchDoc(s, hash, { model: r.model, text: r.text }));
    logger.info("[spielbuch] erzeugt", { scenarioId: s.id, hash, model: r.model, ms: Date.now() - t0, chars: r.text.length, tokens: r.tokens });
    return r.text;
  } catch (e) {
    logger.apiError("spielbuch/generate", e, { scenarioId: s.id, hash, ms: Date.now() - t0 });
    // Paket 5, C28: Fehlschlag merken. Gelingt auch das nicht, bleibt es beim Protokoll (dann gilt keine Pause).
    await upsertItem(runsContainer(), spielbuchDoc(s, hash, { model: "", text: "", failedAt: new Date().toISOString() })).catch((e2) =>
      logger.apiError("spielbuch/fehlschlag-merken", e2, { scenarioId: s.id, hash })
    );
    return null;
  }
}

/**
 * Liefert das passende Spielbuch oder null. Ohne `wait` wird ein fehlendes Spielbuch im Hintergrund
 * erzeugt (das nächste Gespräch hat es dann); mit `wait` wartet der Aufrufer auf die Erzeugung.
 * Nach einem Fehlschlag startet 30 Minuten lang kein neuer Versuch (Paket 5, C28).
 */
export async function ensureSpielbuch(s: SimulationScenario, opts?: { wait?: boolean }): Promise<string | null> {
  if (!coachSpielbuchOn()) return null;
  const hash = spielbuchHash(s);
  const cached = await readCached(s, hash);
  if (cached.text) return cached.text;
  if (!claudeVertexConfigured()) return null;
  const key = `${s.id}:${hash}`;
  const map = inflight();
  let job = map.get(key);
  if (!job) {
    if (cached.failedAt && Date.now() - Date.parse(cached.failedAt) < SPIELBUCH_FEHLER_PAUSE_MS) return null;
    job = generateAndStore(s, hash).finally(() => map.delete(key));
    map.set(key, job);
  }
  if (opts?.wait) return job;
  void job;
  return null;
}

/** Paket 5, C28: Stand der Vorbereitung einer Rolle, für den Builder. */
export type SpielbuchStatus = "bereit" | "laeuft" | "fehlgeschlagen" | "offen";

/**
 * Sagt, wie es um das Spielbuch eines Szenarios steht, ohne etwas anzustoßen: bereit, wird gerade erzeugt, zuletzt
 * gescheitert (der nächste Versuch folgt bei einem Gespräch nach der Pause) oder offen (entsteht beim Veröffentlichen
 * oder beim ersten Gespräch). null: Die Vorbereitung ist abgeschaltet oder nicht eingerichtet, es gibt nichts zu melden.
 */
export async function spielbuchStatus(s: SimulationScenario): Promise<SpielbuchStatus | null> {
  if (!coachSpielbuchOn()) return null;
  const hash = spielbuchHash(s);
  const cached = await readCached(s, hash);
  if (cached.text) return "bereit";
  if (!claudeVertexConfigured()) return null;
  if (inflight().has(`${s.id}:${hash}`)) return "laeuft";
  return cached.failedAt ? "fehlgeschlagen" : "offen";
}

/**
 * Paket 2, C19 (12.11.2026): Spielbuch eines Szenarios löschen. Das Dokument trägt weder Personen- noch
 * Firmenkennung und blieb deshalb liegen, wenn das Szenario, das Konto oder die Firma gelöscht wurde. Jede Stelle,
 * die ein Szenario löscht, ruft das hier auf. Läuft gerade eine Erzeugung, wird ihr Ergebnis danach ebenfalls
 * gelöscht. Fail-soft: Das Löschen des Szenarios scheitert nie am Spielbuch (false = nicht gelungen, steht im Protokoll).
 */
export async function deleteSpielbuch(scenarioId: string): Promise<boolean> {
  const loeschen = () => deleteItem(runsContainer(), spielbuchDocId(scenarioId), SPIELBUCH_PARTITION);
  try {
    for (const [key, job] of inflight()) {
      if (!key.startsWith(`${scenarioId}:`)) continue;
      void job.then(loeschen).catch((e) => logger.apiError("spielbuch/delete", e, { scenarioId }));
    }
    await loeschen();
    return true;
  } catch (e) {
    logger.apiError("spielbuch/delete", e, { scenarioId });
    return false;
  }
}
