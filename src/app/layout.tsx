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

const sans = Inter({ subsets: ["latin"], variable: "--font-geist-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "Pulscraft AI · Coach",
  description: "AI-powered communication coaching.",
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

  return (
    <html
      lang={localeBcp47[locale]}
      // dark-first: die .dark-Klasse serverseitig setzen, damit KEINE helle
      // Erstdarstellung (FOUC) entsteht, bevor next-themes clientseitig greift —
      // betraf v.a. den ausgeloggten Login als ersten Kalt-Load. next-themes
      // (defaultTheme=dark) haelt dunkel bzw. wechselt auf eine gespeicherte
      // Light-Praeferenz; suppressHydrationWarning deckt den Klassen-Abgleich.
      className={`${sans.variable} ${mono.variable} dark`}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased bg-background text-foreground transition-colors duration-300">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-white focus:rounded-lg focus:text-sm focus:font-medium"
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
            {children}
            <Toaster />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

