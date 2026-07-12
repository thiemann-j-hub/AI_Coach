import { Suspense } from "react";
import SettingsClient from "./SettingsClient";
import { AuthGuard } from "@/components/auth/auth-guard";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <AuthGuard>
      <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
        <SettingsClient />
      </Suspense>
    </AuthGuard>
  );
}
