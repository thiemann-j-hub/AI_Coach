/**
 * M4 — Build & Deploy auf Azure App Service (ZIP-Deploy des standalone-Outputs).
 *
 * Schritte (Playbook Gotcha 12):
 *   1. next build  (output: "standalone")
 *   2. .next/static  → .next/standalone/.next/static
 *      public       → .next/standalone/public
 *   3. ZIP des standalone-Verzeichnisses
 *   4. az webapp deploy --type zip
 *
 * Aufruf:
 *   node scripts/deploy-azure.mjs              # Build + Deploy
 *   node scripts/deploy-azure.mjs --skip-build # nur Paketieren + Deploy
 *   node scripts/deploy-azure.mjs --package    # nur ZIP bauen, kein Deploy
 *
 * Voraussetzungen: az CLI eingeloggt (az login), Rechte auf pulsecraft-prod-rg.
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RESOURCE_GROUP = "pulsecraft-prod-rg";
const WEB_APP = "pulsecraft-coach";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const standalone = join(root, ".next", "standalone");
const zipPath = join(root, ".next", "deploy.zip");

const args = new Set(process.argv.slice(2));
const run = (cmd, cwd = root) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit" });
};

if (!args.has("--skip-build")) {
  run("npm run build");
}

if (!existsSync(standalone)) {
  console.error("Kein standalone-Output unter .next/standalone — Build fehlgeschlagen?");
  process.exit(1);
}

// Statische Assets gehören beim standalone-Output nicht automatisch dazu
console.log("\nKopiere .next/static und public in den standalone-Output …");
cpSync(join(root, ".next", "static"), join(standalone, ".next", "static"), { recursive: true });
if (existsSync(join(root, "public"))) {
  cpSync(join(root, "public"), join(standalone, "public"), { recursive: true });
}

console.log("Erzeuge deploy.zip …");
rmSync(zipPath, { force: true });
if (process.platform === "win32") {
  run(
    `powershell -NoProfile -Command "Compress-Archive -Path '${standalone}\\*' -DestinationPath '${zipPath}' -Force"`
  );
} else {
  run(`cd "${standalone}" && zip -qry "${zipPath}" .`);
}

if (args.has("--package")) {
  console.log(`\nFertig: ${zipPath} (kein Deploy, --package gesetzt)`);
  process.exit(0);
}

run(
  `az webapp deploy --resource-group ${RESOURCE_GROUP} --name ${WEB_APP} --src-path "${zipPath}" --type zip`
);

console.log(`\n✅ Deployt: https://${WEB_APP}.azurewebsites.net`);
console.log("Verifikation (M5): siehe docs/azure-migration/PLAN.md, Phase M5.");
