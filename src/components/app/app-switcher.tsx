"use client";

// M3-1 Plattform-Kohäsion, Synthesia-Angleich (Owner-Vorgabe 04.08.):
// Der App-Umschalter lebt jetzt als Dropdown IM Brand-Block der Sidebar
// (wie Synthesias Workspace-Switcher) — das Rastersymbol im Header entfällt.
// Ziele = same-origin Next-Apps hinter app.pulsenorth.ai, daher bewusst
// <a href> statt next/link (kein Client-Routing über App-Grenzen).
// Strings = Produkt-Eigennamen → bewusst nicht übersetzt (wie Wortmarke).
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { PulscraftMark } from "@/components/pulscraft-wordmark";

const CURRENT = "coach";

/**
 * suffix = Produktname hinter der Wortmarke ("PulseNorth.AI Coach");
 * Einträge ohne suffix (Hub/Radar) tragen ihren Eigennamen in `name`.
 */
const APPS: Array<{ key: string; href: string; name?: string; suffix?: string }> = [
  { key: "hub", href: "/", name: "PulseNorth Hub" },
  { key: "coach", href: "/coach", suffix: "Coach" },
  { key: "jobmap", href: "/jobmap", suffix: "Jobmap" },
  { key: "studio", href: "/studio", suffix: "Learning Studio" },
  { key: "radar", href: "/radar", name: "Mein Lernbereich" },
  { key: "team", href: "/team", name: "Team-Radar" },
];

/**
 * Owner-Entscheid 02.10.2026: Das Team-Radar sieht nur der Admin. Ob der Eintrag
 * erscheint, sagt der Hub — EINE Stelle für alle Apps, der Rückweg-Schalter sitzt dort.
 * Der Pfad liegt an der Wurzel der Domain (Hub), bewusst NICHT unter dem basePath
 * dieser App. Bis zur Antwort und bei jedem Fehler bleibt der Eintrag verborgen; die
 * Seite /team prüft ohnehin selbst.
 */
const HUB_NAV_URL = "/api/nav";

/**
 * Lernenden-Sicht S5 (Owner-GO 06.10.2026): Die Häkchen aus „Team & Zugänge“ gelten auch
 * hier. Der Hub nennt in derselben Antwort die Werkzeuge, die diese Sitzung sehen darf
 * (`apps`). Fehlt die Angabe (Störung, Schalter dort aus), bleiben alle Werkzeuge sichtbar
 * wie bisher — die Apps prüfen den Zugang ohnehin selbst.
 */
type AppKey = "coach" | "jobmap" | "studio";
const TOOL_KEYS: readonly string[] = ["coach", "jobmap", "studio"];

export interface HubSubNav {
  href: string;
  label: string;
}

export interface HubNav {
  teamRadar: boolean;
  apps: AppKey[] | null;
  /**
   * Einfaches Menü (Lernbereich A, Owner-GO 09.10.2026): Der Hub sagt, ob diese Sitzung die
   * Lernenden-Seitenleiste bekommt — kein App-Umschalter, kein „Start“, Sprungmarken unter
   * „Mein Lernbereich“. Der Coach zeigt dann dieselbe Leiste wie der Hub. Rückweg im Hub: LEARNER_MENU=off.
   */
  simpleMenu: boolean;
  subNav: HubSubNav[];
  lernbereichLabel: string | null;
}

