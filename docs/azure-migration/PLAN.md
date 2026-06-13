# Azure-Migration: PulseCraft AI Gesprächs-Coach

**Ziel:** DSGVO-Konformität / Akzeptanz in Deutschland — Auth, Daten und Hosting in die EU
(Azure West Europe), Microsoft-AVV. **Das LLM bleibt zunächst Gemini** (bewusste Entscheidung,
späterer Schritt). Grundlage: Playbook der bereits verifizierten Jobmap-Migration
([playbook-jobmap-referenz.pdf](playbook-jobmap-referenz.pdf)) auf derselben Azure-Basis.

## Zielarchitektur (Mapping für DIESE App)

| Schicht | Vorher (Firebase) | Nachher (Azure) |
|---|---|---|
| Auth (Client) | Firebase Auth (E-Mail/Passwort, LoginModal) | NextAuth v5, `signIn("microsoft-entra-id")` |
| Auth (Server) | `requireAuth` (Bearer-ID-Token, 8 Routen) | `verifyAuth` aus NextAuth-Session (HTTP-only-Cookie), **gleiche Rückgabeform `{uid, email}`** |
| DB | Firestore `sessions/{sid}/runs`, `users/{uid}` | Cosmos DB `coach`: Container `users` (pk `/id`), `sessions` (pk `/id`), `runs` (pk `/sessionId`) |
| LinkedIn-Token | `users/{uid}/integrations/linkedin` (Subcollection) | eingebettetes Feld `linkedin` im `users`-Dokument (server-only) |
| LLM | Gemini via Genkit | **unverändert Gemini** (`GEMINI_API_KEY` → Key Vault) |
| RAG | Pinecone (Index in gcp-europe-west4 = EU) | **vorerst unverändert Pinecone**; optional später Cosmos-Vektor (erfordert Re-Embedding) |
| Secrets | apphosting.yaml / Cloud Secret Manager | Azure Key Vault + System-Managed-Identity + KV-Referenzen |
| Hosting | Firebase App Hosting | App Service `pulsecraft-coach` (geteilter Plan B2, Node 22, `output: standalone`, ZIP-Deploy) |
| Rules | firestore.rules | entfallen — DB-Zugriff ausschließlich serverseitig (Cosmos-Key in KV) |

**Geteilte Basis (existiert, verifiziert):** `pulsecraft-prod-rg`, `pulsecraft-prod-plan` (B2 Linux),
`pulsecraft-prod-cosmos`, `pulsecraft-prod-openai`. **Neu für diese App:** Entra-App „PulseCraft Coach",
Web-App `pulsecraft-coach`, Cosmos-DB `coach`, Key Vault `coach-kv-*`.
`pulsecraft-app` ist durch den separaten „LinkedIn Post Generator" belegt — nicht anfassen.

## Phasen

- **M0 — Code-Vorbereitung** (kein Azure nötig): `output: "standalone"` in next.config; Node-Engine 20→22;
  `__session`-Locale-Fallback aus middleware/locale-cookie/layout entfernen (Gotcha 17 — auf Azure obsolet
  UND schädlich); Inventur der 8 `requireAuth`-Routen + AuthProvider-Konsumenten.
- **M1 — Provisionierung** (az CLI): Entra-App (Audience `AzureADandPersonalMicrosoftAccount`!,
  Redirect-URIs prod + `http://localhost:9002/...`), Key Vault, Web-App auf Plan, Managed Identity +
  KV-Policy, Cosmos-DB `coach` + 3 Container. Secrets (AUTH_SECRET, Entra-Secret, Cosmos-Key,
  GEMINI_API_KEY, PINECONE_API_KEY, LINKEDIN_*) in KV; App-Settings als KV-Referenzen
  (+ `AUTH_TRUST_HOST=true`, exakte `AUTH_URL`, `PORT=8080`, `WEBSITE_RUN_FROM_PACKAGE=1`,
  `ENABLE_ORYX_BUILD=false`).
- **M2 — Auth-Migration**: NextAuth v5 (`auth.ts`, Route-Handler `/api/auth/[...nextauth]`);
  `verifyAuth`-Shim ersetzt `requireAuth` (gleiche Signatur, Profil pro Anfrage frisch aus Cosmos);
  AuthProvider/`useAuth`-Shim als Context — **alle Funktionen `useCallback`, Value `useMemo`**
  (Gotcha 3: Endlos-Refetch); LoginModal → Microsoft-Login; `authFetch`: Bearer raus, Cookie-Auth
  (`credentials: "same-origin"`), `x-locale`-Header bleibt (Gotcha 15: Bearer-Leftovers suchen!).
- **M3 — Daten-Migration**: `lib/cosmos.ts` (readItem/queryItems/upsertItem/deleteItem);
  Routen `runs/save|list|get|rate`, `linkedin-connection`, Profil-/Language-Sync auf Cosmos;
  Cursor-Pagination via `ORDER BY c.createdAt DESC` + Continuation/OFFSET;
  Export-Skript Firestore→Cosmos mit **UID-Mapping** (Firebase-UID ≠ Entra-ID; Mapping-Tabelle
  alte→neue uid beim ersten Login bzw. manuell für den Bestandsnutzer).
