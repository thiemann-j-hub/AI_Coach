# Einheitliches Anmeldefenster für alle Apps – Komplette Anleitung

Diese Vorlage reproduziert das Anmeldefenster der **AI Jobmap Moderator**-App
(helles Design: Navbar mit Logo, zentrierter Hero mit Icon-Badge, Titel,
Untertitel, Beschreibung, dunkler Anmelde-Button mit Provider-Logo,
3 Feature-Karten auf grauem Band, Footer) als wiederverwendbare
React-Komponente. Alle Texte sind pro App über ein einziges Config-Objekt
austauschbar – der Look bleibt überall identisch.

---

## 1. Voraussetzungen

Die Ziel-App braucht:

| Abhängigkeit | Version | Zweck |
|---|---|---|
| React | 18+ | Komponente |
| TailwindCSS | 3+ | Styling (nur Standard-Klassen, keine eigenen Tokens nötig) |
| lucide-react | beliebig aktuell | Feature- und Pfeil-Icons |

Falls `lucide-react` fehlt:

```bash
npm install lucide-react
```

Die Komponente funktioniert in **Next.js (App Router & Pages Router), Vite
und CRA** gleichermaßen – sie hat keine Framework-Abhängigkeiten außer React.
Die `"use client"`-Direktive in Zeile 1 ist nur für Next.js App Router
relevant und stört anderswo nicht.

---

## 2. Installation (pro App, ~2 Minuten)

1. **Datei kopieren:** `login-landing.tsx` nach `src/components/login-landing.tsx`
   der Ziel-App kopieren.
2. **Login-Seite anlegen** (Beispiel Next.js App Router, `src/app/page.tsx`):

```tsx
"use client";

import { LoginLanding, type LoginLandingConfig } from "@/components/login-landing";
import { FileText, Users, Shield } from "lucide-react";

// ── HIER die app-spezifischen Texte pflegen ──────────────────────
const config: LoginLandingConfig = {
  appName: "AI Jobmap",
  title: "AI Jobmap Moderator",
  subtitle: "Strukturierter Wissenstransfer mit KI-Unterstützung",
  description:
    "Erfassen, strukturieren und sichern Sie kritisches Rollenwissen, " +
    "bevor es verloren geht. Der KI-Moderator führt strukturierte Interviews " +
    "und erstellt automatisch Wissenskarten, Stakeholder-Maps und Übergabe-Playbooks.",
  signInLabel: "Mit Microsoft anmelden",
  provider: "microsoft", // "microsoft" | "google" | "none"
  features: [
    {
      icon: FileText,
      title: "Wissenskarten",
      description:
        "KI-gestützte Interviews erfassen und strukturieren Expertenwissen " +
        "automatisch in durchsuchbare Wissenskarten.",
    },
    {
      icon: Users,
      title: "Stakeholder-Mapping",
      description:
        "Automatische Erkennung und Visualisierung von Stakeholder-Netzwerken " +
        "und Beziehungen.",
    },
    {
      icon: Shield,
      title: "DSGVO-konform",
      description:
        "Datenschutzkonformer Umgang mit sensiblen Informationen durch " +
        "integrierte Klassifizierung und Pseudonymisierung.",
    },
  ],
  footer: "© 2026 AI Jobmap Moderator",
};

export default function LoginPage() {
  return <LoginLanding config={config} onSignIn={handleSignIn} />;
}

async function handleSignIn() {
  // → Auth-Anbindung: siehe Abschnitt 4
}
```

Das war's – mehr ist pro App nicht nötig. Nur das `config`-Objekt und
`handleSignIn` unterscheiden sich.

---

## 3. Texte pro App anpassen

Jede App bekommt ihr eigenes `config`-Objekt. Welche Felder was steuern:

| Feld | Erscheint wo | Beispiel Jobmap |
|---|---|---|
| `appName` | Navbar oben links | „AI Jobmap" |
| `title` | Große Überschrift | „AI Jobmap Moderator" |
| `subtitle` | Zeile unter dem Titel | „Strukturierter Wissenstransfer…" |
| `description` | Absatz unter dem Untertitel | 2–4 Sätze |
| `signInLabel` | Button-Text | „Mit Microsoft anmelden" |
| `provider` | Logo im Button | `"microsoft"`, `"google"` oder `"none"` |
| `features` | Die 3 Karten unten | Icon + Titel + Beschreibung |
| `footer` | Fußzeile | „© 2026 AI Jobmap Moderator" |
| `logo` (optional) | Navbar + Hero-Badge | eigenes SVG/`<img>`; ohne Angabe wird das Icon des ersten Features verwendet |

