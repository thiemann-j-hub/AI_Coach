import { ArrowLeft, Lock } from "lucide-react";
import { PulscraftMark, PulscraftWordmark } from "@/components/pulscraft-wordmark";

/**
 * Lernenden-Sicht S5 (Owner-GO 06.10.2026) — Seite „kein Zugang“ des Coachs.
 *
 * Erscheint statt der App, wenn das Konto das Häkchen „KI-Coach“ nicht hat (Entscheidung:
 * lib/server/coach-access.ts). Ein Satz zum Grund, ein Knopf zurück in „Mein Lernbereich“ —
 * der liegt im Hub an der Wurzel der Domain, deshalb ein gewöhnlicher Link ohne basePath.
 */
const LEARNING_AREA_URL = "/radar";

export function NoAccess({ texts }: { texts: { title: string; body: string; cta: string } }) {
  return (
    <main
      className="flex min-h-screen items-center justify-center bg-background p-6"
      data-testid="no-coach-access"
    >
      <div className="pn-surface w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <PulscraftMark />
          <span className="flex flex-col items-start leading-none">
            <PulscraftWordmark />
            <span className="mt-0.5 text-[11px] font-medium text-muted-foreground">Coach</span>
          </span>
        </div>
        <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
          <Lock className="h-5 w-5" aria-hidden="true" />
        </span>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{texts.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{texts.body}</p>
        <a
          href={LEARNING_AREA_URL}
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {texts.cta}
        </a>
      </div>
    </main>
  );
}
