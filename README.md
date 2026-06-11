# PulseCraft AI Coach

KI-Gesprächs-Coach: analysiert Gesprächstranskripte (Gemini + RAG via Pinecone),
liefert strukturiertes Coaching-Feedback (Stärken, Verbesserungen, Rewrites,
Risiken, Kompetenz-Scores) und generiert optional LinkedIn-Posts.

**Stack:** Next.js 15 (App Router, `output: standalone`, Node 22) ·
NextAuth v5 + Microsoft Entra ID · Azure Cosmos DB · Gemini (Genkit) · Pinecone ·
Azure App Service (West Europe).

## Lokale Entwicklung

1. `cp .env.example .env.local` und Werte eintragen (Entra-App, Cosmos, Gemini, Pinecone).
2. `npm install`
3. `npm run dev` → http://localhost:9002

`npm run typecheck` und `npm run build` müssen vor jedem Merge grün sein.

## Deployment (Azure App Service)

Die App läuft als Web-App `pulsecraft-coach` (Resource Group `pulsecraft-prod-rg`,
Plan `pulsecraft-prod-plan`). Secrets liegen im Key Vault `coach-kv-*` und werden
über App-Setting-Referenzen aufgelöst.

```bash
az login
node scripts/deploy-azure.mjs        # Build + ZIP + az webapp deploy
node scripts/deploy-azure.mjs --package   # nur Paket bauen (Smoke-Test)
```

Verifikation nach dem Deploy: Checkliste M5 in
[docs/azure-migration/PLAN.md](docs/azure-migration/PLAN.md).

## Architektur-Notizen

- **Auth:** NextAuth v5, Session als JWT im HTTP-only-Cookie; API-Routen prüfen
  über `requireAuth()` (`src/lib/api-auth.ts`).
- **Daten:** Cosmos DB `coach` — Container `users` (pk `/id`), `sessions` (pk `/id`),
  `runs` (pk `/sessionId`). Zugriff ausschließlich serverseitig (`src/lib/cosmos.ts`).
- **LLM:** Gemini via Genkit (`src/ai/`) — Wechsel auf Azure OpenAI ist als
  separater Schritt M7 geplant.
- **Migrationshistorie:** [docs/azure-migration/PLAN.md](docs/azure-migration/PLAN.md)
  (Firebase → Azure, inkl. einmaligem Datenexport-Skript unter `scripts/`).
