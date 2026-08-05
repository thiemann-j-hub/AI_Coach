import { cn } from "@/lib/utils";

/**
 * PulseNorth.AI-Marken-Lockup (asset-frei, reines SVG/Text — keine PNG noetig).
 * Einheitlich ueber alle Apps: [Pulse-Mark] PulseNorth.AI · <Produkt>.
 * Schreibweise verbindlich: "PulseNorth" (foreground) + ".AI" (primary, KEIN Leerzeichen).
 * (Komponenten-/Dateiname bleibt "Pulscraft..." — nur der gerenderte Text aendert sich.)
 */

/** Pulse-/Heartbeat-Mark im abgerundeten Quadrat (currentColor).
 *  Einheitliche flache Studio-Optik (Owner-Vorgabe 04.08.): eckiges Logo mit
 *  12%-Flaeche statt Rahmen-Badge — identisch zu Studio/Jobmap PulseMark. */
export function PulscraftMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={cn("h-8 w-8 shrink-0 text-primary", className)}
      fill="none"
      aria-hidden="true"
    >
      <rect x="0" y="0" width="40" height="40" rx="10" fill="currentColor" fillOpacity="0.12" />
      <polyline
        points="6,22 12,22 16,10 20,32 24,16 28,26 32,22 34,22"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/**
 * Produktname-Suffix ("&nbsp;· <Produkt>") — einzeln komponierbar (z. B. als eigener
 * Link neben der Marke). Typografie identisch zum Lockup; fuehrendes NBSP statt
 * Leerzeichen, damit der Abstand auch als eigenstaendiges Element erhalten bleibt
 * (fuehrende normale Leerzeichen wuerden vom Browser weggetrimmt).
 */
export function PulscraftProductName({
  product,
  className,
}: {
  product: string;
  className?: string;
}) {
  return (
    <span className={cn("text-base font-medium tracking-tight text-muted-foreground", className)}>
      {"\u00A0· "}
      {product}
    </span>
  );
}

export function PulscraftWordmark({
  product = "Coach",
  iconOnly = false,
  className,
}: {
  /** Produktname hinter der Marke; leerer String ("") unterdrueckt das Suffix. */
  product?: string;
  iconOnly?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <PulscraftMark />
      {!iconOnly && (
        <span className="text-lg font-bold tracking-tight">
          <span className="text-foreground">PulseNorth</span>
          <span className="text-primary">.AI</span>
          {product ? <PulscraftProductName product={product} /> : null}
        </span>
      )}
    </span>
  );
}
