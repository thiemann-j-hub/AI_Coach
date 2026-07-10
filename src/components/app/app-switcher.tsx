"use client";

// M3-1 Plattform-Kohäsion: App-Switcher — aus jeder App in jede App (same-origin
// hinter app.pulsenorth.ai, daher bewusst <a href> statt next/link: die Ziele sind
// EIGENE Next-Apps, kein Client-Routing über App-Grenzen). Identisches Muster in
// Coach/Jobmap/Studio; Hub selbst IST der Switcher (Kachel-Home).
// Strings = Produkt-Eigennamen → bewusst nicht übersetzt (wie Wortmarke).
import { useEffect, useRef, useState } from "react";
import {
  LayoutGrid,
  Home,
  MessageSquare,
  Network,
  GraduationCap,
  Radar,
  Users,
} from "lucide-react";

const CURRENT = "coach";

const APPS = [
  { key: "hub", name: "PulseNorth Hub", href: "/", icon: Home },
  { key: "coach", name: "Gesprächs-Coach", href: "/coach", icon: MessageSquare },
  { key: "jobmap", name: "Jobmap", href: "/jobmap", icon: Network },
  { key: "studio", name: "Learning Studio", href: "/studio", icon: GraduationCap },
  { key: "radar", name: "Privates Radar", href: "/radar", icon: Radar },
  { key: "team", name: "Team-Radar", href: "/team", icon: Users },
];

export function AppSwitcher() {
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
        aria-label="PulseNorth Apps"
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card/50 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      >
        <LayoutGrid className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-11 z-50 w-56 overflow-hidden rounded-xl border border-border bg-background/95 p-1.5 shadow-xl backdrop-blur"
        >
          {APPS.map((app) => {
            const Icon = app.icon;
            const active = app.key === CURRENT;
            return (
              <a
                key={app.key}
                href={app.href}
                role="menuitem"
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-foreground hover:bg-foreground/5"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {app.name}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