export function useHubNav(): HubNav {
  const [nav, setNav] = useState<HubNav>({
    teamRadar: false,
    apps: null,
    simpleMenu: false,
    subNav: [],
    lernbereichLabel: null,
  });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(HUB_NAV_URL, { credentials: "same-origin", cache: "no-store" });
        const body = res.ok
          ? ((await res.json()) as { teamRadar?: unknown; apps?: unknown; simpleMenu?: unknown; subNav?: unknown; lernbereichLabel?: unknown })
          : null;
        if (cancelled) return;
        const subNav = Array.isArray(body?.subNav)
          ? (body.subNav as Array<{ href?: unknown; label?: unknown }>)
              .filter((s) => typeof s?.href === "string" && typeof s?.label === "string" && (s.href as string).startsWith("/"))
              .map((s) => ({ href: s.href as string, label: s.label as string }))
          : [];
        setNav({
          teamRadar: body?.teamRadar === true,
          apps: Array.isArray(body?.apps)
            ? (body.apps.filter((a) => TOOL_KEYS.includes(a as string)) as AppKey[])
            : null,
          simpleMenu: body?.simpleMenu === true,
          subNav,
          lernbereichLabel: typeof body?.lernbereichLabel === "string" ? body.lernbereichLabel : null,
        });
      } catch {
        /* Team-Radar bleibt verborgen, Werkzeuge bleiben sichtbar */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return nav;
}

/**
 * Brand-Block der Sidebar als Umschalter: Logo + Wortmarke + App-Name,
 * Klick öffnet die App-Liste — jeder Eintrag mit dem Puls-Logo davor.
 */
export function BrandSwitcher({ collapsed }: { collapsed?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const nav = useHubNav();
  const apps = APPS.filter((app) => {
    if (app.key === "team") return nav.teamRadar;
    // Diese App selbst bleibt immer in der Liste (Standort); die anderen Werkzeuge nur mit Häkchen.
    if (app.key !== CURRENT && TOOL_KEYS.includes(app.key) && nav.apps) {
      return nav.apps.includes(app.key as AppKey);
    }
    return true;
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (nav.simpleMenu) {
    // Lernende (einfaches Menü): nichts zu wechseln — die Marke führt in „Mein Lernbereich“ (Hub, Wurzel).
    return (
      <a
        href="/radar"
        aria-label={nav.lernbereichLabel ?? "Mein Lernbereich"}
        title={nav.lernbereichLabel ?? "Mein Lernbereich"}
        data-testid="brand-learner"
        className="flex items-start rounded-lg transition-opacity hover:opacity-85"
      >
        {collapsed ? (
          <PulscraftMark />
        ) : (
          <span className="flex items-start gap-2.5">
            <PulscraftMark />
            <span className="text-lg font-bold tracking-tight">
              <span className="text-foreground">PulseNorth</span>
              <span className="text-primary">.AI</span>
            </span>
          </span>
        )}
      </a>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="PulseNorth App wechseln"
        className="group flex items-start rounded-lg transition-opacity hover:opacity-85"
      >
        {collapsed ? (
          <PulscraftMark />
        ) : (
          <span className="flex flex-col items-start leading-none text-left">
            <span className="flex items-start gap-2.5">
              <PulscraftMark />
              <span className="text-lg font-bold tracking-tight">
                <span className="text-foreground">PulseNorth</span>
                <span className="text-primary">.AI</span>
              </span>
              <ChevronDown
                className={`mt-1.5 h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
              />
            </span>
            <span className="-mt-2.5 ml-[42px] text-[11px] font-medium text-muted-foreground">
              Coach
            </span>
          </span>
        )}
      </button>
      {open && (
        <div
          role="menu"
          className="pn-none absolute left-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-border bg-background/95 p-1.5 shadow-xl backdrop-blur"
        >
          {apps.map((app) => {
            const active = app.key === CURRENT;
            return (
              <a
                key={app.key}
                href={app.href}
                role="menuitem"
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-primary/10 font-medium"
                    : "hover:bg-foreground/5"
                }`}
              >
                <PulscraftMark className="h-5 w-5" />
                {app.suffix ? (
                  <span className="truncate font-semibold tracking-tight">
                    <span className="text-foreground">PulseNorth</span>
                    <span className="text-primary">.AI</span>
                    <span className="font-medium text-muted-foreground"> {app.suffix}</span>
                  </span>
                ) : (
                  <span className="truncate font-medium text-foreground">{app.name}</span>
                )}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
