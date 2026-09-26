/**
 * Retrieval-Gate (Deploy-Gate, Gemini-Vorgabe zu V1, Owner-GO 25.09.2026).
 *
 *   npm run verify:retrieval
 *
 * Läuft im Deploy-Workflow VOR dem Deploy-Schritt gegen die echte Karten-DB
 * (coach-vec/cards) mit den ECHTEN Kunden-Payloads:
 *   1. Transkript-Weg de  — Client sendet fest conversationType 'feedback',
 *      conversationSubType 'mitarbeitendengespräch', jurisdiction 'de_eu'.
 *   2. Transkript-Weg en  — jurisdiction 'en_us'.
 *   3. Coach-Pause/Debrief (V3) — Rollenspiel-Suchtext, lang de.
 *   4. E-4: jede gelieferte Karte trägt status 'published'.
 *
 * Assertion je Fall: returned_cards.length > 0 — sonst Exit 1 und der Build
 * scheitert. Hintergrund: Der Filterfehler N4-76 (10/209 Karten, englisch 0)
 * blieb monatelang unbemerkt, weil nichts ihn maß.
 *
 * Env: COSMOS_ENDPOINT, COSMOS_KEY, GEMINI_API_KEY (CI: Secrets; lokal:
 * .env.local wird nachgeladen, vorhandene Env gewinnt).
 */
import { config } from "dotenv";
import { searchCards } from "../src/lib/cosmos-cards";
import { buildBaseFilter } from "../src/ai/flows/generate-dynamic-feedback";
import { buildCoachQuery, retrieveCoachCards } from "../src/lib/coach-cards";

config({ path: ".env.local" });

const MIN_EXPECTED_WARN = 5;

type Case = {
  name: string;
  run: () => Promise<{ count: number; statuses: string[]; sample: string[] }>;
};

const TRANSCRIPT_DE = `Führungskraft: Danke, dass du dir Zeit nimmst. Ich möchte über die letzten Wochen sprechen.
Mitarbeiter:in: Okay. Worum geht es genau?
Führungskraft: Mir ist aufgefallen, dass zwei Abgaben spät kamen. Wie siehst du das?
Mitarbeiter:in: Die anderen haben mir die Zahlen nicht rechtzeitig geliefert.
Führungskraft: Verstehe. Was brauchst du, damit es beim nächsten Mal klappt?`;

const TRANSCRIPT_EN = `Manager: Thanks for making time. I would like to talk about the last few weeks.
Employee: Sure. What is this about?
Manager: Two deliverables came in late. How do you see it?
Employee: The others did not send me the numbers on time.
Manager: I see. What do you need so it works next time?`;

function customerQuery(lang: "de" | "en"): string {
  const t = lang === "de" ? TRANSCRIPT_DE : TRANSCRIPT_EN;
  // Gleiche Bauweise wie buildRetrievalQuery (generate-dynamic-feedback.ts).
  return [
    "conversationType: feedback",
    "conversationSubType: mitarbeitendengespräch",
    "goal: Provide clear, constructive coaching feedback.",
    t,
  ].join("\n");
}

const cases: Case[] = [
  {
    name: "Kundenweg de (feedback / de_eu)",
    run: async () => {
      const filter = buildBaseFilter({ jurisdiction: "de_eu" });
      const r = await searchCards({ text: customerQuery("de"), topK: 8, lang: "de", filter });
      return {
        count: r.count,
        statuses: r.results.map((x) => String(x.metadata?.status ?? "")),
        sample: r.results.slice(0, 3).map((x) => String(x.metadata?.title ?? x.id)),
      };
    },
  },
  {
    name: "Kundenweg en (feedback / en_us)",
    run: async () => {
      const filter = buildBaseFilter({ jurisdiction: "en_us" });
      const r = await searchCards({ text: customerQuery("en"), topK: 8, lang: "en", filter });
      return {
        count: r.count,
        statuses: r.results.map((x) => String(x.metadata?.status ?? "")),
        sample: r.results.slice(0, 3).map((x) => String(x.metadata?.title ?? x.id)),
      };
    },
  },
  {
    name: "Coach-Pause/Debrief de (V3)",
    run: async () => {
      const text = buildCoachQuery({
        conversationType: "leadership_1on1",
        title: "Kritikgespräch nach verspäteter Abgabe",
        goals: ["Kritik klar ansprechen", "Vereinbarung treffen"],
        rubricLabels: ["Klarheit", "Zuhören", "Verbindlichkeit"],
        transcript: TRANSCRIPT_DE,
        question: "Wie spreche ich die Ausrede an, ohne hart zu werden?",
      });
      const r = await retrieveCoachCards({ text, lang: "de", topK: 5, label: "gate-coach-pause" });
      if (r.error) throw new Error(r.error);
      return { count: r.cards.length, statuses: [], sample: r.cards.slice(0, 3).map((c) => c.title) };
    },
  },
];

async function main() {
  let failed = 0;
  console.log("── Retrieval-Gate: Kundenweg muss Karten liefern ──");
  for (const c of cases) {
    try {
      const out = await c.run();
      const ok = out.count > 0;
      const notPublished = out.statuses.filter((s) => s !== "published");
      const e4ok = notPublished.length === 0;
      if (!ok) failed++;
      if (!e4ok) failed++;
      console.log(
        `  ${ok && e4ok ? "PASS" : "FAIL"} ${c.name}: ${out.count} Karte(n)` +
          (out.count > 0 && out.count < MIN_EXPECTED_WARN ? ` (WARN: unter ${MIN_EXPECTED_WARN})` : "") +
          (e4ok ? "" : ` — ${notPublished.length} nicht 'published' (E-4)`) +
          (out.sample.length ? `\n         z. B. ${out.sample.join(" · ")}` : "")
      );
    } catch (e) {
      failed++;
      console.log(`  FAIL ${c.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (failed > 0) {
    console.error(`✗ Retrieval-Gate: ${failed} Prüfung(en) fehlgeschlagen — Deploy gestoppt.`);
    process.exit(1);
  }
  console.log("✓ Retrieval-Gate bestanden.");
}

main().catch((e) => {
  console.error("Retrieval-Gate FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
