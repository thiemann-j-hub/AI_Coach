import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest-Setup fuer die geldbewegende Server-Logik (Ledger, Workspace, Cost-Cap,
 * Rate-Limit) und Pure-Utils. Reine Node-Umgebung, keine echte Cosmos/Stripe-
 * Anbindung — externe IO wird per vi.mock durch In-Memory-Fakes ersetzt.
 *
 * - "@"  -> src (wie tsconfig paths)
 * - "server-only" -> No-Op-Stub (das echte Paket wirft ausserhalb eines RSC-Bundles)
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: true,
  },
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "src/test/empty.ts"),
      "@": path.resolve(__dirname, "src"),
    },
  },
});
