import { cn } from "@/lib/utils";

/**
 * Pulscraft-AI-Marken-Lockup (asset-frei, reines SVG/Text — keine PNG noetig).
 * Einheitlich ueber alle PULS-Craft-AI-Apps: [Pulse-Mark] Pulscraft AI · <Produkt>.
 * Schreibweise verbindlich: "Pulscraft" (foreground) + "AI" (primary).
 */

/** Pulse-/Heartbeat-Mark im abgerundeten Quadrat (currentColor). */
export function PulscraftMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-primary shadow-neon",
        className
      )}
      aria-hidden
    >
      <svg viewBox="0 0 40 40" className="h-5 w-5" fill="none">
        <polyline
          points="6,22 12,22 16,10 20,32 24,16 28,26 32,22 34,22"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function PulscraftWordmark({
  product = "Coach",
  iconOnly = false,
  className,
}: {
  product?: string;
  iconOnly?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <PulscraftMark />
      {!iconOnly && (
        <span className="text-base font-bold tracking-tight">
          <span className="text-foreground">Pulscraft</span>{" "}
          <span className="text-primary">AI</span>
          {product && (
            <span className="font-medium text-muted-foreground"> · {product}</span>
          )}
        </span>
      )}
    </span>
  );
}
