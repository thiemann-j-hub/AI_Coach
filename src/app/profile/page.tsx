"use client";

// Standard-Profilseite (Owner-Vorgabe 16.08., in ALLEN Apps identisch):
// Profilbild -> Persoenliche Daten -> Erscheinungsbild (Hell/Dunkel/System).
// Bild + Anzeigename gehen ZENTRAL (PATCH /api/users/profile -> Mandanten-
// Register) und gelten damit ueberall — "einmal aendern, ueberall gleich".
import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Camera, Mail, Moon, Palette, Save, Shield, Sun, User } from "lucide-react";
import AppShell from "@/components/app/app-shell";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/providers/auth-provider";
import { useTranslation } from "@/i18n/useTranslation";
import { authFetch } from "@/lib/api-client";
import SettingsClient from "@/app/settings/SettingsClient";

/** 256px-JPEG-Data-URL (gleiche Regel wie Studio/Jobmap/Hub). */
async function compressToDataUrl(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const s = Math.min(bmp.width, bmp.height);
  ctx.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export default function ProfilePage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const p = t.profilePage;
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<"ok" | "err" | null>(null);

  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Zentrale Workspace-Rolle (Standard-Profilseite zeigt sie in ALLEN Apps).
  const [role, setRole] = useState<"admin" | "member" | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch("/api/users/profile");
        const j = await res.json().catch(() => null);
        if (!cancelled && (j?.profile?.workspaceRole === "admin" || j?.profile?.workspaceRole === "member")) {
          setRole(j.profile.workspaceRole);
        }
      } catch {
        /* fail-soft: ohne Zentrale bleibt das Feld leer */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  // Folgt AKTUALISIERUNGEN des Namens (zentraler Wert laedt nach der Session
  // nach) — eigene Tipp-Eingaben werden nicht ueberschrieben.
  const lastAppliedName = useRef<string>("");
  useEffect(() => {
    const incoming = user?.displayName ?? "";
    if (!incoming) return;
    setDisplayName((prev) =>
      prev === "" || prev === lastAppliedName.current ? incoming : prev
    );
    lastAppliedName.current = incoming;
  }, [user?.displayName]);

  const src = preview ?? user?.photoURL ?? undefined;

  const patch = async (body: Record<string, unknown>): Promise<boolean> => {
    const res = await authFetch("/api/users/profile", {
      method: "PATCH",
      body: JSON.stringify(body),
    }).catch(() => null);
    return !!res?.ok;
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMsg(null);
    try {
      const dataUrl = await compressToDataUrl(file);
      setPreview(dataUrl);
      const ok = await patch({ avatarUrl: dataUrl });
      setMsg(ok ? "ok" : "err");
    } catch {
      setMsg("err");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onSave = async () => {
    setSaving(true);
    setMsg(null);
    const ok = await patch({ displayName: displayName.trim() || user?.displayName || "" });
    setMsg(ok ? "ok" : "err");
    setSaving(false);
    // Shell-Avatare/Name sofort aktualisieren (Provider laedt beim Mount neu).
    if (ok) setTimeout(() => window.location.reload(), 600);
  };

  // Owner-Vorgabe 16.08.: GENAU zwei Optionen mit dem WORTLAUT der
  // Seitenleiste ("Heller Modus"/"Dunkler Modus"). KEIN System-Modus.
  const themeOptions = [
    { value: "light", label: t.common.lightMode, Icon: Sun },
    { value: "dark", label: t.common.darkMode, Icon: Moon },
  ] as const;

  return (
    <AppShell title={p.title}>
      <div className="mx-auto max-w-2xl space-y-6">
        {/* ── Profilbild ── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Camera className="h-4 w-4 text-muted-foreground" /> {p.photo}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-5">
            <Avatar className="h-24 w-24 border border-border">
              {src ? <AvatarImage src={src} alt={displayName} /> : null}
              <AvatarFallback className="bg-gradient-to-br from-primary to-accent text-xl font-semibold text-white">
                {(displayName || user?.email || "U")
                  .split(/\s+/)
                  .filter(Boolean)
                  .map((w) => w[0])
                  .join("")
                  .toUpperCase()
                  .slice(0, 2)}
              </AvatarFallback>
            </Avatar>
            <div>
              <button
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-card/50 px-3 py-2 text-sm transition hover:border-primary/40 hover:text-foreground"
              >
                <Camera className="h-4 w-4" /> {p.changePhoto}
              </button>
              <p className="mt-2 text-xs text-muted-foreground">{p.photoHint}</p>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
            </div>
          </CardContent>
        </Card>

        {/* ── Persoenliche Daten ── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="h-4 w-4 text-muted-foreground" /> {p.personal}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">{p.displayName}</label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                <Mail className="h-3.5 w-3.5" /> E-Mail
              </label>
              <input
                value={user?.email ?? ""}
                disabled
                className="w-full rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
              />
              <p className="mt-1 text-xs text-muted-foreground">{p.emailLocked}</p>
            </div>
            {role && (
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                  <Shield className="h-3.5 w-3.5" /> {p.role}
                </label>
                <input
                  value={role === "admin" ? p.roleAdmin : p.roleMember}
                  disabled
                  className="w-full rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Erscheinungsbild ── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Palette className="h-4 w-4 text-muted-foreground" /> {p.appearance}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1">
              {themeOptions.map(({ value, label, Icon }) => {
                // Alles ausser "light" gilt als dunkel (raeumt gespeicherte
                // "system"-Werte still auf).
                const active =
                  mounted && (value === "light" ? theme === "light" : theme !== "light");
                return (
                  <button
                    key={value}
                    onClick={() => setTheme(value)}
                    aria-pressed={active}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                      active
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4" /> {label}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* ── Speichern ── */}
        <div className="flex items-center justify-end gap-3">
          {msg === "ok" && <span className="text-sm text-emerald-400">{p.saved}</span>}
          {msg === "err" && <span className="text-sm text-destructive">{p.saveFailed}</span>}
          <button
            onClick={() => void onSave()}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            <Save className="h-4 w-4" /> {p.save}
          </button>
        </div>

        {/* ── Konto & Daten (frueher /settings; 16.08. hierher umgezogen) ── */}
        <SettingsClient />
      </div>
    </AppShell>
  );
}
