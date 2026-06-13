# Qualitäts-Feedback-Loop (Q2)

Misst den **echten** Analyse-Generator reproduzierbar gegen ein Golden-Set —
abgeguckt vom Quality-Loop der AI-E-Learning-Schwester-App, adaptiert auf den
Gesprächs-Coach.

## Was es prüft

Der Harness (`scripts/quality/run-regression.ts`) ruft den App-eigenen Flow
`scoreCompetencies` (gleicher Prompt wie Produktion) gegen jedes Szenario in
`scripts/quality/golden-set.json` und prüft mit den **App-eigenen** Core-Checks
(`src/lib/quality-core.ts`):

- **Faithfulness/Grounding (hart):** jedes Evidenz-Zitat muss wörtlich im Transkript stehen.
- **Negativ-Test (hart):** als „nicht beobachtbar" markierte Kompetenzen MÜSSEN `score=null` haben.
- **Halluzination (hart):** verbotene Begriffe (nicht im Transkript) dürfen nicht in `why`/`evidence` auftauchen.
- **Observable (weich):** beobachtbare Kompetenzen sollten einen Score haben.
- **Locale (weich):** Begründungen der gescorten Kompetenzen in der Zielsprache.
- **Stabilität (weich, `--n>1`):** Score-Spannweite je Kompetenz über mehrere Läufe.

Quellen werden direkt injiziert (kein RAG/keine Persistenz) → saubere Isolation:
ein schlechter Score liegt am Generator, nicht an einem Retrieval-Treffer.

## Ausführen

```bash
npm run quality:regression                  # alle Szenarien, deterministisch (Gemini-Calls)
npm run quality:regression -- --only=03-...  # ein Szenario
npm run quality:regression -- --n=3          # Score-Stabilität über 3 Läufe (Mehrheit)
npm run quality:regression -- --judge        # zusätzlich neutraler LLM-Judge (ANTHROPIC_API_KEY nötig)
```

Exit-Code 0 = alle PASS, 1 = mind. ein hartes FAIL (CI-tauglich).

> Hinweis: Der `--conditions=react-server`-Flag (im npm-Script enthalten) mappt das
> `server-only`-Paket auf seine No-op-Variante, damit der Flow außerhalb von Next läuft.

## LLM-as-Judge (optional, `--judge`)

`scripts/quality/judge.ts` bewertet jede Analyse mit einem **neutralen Fremd-Judge**
(Claude, NICHT „Gemini bewertet Gemini") über 6 Dimensionen (faithfulness, coverage,
actionability, competency_consistency, tone, locale), n≥3-Mehrheit. Gegated auf
`ANTHROPIC_API_KEY` — ohne Key laufen nur die kostenlosen deterministischen Checks.

> **SLOT:** Sobald das erprobte Judge-Prompt + die 6-Dimensionen-Rubrik aus der
> E-Learning-Schwester-App vorliegen, in `judge.ts` (`DIMENSIONS`/Rubrik) ersetzen.

## Owner-Regel

Jeder neue Check braucht einen **Negativ-Test** im Golden-Set — einen Input, der ihn
nachweislich auslöst. Bewährter Zyklus: **measure → find → fix → re-measure**. Beispiel
aus dem Bau dieses Loops: der Harness fand sofort (1) deutsche Begründungen bei EN-Input
und (2) Über-Scoring bei trivialen Terminabsprachen — beide am Generator gefixt und grün
re-gemessen (5/5 bei n=3).
