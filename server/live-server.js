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
 *   - COACH_LIVE an: sie startet Next als Bibliothek, bedient HTTP wie bisher und nimmt auf
 *     `<basePath>/api/simulation/live/ws` WebSockets an. Die Annahme selbst (Karte prüfen, Gespräch
 *     fahren) registriert der Next-Code unter `globalThis.__coachLive` (src/lib/server/live).
 * Entwicklung: `LIVE_SERVER_DEV=1 node server/live-server.js` fährt Next im Entwicklungsmodus.
 * Rückweg: COACH_LIVE weglassen (oder `node next-server.js` als Startbefehl).
 */
const path = require("path");
const http = require("http");

const liveRaw = (process.env.COACH_LIVE || "off").trim().toLowerCase();
const liveOn = Boolean(liveRaw) && liveRaw !== "off";
const dev = process.env.LIVE_SERVER_DEV === "1";

if (!liveOn && !dev) {
  // Schalter aus: der unveränderte Next-Server.
  require("./next-server.js");
} else {
  const dir = dev ? process.cwd() : __dirname;
  process.env.NODE_ENV = dev ? "development" : "production";
  process.chdir(dir);
  const next = require("next");
  const { WebSocketServer } = require("ws");

  const conf = dev ? undefined : require(path.join(dir, ".next", "required-server-files.json")).config;
  const port = parseInt(process.env.PORT, 10) || (dev ? 9002 : 3000);
  const hostname = process.env.HOSTNAME || "0.0.0.0";
  const basePath = (conf && conf.basePath) || process.env.NEXT_PUBLIC_BASE_PATH || "";
  const livePath = `${basePath}/api/simulation/live/ws`;
  let keepAliveTimeout = parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10);
  if (Number.isNaN(keepAliveTimeout) || !Number.isFinite(keepAliveTimeout) || keepAliveTimeout < 0) keepAliveTimeout = undefined;

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

  const app = next({ dev, dir, hostname, port, ...(conf ? { conf } : {}), ...(dev ? { turbopack: true } : {}) });
  app
    .prepare()
    .then(() => {
      const handle = app.getRequestHandler();
      const upgradeNext = typeof app.getUpgradeHandler === "function" ? app.getUpgradeHandler() : null;
      const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20, perMessageDeflate: false });
      const server = http.createServer((req, res) => handle(req, res));
      server.on("upgrade", (req, socket, head) => {
        let pathname = "/";
        try {
          pathname = new URL(req.url || "/", "http://x").pathname;
        } catch {
          /* bleibt "/" */
        }
        if (pathname !== livePath) {
          // Im Entwicklungsmodus braucht Next den Socket für sein Neuladen; sonst gibt es nichts.
          if (dev && upgradeNext) return upgradeNext(req, socket, head);
          socket.destroy();
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
      if (keepAliveTimeout !== undefined) server.keepAliveTimeout = keepAliveTimeout;
      server.listen(port, hostname, () => {
        console.log(`> Coach bereit auf http://${hostname}:${port}${basePath} (Sprachmodus Live: ${livePath})`);
      });
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
