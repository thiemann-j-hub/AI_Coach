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
 * Brand-Block der Sidebar als Umschalter: Logo + Wortmarke + App-Name,
 * Klick öffnet die App-Liste — jeder Eintrag mit dem Puls-Logo davor.
 */
export function BrandSwitcher({ collapsed }: { collapsed?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
          className="absolute left-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-border bg-background/95 p-1.5 shadow-xl backdrop-blur"
        >
          {APPS.map((app) => {
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