**Beispiel für eine zweite App** („Skill Radar"):

```tsx
const config: LoginLandingConfig = {
  appName: "Skill Radar",
  title: "Skill Radar",
  subtitle: "Kompetenzen sichtbar machen mit KI",
  description:
    "Analysieren Sie Team-Kompetenzen, erkennen Sie Lücken und planen Sie " +
    "Entwicklungspfade – automatisch aufbereitet und jederzeit aktuell.",
  signInLabel: "Mit Microsoft anmelden",
  provider: "microsoft",
  features: [
    { icon: Radar,        title: "Kompetenz-Radar", description: "…" },
    { icon: TrendingUp,   title: "Gap-Analyse",     description: "…" },
    { icon: GraduationCap,title: "Lernpfade",       description: "…" },
  ],
  footer: "© 2026 Skill Radar",
};
```

> **Tipp Mehrsprachigkeit:** Nutzt die App `next-intl` (wie der Jobmap
> Moderator), die Texte einfach aus den Messages ziehen statt hart zu
> kodieren: `title: t("landing.title")` usw. Die Komponente selbst bleibt
> unverändert.

---

## 4. Anmeldung anbinden (`onSignIn`)

Die Komponente ist bewusst auth-agnostisch: Sie ruft nur `onSignIn` auf und
zeigt währenddessen einen Spinner. Drei gängige Anbindungen:

### Variante A – Microsoft Entra ID mit MSAL (wie die Azure-App)

```bash
npm install @azure/msal-browser
```

```tsx
import { PublicClientApplication } from "@azure/msal-browser";

const msal = new PublicClientApplication({
  auth: {
    clientId: process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID!,
    authority: `https://login.microsoftonline.com/${process.env.NEXT_PUBLIC_AZURE_AD_TENANT_ID}`,
    redirectUri: "/",
  },
});

async function handleSignIn() {
  await msal.initialize();
  await msal.loginRedirect({ scopes: ["openid", "profile", "email"] });
}
```

### Variante B – Firebase Auth (wie dieses Repository)

Funktioniert mit Google **und** Microsoft (Firebase unterstützt Entra ID
über `OAuthProvider`):

```tsx
import { signInWithPopup, GoogleAuthProvider, OAuthProvider } from "firebase/auth";
import { auth } from "@/lib/firebase/client";

// Google:
async function handleSignIn() {
  await signInWithPopup(auth, new GoogleAuthProvider());
}

// Oder Microsoft:
async function handleSignIn() {
  const provider = new OAuthProvider("microsoft.com");
  provider.setCustomParameters({ tenant: "DEINE_TENANT_ID" });
  await signInWithPopup(auth, provider);
}
```

> In der Firebase-Konsole unter *Authentication → Sign-in method* den
> jeweiligen Provider aktivieren (für Microsoft: Client-ID/Secret einer
> Entra-ID-App-Registrierung hinterlegen).

### Variante C – NextAuth / Auth.js

```tsx
import { signIn } from "next-auth/react";

async function handleSignIn() {
  await signIn("azure-ad", { callbackUrl: "/dashboard" });
}
```

### Weiterleitung nach erfolgreicher Anmeldung

Eingeloggt → direkt ins Dashboard (Muster aus dem Jobmap Moderator):

```tsx
const { user, loading } = useAuth(); // bzw. MSAL-/NextAuth-Äquivalent
const router = useRouter();

useEffect(() => {
  if (!loading && user) router.replace("/dashboard");
}, [loading, user, router]);

if (loading) return <LoadingScreen />;
if (user) return null;
return <LoginLanding config={config} onSignIn={handleSignIn} />;
```

---

## 5. Design anpassen (optional, eine Stelle)

Der Look soll überall identisch bleiben – falls eine App doch eine eigene
Akzentfarbe braucht, gibt es genau **eine** Stelle: die Button-Klassen in
`login-landing.tsx` (`bg-slate-900 … hover:bg-slate-800`). Alles andere
(Grautöne, Abstände, Typografie) bewusst nicht anfassen, damit die Apps
einheitlich wirken.

---

## 6. Checkliste pro App

- [ ] `login-landing.tsx` nach `src/components/` kopiert
- [ ] `lucide-react` installiert
- [ ] `config`-Objekt mit app-spezifischen Texten gefüllt (Abschnitt 3)
- [ ] 3 passende Feature-Icons aus [lucide.dev](https://lucide.dev) gewählt
- [ ] `onSignIn` mit dem Auth-Flow der App verbunden (Abschnitt 4)
- [ ] Redirect für bereits angemeldete Nutzer eingebaut
- [ ] Im Browser geprüft: Desktop + Mobil (Karten stapeln sich unter `sm`)

---

## Hinweis zur Quelle

Die Vorlage wurde 1:1 nach dem Live-Anmeldefenster von
`jobmap-app.azurewebsites.net` nachgebaut. Der dort deployte Code (Variante
mit „Mit Microsoft anmelden") liegt **nicht** in diesem Repository – dieses
Repo enthält die Schwester-Variante mit Google-Login und dunklem Theme
(`src/app/page.tsx`). Falls das Original-Repo der Azure-App verfügbar ist,
kann die dortige Implementierung direkt mit dieser Vorlage abgeglichen werden.
