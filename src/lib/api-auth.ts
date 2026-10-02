import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getApiMessages } from "./server/get-request-locale";
import { isMagicLinkOid } from "./magic-link-oid";
import { requireValidLoginEnabled } from "./server/credits/login-gate";
import { isPnMemberId, pnAccountsEnabled } from "./server/credits/cs-credential";

/**
 * Auth-Helfer für API-Routen — NextAuth-Session (HTTP-only-Cookie) statt
 * Firebase-Bearer-Token. Vertragsform bewusst identisch zum früheren
 * Firebase-Helfer ({ uid, email } | 401-Response), damit die Routen
 * unverändert bleiben (Playbook-Leitprinzip „Vertragstreue").
 */
export async function verifyAuthToken(_req: NextRequest | Request) {
  const session = await auth();
  const uid = (session?.user as { id?: string } | undefined)?.id;
  if (!uid) return null;
  return {
    uid,
    email: session?.user?.email ?? null,
    // App-uebergreifend stabile Entra Object-ID = Schluessel in den Server-Token-Store
    // (entra-token-store). Das Access-Token liegt NICHT mehr in der Session.
    // PulseNorth-Konto (Anmeldung ohne Microsoft): uid und oid sind die Kennung "ml:…".
    oid: (session?.user as { oid?: string } | undefined)?.oid ?? null,
  };
}

/**
 * Returns a 401 JSON response for unauthenticated requests.
 */
export function unauthorizedResponse(message = "Authentication required") {
  return NextResponse.json(
    { ok: false, error: message, code: "UNAUTHORIZED" },
    { status: 401 }
  );
}

/**
 * 401 „Sitzung abgelaufen". Code CENTRAL_REAUTH = derselbe, den die Analyse seit jeher
 * fuer ein totes Token sendet — die Oberflaeche zeigt dazu „Neu anmelden".
 */
export function loginRequiredResponse(req: NextRequest | Request) {
  return NextResponse.json(
    { ok: false, error: getApiMessages(req).sessionExpired, code: "CENTRAL_REAUTH" },
    { status: 401 }
  );
}

/**
 * Antworten des Tors für PulseNorth-Konten. Wortlaut und Code wie für Microsoft-Konten
 * (unten in requireAuth) — ein PulseNorth-Konto ohne Freigabe sieht dasselbe.
 */
function appNotEnabledResponse() {
  return NextResponse.json(
    { ok: false, error: "Der KI-Coach ist für dieses Konto nicht freigeschaltet. Wende dich an deine:n Admin.", code: "APP_NOT_ENABLED" },
    { status: 403 }
  );
}

function accountDisabledResponse() {
  return NextResponse.json(
    { ok: false, error: "Dieses Konto wurde deaktiviert. Wende dich an deine:n Admin.", code: "ACCOUNT_DISABLED" },
    { status: 403 }
  );
}

/**
 * 503, wenn das Register für ein PulseNorth-Konto gerade keine Auskunft gibt. Code und
 * Wortlaut wie beim Guthaben-Tor (entitlement.ts) — die Oberfläche kennt beides.
 */
function registerUnavailableResponse() {
  return NextResponse.json(
    { ok: false, code: "CENTRAL_UNAVAILABLE", error: "Guthaben-Dienst nicht erreichbar. Bitte erneut versuchen." },
    { status: 503 }
  );
}

/**
 * Convenience: verify session and return uid, or send 401.
 * Usage in API routes:
 *   const auth = await requireAuth(req);
 *   if (auth instanceof NextResponse) return auth;
 *   const { uid } = auth;
 *
 * `allowExpiredLogin`: nur fuer /api/credits — die Route meldet der Oberflaeche selbst,
 * dass die Anmeldung abgelaufen ist (sessionExpired), und muss dafuer erreichbar bleiben.
 */
