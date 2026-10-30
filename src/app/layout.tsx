import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from "@/providers/auth-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { STORAGE_KEY_THEME } from "@/lib/storage-keys";
import { locales, defaultLocale, localeBcp47, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
// Chatbot Blueprint Teil C, SSOT pulsenorth-ops/chat-widget-kit,
// ruft /api/chat root-absolut = Hub-Catch-all
import ChatWidget from "@/components/chatbot/ChatWidget";
// Lernenden-Sicht S5 (Owner-GO 06.10.2026): ohne Häkchen „KI-Coach" eine klare Seite statt der App.
import { coachNotEnabled } from "@/lib/server/coach-access";
import { NoAccess } from "@/components/app/no-access";

const sans = Inter({ subsets: ["latin", "latin-ext", "cyrillic", "greek"], variable: "--font-geist-sans" });
const mono = JetBrains_Mono({ subsets: ["latin", "latin-ext", "cyrillic", "greek"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "PulseNorth.AI · Coach",
  description: "AI-powered communication coaching.",
  // O4 Bündel-Frische: Build-SHA steht mit dem Dokument fest — der VersionWatcher
  // vergleicht sie mit public/build-info.json (nicht mit einer Chunk-Konstante).
  other: { "build-sha": (process.env.NEXT_PUBLIC_BUILD_SHA ?? "").slice(0, 7) || "dev" },
};

function resolveLocale(value: string | undefined): Locale | null {
  return value && locales.includes(value as Locale) ? (value as Locale) : null;
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Locale wie in der Middleware: NEXT_LOCALE, sonst Default.
  const cookieStore = await cookies();
  const locale =
    resolveLocale(cookieStore.get("NEXT_LOCALE")?.value) ?? defaultLocale;
  const t = getDictionary(locale);
  // S5: Dieselbe Entscheidung wie das Tor der API (requireAuth → APP_NOT_ENABLED). Ohne Sitzung
  // oder bei anderen Ablehnungen bleibt alles wie bisher (Anmeldung, Sperre, Störung).
  const denied = await coachNotEnabled();
  // W5-9 (20.10.2026): Wer kann Zugang geben? Nur gelesen, wenn die Seite „kein Zugang“ erscheint.
  let admins: Array<{ oid: string; name: string | null; email: string | null }> = [];
  let istAdmin = false;
  if (denied) {
    try {
      const { auth } = await import("@/auth");
      const oid = ((await auth())?.user as { oid?: string } | undefined)?.oid;
      if (oid) {
        const { getCentralMemberInfo } = await import("@/lib/server/credits/member-info");
        const info = await getCentralMemberInfo(oid);
        admins = info?.admins ?? [];
        istAdmin = info?.role === "admin" && !info.disabled;
      }
    } catch { /* fail-soft: Seite ohne Namen */ }
  }

  return (
    <html
      lang={localeBcp47[locale]}
      // dark-first: die .dark-Klasse serverseitig setzen, damit KEINE helle
      // Erstdarstellung (FOUC) entsteht, bevor next-themes clientseitig greift —
      // betraf v.a. den ausgeloggten Login als ersten Kalt-Load. next-themes
      // (defaultTheme=dark) haelt dunkel bzw. wechselt auf eine gespeicherte
      // Light-Praeferenz; suppressHydrationWarning deckt den Klassen-Abgleich.
      // Farbwelt „Klar“ (Owner-GO 30.10.2026): pn-klar schaltet die Farben in globals.css um. Rückweg DESIGN_KLAR=off.
      className={`${sans.variable} ${mono.variable} dark${(process.env.DESIGN_KLAR ?? "on").trim().toLowerCase() !== "off" ? " pn-klar" : ""}`}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased bg-background text-foreground transition-colors duration-300">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-lg focus:text-sm focus:font-medium"
        >
          {t.common.skipToContent}
        </a>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          storageKey={STORAGE_KEY_THEME}
          disableTransitionOnChange
        >
          <AuthProvider>
            {denied ? <NoAccess texts={t.noAccess} admins={admins} istAdmin={istAdmin} /> : children}
            <ChatWidget surface="coach" lang={locale === "de" ? "de" : "en"} />
            <Toaster />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

