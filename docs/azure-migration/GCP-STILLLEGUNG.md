# GCP-Stilllegung nach Azure-Migration (User-Aktionen)

Die App läuft vollständig auf Azure (https://pulsecraft-coach.azurewebsites.net). Der Code
enthält keine Firebase-Abhängigkeit mehr. Die folgenden Schritte in der **Google-Cloud-/
Firebase-Konsole** kann nur der Projekt-Owner ausführen — bewusst **nicht** automatisiert,
weil sie laufende Dienste abschalten und Daten betreffen.

## Reihenfolge (empfohlen)

### 1. Firestore-Daten als Backup behalten — NICHT sofort löschen
- Die migrierten Daten (1 User, 3 Sessions, 4 Runs) liegen jetzt in Cosmos.
- **Empfehlung:** Firestore-Datenbank ~30 Tage unangetastet als Rückfall-Backup stehen lassen.
- Optional vorher ein Export nach Cloud Storage: Firebase-Konsole → Firestore → Import/Export
  → „Export" (oder `gcloud firestore export gs://<bucket>`).

### 2. App Hosting / Hosting-Backend stilllegen
- Firebase-Konsole → **App Hosting** (bzw. Hosting) → das Backend der Coach-App.
- Rollouts/Auto-Deploy vom GitHub-`main` deaktivieren oder Backend löschen.
- Damit triggert kein Push mehr ein Firebase-Deployment (der alte README-Hinweis
  „Push to main → deploy" gilt nicht mehr).

### 3. Firebase Authentication
- Firebase-Konsole → **Authentication** → Sign-in-Methoden.
- E-Mail/Passwort + Google-Provider deaktivieren (Login läuft jetzt über Microsoft Entra ID).
- User-Accounts erst nach der Backup-Frist löschen.

### 4. Service-Account-Key rotieren/entfernen (Sicherheit)
- Der Admin-Key liegt lokal unter `workspace/firebase-admin-sa.json` (war für das einmalige
  Migrations-Skript nötig). Er ist gitignored, aber als Geheimnis zu behandeln.
- GCP-Konsole → IAM & Verwaltung → Dienstkonten → den Key **rotieren/widerrufen**.
- Lokale Dateien danach löschen: `workspace/firebase-admin-sa.json` + `.oneline.json`.

### 5. Gemini-API-Key — NICHT anfassen
- Gemini bleibt das LLM (bewusste Entscheidung). Der `GEMINI_API_KEY` (Google AI Studio /
  Vertex) wird weiterhin gebraucht — liegt jetzt im Azure Key Vault `coach-kv-20f84`.

### 6. Pinecone — NICHT anfassen
- RAG bleibt auf Pinecone (Index in gcp-europe-west4 = EU). `PINECONE_API_KEY` im Key Vault.

### 7. Aufräumen (optional, nach Backup-Frist)
- Firestore-Datenbank löschen, ungenutzte Firebase-Projekt-Ressourcen entfernen,
  ggf. das Firebase-Projekt selbst stilllegen, falls es nur diese App hostete.

## Was bereits erledigt ist (Code-Seite, Azure)
- ✅ Auth: Microsoft Entra ID (NextAuth v5)
- ✅ Daten: Cosmos DB `coach`
- ✅ Hosting: App Service `pulsecraft-coach`
- ✅ Secrets: Azure Key Vault + Managed Identity
- ✅ Firebase-Code/-Config vollständig entfernt
- ✅ Bestandsdaten migriert + verifiziert

## DSGVO-Restpunkte (Folgeschritt M7, separat)
- Gemini (Google) verarbeitet Transkript-Inhalte — Transkripte werden client-seitig
  anonymisiert (Privacy-Mode default-on). Vollständige EU-Verarbeitung erst mit M7
  (Azure OpenAI `gpt-41-mini-prod` ist bereits provisioniert).
- Pinecone: Index in EU, Anbieter US — optional M7 (Cosmos-Vektorindex).
