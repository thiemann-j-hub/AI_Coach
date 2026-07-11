/**
 * W5-Parität — Cosmos-Adapter (neu) vs. Live-Pinecone (alt) auf echten Coach-Queries.
 * Da wir das Embedding-Modell wechseln (e5-large-1024 → gemini-768), ist EXAKTER
 * Overlap NICHT das Ziel (anderer Vektorraum). Harte Kriterien:
 *  1. Cosmos liefert Treffer, wo Pinecone Treffer hat (kein Retrieval-Ausfall).
 *  2. Filter-Korrektheit: JEDER Cosmos-Treffer erfüllt conversation_type + lang.
 *  3. lang-Fallback funktioniert (lang-Query → Treffer in der Sprache).
 *  4. card_group_id-Overlap (topische Nähe) — informativ.
 * Env: PINECONE_*, COSMOS_*, GEMINI_API_KEY.
 */
import { pineconeSearchCards } from "../src/lib/pinecone";
import { searchCards } from "../src/lib/cosmos-cards";

type Q = { text: string; conversation_type: string; lang: string };
const QUERIES: Q[] = [
  { text: "Wie gebe ich konstruktives Feedback zu schlechter Leistung im Mitarbeitergespräch?", conversation_type: "feedback", lang: "de" },
  { text: "How do I handle a conflict between two team members who won't cooperate?", conversation_type: "conflict", lang: "en" },
  { text: "Vorbereitung auf ein 1:1 mit einem demotivierten Mitarbeiter", conversation_type: "leadership_1on1", lang: "de" },
  { text: "Structuring an annual performance review conversation fairly", conversation_type: "annual_review", lang: "en" },
  { text: "Schwierige Interviewfrage souverän beantworten ohne auszuweichen", conversation_type: "job_interview", lang: "de" },
  { text: "Active listening techniques when an employee is upset", conversation_type: "leadership_1on1", lang: "en" },
  { text: "Kritik annehmen und deeskalieren in einem Konfliktgespräch", conversation_type: "conflict", lang: "de" },
  { text: "Giving recognition that feels genuine, not generic", conversation_type: "feedback", lang: "en" },
];

const grp = (id: string) => id.replace(/-(de|en)$/i, "");
let pass = 0, fail = 0;
const assert = (c: boolean, l: string) => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ FAIL: ${l}`); } };

async function main() {
  let cosmosNonEmpty = 0, pineNonEmpty = 0, filterOk = 0, overlapSum = 0, langOk = 0;
  for (const q of QUERIES) {
    const filter = { conversation_type: q.conversation_type };
    const [pc, cx] = await Promise.all([
      pineconeSearchCards({ text: q.text, topK: 8, lang: q.lang, filter }),
      searchCards({ text: q.text, topK: 8, lang: q.lang, filter }),
    ]);
    if (pc.count > 0) pineNonEmpty++;
    if (cx.count > 0) cosmosNonEmpty++;
    // Filter-Korrektheit: jeder Cosmos-Treffer erfüllt conversation_type + lang
    const badFilter = cx.results.filter((r) => {
      const m = r.metadata;
      const ctOk = m.conversation_type === q.conversation_type || (Array.isArray(m.conversation_types) && m.conversation_types.includes(q.conversation_type));
      return !(ctOk && m.lang === q.lang);
    });
    if (badFilter.length === 0) filterOk++;
    if (cx.results.every((r) => r.metadata.lang === q.lang)) langOk++;
    // topischer Overlap (card_group_id)
    const pg = new Set(pc.results.map((r) => grp(r.id)));
    const inter = cx.results.filter((r) => pg.has(grp(r.id))).length;
    overlapSum += pc.count > 0 ? inter / Math.min(pc.count, cx.count || 1) : 0;
    console.log(`  · [${q.conversation_type}/${q.lang}] pine=${pc.count} cosmos=${cx.count} overlap=${inter} topTitle="${(cx.results[0]?.metadata.title || "").slice(0, 40)}"`);
  }
  console.log("");
  assert(cosmosNonEmpty >= pineNonEmpty, `Kein Retrieval-Ausfall: Cosmos-non-empty ${cosmosNonEmpty} ≥ Pinecone ${pineNonEmpty}`);
  assert(filterOk === QUERIES.length, `Filter-Korrektheit (conversation_type+lang): ${filterOk}/${QUERIES.length}`);
  assert(langOk === QUERIES.length, `lang-Bindung: ${langOk}/${QUERIES.length} (nur Treffer in Query-Sprache)`);
  console.log(`  · Topischer card_group_id-Overlap Ø ${(overlapSum / QUERIES.length).toFixed(2)} (informativ; Modellwechsel e5→gemini erwartet Abweichung)`);
  // lang-Fallback: seltener conversation_type ohne Treffer in einer Sprache soll ohne lang trotzdem liefern
  const fb = await searchCards({ text: "leading a difficult termination conversation with empathy", topK: 8, lang: "xx", filter: { conversation_type: "conflict" } });
  assert(fb.count > 0, `lang-Fallback: unbekannte Sprache 'xx' → Retry ohne lang liefert ${fb.count} Treffer`);
  console.log(`\n${fail === 0 ? "✓✓✓" : "✗✗✗"} parity-cosmos-vs-pinecone — ${pass} pass / ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}
main();
