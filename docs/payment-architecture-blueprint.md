# Payment & Billing Architecture — Blueprint

> Übertragbare Architektur eines flag-gated Credit-/Bezahlsystems mit GoBD-konformer
> §14-Rechnung. Gebaut auf **Next.js 15 (App Router, Node-Runtime)** + **Azure Cosmos DB**
> + **Azure Blob Storage** + **Stripe (Checkout + Tax + Webhooks)** + **@react-pdf/renderer**.
> Auth via Session-Cookie (NextAuth). Alle Beträge in Cents (Integer).

---

## 0. Leitprinzipien (die das ganze Design tragen)

1. **Flag-Gating (`PAYMENTS_ENABLED`, Default `off`)**: Der gesamte Bezahlpfad ist hinter
   einem ENV-Flag. Bei `off` wird kein Hold gezogen, keine Steuer berechnet, keine
   Save-Prüfung aktiv → die App läuft im „Gratis-Modus" völlig unverändert. So kann der
   Code **live (inert) deployt** werden, lange bevor Stripe/Steuer scharf geschaltet sind.
2. **Stripe ist Single Source of Truth für Steuer.** Kein paralleler VIES-/Steuer-Check im
   Backend (keine „Dual-Truth"). Das Rechnungs-`taxTreatment` wird **ausschließlich aus
   Stripes Aufschlüsselung** (`amount_subtotal` / `amount_tax`) abgeleitet.
3. **Idempotenz über deterministische IDs.** Jede kritische Mutation hat eine ableitbare
   Doc-ID (`hold:{runId}`, `refund:{runId}`, `purchase:{eventId}`, `inv:{paymentIntentId}`,
   `stripeEvent` = `event.id`). Ein `Create` mit existierender ID → `409` → no-op/Rollback.
4. **ACID via Cosmos TransactionalBatch innerhalb EINER Partition.** Mehr-Doc-Mutationen
   (Saldo + Batch + Ledger) laufen atomar; OCC über ETag/`If-Match`, `412` → Read-Compute-Retry.
5. **Invariante: „Credit verbraucht ⇒ Run existiert".** Wird über Schatten-Dokumente +
   ein Save-Gate hart durchgesetzt (siehe §6).
6. **0 Hintergrund-Infrastruktur.** Kein Cron/Worker: Aufräumarbeit passiert lazy beim
   nächsten Zugriff (Lazy Reconciliation). PDF-Rendering via `after()` im Request-Lifecycle.

---

## 1. Datenmodell (Cosmos DB, Single-Container-pro-Concern)

| Container | Partition Key | Inhalt |
|---|---|---|
| `workspaces` | `/workspaceId` | **Alles eines Workspaces in EINER Partition**: das `workspace`-Doc (Saldo, Members), `creditBatch`-Docs, `ledger`-Docs, `stripeEvent`-Docs. Ermöglicht TransactionalBatch über Saldo+Batch+Ledger. |
| `domains` | `/domain` | Free-Run-Claims (1 Gratis-Analyse pro verifizierter B2B-Domain; Freemail → pro uid). Claim via `create()` = 409-idempotent. |
| `invoices` | `/year` | Pro Jahr: ein `counter`-Doc (`lastSeq`) + die `invoice`-Docs. Lückenlose Nummer atomar in der Jahres-Partition. |
| `users`/`sessions`/`runs` | je eigener PK | Fachdaten der App (unverändert vom Payment-Layer; `runs` trägt nur zusätzlich `workspaceId`, `deleted`, `refundPending`). |

**Doc-Typen im `workspaces`-Container:**
- `workspace`: `{ workspaceId, ownerUid, members[], balance, ... }` — `balance` ist ein
  Schnell-Saldo (Cache); **autoritativer Saldo = Summe der gültigen Batch-Restmengen**.
- `creditBatch`: `{ id, amount, originalAmount, source('free'|'purchase'), expiresAt(+12M), ... }` — FIFO.
- `ledger`: `{ id, delta, reason, status('pending'|'settled'|'refunded'), runId?, batchId?, holdExpiresAt? }`.

> **Solo-Default:** jeder User IST sein eigener Workspace (`workspaceId === uid`). Teams sind
> nur ein `members[]`-Array (max N) — `users`/`sessions`/`runs` bleiben unverändert.

---

## 2. Credit- & Hold-Ledger (der Kern)

Verbrauch ist ein **zweiphasiger Hold** (reserve → settle/refund), damit ein teurer Vorgang
(z. B. LLM-Call) nie einen Credit verbrennt, der dann verloren ginge.

```
reserveCredit(workspaceId, runId)         // VOR dem teuren Call
  → TransactionalBatch in /workspaceId:
      1) Patch creditBatch[fifo].amount -1   (If-Match ETag → kein Doppel-Draw)
      2) Create ledger "hold:{runId}" {delta:-1, reason:'consume', status:'pending',
                                        batchId, holdExpiresAt: now+15min}
      3) Patch workspace.balance -1
  → leere/zu wenige Batches → { ok:false, reason:'insufficient_credits' }  // 402 Paywall
  → 412/409 → Read-Compute-Retry (max 3); existierender Hold → idempotent ok

settleHold(workspaceId, runId)            // bei Erfolg
  → Patch hold:{runId}.status pending→settled   (condition status='pending';
                                                  412/404 = schon settled/refunded = idempotent ok)

refundCredit(workspaceId, runId, reason)  // EINE Primitive, 3 Trigger (siehe §6)
  → wenn kein Hold ODER bereits 'refunded' → no-op
  → TransactionalBatch:
      1) Patch creditBatch.amount +1   (zurück in den Ursprungs-Batch)
      2) Create ledger "refund:{runId}" {delta:+1, status:'refunded'}  // 409 = schon erstattet → ganzer Batch rollt zurück
      3) Patch hold:{runId}.status → 'refunded'
      4) Patch workspace.balance +1
```

**Warum kein Saldo-Double-Spend:** Der deterministische `Create refund:{runId}` ist im selben
Batch wie der Saldo-`+1`. Zwei zeitgleiche Refunds → der zweite Batch wirft beim Create `409`
→ **gesamter zweiter Batch wird verworfen** (inkl. Saldo-Patch). Keine Inflation, obwohl der
Lese-Schritt außerhalb des Batches liegt.

**grantCredits (Kauf/Free-Grant):** legt `creditBatch` + `ledger` + Saldo-`+amount` an; bei Kauf
zusätzlich ein `stripeEvent`-Doc (`id = event.id`) **im selben Batch** als Idempotenz-Anker
(409 = Event schon verarbeitet → kompletter Rollback).

---

## 3. Stripe Checkout & Tax

**Checkout-Session** (`mode: 'payment'`):
- **Netto-Preise** (`tax_behavior: 'exclusive'`), pro Paket eigene Price-ID; Credits-Menge in
  der **Price-Metadata** (`credits_awarded`) — der Webhook liest sie blind (kein Summenrechnen).
- `automatic_tax: { enabled: true }` → Stripe Tax rechnet USt am Point-of-Sale (Location-
  Triangulierung + VIES inkl. Reverse-Charge).
- `tax_id_collection: { enabled: true }` + `billing_address_collection: 'required'`.
- Sicherheits-Anker NUR serverseitig in die Session-Metadata: `{ workspaceId, purchasedByUid,
  packageId }` (dem Client nie vertrauen; Price-ID nie aus dem Client lesen).

**Zero-Tax-Guard** (kritisch): **vor** dem Anlegen der Session prüfen, dass die eigene
Steuerregistrierung aktiv ist:
```ts
const tax = await stripe.tax.settings.retrieve();
if (tax.status !== 'active') return 503 TAX_NOT_ACTIVE;
```
> Verhindert die **„Zero-Tax-Falle"**: würde `PAYMENTS_ENABLED` live geflippt, bevor die
> Steuerregistrierung aktiv ist, berechnete `automatic_tax` **0 %** und das System erzeugte
> 0-%-Rechnungen an Inlandskunden (Compliance-Verstoß + rückwirkende Haftung). Lieber 503.

**Reverse-Charge-Ableitung (`deriveTreatmentFromStripe`)** — einzig aus Stripes Breakdown:
```
amount_tax > 0  & Land == Inland  → domestic_19 (mit VAT-ID) / domestic_b2c
amount_tax > 0  & EU-Ausland      → eu_oss (Kundenland-Satz)
amount_tax == 0 & EU-Ausland & hat VAT-ID → reverse_charge (+ Pflichthinweis Art. 196 MwStSystRL)
sonst (Non-EU)                    → exempt (nicht im Inland steuerbar)
```

---

## 4. Webhook-Flow (`POST /api/webhooks/stripe`)

1. **Signatur über den ROHEN Body** verifizieren (`stripe.webhooks.constructEvent(rawBody, sig,
   secret)`). Kein Secret → `503` (inerter Zustand). Ungültig → `400`.
2. Bei `checkout.session.completed` + `payment_status === 'paid'`:
   - `grantCredits(...)` (idempotent via `stripeEvent`-Doc). **DB-Fehler → 500 → Stripe-Retry.**
   - `createInvoice(...)` (§5) — die Rechnungs-DATEN (Nummer, `issuedAt`) werden hier eingefroren.
   - **`after(async () => ensureInvoicePdf(invoice))`** — PDF-Render + Blob-Upload laufen NACH
     dem Flush der `200`-Antwort (→ kein Stripe-Timeout durch synchrones Rendern).
3. **Schnelle `200`-Antwort.** Idempotenz macht Retries unkritisch.

> **Warum `after()` zuverlässig ist:** Der App Service läuft als fortlaufender Node-Prozess
> (`node server.js`) — anders als bei serverless wird die Ausführung nach dem `200` nicht
> abgebrochen. Schlägt `after()` doch fehl, greift der **Lazy-Fallback** in
> `GET /api/invoices/[id]` (rendert on-demand aus dem eingefrorenen Doc).

---

## 5. GoBD-konformes Invoicing (§14 UStG)

**Lückenlose Nummer `RE-YYYY-NNNNNN`** (Lead-Lösung statt „Lücke akzeptieren"):
- `counter`-Doc und `invoice`-Doc liegen in **derselben Jahres-Partition** des `invoices`-
  Containers. Nummern-Inkrement (`Patch counter.lastSeq`, `If-Match`) **und** `Create invoice`
  laufen in **EINEM TransactionalBatch** → atomar. Schlägt der Write fehl, wird der Counter
  NICHT erhöht ⇒ **keine verlorene Nummer**.
- Idempotenz: deterministische `id = inv:{paymentIntentId}` (Stripe-Retry = 409 = unverändert
  zurückgeben).

**Einfrieren zum Ausstellungszeitpunkt (Unveränderbarkeit):** Auf das `invoice`-Doc werden
ALLE rechtlich relevanten Felder **kopiert/eingefroren**: Aussteller-Profil (aus ENV),
Empfänger-Billing inkl. **USt-IdNr**, Netto/USt/Brutto, `taxRate`, `taxTreatment`, `taxNote`
(Reverse-Charge-Pflichthinweis), `currency`, `lineItemDescription` — **und `templateVersion`**.

**Visuelles Einfrieren via `templateVersion`:** Das PDF-Template trägt eine Version (`'v1'`),
die am Doc eingefroren wird. Ändert sich später das Layout (Logo, Fußzeile, Geschäftsführung),
kommt `'v2'` hinzu; Altrechnungen rendern beim (seltenen) Lazy-Fallback weiter ihre eingefrorene
Version → kein visueller GoBD-Drift Monate später.

**PDF:** `@react-pdf/renderer` (deklaratives Flexbox-Template, pure Node, **kein Chromium**).
Reverse-Charge-Rechnung weist 0 % USt + den Pflichthinweis prominent aus; Empfänger-USt-IdNr
sichtbar.

**Blob-Storage + Download (kein Account-Key):**
- Auth durchgängig über **Managed Identity** (`DefaultAzureCredential`). Upload via
  `BlockBlobClient`. Deterministischer Pfad `{year}/{invoiceNumber}.pdf`.
- **Binärdaten NIE base64 ins Cosmos-Doc** (2-MB-Limit) — nur der Blob-Pfad wird persistiert.
- Download via kurzlebiger **User-Delegation-SAS** (`getUserDelegationKey` über MI, kein
  Account-Key), TTL ~2 Min. `GET /api/invoices/[id]` = `requireAuth` + Workspace-Membership
  → **302-Redirect** auf die SAS-URL (kein Stream-Proxy → kein Thread-/Bandbreiten-Bind).

---

## 6. Refund-Mechanismus & Security

**EINE idempotente Refund-Primitive, drei Trigger:**
| Trigger | reason | Auslöser |
|---|---|---|
| User-Delete im Kulanzfenster | `refund_user_delete` | `POST /api/runs/delete` < 10 Min |
| Technischer Abbruch | `refund_technical_failure` | `catch` in `/api/analyze` (Schnellpfad) |
| Hold-Verfall | `refund_hold_expired` | **Lazy Reconciliation** |

**10-Minuten-Regel:** Der Client zeigt die Refund-Affordanz nur als UI-Zustand aus `createdAt`
(`refundable = paymentsEnabled && age < 10min`) — die **Server-Wahrheit** (`REFUND_WINDOW_MS`-
Check in `/api/runs/delete`) ist die Autorität. Delete = **Soft-Delete ZUERST** (`deleted=true`),
DANN Refund → der Run-Record bleibt für den Backstop erhalten; `listRuns` filtert `deleted`,
Detail-Route gibt `404`.

**Lazy Reconciliation (statt Cron):** Beim Workspace-Load werden offene, abgelaufene Holds
(`status='pending'` & `holdExpiresAt < now`) **dieser Partition** zurückgebucht. 0 Hintergrund-
Infra, keine Cross-Partition-Query.

**State-Recovery via Schatten-Dokument:** `/api/analyze` schreibt den Run **serverseitig** als
Schatten-Record (ohne Transkript = Datenminimierung) via `persistShadowRun` **VOR** dem Settle.
Stirbt der Browser-Tab mitten im Request, läuft der Node-Handler trotzdem durch → Credit
verbraucht **und** Run existiert (taucht in der History auf, ist löschbar). **Der Hold wird NUR
gesettlet, wenn der Schatten-Run wirklich persistiert wurde** (`shadowPersisted`), sonst
`compensate` (Refund) → Invariante hält auch bei Persist-Fehler.

**Save-Gate (verhindert Gratis-Run-Leak):** Adversarial gefundener Defekt — bei Persist-Fehler
wurde refunded, der Client legte aber via `save` trotzdem einen abrechenbaren Run an (= Gratis-
Analyse, per Payload-Bloat sogar provozierbar). Fix an der **Save-Grenze** (einziger Ort, an dem
ein abrechenbarer Run entsteht), nur bei `paymentsEnabled`:
```
POST /api/runs/save:
  ohne runId                           → 409 MISSING_PAID_RUN   // kein abrechenbarer Run ohne Hold
  runId vorhanden & hold.status=='refunded' → 409 RUN_REFUNDED  // Credit war erstattet
  (settled / pending erlaubt)
```
Defense-in-Depth: `/api/analyze` liefert die `runId` nur aus, wenn `shadowPersisted || !grant`.
**Der Hold ist die Server-Wahrheit — ein gefälschter Client kann ihn nicht setzen.**

---

## 7. Cosmos-Limits — wie sie umschifft werden

- **2 MB/Doc** → PDFs in Blob, nicht ins Doc; Schatten-Runs ohne Transkript.
- **20 GB/logische Partition** → `invoices` nach `/year` partitioniert; Workspace-Daten je
  Workspace-Partition; B2B-Volumen unkritisch.

---

## 8. Übernahme-Checkliste für ein neues Projekt

1. ENV-Flag (`PAYMENTS_ENABLED`) zuerst — alles dahinter, von Tag 1 deploybar (inert).
2. `workspaces`-Single-Container (alles in einer Partition) ist die Voraussetzung für die
   TransactionalBatch-ACID-Garantien. Nicht auf mehrere Container verteilen.
3. Deterministische IDs für JEDE Geld-Mutation (Idempotenz vor Retries/Races).
4. Stripe Tax als Steuer-Source-of-Truth; eigener Code macht nur das **rechtliche Dokument**.
5. **Zero-Tax-Guard + strikte Go-Live-Reihenfolge** (Steuerregistrierung aktiv VOR Flag-Flip).
6. Schatten-Doc + Save-Gate gemeinsam → harte „verbraucht ⇒ Run existiert"-Invariante.
7. `after()` für teure Post-Response-Arbeit; Lazy-Fallback als Netz; keine Worker nötig.
8. Test-Strategie: Hold/Settle/Refund-Zyklus, Free-Run→402-Paywall, State-Recovery (Tab-Crash),
   beide Steuerpfade (Inland 19 % + Reverse-Charge 0 %) als echte PDFs aus dem Blob.
