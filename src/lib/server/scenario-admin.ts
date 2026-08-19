import "server-only";

import { NextResponse } from "next/server";
import { getCentralMemberInfo } from "@/lib/server/credits/member-info";
import { resolveWorkspaceIdForScenarios } from "@/lib/server/scenario-store";

/**
 * Welle C — Admin-Gate des Szenario-Builders: Szenarien erstellt und
 * veröffentlicht nur, wer im zentralen Mandanten-Register als admin des
 * Workspace geführt ist (dieselbe Rolle, die Hub »Team & Zugänge« vergibt).
 * Fail-closed: ohne zentrale Auskunft kein Builder-Zugriff.
 */
export async function requireWorkspaceAdmin(auth: {
  uid: string;
  oid?: string | null;
}): Promise<{ workspaceId: string } | NextResponse> {
  const info = auth.oid ? await getCentralMemberInfo(auth.oid) : null;
  if (!info || info.role !== "admin" || info.disabled) {
    return NextResponse.json(
      { ok: false, code: "ADMIN_ONLY" },
      { status: 403 }
    );
  }
  const workspaceId =
    info.workspaceId ?? (await resolveWorkspaceIdForScenarios(auth.uid, auth.oid));
  return { workspaceId };
}
