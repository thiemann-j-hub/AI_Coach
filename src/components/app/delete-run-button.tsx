"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, RotateCcw, Loader2 } from "lucide-react";
import { authFetch } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n/useTranslation";

/** Kulanz-Fenster muss zum Server (/api/runs/delete) passen: 10 Minuten. */
const REFUND_WINDOW_MS = 10 * 60 * 1000;

/**
 * Löscht einen Run und macht das 10-Min-Erstattungsfenster im UI eindeutig
 * sichtbar (Zustand aus createdAt). Die Server-Wahrheit (/api/runs/delete)
 * bleibt die Autorität — der Toast nach dem Klick spiegelt, was wirklich
 * passiert ist (erstattet ja/nein).
 */
export function DeleteRunButton({
  sessionId,
  runId,
  createdAt,
  paymentsEnabled = false,
}: {
  sessionId: string;
  runId: string;
  createdAt: string | null;
  /** Nur wenn das Bezahlsystem aktiv ist, kann der 10-Min-Refund greifen. */
  paymentsEnabled?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { locale } = useTranslation();
  const de = locale.startsWith("de");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const ageMs = createdAt ? Date.now() - new Date(createdAt).getTime() : Infinity;
  // Refund-Affordanz NUR zeigen, wenn das Bezahlsystem aktiv ist UND der Run im
  // 10-Min-Fenster liegt — sonst verspräche der Button bei Payments-off eine
  // Erstattung, die der Server nie ausführt.
  const refundable =
    paymentsEnabled && Number.isFinite(ageMs) && ageMs <= REFUND_WINDOW_MS;
  const refundUntil =
    refundable && createdAt
      ? new Date(new Date(createdAt).getTime() + REFUND_WINDOW_MS).toLocaleTimeString(
          de ? "de-DE" : "en-US",
          { hour: "2-digit", minute: "2-digit" }
        )
      : null;

  async function doDelete() {
    setBusy(true);
    try {
      const res = await authFetch("/api/runs/delete", {
        method: "POST",
        body: JSON.stringify({ sessionId, runId }),
      });
      const j = await res.json().catch(() => ({} as any));
      if (!res.ok || !j?.ok) {
        throw new Error(j?.error ? String(j.error) : `HTTP ${res.status}`);
      }
      // Toast spiegelt die Server-Wahrheit. "Fenster abgelaufen" NUR zeigen,
      // wenn Payments aktiv sind (sonst gab es nie eine Refund-Erwartung).
      const description = j?.refunded
        ? de
          ? "1 Credit wurde erstattet."
          : "1 credit was refunded."
        : paymentsEnabled
          ? de
            ? "Kein Credit erstattet (Fenster abgelaufen)."
            : "No credit refunded (window expired)."
          : undefined;
      toast({
        title: de ? "Analyse gelöscht" : "Analysis deleted",
        ...(description ? { description } : {}),
      });
      router.push("/runs-dashboard");
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: de ? "Löschen fehlgeschlagen" : "Delete failed",
        description: e?.message ?? "",
      });
      setBusy(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">{de ? "Wirklich löschen?" : "Really delete?"}</span>
        <button
          onClick={doDelete}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-destructive/90 px-3 py-1.5 font-medium text-destructive-foreground hover:bg-destructive disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          {de ? "Ja, löschen" : "Yes, delete"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="rounded-lg px-3 py-1.5 text-muted-foreground hover:text-foreground"
        >
          {de ? "Abbrechen" : "Cancel"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        onClick={() => setConfirming(true)}
        title={
          refundable
            ? de
              ? "Im Erstattungsfenster — Credit kommt zurück"
              : "Within refund window — credit will be returned"
            : de
              ? "Erstattungsfenster abgelaufen — kein Credit zurück"
              : "Refund window expired — no credit returned"
        }
        className={
          refundable
            ? "inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/20"
            : "inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-destructive hover:border-destructive/30"
        }
      >
        {refundable ? <RotateCcw className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
        {refundable
          ? de
            ? "Löschen & Credit zurück"
            : "Delete & refund credit"
          : de
            ? "Löschen"
            : "Delete"}
      </button>
      {refundUntil && (
        <span className="text-[11px] text-muted-foreground">
          {de ? `Erstattung bis ${refundUntil}` : `Refund until ${refundUntil}`}
        </span>
      )}
    </div>
  );
}
