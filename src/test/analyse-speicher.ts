/**
 * Go-Live-Prüfung 12.11.2026 (B1–B3, S1, S3): Speicher im Arbeitsspeicher für die Tests der Transkript-Analyse.
 * Er ersetzt `@/lib/cosmos` für die Container `sessions` (Partition = id) und `runs` (Partition = sessionId), damit
 * in den Tests der echte `runs-store` und der echte Buchungsvermerk laufen. Er versteht genau die Abfragen, die
 * der Code heute stellt; eine unbekannte Bedingung lässt den Test scheitern, statt still ignoriert zu werden.
 * Wie Cosmos vergibt er je Schreibung eine neue Version (`_etag`, nur beim Lesen sichtbar); ein Ersetzen mit
 * veralteter Version scheitert mit 412, das Ersetzen eines fehlenden Dokuments mit 404.
 *
 *   const db = await vi.hoisted(async () => (await import("@/test/analyse-speicher")).neuerAnalyseSpeicher());
 *   vi.mock("@/lib/cosmos", () => db.cosmos);
 */
type Doc = Record<string, unknown> & { id: string };
type Params = Record<string, unknown>;
type Vorgang = "read" | "upsert" | "delete" | "query";
type ContainerName = "runs" | "sessions";

const FILTER: Record<string, (d: Doc, p: Params) => boolean> = {
  "c.sessionId = @sid": (d, p) => d.sessionId === p["@sid"],
  "c.uid = @uid": (d, p) => d.uid === p["@uid"],
  "c.id != @excludeRunId": (d, p) => d.id !== p["@excludeRunId"],
  "c.createdAt < @cursor": (d, p) => typeof d.createdAt === "string" && d.createdAt < String(p["@cursor"]),
  "c.createdAt < @before": (d, p) => typeof d.createdAt === "string" && d.createdAt < String(p["@before"]),
  "(NOT IS_DEFINED(c.deleted) OR c.deleted = false)": (d) => d.deleted === undefined || d.deleted === false,
};

export function neuerAnalyseSpeicher() {
  const containers = new Map<ContainerName, Map<string, Doc>>();
  const of = (name: ContainerName) => {
    if (!containers.has(name)) containers.set(name, new Map());
    return containers.get(name)!;
  };
  const pkOf = (name: ContainerName, doc: Doc) => (name === "runs" ? String(doc.sessionId) : doc.id);
  const key = (pk: string, id: string) => `${pk}|${id}`;
  const etags = new Map<string, string>();
  let version = 0;
  /** Dokument ablegen (ohne `_etag`, das ist ein Systemfeld) und eine neue Version vergeben. */
  const lege = (name: ContainerName, doc: Doc) => {
    const { _etag: _alt, ...rest } = doc;
    const k = key(pkOf(name, doc), doc.id);
    of(name).set(k, structuredClone(rest) as Doc);
    etags.set(`${name}|${k}`, `v${++version}`);
  };
  const entferne = (name: ContainerName, pk: string, id: string) => {
    etags.delete(`${name}|${key(pk, id)}`);
    return of(name).delete(key(pk, id));
  };
  let stoerung: ((vorgang: Vorgang, container: ContainerName, doc: Partial<Doc>) => void) | null = null;
  const pruefe = (vorgang: Vorgang, container: ContainerName, doc: Partial<Doc>) => stoerung?.(vorgang, container, doc);

  const container = (name: ContainerName) => ({
    name,
    /** Roher Zugriff wie im SDK: Löschen eines fehlenden Dokuments wirft 404. */
    item: (id: string, pk: string) => ({
      delete: async () => {
        pruefe("delete", name, { id, sessionId: pk });
        if (!entferne(name, pk, id)) throw Object.assign(new Error("Entity with the specified id does not exist"), { code: 404 });
        return {};
      },
    }),
  });
  const runs = container("runs");
  const sessions = container("sessions");

  const speicher = {
    /** Dokument ablegen, wie es in der Datenbank stünde. */
    put(name: ContainerName, doc: Doc): Doc {
      lege(name, doc);
      return doc;
    },
    /** Dokument entfernen, als hätte es ein anderer Aufruf gelöscht. */
    remove: (name: ContainerName, pk: string, id: string) => void entferne(name, pk, id),
    /** Sitzungsdokument einer Person. */
    sitzung(id: string, uid: string): void {
      speicher.put("sessions", { id, uid, updatedAt: "2026-11-01T08:00:00.000Z" });
    },
    get<T = Doc>(name: ContainerName, pk: string, id: string): T | null {
      const hit = of(name).get(key(pk, id));
      return hit ? (structuredClone(hit) as T) : null;
    },
    has: (name: ContainerName, pk: string, id: string) => of(name).has(key(pk, id)),
    all: (name: ContainerName) => [...of(name).values()].map((d) => structuredClone(d)),
    /** Stehende Buchungsvermerke (alle Personen). */
    vermerke: () => speicher.all("runs").filter((d) => d.docType === "buchungsvermerk"),
    /** Störung einbauen: `fn` darf werfen (z. B. beim Schreiben eines bestimmten Dokuments). null = keine. */
    stoere(fn: typeof stoerung): void {
      stoerung = fn;
    },
    reset(): void {
      containers.clear();
      etags.clear();
      stoerung = null;
    },
    /** Ersatz für `@/lib/cosmos`. */
    cosmos: {
      runsContainer: () => runs,
      sessionsContainer: () => sessions,
      readItem: async (c: { name: ContainerName }, id: string, pk: string) => {
        pruefe("read", c.name, { id, sessionId: pk });
        const hit = of(c.name).get(key(pk, id));
        return hit ? { ...structuredClone(hit), _etag: etags.get(`${c.name}|${key(pk, id)}`) } : null;
      },
      upsertItem: async (c: { name: ContainerName }, item: Doc) => {
        pruefe("upsert", c.name, item);
        lege(c.name, item);
        return item;
      },
      replaceItemIfMatch: async (c: { name: ContainerName }, item: Doc, pk: string, etag: string) => {
        pruefe("upsert", c.name, item);
        const k = `${c.name}|${key(pk, item.id)}`;
        if (!etags.has(k)) throw Object.assign(new Error("Entity with the specified id does not exist"), { code: 404 });
        if (etags.get(k) !== etag) throw Object.assign(new Error("precondition failed"), { code: 412 });
        lege(c.name, item);
        return item;
      },
      deleteItem: async (c: { name: ContainerName }, id: string, pk: string) => {
        pruefe("delete", c.name, { id, sessionId: pk });
        entferne(c.name, pk, id);
      },
      queryItems: async (c: { name: ContainerName }, query: string, params: Array<{ name: string; value: unknown }> = []) => {
        pruefe("query", c.name, {});
        const p: Params = Object.fromEntries(params.map((x) => [x.name, x.value]));
        const flat = query.replace(/\s+/g, " ").trim();
        const where = /WHERE (.+?)(?: ORDER BY .*)?$/.exec(flat)?.[1] ?? "";
        let rows = [...of(c.name).values()];
        for (const cond of where.split(" AND ").map((x) => x.trim()).filter(Boolean)) {
          const f = FILTER[cond];
          if (!f) throw new Error(`Attrappe kennt die Bedingung nicht: ${cond}`);
          rows = rows.filter((d) => f(d, p));
        }
        if (/ORDER BY c\.createdAt DESC$/.test(flat)) {
          rows.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
        }
        const top = /^SELECT TOP (\d+) /.exec(flat);
        return structuredClone(top ? rows.slice(0, Number(top[1])) : rows);
      },
    },
  };
  return speicher;
}
