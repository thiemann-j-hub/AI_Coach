/**
 * Paket 2, C3 (12.11.2026): Speicher im Arbeitsspeicher für Routen-Tests. Er verhält sich wie Cosmos: jede
 * Schreibung vergibt eine neue Version, ein Ersetzen mit veralteter Version scheitert mit 412. So läuft in den
 * Tests der echte `simulation-store` (lesen, `updateSimulation`, Wiederholen bei Konflikt), nur ohne Datenbank.
 *
 *   const db = await vi.hoisted(async () => (await import("@/test/sim-speicher")).neuerSimSpeicher());
 *   vi.mock("@/lib/cosmos", () => db.cosmos);
 */
type Item = Record<string, unknown> & { id: string };

export function neuerSimSpeicher() {
  const items = new Map<string, Item>();
  let version = 0;
  const next = () => `v${++version}`;
  let vorDemErsetzen: (() => void) | null = null;

  const speicher = {
    /** Legt einen Lauf an (aktiv, Person u1), mit den übergebenen Abweichungen. */
    seed(extra: Record<string, unknown> = {}): Item {
      const doc: Item = {
        id: "sim-12345678",
        sessionId: "sim:u1",
        docType: "simulation",
        uid: "u1",
        scenarioId: "sim-coaching-morgan",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "active",
        turns: [{ role: "persona", text: "Hallo, Du wolltest mich sprechen?", ts: "t0" }],
        ...extra,
        _etag: next(),
      };
      items.set(doc.id, doc);
      return doc;
    },
    /** Der gespeicherte Lauf, wie er jetzt in der Datenbank stünde. */
    lauf<T = Item>(id = "sim-12345678"): T {
      return structuredClone(items.get(id)) as T;
    },
    /** Ein anderer Schreiber (Coach-Pause, Live-Gespräch, Auswertung) ändert den Lauf: neue Version. */
    fremderSchreiber(change: (doc: Item) => void, id = "sim-12345678"): void {
      const doc = structuredClone(items.get(id)) as Item;
      change(doc);
      doc._etag = next();
      items.set(id, doc);
    },
    /** Derselbe fremde Schreiber, aber genau zwischen Lesen und Schreiben des nächsten Speicherns (einmalig). */
    fremderSchreiberVorDemSpeichern(change: (doc: Item) => void, id = "sim-12345678"): void {
      vorDemErsetzen = () => speicher.fremderSchreiber(change, id);
    },
    reset(): void {
      items.clear();
      version = 0;
      vorDemErsetzen = null;
    },
    /** Ersatz für `@/lib/cosmos`. */
    cosmos: {
      runsContainer: () => ({}),
      readItem: async (_c: unknown, id: string) => {
        const hit = items.get(id);
        return hit ? structuredClone(hit) : null;
      },
      upsertItem: async (_c: unknown, item: Item) => {
        const saved = { ...item, _etag: next() };
        items.set(item.id, structuredClone(saved));
        return saved;
      },
      replaceItemIfMatch: async (_c: unknown, item: Item, _pk: string, etag: string) => {
        const dazwischen = vorDemErsetzen;
        vorDemErsetzen = null;
        dazwischen?.();
        const current = items.get(item.id);
        if (!current || current._etag !== etag) throw Object.assign(new Error("precondition failed"), { code: 412 });
        const saved = { ...item, _etag: next() };
        items.set(item.id, structuredClone(saved));
        return saved;
      },
      queryItems: async () => [],
      deleteItem: async () => undefined,
    },
  };
  return speicher;
}
