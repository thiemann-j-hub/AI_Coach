"use client";

/**
 * W1-3 (LXT-Welle W1, Owner-GO 14.10.2026): Fehlerbericht für den Support.
 *
 * Vorbild LXT (Anhang A §7.8, Anhang E §5.3): Strg+D öffnet „Systemdiagnose und Fehlerbericht“
 * mit Umgebung (URL, Browser, Version, Zoom, Bildschirm, Online-Status), App-Zustand, letzten
 * Ressourcen-Zeiten und einem Ringpuffer der letzten 500 Logeinträge → Download als JSON;
 * Fehlermeldungen verlinken dorthin. Schwächen dort: ganzes Nutzerobjekt und Screenshot im
 * Bericht. Unsere Fassung: Version/Build, Browser, Schalterstand, letzte Fehler-Nummern,
 * Log-Ringpuffer OHNE Personendaten (E-Mails, Schlüssel, Abfrage-Parameter werden entfernt),
 * Vorschau vor dem Speichern, kein Screenshot. Rückweg: DIAGNOSE_REPORT=off (Server).
 */

export interface DiagEntry {
  t: string;
  level: "error" | "warn" | "info";
  msg: string;
}

export interface DiagErrorRef {
  t: string;
  requestId?: string;
  code?: string;
  status?: number;
  msg: string;
}

const MAX_LOG = 500;
const MAX_ERRORS = 5;

type Store = { log: DiagEntry[]; errors: DiagErrorRef[]; installed: boolean };

function store(): Store {
  const g = globalThis as typeof globalThis & { __pnDiag?: Store };
  if (!g.__pnDiag) g.__pnDiag = { log: [], errors: [], installed: false };
  return g.__pnDiag;
}

/** Personendaten und Geheimnisse entfernen: E-Mails, Bearer/Schlüssel, lange Zeichenketten, Abfrage-Parameter. Reine Funktion. */
export function redact(input: string): string {
  return String(input)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[E-Mail]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "[Zugangsdaten entfernt]")
    .replace(/\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g, "[Token]")
    .replace(/\b[A-Za-z0-9+/_-]{48,}={0,2}\b/g, "[Schlüssel]")
    .replace(/(https?:\/\/[^\s?#"']+)\?[^\s"']*/g, "$1?[Parameter entfernt]")
    .replace(/("?(?:password|passwort|secret|token|apikey|api_key|authorization)"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1[entfernt]");
}

function toText(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ")
    .slice(0, 600);
}

export function diagLog(level: DiagEntry["level"], ...args: unknown[]): void {
  const s = store();
  s.log.push({ t: new Date().toISOString(), level, msg: redact(toText(args)) });
  if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
}

/** Vom API-Client bei jedem Fehler aufgerufen: hält die letzten fünf Fehler-Nummern fest. */
export function recordApiError(ref: Omit<DiagErrorRef, "t">): void {
  const s = store();
  s.errors.push({ t: new Date().toISOString(), ...ref, msg: redact(ref.msg).slice(0, 300) });
  if (s.errors.length > MAX_ERRORS) s.errors.splice(0, s.errors.length - MAX_ERRORS);
  diagLog("error", `API ${ref.status ?? ""} ${ref.code ?? ""} ${ref.requestId ? `rid=${ref.requestId}` : ""} ${ref.msg}`.trim());
}

/** Einmal je Seite: Konsolenfehler/-warnungen und unbehandelte Fehler in den Ringpuffer spiegeln. */
export function installDiagnoseHooks(): void {
  if (typeof window === "undefined") return;
  const s = store();
  if (s.installed) return;
  s.installed = true;
  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);
  console.error = (...args: unknown[]) => {
    diagLog("error", ...args);
    origError(...args);
  };
  console.warn = (...args: unknown[]) => {
    diagLog("warn", ...args);
    origWarn(...args);
  };
  window.addEventListener("error", (ev) => diagLog("error", "window.error", ev.message, ev.filename ? `${ev.filename.split("?")[0]}:${ev.lineno}` : ""));
  window.addEventListener("unhandledrejection", (ev) => diagLog("error", "unhandledrejection", (ev as PromiseRejectionEvent).reason));
  diagLog("info", "Fehlerbericht-Puffer aktiv");
}

export interface DiagnoseReport {
  app: string;
  createdAt: string;
  build: { sha?: string | null; branch?: string | null; builtAt?: string | null };
  switches: Record<string, string>;
  page: { path: string; locale?: string };
  browser: {
    userAgent: string;
    language: string;
    viewport: string;
    screen: string;
    pixelRatio: number;
    online: boolean;
    reducedMotion: boolean;
    cookiesEnabled: boolean;
    timezone: string;
  };
  lastErrors: DiagErrorRef[];
  resourceTimings: Array<{ name: string; ms: number; type: string }>;
  log: DiagEntry[];
}

export function buildDiagnoseReport(opts: {
  app: string;
  build?: DiagnoseReport["build"];
  switches?: Record<string, string>;
  locale?: string;
}): DiagnoseReport {
  const s = store();
  const w = typeof window !== "undefined" ? window : undefined;
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  let timings: DiagnoseReport["resourceTimings"] = [];
  try {
    timings = (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
      .slice(-50)
      .map((e) => ({ name: redact(e.name.split("?")[0]).slice(0, 160), ms: Math.round(e.duration), type: e.initiatorType }));
  } catch {
    /* ohne Zeiten */
  }
  return {
    app: opts.app,
    createdAt: new Date().toISOString(),
    build: opts.build ?? {},
    switches: opts.switches ?? {},
    page: { path: w ? w.location.pathname : "", locale: opts.locale },
    browser: {
      userAgent: nav?.userAgent ?? "",
      language: nav?.language ?? "",
      viewport: w ? `${w.innerWidth}×${w.innerHeight}` : "",
      screen: w ? `${w.screen.width}×${w.screen.height}` : "",
      pixelRatio: w ? w.devicePixelRatio : 1,
      online: nav?.onLine ?? true,
      reducedMotion: w ? w.matchMedia("(prefers-reduced-motion: reduce)").matches : false,
      cookiesEnabled: nav?.cookieEnabled ?? true,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    lastErrors: [...s.errors],
    resourceTimings: timings,
    log: [...s.log],
  };
}

export function diagnoseFileName(app: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `fehlerbericht-${app}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

export function downloadDiagnoseReport(report: DiagnoseReport, fileName: string): void {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
