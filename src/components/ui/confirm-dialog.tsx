"use client";

/**
 * W1-10 (LXT-Welle W1, Owner-GO 14.10.2026): Bestätigen als `await confirm()`.
 *
 * Vorbild LXT (Tiefenanalyse Anhang E §4.3): imperative Dialoge `await KJ(titel, text, optionen)`
 * liefern ja/nein; bei gefährlichen Aktionen Wischen oder ein Wort eintippen; 47 Aufrufe statt
 * 47 eigener Dialog-Zustände. Unsere Fassung: EIN Provider mit shadcn AlertDialog, Haken
 * `useConfirm()`; der Fokus liegt beim Öffnen auf „Abbrechen“ (Enter löscht nie versehentlich);
 * `typeToConfirm` verlangt ein Wort (Standard „LÖSCHEN“ in der Sprache der Oberfläche) für
 * endgültige Löschungen. Dieselbe Datei in Studio, Coach und Jobmap; die Texte reicht jede App
 * über `labels` herein (eigene Sprachdateien).
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";

export interface ConfirmLabels {
  /** Standard-Knopf „Fortfahren“. */
  ok: string;
  cancel: string;
  /** Satz mit Platzhalter {word}: „Gib zur Bestätigung {word} ein.“ */
  typeWord: string;
  /** Das Wort für endgültige Löschungen, z. B. „LÖSCHEN“. */
  deleteWord: string;
  /** Knopf bei endgültigen Löschungen: „Endgültig löschen“. */
  deleteOk: string;
}

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Roter Bestätigen-Knopf (Löschen, Verwerfen). */
  destructive?: boolean;
  /** Endgültiges Löschen: `true` = Wort aus `labels.deleteWord`, oder ein eigenes Wort. */
  typeToConfirm?: boolean | string;
}

export type ConfirmFn = (input: ConfirmOptions | string) => Promise<boolean>;

/** Reine Regel: ist das eingetippte Wort das verlangte? (Groß/Klein egal, Rand-Leerzeichen egal.) */
export function typedWordMatches(required: string | null, typed: string): boolean {
  if (!required) return true;
  return typed.trim().toLocaleUpperCase() === required.trim().toLocaleUpperCase();
}

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ labels, children }: { labels: ConfirmLabels; children: ReactNode }) {
  const [state, setState] = useState<{ opts: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);
  const [typed, setTyped] = useState("");
  const cancelRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<ConfirmFn>(
    (input) =>
      new Promise<boolean>((resolve) => {
        setTyped("");
        // Ein offener Dialog wird durch den neuen ersetzt und als „nein“ beantwortet.
        setState((prev) => {
          prev?.resolve(false);
          return { opts: typeof input === "string" ? { title: input } : input, resolve };
        });
      }),
    []
  );

  const close = (value: boolean) => {
    setState((prev) => {
      prev?.resolve(value);
      return null;
    });
  };

  const opts = state?.opts;
  const word = opts?.typeToConfirm ? (typeof opts.typeToConfirm === "string" ? opts.typeToConfirm : labels.deleteWord) : null;
  const ready = typedWordMatches(word, typed);
  const destructive = Boolean(opts?.destructive) || word !== null;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog
        open={state !== null}
        onOpenChange={(open) => {
          if (!open) close(false);
        }}
      >
        <AlertDialogContent
          data-testid="confirm-dialog"
          onOpenAutoFocus={(e) => {
            // LXT-Regel übernommen: Fokus auf „Abbrechen“, nie auf dem gefährlichen Knopf.
            e.preventDefault();
            cancelRef.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{opts?.title}</AlertDialogTitle>
            {opts?.description ? <AlertDialogDescription>{opts.description}</AlertDialogDescription> : null}
          </AlertDialogHeader>
          {word ? (
            <div className="space-y-2 py-1">
              <p className="text-sm text-muted-foreground">{labels.typeWord.replace("{word}", word)}</p>
              <Input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={word}
                aria-label={word}
                autoComplete="off"
                data-testid="confirm-type-word"
              />
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel ref={cancelRef} onClick={() => close(false)}>
              {opts?.cancelLabel ?? labels.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!ready}
              onClick={() => close(true)}
              className={destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
              data-testid="confirm-ok"
            >
              {opts?.confirmLabel ?? (word ? labels.deleteOk : labels.ok)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

/** `const confirm = useConfirm(); if (!(await confirm({ title, typeToConfirm: true }))) return;` */
export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) throw new Error("useConfirm braucht einen ConfirmProvider (App-Hülle).");
  return fn;
}
