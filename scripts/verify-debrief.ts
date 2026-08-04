/**
 * Debrief 2.0 — Verify: der deterministische Gesamtscore rechnet richtig.
 *   npm run verify:debrief
 *
 * Reine Struktur-/Rechen-Checks ohne Netzwerk/Credits. Haelt die Kern-Zusagen
 * des Blueprints fest: Code rechnet (nicht das LLM), »nicht beobachtbar«
 * ist keine 0-%-Strafe, unter 50 % Belegquote gibt es kein Urteil.
 */
import {
  computeDebrief,
  computeDelta,
  expectationForScore,
  scoreToPct,
} from "../src/lib/simulation/debrief";

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass++;
    console.log(`  PASS ${label}`);
  } else {
    fail++;
    console.error(`  FAIL ${label}${detail ? " — " + detail : ""}`);
  }
}

const R = (scores: Array<number | null>) =>
  scores.map((s, i) => ({ key: `S${i + 1}`, label: `Kompetenz ${i + 1}`, score: s }));
const C = (hits: boolean[]) => hits.map((h, i) => ({ id: `cp${i + 1}`, hit: h }));

console.log("── A: Skala und Labels ──");
{
  ok("A1: Score 1 → 0 %", scoreToPct(1) === 0);
  ok("A2: Score 4 → 100 %", scoreToPct(4) === 100);
  ok("A3: Score 3 → 67 %", scoreToPct(3) === 67);
  ok("A4: Label-Treppe",
    expectationForScore(null) === "not-observable" &&
    expectationForScore(1) === "below" &&
    expectationForScore(2) === "approaching" &&
    expectationForScore(3) === "meets" &&
    expectationForScore(4) === "exceeds");
}

console.log("── B: Gesamtscore (70 % Anker, 30 % Schluesselmomente) ──");
{
  // Alle 5 Anker Score 3 (=67 %), 2 von 4 Checkpoints (=50 %):
  // 0.7*67 + 0.3*50 = 61.9 → 62, Bestehensgrenze 60 → bestanden.
  const d = computeDebrief({ rubric: R([3, 3, 3, 3, 3]), checkpoints: C([true, true, false, false]) });
  ok("B1: Rechnung stimmt", d.overall === 62, `overall=${d.overall}`);
  ok("B2: bestanden bei 62 ≥ 60", d.verdict === "passed", d.verdict);
  ok("B3: Bestehensgrenze default 60", d.passMarkPct === 60);

  const strict = computeDebrief({
    rubric: R([3, 3, 3, 3, 3]),
    checkpoints: C([true, true, false, false]),
    passThreshold: 0.7,
  });
  ok("B4: strengere Szenario-Grenze wirkt", strict.verdict === "failed" && strict.passMarkPct === 70);
}

console.log("── C: Ehrlichkeit statt 0-%-Strafe ──");
{
  // 3 von 5 belegt (Schnitt der BELEGTEN, nicht durch 5 geteilt).
  const d = computeDebrief({ rubric: R([4, 4, 4, null, null]), checkpoints: C([true, true]) });
  ok("C1: nicht beobachtbar drueckt nicht auf 0",
    d.overall === 100, `overall=${d.overall} (0.7*100 + 0.3*100)`);
  ok("C2: Belegquote transparent", d.coverage === 0.6, `coverage=${d.coverage}`);

  // Nur 2 von 5 belegt → kein Urteil, egal wie gut die Zahlen sind.
  const thin = computeDebrief({ rubric: R([4, 4, null, null, null]), checkpoints: C([true, true]) });
  ok("C3: unter 50 % Belegquote → Nicht bewertbar", thin.verdict === "unrated", thin.verdict);

  // Gar nichts belegt → unrated, overall null.
  const empty = computeDebrief({ rubric: R([null, null, null, null, null]), checkpoints: C([false]) });
  ok("C4: ohne Belege kein Score", empty.verdict === "unrated" && empty.overall === null);
}

console.log("── D: Delta zum Vorversuch ──");
{
  const prev = computeDebrief({ rubric: R([2, 2, 2, 2, 2]), checkpoints: C([false, false]) });
  const curr = computeDebrief({ rubric: R([3, 3, 2, null, 4]), checkpoints: C([true, false]) });
  const delta = computeDelta({ current: curr, previous: prev, prevAttempt: 1 });
  ok("D1: Gesamt-Delta berechnet", typeof delta.overall === "number" && (delta.overall as number) > 0,
    `delta=${delta.overall}`);
  ok("D2: Anker-Delta je Kompetenz", delta.anchors.find((a) => a.key === "S1")?.delta === 34,
    `S1=${delta.anchors.find((a) => a.key === "S1")?.delta} (33→67)`);
  ok("D3: unvergleichbare Anker ehrlich null",
    delta.anchors.find((a) => a.key === "S4")?.delta === null);
  ok("D4: Vorversuchs-Kontext dabei", delta.prevAttempt === 1 && delta.prevOverall === prev.overall);
}

console.log(`\nDEBRIEF: ${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
