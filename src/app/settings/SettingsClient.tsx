"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { authFetch } from "@/lib/api-client";
import { signOut } from "@/lib/auth-service";
import { useToast } from "@/hooks/use-toast";

export default function SettingsClient() {
  const { toast } = useToast();
  const [busyHistory, setBusyHistory] = useState(false);
  const [busyAccount, setBusyAccount] = useState(false);
  // W1-10 (14.10.2026): Bestätigen als await confirm() mit Wort — Fokus auf „Abbrechen“.
  const confirm = useConfirm();

  async function deleteHistory() {
    const ok = await confirm({
      title: "Lern-Historie wirklich löschen?",
      description:
        "Alle Analysen und Dein Fortschritts-Verlauf werden dauerhaft entfernt. Diese Aktion kann nicht rückgängig gemacht werden.",
      typeToConfirm: true,
    });
    if (!ok) return;
    setBusyHistory(true);
    try {
      const res = await authFetch("/api/account/history", { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || String(res.status));
      toast({
        title: "Lern-Historie gelöscht",
        description: `${data.runsDeleted ?? 0} Analysen und ${data.measurementsDeleted ?? 0} Radar-Messpunkte wurden entfernt.`,
      });
    } catch (e) {
      toast({
        title: "Löschung fehlgeschlagen",
        description: "Bitte versuche es später erneut.",
        variant: "destructive",
      });
    } finally {
      setBusyHistory(false);
    }
  }

  async function deleteAccount() {
    const ok = await confirm({
      title: "Account endgültig löschen?",
      description: "Diese Aktion ist unwiderruflich. Lern-Historie, Sitzungen, Profil und gespeicherte Zugriffs-Token werden entfernt.",
      confirmLabel: "Account löschen",
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
        title: "Account gelöscht",
        description: "Deine Daten wurden entfernt. Du wirst jetzt abgemeldet.",
      });
      // Kurz warten, damit der Toast sichtbar ist, dann ausloggen.
      setTimeout(() => {
        void signOut();
      }, 1500);
    } catch (e) {
      toast({
        title: "Löschung fehlgeschlagen",
        description: "Bitte versuche es später erneut.",
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
        <h2 className="text-lg font-semibold text-foreground">Konto &amp; Daten</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Verwalte deine Daten. Löschungen sind endgültig und können nicht rückgängig gemacht werden.
        </p>
      </div>

      {/* Lern-Historie löschen */}
      <Card className="pn-surface">
        <CardHeader>
          <CardTitle>Lern-Historie löschen</CardTitle>
          <CardDescription>
            Entfernt alle deine Analysen und deinen Fortschritts-Verlauf (Radar). Dein Konto, dein
            Guthaben und deine Rechnungen bleiben bestehen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" disabled={busyHistory} onClick={() => void deleteHistory()}>
            {busyHistory ? "Wird gelöscht…" : "Lern-Historie löschen"}
          </Button>
        </CardContent>
      </Card>

      {/* Account & alle Daten löschen */}
      <Card className="pn-none border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Account &amp; alle Daten löschen</CardTitle>
          <CardDescription>
            Entfernt deine personenbezogenen Daten dauerhaft: Lern-Historie, Sitzungen, Profil und
            gespeicherte Zugriffs-Token. Aus gesetzlichen Gründen bleiben Rechnungen für die
            Aufbewahrungsfrist (§ 147 AO) erhalten. Du wirst anschließend abgemeldet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" disabled={busyAccount} onClick={() => void deleteAccount()}>
            {busyAccount ? "Wird gelöscht…" : "Account löschen"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
