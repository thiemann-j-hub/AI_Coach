// src/app/api/users/profile/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { readItem, upsertItem, usersContainer } from "@/lib/cosmos";
import { getRequestLocale, getApiMessages } from "@/lib/server/get-request-locale";
import { locales } from "@/i18n/config";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type UserProfileDoc = {
  id: string; // = uid (= OIDC sub, Partition Key)
  email: string;
  displayName: string;
  language?: string;
  /** App-uebergreifend stabile Entra Object-ID (sub != oid). Quelle fuer das
   *  sub->oid-Mapping der CreditService-Migration; beim Login erfasst/nachgetragen. */
  entraOid?: string;
  createdAt: string;
  updatedAt: string;
  // linkedin?: { ... } — von linkedin-connection.ts verwaltet, hier nie zurückgegeben
};

function publicProfile(doc: UserProfileDoc) {
  return {
    uid: doc.id,
    email: doc.email,
    displayName: doc.displayName,
    language: doc.language ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * GET: Frisches Profil aus Cosmos (Playbook Gotcha 4: nicht dem JWT vertrauen).
 * Selbst-Provisionierung beim ersten Login ist hier GEWOLLT — die App ist ein
 * offenes Produkt ohne Einladungs-Flow (bewusste Abweichung von Gotcha 5).
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const { uid, email, oid } = authResult;

  const rl = checkRateLimit(rateLimitKey(req, "profile-get"), 30, 60_000);
  if (rl) return rl;

  try {
    let doc = await readItem<UserProfileDoc>(usersContainer(), uid, uid);

    if (!doc) {
      const now = new Date().toISOString();
      doc = {
        id: uid,
        email: email ?? "",
        displayName: email?.split("@")[0] ?? "",
        language: getRequestLocale(req),
        ...(oid ? { entraOid: oid } : {}),
        createdAt: now,
        updatedAt: now,
      };
      await upsertItem(usersContainer(), doc);
      logger.api("/api/users/profile", "provisioned", { uid });
    } else if (oid && doc.entraOid !== oid) {
      // Backfill: vorhandenes Profil bekommt die Entra-oid nachgetragen, damit
      // die CreditService-Migration spaeter sub->oid aufloesen kann.
      doc = { ...doc, entraOid: oid, updatedAt: new Date().toISOString() };
      await upsertItem(usersContainer(), doc);
    }

    return NextResponse.json({ ok: true, profile: publicProfile(doc) });
  } catch (err: any) {
    logger.apiError("/api/users/profile", err);
    return NextResponse.json(
      { ok: false, error: getApiMessages(req).internalError, code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}

const patchSchema = z.object({
  language: z.enum(locales).optional(),
  displayName: z.string().min(1).max(200).optional(),
});

/** PATCH: language/displayName aktualisieren (Read-Modify-Upsert, Cosmos hat kein merge). */
export async function PATCH(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;
  const { uid, email } = authResult;

  const rl = checkRateLimit(rateLimitKey(req, "profile-patch"), 20, 60_000);
  if (rl) return rl;

  try {
    const json = await req.json().catch(() => null);
    const parsed = patchSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const existing = await readItem<UserProfileDoc>(usersContainer(), uid, uid);
    const doc: UserProfileDoc = {
      ...(existing ?? {
        id: uid,
        email: email ?? "",
        displayName: email?.split("@")[0] ?? "",
        createdAt: now,
        updatedAt: now,
      }),
      ...(parsed.data.language ? { language: parsed.data.language } : {}),
      ...(parsed.data.displayName ? { displayName: parsed.data.displayName } : {}),
      updatedAt: now,
    };
    await upsertItem(usersContainer(), doc);

    return NextResponse.json({ ok: true, profile: publicProfile(doc) });
  } catch (err: any) {
    logger.apiError("/api/users/profile", err);
    return NextResponse.json(
      { ok: false, error: getApiMessages(req).internalError, code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
