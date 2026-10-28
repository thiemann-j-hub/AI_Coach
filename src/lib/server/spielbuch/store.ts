import "server-only";
import { createHash } from "node:crypto";
import { readItem, runsContainer, upsertItem } from "@/lib/cosmos";
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
}

/** Bindet das Spielbuch an Titel, Sprache und Rollen-DNA: ändert sich davon etwas, gilt es nicht mehr. */
export function spielbuchHash(s: SimulationScenario): string {
  const basis = JSON.stringify({ v: SPIELBUCH_VERSION, title: s.title, locale: s.locale, goals: s.candidateBriefing.goals, dna: s.personaDna });
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

async function readCached(s: SimulationScenario, hash: string): Promise<string | null> {
  const builtin = SPIELBUECHER_BUILTIN[s.id];
  if (builtin && builtin.hash === hash) return builtin.text;
  try {
    const doc = await readItem<SpielbuchDoc>(runsContainer(), spielbuchDocId(s.id), SPIELBUCH_PARTITION);
    if (doc?.docType === SPIELBUCH_DOC_TYPE && doc.hash === hash) return doc.text;
  } catch (e) {
    logger.apiError("spielbuch/readCached", e, { scenarioId: s.id });
  }
  return null;
}

async function generateAndStore(s: SimulationScenario, hash: string): Promise<string | null> {
  const t0 = Date.now();
  try {
    const r = await generateSpielbuch(s);
    const doc: SpielbuchDoc = {
      id: spielbuchDocId(s.id),
      sessionId: SPIELBUCH_PARTITION,
      docType: SPIELBUCH_DOC_TYPE,
      scenarioId: s.id,
      hash,
      model: r.model,
      createdAt: new Date().toISOString(),
      text: r.text,
    };
    await upsertItem(runsContainer(), doc);
    logger.info("[spielbuch] erzeugt", { scenarioId: s.id, hash, model: r.model, ms: Date.now() - t0, chars: r.text.length, tokens: r.tokens });
    return r.text;
  } catch (e) {
    logger.apiError("spielbuch/generate", e, { scenarioId: s.id, hash, ms: Date.now() - t0 });
    return null;
  }
}

/**
 * Liefert das passende Spielbuch oder null. Ohne `wait` wird ein fehlendes Spielbuch im Hintergrund
 * erzeugt (das nächste Gespräch hat es dann); mit `wait` wartet der Aufrufer auf die Erzeugung.
 */
export async function ensureSpielbuch(s: SimulationScenario, opts?: { wait?: boolean }): Promise<string | null> {
  if (!coachSpielbuchOn()) return null;
  const hash = spielbuchHash(s);
  const cached = await readCached(s, hash);
  if (cached) return cached;
  if (!claudeVertexConfigured()) return null;
  const key = `${s.id}:${hash}`;
  const map = inflight();
  let job = map.get(key);
  if (!job) {
    job = generateAndStore(s, hash).finally(() => map.delete(key));
    map.set(key, job);
  }
  if (opts?.wait) return job;
  void job;
  return null;
}
