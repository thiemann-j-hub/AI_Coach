import {vertexHost} from './gemini-backend';

/**
 * Das Genkit-Vertex-Plugin baut den Host aus der Region („<region>-aiplatform.googleapis.com“) und kennt
 * die Mehrfachregionen „eu“/„us“ nicht, deren Host „aiplatform.eu.rep.googleapis.com“ heißt. Diese kleine
 * Umleitung ersetzt genau diesen einen Hostnamen in fetch-Aufrufen des Prozesses, sonst nichts.
 * Wirkt nur, wenn VERTEX_LOCATION eine Mehrfachregion ist; einmal pro Prozess. Rückweg: VERTEX_LOCATION=europe-west3.
 */
export function installVertexFetchShim(location: string): void {
  if (location !== 'eu' && location !== 'us') return;
  const g = globalThis as typeof globalThis & {__pnVertexFetchShim?: string};
  if (g.__pnVertexFetchShim === location) return;
  const original = globalThis.fetch;
  const wrong = `https://${location}-aiplatform.googleapis.com/`;
  const right = `https://${vertexHost(location)}/`;
  const rewrite = (url: string): string => (url.startsWith(wrong) ? right + url.slice(wrong.length) : url);
  const shim: typeof fetch = (input, init) => {
    if (typeof input === 'string') return original(rewrite(input), init);
    if (input instanceof URL) return original(rewrite(input.toString()), init);
    const url = rewrite(input.url);
    return url === input.url ? original(input, init) : original(new Request(url, input), init);
  };
  globalThis.fetch = shim;
  g.__pnVertexFetchShim = location;
}
