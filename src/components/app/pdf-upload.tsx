'use client';

import React, { useMemo, useRef, useState } from 'react';
import { parsePdfToText } from '@/lib/pdf/parsePdfToText';

type Props = {
  onApplyText: (text: string, mode: 'replace' | 'append') => void;
  cleaner?: (text: string) => string;
  defaultMode?: 'replace' | 'append';
  defaultClean?: boolean;
  maxPages?: number;
  maxChars?: number;
};

export default function PdfUpload({
  onApplyText,
  cleaner,
  defaultMode = 'replace',
  defaultClean = true,
  maxPages = 30,
  maxChars = 250000,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [mode, setMode] = useState<'replace' | 'append'>(defaultMode);
  const [doClean, setDoClean] = useState<boolean>(defaultClean);

  const [fileName, setFileName] = useState<string | null>(null);
  const [pagesInfo, setPagesInfo] = useState<string | null>(null);

  const hasCleaner = typeof cleaner === 'function';

  const hint = useMemo(() => {
    const parts: string[] = [];
    parts.push(`max. ${maxPages} Seiten`);
    parts.push(`max. ${Math.round(maxChars / 1000)}k Zeichen`);
    return parts.join(' · ');
  }, [maxPages, maxChars]);

  async function handleFile(file: File) {
    setErr(null);
    setBusy(true);
    setFileName(file.name);
    setPagesInfo(null);

    try {
      const { text, pages, truncated } = await parsePdfToText(file, { maxPages, maxChars });
      let out = text;

      if (doClean && hasCleaner) {
        out = cleaner!(out);
      }

      onApplyText(out, mode);

      setPagesInfo(`${pages} Seite(n)${truncated ? ' · gekürzt' : ''}`);
    } catch (e: any) {
      setErr(e?.message || 'PDF konnte nicht gelesen werden.');
    } finally {
      setBusy(false);
    }
  }

  function onPick() {
    inputRef.current?.click();
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type === 'application/pdf') handleFile(file);
    else setErr('Bitte eine PDF-Datei auswählen.');
  }

  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
  }

  return (
    <div className="bg-white dark:bg-[#111826] rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-4 md:p-5">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className="font-bold text-gray-900 dark:text-white">PDF importieren</div>
          <div className="text-xs text-gray-500">{hint}</div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            className="text-xs px-2 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200"
            value={mode}
            onChange={(e) => setMode(e.target.value as any)}
            disabled={busy}
          >
            <option value="replace">Ersetzen</option>
            <option value="append">Anhängen</option>
          </select>

          <label
            className={`text-xs px-2 py-2 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-2 ${
              hasCleaner ? 'cursor-pointer' : 'opacity-60'
            }`}
          >
            <input
              type="checkbox"
              className="accent-[hsl(var(--primary))]"
              checked={doClean}
              onChange={(e) => setDoClean(e.target.checked)}
              disabled={!hasCleaner || busy}
            />
            Teams bereinigen
          </label>

          <button
            type="button"
            onClick={onPick}
            disabled={busy}
            className="px-3 py-2 rounded-lg text-xs font-semibold bg-blue-50 dark:bg-[hsl(var(--primary))/0.10] text-[hsl(var(--primary))] border border-gray-200 dark:border-gray-700 hover:bg-blue-100/60 dark:hover:bg-[hsl(var(--primary))/0.16] transition"
          >
            {busy ? 'Lese PDF…' : 'PDF hochladen'}
          </button>

          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={onChange}
          />
        </div>
      </div>

      <div
        className="mt-3 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-4 text-sm text-gray-600 dark:text-gray-300"
        onDrop={onDrop}
        onDragOver={onDragOver}
      >
        <div className="font-medium text-gray-800 dark:text-gray-200">Drag & Drop</div>
        <div className="text-xs text-gray-500 mt-1">Ziehe eine Teams‑PDF hier rein oder nutze den Button.</div>

        {(fileName || pagesInfo) && (
          <div className="mt-3 text-xs text-gray-500">
            <span className="font-medium">Datei:</span> {fileName || '—'}
            {pagesInfo ? <span className="ml-2">({pagesInfo})</span> : null}
          </div>
        )}

        {err && <div className="mt-3 text-xs text-red-600 dark:text-red-400">{err}</div>}
      </div>
    </div>
  );
}
