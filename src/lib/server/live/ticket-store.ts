import { randomBytes } from "node:crypto";

/**
 * Einmal-Eintrittskarten für die Live-Verbindung (Sprachmodus Live, N4-231).
 *
 * Der Browser kann an einen WebSocket keine eigenen Kopfzeilen hängen, und die Verbindung kommt
 * am Next-Server vorbei direkt beim Server-Mantel an (server/live-server.js). Deshalb prüft die
 * normale API-Route (Anmeldung, Einwilligung, Szenario, Schalter) ALLES und stellt eine kurzlebige
 * Karte aus; der Mantel nimmt nur die Karte entgegen. Eine Karte gilt 60 Sekunden und genau einmal.
 * Rein im Speicher: der Coach läuft als EIN Prozess (App Service, standalone).
 */
export interface LiveTicket {
  uid: string;
  email: string | null;
  oid: string | null;
  simId: string;
}

interface Stored {
  ticket: LiveTicket;
  issuedAt: number;
}

export interface TicketStore {
  issue(ticket: LiveTicket, now?: number): string;
  redeem(id: string, now?: number): LiveTicket | null;
  size(): number;
}

export function createTicketStore(ttlMs = 60_000): TicketStore {
  const map = new Map<string, Stored>();
  const sweep = (now: number) => {
    for (const [id, s] of map) if (now - s.issuedAt > ttlMs) map.delete(id);
  };
  return {
    issue(ticket, now = Date.now()) {
      sweep(now);
      const id = randomBytes(24).toString("base64url");
      map.set(id, { ticket, issuedAt: now });
      return id;
    },
    redeem(id, now = Date.now()) {
      sweep(now);
      const s = map.get(id);
      if (!s) return null;
      map.delete(id);
      return s.ticket;
    },
    size() {
      return map.size;
    },
  };
}

/** Ein Laden je Prozess — auch über Next-Neuladen im Entwicklungsmodus hinweg. */
export function liveTicketStore(): TicketStore {
  const g = globalThis as typeof globalThis & { __coachLiveTickets?: TicketStore };
  if (!g.__coachLiveTickets) g.__coachLiveTickets = createTicketStore();
  return g.__coachLiveTickets;
}
