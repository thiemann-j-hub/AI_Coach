"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/providers/auth-provider";
import { useTranslation } from "@/i18n/useTranslation";
import { locales, localeNames, type Locale } from "@/i18n/config";
import { Check, ChevronDown } from "lucide-react";
import { FlagIcon } from "@/components/flag-icon";

/**
 * Language switcher dropdown (Optik-Angleich 08.08.: SVG-Flagge + Eigenname,
 * wie im Studio — Custom-Dropdown statt nativem <select>, weil Options keine
 * SVGs rendern können; Emoji-Flaggen zeigt Windows nicht an).
 *
 * - `compact` zeigt im Trigger nur die Flagge (Liste bleibt voll)
 */
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, updateLanguage } = useAuth();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (l: Locale) => {
    setOpen(false);
    if (l === locale) return;
    void updateLanguage(l);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t.common.selectLanguage}
        className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <FlagIcon locale={locale} />
        {!compact && <span>{localeNames[locale]}</span>}
        <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={t.common.selectLanguage}
          className="absolute right-0 z-50 mt-1.5 max-h-80 w-44 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-xl"
        >
          {locales.map((l) => (
            <li key={l}>
              <button
                type="button"
                role="option"
                aria-selected={l === locale}
                onClick={() => pick(l)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground ${
                  l === locale ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                <FlagIcon locale={l} />
                <span className="flex-1">{localeNames[l]}</span>
                {l === locale && <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
