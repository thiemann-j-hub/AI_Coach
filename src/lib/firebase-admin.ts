import "server-only";

import { App, applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { Firestore, getFirestore } from "firebase-admin/firestore";

type AdminCache = { app?: App; db?: Firestore };

// eslint-disable-next-line no-var
declare global {
  // Prevent re-init across hot reloads
  var __firebaseAdmin: AdminCache | undefined;
}

function getProjectId(): string {
  const pid =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT;

  if (!pid) {
    throw new Error(
      "Missing Firebase project id. Set FIREBASE_PROJECT_ID (recommended) or NEXT_PUBLIC_FIREBASE_PROJECT_ID."
    );
  }
  return pid;
}

function getCredential() {
  const json = (process.env.SERVICE_ACCOUNT_JSON ?? process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (json && json.trim()) {
    try {
      const parsed = JSON.parse(json);
      return cert(parsed);
    } catch {
      throw new Error("SERVICE_ACCOUNT_JSON (or FIREBASE_SERVICE_ACCOUNT_JSON) is not valid JSON.");
    }
  }

  // Uses GOOGLE_APPLICATION_CREDENTIALS (file path) or Workstation ADC/metadata if available
  return applicationDefault();
}

export function getAdminApp(): App {
  if (global.__firebaseAdmin?.app) return global.__firebaseAdmin.app;

  const existing = getApps();
  const app =
    existing.length > 0
      ? existing[0]
      : initializeApp({
          credential: getCredential(),
          projectId: getProjectId(),
        });

  global.__firebaseAdmin = { ...(global.__firebaseAdmin ?? {}), app };
  return app;
}

export function getAdminDb(): Firestore {
  if (global.__firebaseAdmin?.db) return global.__firebaseAdmin.db;

  const db = getFirestore(getAdminApp());
  db.settings({ ignoreUndefinedProperties: true });

  global.__firebaseAdmin = { ...(global.__firebaseAdmin ?? {}), db };
  return db;
}
