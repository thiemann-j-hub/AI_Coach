import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Geldbewegende Regressionstests fuer den Credit-Ledger.
 *
 * Cosmos wird durch einen In-Memory-Fake ersetzt, der die fuer den Ledger
 * RELEVANTE Semantik ECHT durchspielt (kein SQL-Parser, aber: atomarer Batch,
 * Create-409 bei existierender id, Patch-412 bei stale ifMatch, Patch-condition
 * fuer settle). Millisekunden, keine echte DB -> CI-tauglich.
 *
 * Der Store + die Fakes liegen in vi.hoisted(), damit der vi.mock-Factory sie
 * referenzieren kann (vi.mock wird an den Modulkopf gehoistet).
 */
const h = vi.hoisted(() => {
  const store = new Map<string, any>();
  let etagSeq = 1;
  const k = (pk: string, id: string) => `${pk}::${id}`;
  const clone = (o: any) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const newEtag = () => `etag-${etagSeq++}`;

  function applyPatchOps(doc: any, operations: any[]) {
    for (const op of operations) {
      const path = String(op.path || "").replace(/^\//, "");
      if (op.op === "incr") doc[path] = (doc[path] ?? 0) + op.value;
      else if (op.op === "set") doc[path] = op.value;
    }
  }

  // Nur die von settleHold genutzte Form "c.status = 'pending'".
  function conditionHolds(doc: any, condition?: string): boolean {
    if (!condition) return true;
    const m = condition.match(/c\.(\w+)\s*=\s*'([^']*)'/);
    if (!m) return true;
    return String(doc[m[1]]) === m[2];
  }

  const container = {
    items: {
      async batch(ops: any[], pk: string) {
        const results: any[] = [];
        let failedIdx = -1;
        // 1) Alle Ops gegen den AKTUELLEN Zustand validieren (vor jeglichem Commit).
        for (let i = 0; i < ops.length; i++) {
          const op = ops[i];
          if (op.operationType === "Create") {
            const id = op.resourceBody.id;
            if (store.has(k(pk, id))) {
              results.push({ statusCode: 409 });
              if (failedIdx < 0) failedIdx = i;
            } else {
              results.push({ statusCode: 201 });
            }
          } else if (op.operationType === "Patch") {
            const existing = store.get(k(pk, op.id));
            if (!existing) {
              results.push({ statusCode: 404 });
              if (failedIdx < 0) failedIdx = i;
            } else if (op.ifMatch && existing._etag !== op.ifMatch) {
              results.push({ statusCode: 412 });
              if (failedIdx < 0) failedIdx = i;
            } else {
              results.push({ statusCode: 200 });
            }
          } else {
            results.push({ statusCode: 400 });
            if (failedIdx < 0) failedIdx = i;
          }
        }
        // 2) Atomar: bei irgendeinem Fehler NICHTS schreiben (Rollback).
        if (failedIdx >= 0) {
          for (let i = 0; i < results.length; i++) {
            if (i !== failedIdx && results[i].statusCode < 400) results[i] = { statusCode: 424 };
          }
          return { result: results, code: results[failedIdx].statusCode };
        }
        // 3) Commit.
        for (const op of ops) {
          if (op.operationType === "Create") {
            const doc = clone(op.resourceBody);
            doc._etag = newEtag();
            store.set(k(pk, doc.id), doc);
          } else if (op.operationType === "Patch") {
            const doc = store.get(k(pk, op.id));
            applyPatchOps(doc, op.resourceBody.operations);
            doc._etag = newEtag();
          }
        }
        return { result: results, code: 200 };
      },
    },
    item(id: string, pk: string) {
      return {
        async read() {
          const d = store.get(k(pk, id));
          if (!d) {
            const e: any = new Error("not found");
            e.code = 404;
            throw e;
          }
          return { resource: clone(d) };
        },
        async patch(body: any) {
          const d = store.get(k(pk, id));
          if (!d) {
            const e: any = new Error("not found");
            e.code = 404;
            throw e;
          }
          if (!conditionHolds(d, body.condition)) {
            const e: any = new Error("precondition failed");
            e.code = 412;
            throw e;
          }
          applyPatchOps(d, body.operations);
          d._etag = newEtag();
          return { resource: clone(d) };
        },
        async replace(newBody: any, opts: any) {
          const d = store.get(k(pk, id));
          const cond = opts?.accessCondition;
          if (cond?.type === "IfMatch" && d && d._etag !== cond.condition) {
            const e: any = new Error("precondition failed");
            e.code = 412;
            throw e;
          }
          const doc = clone(newBody);
          doc._etag = newEtag();
          store.set(k(pk, id), doc);
          return { resource: clone(doc) };
        },
      };
    },
  };

  async function readItem(_c: any, id: string, pk: string) {
    return clone(store.get(k(pk, id))) ?? null;
  }
  async function queryItems(_c: any, query: string, params: any[] = []) {
    const ws = params.find((p) => p.name === "@ws")?.value;
    const now = params.find((p) => p.name === "@now")?.value;
    const all = [...store.values()].filter((d) => !ws || d.workspaceId === ws);
    if (query.includes("'creditBatch'")) {
      return all
        .filter((d) => d.type === "creditBatch" && d.amount > 0 && (!now || d.expiresAt > now))
        .sort((a, b) => (a.expiresAt < b.expiresAt ? -1 : a.expiresAt > b.expiresAt ? 1 : 0))
        .map(clone);
    }
    if (query.includes("'pending'")) {
      return all
        .filter(
          (d) => d.type === "ledger" && d.status === "pending" && d.holdExpiresAt && (!now || d.holdExpiresAt < now)
        )
        .map(clone);
    }
    return all.map(clone);
  }
  async function upsertItem(_c: any, item: any) {
    const doc = clone(item);
    doc._etag = newEtag();
    store.set(k(item.workspaceId ?? item.id, item.id), doc);
    return clone(doc);
  }

  const module = {
    workspacesContainer: () => container,
    domainsContainer: () => container,
    usersContainer: () => container,
    invoicesContainer: () => container,
    runsContainer: () => container,
    sessionsContainer: () => container,
    usageContainer: () => container,
    readItem,
    queryItems,
    upsertItem,
    deleteItem: async () => {},
  };

  return { store, k, module };
});

