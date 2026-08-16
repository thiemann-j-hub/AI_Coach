"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { authFetch } from "@/lib/api-client";
import { signOut } from "@/lib/auth-service";
import { useToast } from "@/hooks/use-toast";
import { Languages } from "lucide-react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useTranslation } from "@/i18n/useTranslation";

export default function SettingsClient() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [busyHistory, setBusyHistory] = useState(false);
  const [busyAccount, setBusyAccount] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  async function deleteHistory() {
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

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 space-y-8">
      {/* Standard-Einstellungsseite (Owner-Vorgabe 16.08., alle Apps gleich):
          Karte "Sprache" zuerst; app-eigene Bereiche (Konto & Daten) darunter. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Languages className="h-4 w-4 text-muted-foreground" />
            {t.settingsPage.language}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">{t.settingsPage.languageHint}</p>
          <LanguageSwitcher />
        </CardContent>
      </Card>

      <div>
        <h1 className="text-2xl font-bold text-foreground">Konto &amp; Daten</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Verwalte deine Daten. Löschungen sind endgültig und können nicht rückgängig gemacht werden.
        </p>
      </div>

      {/* Lern-Historie löschen */}
      <Card>
        <CardHeader>
          <CardTitle>Lern-Historie löschen</CardTitle>
          <CardDescription>
            Entfernt alle deine Analysen und deinen Fortschritts-Verlauf (Radar). Dein Konto, dein
            Guthaben und deine Rechnungen bleiben bestehen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={busyHistory}>
                {busyHistory ? "Wird gelöscht…" : "Lern-Historie löschen"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Lern-Historie wirklich löschen?</AlertDialogTitle>
                <AlertDialogDescription>
                  Alle Analysen und dein Fortschritts-Verlauf werden dauerhaft entfernt. Diese
                  Aktion kann nicht rückgängig gemacht werden.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction onClick={deleteHistory}>Endgültig löschen</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>

      {/* Account & alle Daten löschen */}
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Account &amp; alle Daten löschen</CardTitle>
          <CardDescription>
            Entfernt deine personenbezogenen Daten dauerhaft: Lern-Historie, Sitzungen, Profil und
            gespeicherte Zugriffs-Token. Aus gesetzlichen Gründen bleiben Rechnungen für die
            Aufbewahrungsfrist (§ 147 AO) erhalten. Du wirst anschließend abgemeldet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog onOpenChange={() => setConfirmText("")}>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={busyAccount}>
                {busyAccount ? "Wird gelöscht…" : "Account löschen"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Account endgültig löschen?</AlertDialogTitle>
                <AlertDialogDescription>
                  Diese Aktion ist unwiderruflich. Gib zur Bestätigung <strong>LÖSCHEN</strong> ein.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-2 py-2">
                <Label htmlFor="confirm-delete">Bestätigung</Label>
                <Input
                  id="confirm-delete"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="LÖSCHEN"
                  autoComplete="off"
                />
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction
                  onClick={deleteAccount}
                  disabled={confirmText !== "LÖSCHEN"}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Account löschen
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
