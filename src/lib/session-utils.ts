/**
 * Session ID helpers shared by AnalyzeClient and AnalyzeForm.
 */

export function newSessionId(): string {
  const c: any = globalThis.crypto as any;
  if (c?.randomUUID) return c.randomUUID();
  return `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function shortId(id?: string, n = 18): string {
  const s = String(id ?? '');
  if (!s) return '—';
  if (s.length <= n) return s;
  return s.slice(0, n) + '…';
}
