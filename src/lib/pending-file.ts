/**
 * Datei-Übergabe der Einstiegs-Ablageleiste (COACH-UX-BLUEPRINT §3/W1-2):
 * ein File-Objekt lässt sich nicht durch sessionStorage tragen — bei
 * Client-Navigation (router.push) überlebt aber der Modul-Scope. Consume-once,
 * damit ein späterer /analyze-Besuch nicht erneut denselben Upload auslöst.
 */
let pending: File | null = null;

export function setPendingFile(f: File): void {
  pending = f;
}

export function takePendingFile(): File | null {
  const f = pending;
  pending = null;
  return f;
}