- **M4 — Build & Deploy**: standalone-Build (Projekt liegt bereits außerhalb OneDrive ✅),
  `static` + `public` ins standalone-Verzeichnis kopieren (Gotcha 12), ZIP, `az webapp deploy`.
- **M5 — Verifikation** (Playbook Phase 7, angepasst): Landing 200; signin 302 → korrekte
  authorize-URL; interaktiver MS-Login (persönliches Konto!); Analyse-Run end-to-end (Gemini-Call!);
  Runs-Liste; Rating; 401 ohne Session; KV-Auflösung; `az webapp log tail` sauber.
- **M6 — Firebase-Rückbau** ✅: `firebase`-Client-SDK + `src/lib/firebase-admin.ts` (toter Code,
  0 Importer) entfernt; Config gelöscht (.firebaserc, firebase.json, firestore.rules,
  firestore.indexes.json, apphosting.yaml); .env.example auf Azure umgestellt; irreführende
  „Firestore"-Kommentare → Cosmos. `firebase-admin` bleibt nur transitiv über @genkit-ai/firebase
  (ungenutzt, kann nicht weg ohne Genkit/Gemini). GCP-Konsolen-Schritte: siehe
  [GCP-STILLLEGUNG.md](GCP-STILLLEGUNG.md). Verifiziert: tsc 0, 0 firebase-Source-Imports,
  firebase-admin nicht im standalone-Trace, Deploy RuntimeSuccessful, alle APIs 401 ohne Session,
  /__/firebase/init.json → 404, Log sauber.
- **M7 (später, separat)** — LLM → Azure OpenAI (`gpt-41-mini-prod` existiert schon) und optional
  Pinecone → Cosmos-Vektorindex. Bewusst NICHT Teil dieser Migration.

## Wichtigste Gotchas aus dem Playbook (für diese App relevant)

1. ~~OneDrive-Build~~ ✅ bereits gelöst (Projekt liegt in `C:\dev\AI_Coach`)
2. Entra-Audience MUSS `AzureADandPersonalMicrosoftAccount` sein (sonst keine @outlook.de-Logins)
3. `AUTH_TRUST_HOST=true` + exakte `AUTH_URL` (sonst UntrustedHost/redirect_uri-Mismatch)
4. useAuth-Shim: useCallback/useMemo-Disziplin (sonst Endlos-Refetch in allen authFetch-Konsumenten)
5. Bearer-Leftovers: jede Stelle finden, die noch `Authorization: Bearer` erwartet/sendet
6. `__session`-Cookie-Logik entfernen (überschreibt sonst NEXT_LOCALE)
7. Cosmos: kein arrayUnion, keine Kaskaden-Löschung, PK nicht per upsert änderbar
8. Zod-Validierung NACH Auth (401 vor 400) — ist bei uns bereits so
9. `output: standalone` + static/public kopieren beim ZIP-Deploy
10. Profil pro Anfrage frisch aus Cosmos lesen (nicht dem JWT vertrauen)

## Konkrete Werte (provisioniert 2026-06-10, M1 — keine Secrets)

| Ressource | Wert |
|---|---|
| Entra-App „PulseCraft Coach" | clientId `2b24d264-1643-4b12-846b-f1a9e1554e9f`, Audience `AzureADandPersonalMicrosoftAccount`, Tenant `common` |
| Redirect-URIs | `https://pulsecraft-coach.azurewebsites.net/api/auth/callback/microsoft-entra-id` + `http://localhost:9002/...` |
| Web-App | `pulsecraft-coach` → https://pulsecraft-coach.azurewebsites.net (Node 22, geteilter Plan `pulsecraft-prod-plan`) |
| Key Vault | `coach-kv-20f84` — 7 Secrets (AUTH-SECRET, ENTRA-CLIENT-SECRET, COSMOS-KEY, GEMINI-API-KEY, PINECONE-API-KEY, LINKEDIN-CLIENT-ID/-SECRET), alle App-Setting-Referenzen Status „Resolved" |
| Cosmos | Account `pulsecraft-prod-cosmos` (West Europe), DB `coach` (Shared 400 RU), Container `users` (/id), `sessions` (/id), `runs` (/sessionId) |
| App-Settings | 23 gesetzt, inkl. `AUTH_TRUST_HOST=true`, exakte `AUTH_URL`, `PORT=8080`, `WEBSITE_RUN_FROM_PACKAGE=1`, `GEMINI_TEXT_MODEL=gemini-2.5-flash` |

## DSGVO-Bilanz nach Migration

- ✅ Auth, Nutzerdaten, Transkripte, Hosting: Azure West Europe (EU), Microsoft-AVV
- ✅ Kein Google-Auth/Firestore/Firebase-Hosting mehr
- ⚠️ Bewusst offen: Gemini-API (Google, Datenverarbeitung außerhalb EU möglich) — Folgeschritt M7;
  bis dahin: Transkripte werden client-seitig anonymisiert (Privacy-Mode ist default-on)
- ⚠️ Pinecone: Index liegt in EU (gcp-europe-west4), Anbieter US — Folgeschritt M7 optional
