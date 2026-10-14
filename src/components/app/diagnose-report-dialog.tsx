"use client";

/**
 * W1-3 (LXT-Welle W1, Owner-GO 14.10.2026): „Fehlerbericht herunterladen“ — Vorschau, dann Datei.
 * Vorbild LXT (Anhang A §7.8). Menüpunkt + Strg+Alt+D; keine Zugangsdaten, E-Mails oder Inhalte.
 */
import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Download, FileWarning } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import { authFetch } from "@/lib/api-client";
import { buildDiagnoseReport, diagnoseFileName, downloadDiagnoseReport, installDiagnoseHooks, type DiagnoseReport } from "@/lib/diagnose";

export const DIAGNOSE_OPEN_EVENT = "pn:diagnose-open";

export function openDiagnoseReport(): void {
  window.dispatchEvent(new CustomEvent(DIAGNOSE_OPEN_EVENT));
}

interface VersionInfo {
  sha?: string | null;
  branch?: string | null;
  builtAt?: string | null;
  diagnose?: boolean;
  switches?: Record<string, string>;
}

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));

export function DiagnoseReportDialog() {
  const { t, locale } = useTranslation();
  const d = t.diagnose;
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<DiagnoseReport | null>(null);
  const [disabled, setDisabled] = useState(false);

  useEffect(() => {
    installDiagnoseHooks();
  }, []);

  const build = useCallback(async () => {
    let info: VersionInfo = {};
    try {
      const res = await authFetch("/api/version");
      if (res.ok) info = (await res.json()) as VersionInfo;
    } catch {
      /* ohne Version weiter */
    }
    if (info.diagnose === false) {
      setDisabled(true);
      return;
    }
    setReport(
      buildDiagnoseReport({
        app: "coach",
        build: { sha: info.sha ?? null, branch: info.branch ?? null, builtAt: info.builtAt ?? null },
        switches: info.switches ?? {},
        locale,
      })
    );
    setOpen(true);
  }, [locale]);

  useEffect(() => {
    const onOpen = () => void build();
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && !e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        void build();
      }
    };
    window.addEventListener(DIAGNOSE_OPEN_EVENT, onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(DIAGNOSE_OPEN_EVENT, onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, [build]);

  if (disabled) return null;
  const json = report ? JSON.stringify(report, null, 2) : "";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileWarning className="h-5 w-5" />
            {d.title}
          </DialogTitle>
          <DialogDescription>{d.intro}</DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
          <li>{fill(d.itemBuild, { sha: report?.build.sha ?? "—" })}</li>
          <li>{d.itemBrowser}</li>
          <li>{fill(d.itemSwitches, { count: Object.keys(report?.switches ?? {}).length })}</li>
          <li>{fill(d.itemErrors, { count: report?.lastErrors.length ?? 0 })}</li>
          <li>{fill(d.itemLog, { count: report?.log.length ?? 0 })}</li>
        </ul>
        <p className="text-xs text-muted-foreground">{d.privacy}</p>
        <Textarea readOnly value={json} className="h-48 font-mono text-[11px]" aria-label={d.previewLabel} />
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            {d.close}
          </Button>
          <Button
            onClick={() => {
              if (report) downloadDiagnoseReport(report, diagnoseFileName("coach"));
              setOpen(false);
            }}
          >
            <Download className="mr-2 h-4 w-4" />
            {d.download}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">{d.shortcutHint}</p>
      </DialogContent>
    </Dialog>
  );
}
