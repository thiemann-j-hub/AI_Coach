"""Coach-Deploy-ZIP bauen — Python zipfile, NIE Compress-Archive
(RELEASE-DEPLOY-SAFETY-BLUEPRINT, Nachtrag 31.07.2026: Compress-Archive
verwirft lange node_modules-Pfade STILL → Container-Crash).

Layout (Next standalone): .next/standalone/* an die Wurzel, dazu
.next/static unter .next/static und public/ unter public/."""
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "deploy.zip")
STANDALONE = os.path.join(ROOT, ".next", "standalone")
STATIC = os.path.join(ROOT, ".next", "static")
PUBLIC = os.path.join(ROOT, "public")

if not os.path.isdir(STANDALONE):
    sys.exit("FEHLER: .next/standalone fehlt — erst `npm run build`.")

if os.path.exists(OUT):
    os.remove(OUT)

count = 0
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for base, _dirs, files in os.walk(STANDALONE):
        for f in files:
            full = os.path.join(base, f)
            arc = os.path.relpath(full, STANDALONE).replace(os.sep, "/")
            z.write(full, arc)
            count += 1
    for base, _dirs, files in os.walk(STATIC):
        for f in files:
            full = os.path.join(base, f)
            arc = ".next/static/" + os.path.relpath(full, STATIC).replace(os.sep, "/")
            z.write(full, arc)
            count += 1
    if os.path.isdir(PUBLIC):
        for base, _dirs, files in os.walk(PUBLIC):
            for f in files:
                full = os.path.join(base, f)
                arc = "public/" + os.path.relpath(full, PUBLIC).replace(os.sep, "/")
                z.write(full, arc)
                count += 1

size_mb = round(os.path.getsize(OUT) / 1048576, 1)
sys.stdout.write("deploy.zip: %d Dateien, %s MB\n" % (count, size_mb))
