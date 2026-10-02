# -*- coding: utf-8 -*-
"""Rechte-Haertung B26 (Owner-GO 02.10.2026): Texte fuer die Meldung "Sitzung abgelaufen".

Der Coach hatte diese Meldung bisher nur fest verdrahtet in Deutsch/Englisch (Analyse,
Credits-Seite). Die neue Meldung im App-Rahmen braucht sie in allen 22 Sprachen.

Quelle: die Jobmap fuehrt genau diese zwei Texte schon in denselben 22 Sprachen
(messages/<sprache>/common.json: sessionExpired, reLogin). Sie werden WOERTLICH
uebernommen, damit beide Apps dasselbe sagen und nichts neu uebersetzt wird.

Schreibt in jede Sprachdatei:
  common.sessionExpired, common.reLogin   (Meldung + Knopf im App-Rahmen)
  api.sessionExpired                      (Fehlertext der API-Antwort)

Aufruf:  python scripts/add-session-expired-strings.py [pfad-zur-jobmap]
Idempotent: vorhandene Schluessel werden nicht ueberschrieben.
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DICTS = os.path.join(ROOT, "src", "i18n", "dictionaries")
JOBMAP = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(ROOT), "ai-jobmap-moderator")


def find_pair(node):
    """Erstes Objekt, das beide Schluessel traegt (die Jobmap fuehrt sie unter common)."""
    if isinstance(node, dict):
        if isinstance(node.get("sessionExpired"), str) and isinstance(node.get("reLogin"), str):
            return node["sessionExpired"], node["reLogin"]
        for v in node.values():
            hit = find_pair(v)
            if hit:
                return hit
    return None


changed = 0
for name in sorted(os.listdir(DICTS)):
    if not name.endswith(".json"):
        continue
    lc = name[:-5]
    src = os.path.join(JOBMAP, "messages", lc, "common.json")
    if not os.path.isfile(src):
        raise SystemExit("Quelle fehlt: %s" % src)
    pair = find_pair(json.load(io.open(src, encoding="utf-8")))
    if not pair:
        raise SystemExit("sessionExpired/reLogin nicht gefunden in %s" % src)
    expired, relogin = pair

    path = os.path.join(DICTS, name)
    raw = io.open(path, encoding="utf-8", newline="").read()
    crlf = "\r\n" in raw
    data = json.loads(raw)
    before = json.dumps(data, ensure_ascii=False)
    data["common"].setdefault("sessionExpired", expired)
    data["common"].setdefault("reLogin", relogin)
    data["api"].setdefault("sessionExpired", expired)
    if json.dumps(data, ensure_ascii=False) == before:
        continue
    out = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if crlf:
        out = out.replace("\n", "\r\n")
    io.open(path, "w", encoding="utf-8", newline="").write(out)
    changed += 1
    sys.stdout.write("%s: %s | %s\n" % (lc, expired.encode("ascii", "replace").decode(), relogin.encode("ascii", "replace").decode()))

sys.stdout.write("Dateien geaendert: %d\n" % changed)
