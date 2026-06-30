/**
 * basePath fuer den Pulscraft-Hub-Front-Door (pfadbasiert, same origin):
 * `/` -> Hub, `/coach/*` -> diese App (Azure Front Door).
 *
 * Next.js prefixt `next/link`, `next/router`, `next/navigation` und `next/image`
 * + die Routen automatisch mit basePath. Fuer ALLES Hand-Absolute, das Next NICHT
 * umschreibt — Client-`fetch`/`authFetch` auf `/api/...`, rohe `<a>`/`<img src>`,
 * manuelle Server-Redirects — diesen Helfer nutzen.
 *
 * Quelle = NEXT_PUBLIC_BASE_PATH (in next.config zu `basePath` gespiegelt), damit
 * Client UND Server denselben Wert sehen. Leer ("") im Direkt-Modus
 * (pulsecraft-coach.azurewebsites.net), "/coach" hinter dem Front Door.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * Prefixt einen wurzel-absoluten App-Pfad mit dem basePath. Idempotent; laesst
 * relative Pfade, protocol-relative (`//host`), volle URLs und bereits praefixte
 * Pfade unangetastet.
 */
export function withBasePath(path: string): string {
  if (!BASE_PATH) return path;
  if (!path.startsWith("/") || path.startsWith("//")) return path; // relativ / protocol-relative / extern
  if (/^https?:\/\//i.test(path)) return path; // volle URL (defensiv)
  if (path === BASE_PATH || path.startsWith(BASE_PATH + "/")) return path; // schon praefixt
  return BASE_PATH + path;
}
