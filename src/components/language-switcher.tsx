"use client";

import { useAuth } from "@/providers/auth-provider";
import { useTranslation } from "@/i18n/useTranslation";
import { locales, localeNames, type Locale } from "@/i18n/config";
import { Globe } from "lucide-react";

/**
 * Language switcher dropdown.
 *
 * - `compact` renders short ISO codes (DE, EN, FR ...)
 * - Default renders full names (Deutsch, English, Fran\u00e7ais ...)
 */
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, updateLanguage } = useAuth();
  const { t } = useTranslation();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLocale = e.target.value as Locale;
    if (newLocale === locale) return;
    void updateLanguage(newLocale);
  };

  return (
    <div className="flex items-center gap-1.5">
      <Globe className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
      <select
        value={locale}
        onChange={handleChange}
        aria-label={t.common.selectLanguage}
        className={`
          bg-transparent text-sm text-muted-foreground
          border-0 outline-none cursor-pointer
          hover:text-foreground transition-colors
          ${compact ? "w-16" : "w-auto"}
        `}
      >
        {locales.map((loc) => (
          <option
            key={loc}
            value={loc}
            className="bg-card text-foreground"
          >
            {compact ? loc.toUpperCase() : localeNames[loc]}
          </option>
        ))}
      </select>
    </div>
  );
}
