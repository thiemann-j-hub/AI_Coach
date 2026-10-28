#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Server-Mantel für den Sprachmodus Live (Owner-GO 28.10.2026, Register N4-231).
 *
 * Der Coach läuft als Next-Standalone auf App Service (Startbefehl `node server.js`). Next selbst
 * nimmt keine WebSockets an, die Live-Verbindung des Browsers braucht aber einen. Darum wird beim
 * Zusammenbau (azure-deploy.yml) Nexts eigener `server.js` zu `next-server.js`, und diese Datei
 * wird `server.js`:
 *   - COACH_LIVE aus (Standard): sie ruft nur `next-server.js` auf — Null Änderung im Betrieb.
 *   - COACH_LIVE an: sie startet Next GENAU wie `next-server.js` (derselbe Startweg `startServer`,
 *     dieselbe Konfiguration aus `.next/required-server-files.json`), fängt dabei den HTTP-Server ab
 *     und hängt auf `<basePath>/api/simulation/live/ws` die WebSocket-Annahme davor. Alle anderen
 *     Upgrade-Anfragen bekommt weiterhin Next. Die Annahme selbst (Karte prüfen, Gespräch fahren)
 *     registriert der Next-Code unter `globalThis.__coachLive` (src/lib/server/live).
 *   Lehre 28.10.: Nexts Bibliotheksweg (`require('next')({...})`) braucht Dateien, die im
 *   Standalone-Bündel fehlen (compiled/webpack) — deshalb der Startweg des Bündels, kein eigener.
 * Rückweg: COACH_LIVE weglassen (oder `node next-server.js` als Startbefehl).
 */
const path = require("path");
const http = require("http");

const liveRaw = (process.env.COACH_LIVE || "off").trim().toLowerCase();
const liveOn = Boolean(liveRaw) && liveRaw !== "off";

if (!liveOn) {
  // Schalter aus: der unveränderte Next-Server.
  require("./next-server.js");
} else {
  const dir = path.join(__dirname);
  process.env.NODE_ENV = "production";
  process.chdir(__dirname);

  const nextConfig = require(path.join(dir, ".next", "required-server-files.json")).config;
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig);
  const port = parseInt(process.env.PORT, 10) || 3000;
  const hostname = process.env.HOSTNAME || "0.0.0.0";
  let keepAliveTimeout = parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10);
  if (Number.isNaN(keepAliveTimeout) || !Number.isFinite(keepAliveTimeout) || keepAliveTimeout < 0) keepAliveTimeout = undefined;
  const basePath = nextConfig.basePath || "";
  const livePath = `${basePath}/api/simulation/live/ws`;

  // Den HTTP-Server abfangen, den Nexts startServer gleich anlegt (einmalig, danach wieder original).
  let server = null;
  const createServerOriginal = http.createServer;
  http.createServer = function (...args) {
    const s = createServerOriginal.apply(this, args);
    server = s;
    http.createServer = createServerOriginal;
    return s;
  };

  require("next");
  const { startServer } = require("next/dist/server/lib/start-server");
  const { WebSocketServer } = require("ws");

  /** Herkunft wie beim CSRF-Tor: Origin muss zur AUTH_URL passen (ohne AUTH_URL: durchlassen, die Karte bleibt das Tor). */
  function originOk(req) {
    const origin = req.headers.origin;
    if (!origin) return false; // Browser schicken bei WebSockets immer eine Origin
    const allowed = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
    if (!allowed) return true;
    try {
      return new URL(origin).origin === new URL(allowed).origin;
    } catch {
      return false;
    }
  }

  startServer({ dir, isDev: false, config: nextConfig, hostname, port, allowRetry: false, keepAliveTimeout })
    .then(() => {
      if (!server) throw new Error("Server-Mantel: HTTP-Server von Next nicht gefunden");
      const nextUpgrade = server.listeners("upgrade");
      server.removeAllListeners("upgrade");
      const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20, perMessageDeflate: false });
      server.on("upgrade", (req, socket, head) => {
        let pathname = "/";
        try {
          pathname = new URL(req.url || "/", "http://x").pathname;
        } catch {
          /* bleibt "/" */
        }
        if (pathname !== livePath) {
          for (const l of nextUpgrade) l.call(server, req, socket, head);
          return;
        }
        if (!originOk(req)) {
          socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
          socket.destroy();
          return;
        }
        const live = globalThis.__coachLive;
        if (!live) {
          // Noch keine Karte ausgestellt seit dem Start → der Next-Code hat sich noch nicht gemeldet.
          socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => live.accept(ws));
      });
      console.log(`> Sprachmodus Live bereit: ${livePath}`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
