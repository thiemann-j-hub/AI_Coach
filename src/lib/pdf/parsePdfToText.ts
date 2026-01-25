/**
 * Client-only helper: parse a PDF File to text using pdfjs-dist.
 * - No server upload
 * - No OCR
 * - Uses local worker at /public/pdf.worker.min.js (same-origin)
 */

export type PdfParseOptions = {
  maxPages?: number;
  maxChars?: number;
};

type PdfTextItem = {
  str: string;
  transform?: number[];
};

function normalizeSpaces(s: string) {
  return s
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function pageItemsToLines(items: PdfTextItem[]) {
  const rows = new Map<number, Array<{ x: number; s: string }>>();

  for (const it of items) {
    const s = String((it as any)?.str ?? '').trim();
    if (!s) continue;

    const tr = (it as any)?.transform as number[] | undefined;
    const x = Array.isArray(tr) ? Number(tr[4] ?? 0) : 0;
    const y = Array.isArray(tr) ? Number(tr[5] ?? 0) : 0;

    const yKey = Math.round(y * 2) / 2;

    if (!rows.has(yKey)) rows.set(yKey, []);
    rows.get(yKey)!.push({ x, s });
  }

  const yKeys = Array.from(rows.keys()).sort((a, b) => b - a);

  const lines: string[] = [];
  for (const y of yKeys) {
    const parts = rows.get(y)!;
    parts.sort((a, b) => a.x - b.x);
    const line = parts.map((p) => p.s).join(' ').trim();
    if (line) lines.push(line);
  }

  return lines;
}

export async function parsePdfToText(
  file: File,
  opts: PdfParseOptions = {}
): Promise<{ text: string; pages: number; truncated: boolean }> {
  const maxPages = typeof opts.maxPages === 'number' ? opts.maxPages : 30;
  const maxChars = typeof opts.maxChars === 'number' ? opts.maxChars : 250_000;

  // Prefer modern build, fallback to legacy build
  let mod: any = null;
  try {
    mod = await import('pdfjs-dist/build/pdf');
  } catch {
    mod = await import('pdfjs-dist/legacy/build/pdf');
  }

  const pdfjs: any = mod?.getDocument ? mod : (mod?.default ?? mod);

  // ✅ Local worker (same origin) => no CDN, no CSP surprise
  if (pdfjs?.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
  }

  const data = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data });
  const pdf = await loadingTask.promise;

  const pages = Number(pdf.numPages ?? 0) || 0;
  const takePages = Math.min(pages, maxPages);

  let out = '';
  let truncated = false;

  for (let pageNum = 1; pageNum <= takePages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    const items = (content.items ?? []) as PdfTextItem[];
    const lines = pageItemsToLines(items);

    const pageText = normalizeSpaces(lines.join('\n'));
    if (pageText) out += pageText + '\n\n';

    if (out.length > maxChars) {
      out = out.slice(0, maxChars);
      truncated = true;
      break;
    }
  }

  out = normalizeSpaces(out);
  return { text: out, pages, truncated };
}
