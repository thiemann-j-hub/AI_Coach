'use client';

/**
 * Kleine Bausteine des Gesprächs, die Chat und Sprechansicht teilen.
 * Paket 4, C25 (12.11.2026): aus SimulationClient herausgelöst, damit die Mitschrift der Sprechansicht dieselben
 * Blasen zeigt wie der Chat (ein Bauteil statt zwei).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { withBasePath } from '@/lib/base-path';

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

/** Anfangsbuchstaben der ersten beiden Namensworte („Alex Morgan“ → AM). */
export function initialen(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/**
 * Persona-Avatar — D4: fotorealistisches Porträt (fal, erfundene Person) aus
 * public/personas/<scenarioId>.jpg mit Initialen-Fallback, falls das Bild
 * fehlt oder (noch) nicht geladen ist.
 */
export function PersonaAvatar({
  name,
  scenarioId,
  size = 'md',
}: {
  name: string;
  scenarioId?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const cls =
    size === 'lg'
      ? 'h-16 w-16 text-xl'
      : size === 'sm'
        ? 'h-7 w-7 text-[10px]'
        : 'h-10 w-10 text-sm';
  const showImage = scenarioId && !imgFailed;
  return (
    <span
      className={cx(
        cls,
        'shrink-0 rounded-full grid place-items-center font-bold text-white overflow-hidden',
        'bg-gradient-to-br from-primary to-accent shadow-neon ring-1 ring-white/20'
      )}
      aria-hidden
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={withBasePath(`/personas/${scenarioId}.jpg`)}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setImgFailed(true)}
        />
      ) : (
        initialen(name)
      )}
    </span>
  );
}

/** Kennzeichen „KI-Rolle“ am Namen der Rolle (U4; Transparenz nach EU-KI-Verordnung, bleibt im ganzen Gespräch sichtbar). */
export function KiKennzeichen({ text, title }: { text: string; title?: string }) {
  return (
    <span
      className="pn-none inline-flex shrink-0 items-center rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-semibold leading-none text-muted-foreground"
      title={title}
      data-testid="ki-rolle"
    >
      {text}
    </span>
  );
}

export interface BlasenZug {
  role: 'user' | 'persona';
  text: string;
}

/**
 * Die Blasen des Gesprächs: gespeicherte Züge, dazu der laufende Zug (Text-Antwort entsteht, mitlaufende
 * Mitschrift im Sprachgespräch). Rollt bei jedem neuen Inhalt ans Ende.
 */
export function GespraechsBlasen(props: {
  turns: BlasenZug[];
  personaName: string;
  /** Kennung für das Porträt (Varianten teilen das Porträt ihres Grundszenarios). */
  portrait: string;
  /** Wartezeile der Rolle, z. B. „Alex antwortet …“. */
  wartet?: string | null;
  /** Mitlaufende Mitschrift des laufenden Zugs (nur im Sprachgespräch). */
  laufendDu?: string;
  laufendRolle?: string;
}) {
  const endeRef = useRef<HTMLDivElement | null>(null);
  const { turns, wartet, laufendDu, laufendRolle } = props;

  useEffect(() => {
    const ruhig = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    endeRef.current?.scrollIntoView({ block: 'end', behavior: ruhig ? 'auto' : 'smooth' });
  }, [turns, wartet, laufendDu, laufendRolle]);

  const avatar = <PersonaAvatar name={props.personaName} scenarioId={props.portrait} size="sm" />;
  return (
    <>
      {turns.map((turn, idx) => (
        <div key={idx} className={cx('flex items-end gap-2', turn.role === 'user' ? 'justify-end' : 'justify-start')}>
          {turn.role === 'persona' && avatar}
          <div
            className={cx(
              'pn-none rounded-2xl px-4 py-2.5 text-sm leading-relaxed max-w-[85%] whitespace-pre-wrap text-left',
              turn.role === 'user' ? 'bg-primary text-primary-foreground rounded-br-sm' : 'glass-panel border border-border rounded-bl-sm'
            )}
          >
            {turn.text}
          </div>
        </div>
      ))}
      {wartet && (
        <div className="flex items-end gap-2 justify-start">
          {avatar}
          <div className="pn-none glass-panel border border-border rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {wartet}
          </div>
        </div>
      )}
      {laufendDu && (
        <div className="flex items-end gap-2 justify-end">
          <div className="pn-none rounded-2xl px-4 py-2.5 text-sm leading-relaxed max-w-[85%] whitespace-pre-wrap text-left bg-primary/70 text-primary-foreground rounded-br-sm">
            {laufendDu}
          </div>
        </div>
      )}
      {laufendRolle && (
        <div className="flex items-end gap-2 justify-start">
          {avatar}
          <div className="pn-none glass-panel border border-border rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm leading-relaxed max-w-[85%] whitespace-pre-wrap text-left">
            {laufendRolle}
          </div>
        </div>
      )}
      <div ref={endeRef} />
    </>
  );
}
