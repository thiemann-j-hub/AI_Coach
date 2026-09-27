/**
 * Karten für Debrief und Coach-Pause (V3, Owner-GO 25.09.2026, Befund N4-77).
 *
 * Bis V3 wirkten die 418 Coaching-Karten NUR im Transkript-Weg (/api/analyze).
 * Rollenspiel-Debrief und Coach-Pause bekamen keine — obwohl die Coach-Pause
 * der Moment ist, in dem eine griffige Karte am meisten hilft (Gemini: „muss
 * die KI ihm sofort eine griffige Karte zuwerfen“).
 *
 * Dieses Modul kapselt Retrieval + Aufbereitung, FAIL-OPEN: schlägt Cosmos/
 * Embedding fehl, liefert es [] und der Flow läuft ohne Karten weiter (der
 * Übende zahlt nie mit einem Fehler für ein fehlendes Extra).
 */
import { searchCards } from '@/lib/cosmos-cards';
import { withTimeout } from '@/lib/with-timeout';

export interface CoachCardRef {
  id: string;
  groupId: string;
  title: string;
  /** Kurzzeile aus WHEN TO USE (für die UI-Kachel). */
  hint: string;
  cardType: string;
  /** Volltext (chunk_text) — nur für den Prompt, nicht für den Client. */
  chunkText: string;
}

export interface PublicCoachCard {
  id: string;
  title: string;
  hint: string;
}

const RETRIEVAL_TIMEOUT_MS = 8_000;

/** Gesprächssprache → Kartensprache (Karten gibt es nur de/en). */
export function cardLang(convoLocale: string | undefined, scenarioLocale: 'de' | 'en'): 'de' | 'en' {
  return convoLocale === 'de' || convoLocale === 'en' ? convoLocale : scenarioLocale;
}

/** Suchtext für das Rollenspiel: Szenario + Ziele + Rubrik + (Ende des) Verlaufs + Frage. */
export function buildCoachQuery(parts: {
  conversationType?: string;
  title?: string;
  goals?: string[];
  rubricLabels?: string[];
  transcript?: string;
  question?: string;
  maxChars?: number;
}): string {
  const out: string[] = [];
  // O3 (27.09.): Die Frage des Lernenden hat Vorrang vor dem Verlauf — sie steht
  // zuerst und doppelt, damit die Vektorsuche die Karte zur FRAGE holt.
  if (parts.question?.trim()) out.push(`Frage: ${parts.question.trim()}`, `Anliegen: ${parts.question.trim()}`);
  if (parts.conversationType) out.push(`conversationType: ${parts.conversationType}`);
  if (parts.title) out.push(`Szenario: ${parts.title}`);
  if (parts.goals?.length) out.push(`Ziele: ${parts.goals.join(' | ')}`);
  if (parts.rubricLabels?.length) out.push(`Kompetenzen: ${parts.rubricLabels.join(' | ')}`);
  const max = parts.maxChars ?? 3500;
  const head = out.join('\n');
  const t = String(parts.transcript ?? '').trim();
  if (!t) return head.slice(0, max);
  // Das ENDE des Verlaufs ist für den nächsten Schritt am aussagekräftigsten.
  const room = Math.max(400, max - head.length - 1);
  const tail = t.length > room ? t.slice(t.length - room) : t;
  return `${head}\n${tail}`;
}

/** Erste Zeile(n) des Abschnitts WHEN TO USE — als Kurzhinweis für die UI. */
export function cardWhenToUse(chunkText: string, maxChars = 160): string {
  const m = /WHEN TO USE:\s*\n([\s\S]*?)(?:\n\s*\n|\n[A-Z][A-Z /-]{3,}:|$)/.exec(String(chunkText ?? ''));
  const raw = (m?.[1] ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  return raw.length > maxChars ? raw.slice(0, maxChars - 1).trimEnd() + '…' : raw;
}

/** Titel aus TITLE: … (Fallback, falls metadata.title fehlt). */
function titleFromChunk(chunkText: string): string {
  const m = /^TITLE:\s*(.+)$/m.exec(String(chunkText ?? ''));
  return (m?.[1] ?? '').trim();
}

export function normalizeTitle(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[‐-―]/g, '-')
    .replace(/[^a-z0-9äöüß]+/gi, ' ')
    .trim();
}

/**
 * Titel, die das Modell gewählt hat, gegen die abgerufenen Karten auflösen.
 * Tolerant (normalisiert, Präfix/Teilstring), max. `max` Treffer, keine Dubletten.
 */
export function matchCardsByTitle(cards: CoachCardRef[], titles: string[], max = 2): CoachCardRef[] {
  const out: CoachCardRef[] = [];
  for (const t of titles ?? []) {
    const n = normalizeTitle(t);
    if (!n) continue;
    const hit = cards.find((c) => {
      const cn = normalizeTitle(c.title);
      return cn === n || cn.startsWith(n) || n.startsWith(cn) || (n.length >= 12 && cn.includes(n));
    });
    if (hit && !out.some((c) => c.id === hit.id)) out.push(hit);
    if (out.length >= max) break;
  }
  return out;
}

/** Prompt-Block: Titel + gekürzter Volltext je Karte. */
export function cardsToPromptBlock(cards: CoachCardRef[], maxCharsPerCard = 1200): string {
  return cards
    .map((c) => {
      const body = c.chunkText.length > maxCharsPerCard ? c.chunkText.slice(0, maxCharsPerCard) + '…' : c.chunkText;
      return `### ${c.title}\n${body}`;
    })
    .join('\n\n');
}

/** Client-Projektion (ohne Volltext). */
export function toPublicCard(c: CoachCardRef): PublicCoachCard {
  return { id: c.id, title: c.title, hint: c.hint };
}

/**
 * Retrieval, fail-open. Karten sind seit E-4 nur im Status `published`
 * auffindbar (Pflichtprädikat in cosmos-cards.ts).
 */
export async function retrieveCoachCards(args: {
  text: string;
  lang: 'de' | 'en';
  topK?: number;
  label?: string;
}): Promise<{ cards: CoachCardRef[]; error: string | null }> {
  const text = String(args.text ?? '').trim();
  if (!text) return { cards: [], error: 'empty query' };
  try {
    const res = await withTimeout(
      searchCards({ text, topK: args.topK ?? 5, lang: args.lang }),
      RETRIEVAL_TIMEOUT_MS,
      args.label ?? 'coach-cards'
    );
    const cards: CoachCardRef[] = [];
    for (const r of res.results ?? []) {
      const md = (r.metadata ?? {}) as Record<string, unknown>;
      const chunk = String(md.chunk_text ?? '');
      const title = String(md.title ?? '') || titleFromChunk(chunk);
      if (!title || !chunk) continue;
      cards.push({
        id: String(r.id ?? ''),
        groupId: String(md.card_group_id ?? ''),
        title,
        hint: cardWhenToUse(chunk),
        cardType: String(md.card_type ?? ''),
        chunkText: chunk,
      });
    }
    return { cards, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[coach-cards] Retrieval fehlgeschlagen (fail-open): ${msg}`);
    return { cards: [], error: msg };
  }
}