export async function requireAuth(
  req: NextRequest | Request,
  opts: { allowExpiredLogin?: boolean } = {}
) {
  const decoded = await verifyAuthToken(req);
  if (!decoded) return unauthorizedResponse(getApiMessages(req).unauthorized);

  // PulseNorth-Konto (Anmeldung ohne Microsoft): Der Hub stellt die Sitzung mit der Kennung
  // "ml:…" in uid UND oid aus. Die Kennung ist eindeutig (Entra-oids sind GUIDs).
  if (isMagicLinkOid(decoded.oid) || isMagicLinkOid(decoded.uid)) {
    // B12 (01.10.2026): Diese Konten haben kein Entra-Token. Das zentrale Register gab für
    // sie keine Auskunft — das Tor wurde übersprungen und der Coach stand ihnen offen.
    // Deshalb hart und ohne Dienst-Aufruf abweisen. Seit dem Anmeldung-Umbau Schritt 2c
    // (02.10.2026) gilt das nur noch, wenn PulseNorth-Konten NICHT eingeschaltet sind
    // (PN_SERVICE_AUTH=off oder kein PN_SERVICE_SECRET) oder die Sitzung nicht die EINE
    // gültige Kennung in uid und oid trägt.
    if (!(pnAccountsEnabled() && isPnMemberId(decoded.oid) && decoded.uid === decoded.oid)) {
      return appNotEnabledResponse();
    }

    // Eingeschaltet: dasselbe zentrale Tor wie für Microsoft-Mitglieder (Abruf mit dem
    // Dienst-Ausweis) — aber NIE fail-soft. Hinein kommt nur, wem das Register es
    // ausdrücklich bestätigt: Mitglied vorhanden, nicht deaktiviert, Coach freigegeben.
    // Was beim Anmelden im JWT eingefroren wurde (mlRole, mlApps, mlWorkspaceId), zählt
    // nie. Weder allowExpiredLogin noch REQUIRE_VALID_LOGIN=off öffnen dieses Tor, und
    // „neu anmelden" gibt es hier nicht: ein PulseNorth-Konto hat kein Token, das abläuft.
    const { getCentralMemberState } = await import("@/lib/server/credits/member-info");
    const state = await getCentralMemberState(decoded.oid);
    if (state.kind === "unavailable") return registerUnavailableResponse();
    if (state.kind !== "info") return appNotEnabledResponse();
    if (state.info.disabled) return accountDisabledResponse();
    if (!state.info.apps.includes("coach")) return appNotEnabledResponse();
    return {
      uid: decoded.uid,
      email: decoded.email,
      oid: decoded.oid,
      decoded,
    };
  }

  // P3 App-Freigaben (ROLLEN-Blueprint 15.08.): das zentrale Mandanten-
  // Register entscheidet, ob der Coach fuer dieses Konto freigeschaltet und
  // das Konto aktiv ist. 60s-Cache; Dienststoerung -> fail-soft (Verfueg-
  // barkeit vor Strenge). Inert ohne CREDITS_CENTRAL/oid.
  if (decoded.oid) {
    const { getCentralMemberState } = await import("@/lib/server/credits/member-info");
    const state = await getCentralMemberState(decoded.oid);
    // B26 (02.10.2026): Ohne gueltiges Entra-Token gab das Register keine Auskunft, und
    // das Tor wurde uebersprungen — eine deaktivierte Person oder jemand ohne Coach-
    // Freigabe kam mit abgelaufener Anmeldung weiter an die kostenlosen Funktionen.
    // Jetzt: erst neu anmelden (danach greift das Tor wieder). Eine STOERUNG von
    // Token-Speicher oder Dienst bleibt fail-soft.
    if (
      state.kind === "login-required" &&
      !opts.allowExpiredLogin &&
      requireValidLoginEnabled()
    ) {
      return loginRequiredResponse(req);
    }
    const central = state.kind === "info" ? state.info : null;
    if (central) {
      if (central.disabled) {
        return NextResponse.json(
          { ok: false, error: "Dieses Konto wurde deaktiviert. Wende dich an deine:n Admin.", code: "ACCOUNT_DISABLED" },
          { status: 403 }
        );
      }
      if (central.apps.length > 0 && !central.apps.includes("coach")) {
        return NextResponse.json(
          { ok: false, error: "Der KI-Coach ist für dieses Konto nicht freigeschaltet. Wende dich an deine:n Admin.", code: "APP_NOT_ENABLED" },
          { status: 403 }
        );
      }
    }
  }

  return {
    uid: decoded.uid,
    email: decoded.email,
    oid: decoded.oid,
    decoded,
  };
}
