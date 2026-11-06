import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface BuildStamp {
  sha: string;
  branch: string | null;
  builtAt: string | null;
}

function datei(cwd: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(join(cwd, "build-info.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/**
 * Versionsstempel für /api/health und /api/version (Go-Live-Ampel G-F, 06.11.2026).
 * Wahrheit ist, was der Bau mitbringt: die eingebackene Kennung und die build-info.json, die die
 * Auslieferung neben server.js legt (azure-deploy.yml). Die App-Einstellungen BUILD_SHA, BUILD_BRANCH
 * und BUILD_STAMPED_AT pflegt die Auslieferung nicht mehr, sie standen seit Juli still (/api/health
 * meldete dadurch 4ca30a9) und zählen nur noch als letzter Rückfall, wenn beides fehlt.
 *
 * NEXT_PUBLIC_BUILD_SHA muss wörtlich über process.env gelesen werden: Next backt den Wert beim Bau ein,
 * zur Laufzeit steht er nicht in der Umgebung.
 */
export function buildStamp(cwd: string = process.cwd()): BuildStamp {
  const info = datei(cwd);
  return {
    sha:
      text(process.env.NEXT_PUBLIC_BUILD_SHA)?.slice(0, 7) ??
      text(info.sha) ??
      text(process.env.BUILD_SHA) ??
      "unstamped",
    branch: text(info.branch) ?? text(process.env.BUILD_BRANCH) ?? null,
    builtAt: text(info.builtAt) ?? text(process.env.BUILD_STAMPED_AT) ?? null,
  };
}
