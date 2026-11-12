"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { authFetch } from "@/lib/api-client";
import { signOut } from "@/lib/auth-service";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n/useTranslation";

export default function SettingsClient() {
  const { toast } = useToast();
  // Go-Live-Prüfung (12.11.2026): Alle Texte kommen aus dem Wörterbuch, vorher stand hier nur Deutsch.
  const { t } = useTranslation();
  const p = t.profilePage;
  const [busyHistory, setBusyHistory] = useState(false);
  const [busyAccount, setBusyAccount] = useState(false);
  // W1-10 (14.10.2026): Bestätigen als await confirm() mit Wort — Fokus auf „Abbrechen“.
  const confirm = useConfirm();

  async function deleteHistory() {
    const ok = await confirm({
      title: p.historyConfirmTitle,
      description: p.historyConfirmBody,
      typeToConfirm: true,
    });
    if (!ok) return;
    setBusyHistory(true);
    try {
      const res = await authFetch("/api/account/history", { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || String(res.status));
      toast({
        title: p.historyDeleted,
        description: p.historyDeletedBody
          .replace("{runs}", String(data.runsDeleted ?? 0))
          .replace("{points}", String(data.measurementsDeleted ?? 0)),
      });
    } catch (e) {
      toast({
        title: t.common.deleteFailed,
        description: p.tryAgainLater,
        variant: "destructive",
      });
    } finally {
      setBusyHistory(false);
    }
  }

  async function deleteAccount() {
    const ok = await confirm({
      title: p.accountConfirmTitle,
      description: p.accountConfirmBody,
      confirmLabel: p.accountDelete,
      typeToConfirm: true,
    });
    if (!ok) return;
    setBusyAccount(true);
    try {
      const res = await authFetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || String(res.status));
      toast({
        title: p.accountDeleted,
        description: p.accountDeletedBody,
      });
      // Kurz warten, damit der Toast sichtbar ist, dann ausloggen.
      setTimeout(() => {
        void signOut();
      }, 1500);
    } catch (e) {
      toast({
        title: t.common.deleteFailed,
        description: p.tryAgainLater,
        variant: "destructive",
      });
      setBusyAccount(false);
    }
  }

  // 16.08.: Kein eigener /settings-Ort mehr — diese Karten leben eingebettet
  // auf der Profil-Seite (Standard-Menue: Name/E-Mail -> Profil -> Abmelden).
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{p.accountData}</h2>
        <p className="text-sm text-muted-foreground mt-1">{p.accountDataIntro}</p>
      </div>

      {/* Lern-Historie löschen */}
      <Card className="pn-surface">
        <CardHeader>
          <CardTitle>{p.historyDelete}</CardTitle>
          <CardDescription>{p.historyDeleteBody}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" disabled={busyHistory} onClick={() => void deleteHistory()}>
            {busyHistory ? p.deleting : p.historyDelete}
          </Button>
        </CardContent>
      </Card>

      {/* Account & alle Daten löschen */}
      <Card className="pn-none border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">{p.accountDeleteTitle}</CardTitle>
          <CardDescription>{p.accountDeleteBody}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" disabled={busyAccount} onClick={() => void deleteAccount()}>
            {busyAccount ? p.deleting : p.accountDelete}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
