"use client";

/**
 * W1-13 (LXT-Welle W1, Owner-GO 14.10.2026): Die KI sagt in Ich-Form, was sie gerade tut.
 *
 * Vorbild LXT (Tiefenanalyse Anhang F §4.4, `ai.chatBot.loadingState.*`): „Ich suche …“, „Ich hole
 * Inhalte …“, „Ich formuliere eine Antwort …“ statt eines Kreisels. Unsere Fassung: drei kurze
 * eigene Sätze, die nacheinander erscheinen (alle `intervalMs`) und beim letzten stehen bleiben;
 * Screenreader bekommen sie als Status. Dieselbe Datei in Studio, Coach und Hub.
 */
import { useEffect, useState } from "react";

export function AiWaitSteps({
  steps,
  intervalMs = 7000,
  className,
}: {
  steps: string[];
  intervalMs?: number;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const key = steps.join("\u0000");

  useEffect(() => {
    setIndex(0);
    if (steps.length < 2) return;
    const timer = setInterval(() => setIndex((i) => Math.min(i + 1, steps.length - 1)), intervalMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, intervalMs]);

  const text = steps[index] ?? "";
  if (!text) return null;
  return (
    <p role="status" aria-live="polite" data-testid="ai-wait-steps" className={className}>
      {text}
    </p>
  );
}
