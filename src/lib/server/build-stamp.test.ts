/**
 * Go-Live-Ampel G-F (06.11.2026): /api/health meldete seit Juli 4ca30a9, weil die Route zuerst die
 * App-Einstellung BUILD_SHA las, die keine Auslieferung mehr pflegt. Der Coach lief da auf d2239ee.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildStamp } from "./build-stamp";
import { GET as health } from "@/app/api/health/route";
import { GET as version } from "@/app/api/version/route";

vi.mock("@/ai/model-id", () => ({ resolveWriterModelId: () => "modell" }));

const ALT = { BUILD_SHA: "4ca30a9", BUILD_BRANCH: "alt", BUILD_STAMPED_AT: "2026-07-31T05:20:07Z" };
const KEYS = ["NEXT_PUBLIC_BUILD_SHA", ...Object.keys(ALT)];
const INFO = { sha: "d2239ee", branch: "feat/scoring-observability", builtAt: "2026-11-06T14:07:24Z" };

let ordner: string;
let cwdSpy: ReturnType<typeof vi.spyOn> | undefined;
const merker: Record<string, string | undefined> = {};

beforeEach(() => {
  ordner = mkdtempSync(join(tmpdir(), "build-stamp-"));
  for (const k of KEYS) {
    merker[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  cwdSpy?.mockRestore();
  cwdSpy = undefined;
  rmSync(ordner, { recursive: true, force: true });
  for (const k of KEYS) {
    if (merker[k] === undefined) delete process.env[k];
    else process.env[k] = merker[k];
  }
});

describe("buildStamp", () => {
  it("nimmt die Angaben aus dem Bau, nicht die alten App-Einstellungen", () => {
    writeFileSync(join(ordner, "build-info.json"), JSON.stringify(INFO));
    Object.assign(process.env, ALT, { NEXT_PUBLIC_BUILD_SHA: "d2239eeabcdef0" });
    expect(buildStamp(ordner)).toEqual(INFO);
  });

  it("ohne Datei: eingebackene Kennung vor der App-Einstellung", () => {
    Object.assign(process.env, ALT, { NEXT_PUBLIC_BUILD_SHA: "d2239eeabcdef0" });
    expect(buildStamp(ordner).sha).toBe("d2239ee");
  });

  it("kaputte Datei stört nicht", () => {
    writeFileSync(join(ordner, "build-info.json"), "{kein json");
    process.env.NEXT_PUBLIC_BUILD_SHA = "d2239eeabcdef0";
    expect(buildStamp(ordner)).toEqual({ sha: "d2239ee", branch: null, builtAt: null });
  });

  it("ganz ohne Angaben: unstamped", () => {
    expect(buildStamp(ordner)).toEqual({ sha: "unstamped", branch: null, builtAt: null });
  });
});

describe("Routen", () => {
  it("/api/health und /api/version zeigen Bau-Stand statt Juli", async () => {
    writeFileSync(join(ordner, "build-info.json"), JSON.stringify(INFO));
    Object.assign(process.env, ALT, { NEXT_PUBLIC_BUILD_SHA: "d2239eeabcdef0" });
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(ordner);

    const h = await (await health()).json();
    expect(h.sha).toBe(INFO.sha);
    expect(h.branch).toBe(INFO.branch);
    expect(h.stampedAt).toBe(INFO.builtAt);

    const v = await version().json();
    expect(v.sha).toBe(INFO.sha);
    expect(v.branch).toBe(INFO.branch);
    expect(v.builtAt).toBe(INFO.builtAt);
  });
});