vi.mock("@/lib/cosmos", () => h.module);

import {
  reserveCredit,
  settleHold,
  refundCredit,
  grantCredits,
  getAvailableCredits,
  getHold,
} from "./ledger";

const WS = "ws-test";

function seedWorkspace(balance = 0) {
  h.store.set(h.k(WS, WS), {
    id: WS,
    workspaceId: WS,
    type: "workspace",
    ownerUid: "owner-1",
    members: [{ uid: "owner-1", email: "o@x.de", role: "owner", addedAt: "t" }],
    balance,
    createdAt: "t",
    updatedAt: "t",
    _etag: "etag-seed",
  });
}

beforeEach(() => {
  h.store.clear();
  seedWorkspace(0);
});

describe("credit ledger — money correctness", () => {
  it("grant -> available reflects the batch", async () => {
    const r = await grantCredits({ workspaceId: WS, amount: 5, source: "free" });
    expect(r.ok).toBe(true);
    expect(await getAvailableCredits(WS)).toBe(5);
  });

  it("reserve draws exactly one credit and creates a pending hold", async () => {
    await grantCredits({ workspaceId: WS, amount: 2, source: "free" });
    const res = await reserveCredit({ workspaceId: WS, runId: "run-1" });
    expect(res.ok).toBe(true);
    expect(await getAvailableCredits(WS)).toBe(1);
    const hold = await getHold(WS, "run-1");
    expect(hold?.status).toBe("pending");
  });

  it("reserve is idempotent for the same runId (no double draw)", async () => {
    await grantCredits({ workspaceId: WS, amount: 2, source: "free" });
    await reserveCredit({ workspaceId: WS, runId: "run-1" });
    const again = await reserveCredit({ workspaceId: WS, runId: "run-1" });
    expect(again.ok).toBe(true);
    expect(await getAvailableCredits(WS)).toBe(1); // still only one drawn
  });

  it("settle flips pending -> settled and is idempotent", async () => {
    await grantCredits({ workspaceId: WS, amount: 1, source: "free" });
    await reserveCredit({ workspaceId: WS, runId: "run-1" });
    expect((await settleHold({ workspaceId: WS, runId: "run-1" })).ok).toBe(true);
    expect((await getHold(WS, "run-1"))?.status).toBe("settled");
    // second settle is a no-op (condition no longer 'pending') but still ok
    expect((await settleHold({ workspaceId: WS, runId: "run-1" })).ok).toBe(true);
  });

  it("refund restores the credit and is idempotent (NO +2 inflation)", async () => {
    await grantCredits({ workspaceId: WS, amount: 1, source: "free" });
    await reserveCredit({ workspaceId: WS, runId: "run-1" });
    await settleHold({ workspaceId: WS, runId: "run-1" });
    expect(await getAvailableCredits(WS)).toBe(0);

    const first = await refundCredit({ workspaceId: WS, runId: "run-1", reason: "refund_user_delete" });
    expect(first.refunded).toBe(true);
    expect(await getAvailableCredits(WS)).toBe(1);

    // Second refund (e.g. compensate racing user-delete) must NOT over-credit.
    const second = await refundCredit({ workspaceId: WS, runId: "run-1", reason: "refund_technical_failure" });
    expect(second.refunded).toBe(false);
    expect(await getAvailableCredits(WS)).toBe(1); // still 1, not 2
    expect((await getHold(WS, "run-1"))?.status).toBe("refunded");
  });

  it("refund works from a pending (not yet settled) hold too", async () => {
    await grantCredits({ workspaceId: WS, amount: 1, source: "free" });
    await reserveCredit({ workspaceId: WS, runId: "run-1" });
    const r = await refundCredit({ workspaceId: WS, runId: "run-1", reason: "refund_technical_failure" });
    expect(r.refunded).toBe(true);
    expect(await getAvailableCredits(WS)).toBe(1);
  });

  it("reserve with empty balance -> insufficient_credits", async () => {
    const res = await reserveCredit({ workspaceId: WS, runId: "run-x" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("insufficient_credits");
  });

  it("refund without a prior hold is a safe no-op", async () => {
    const r = await refundCredit({ workspaceId: WS, runId: "never-held", reason: "refund_user_delete" });
    expect(r.ok).toBe(true);
    expect(r.refunded).toBe(false);
  });

  it("purchase grant is idempotent per stripe event id", async () => {
    const a = await grantCredits({ workspaceId: WS, amount: 5, source: "purchase", stripeEventId: "evt_1" });
    expect(a.granted).toBe(true);
    const b = await grantCredits({ workspaceId: WS, amount: 5, source: "purchase", stripeEventId: "evt_1" });
    expect(b.granted).toBe(false); // duplicate event -> no double credit
    expect(await getAvailableCredits(WS)).toBe(5);
  });
});
