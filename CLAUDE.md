# CLAUDE.md — Hinweise für KI-Agenten in diesem Repo

## Rahmen-Regel für die Oberfläche (Owner-Vorgabe 05.10.2026, verbindlich)

Jeder umrandete Kasten bekommt genau EINE Klasse (Optik zentral in `src/app/globals.css`):

- `pn-field` — Eingabefeld (input/textarea/select, Feld-Wrapper, Editor-Kasten, Ablagefläche, feldartiger Auswahl-/Datums-Knopf): grauer Rahmen, **kein Schatten**.
- `pn-tile` — Kachel, die Inhalte/Ergebnisse/Daten zeigt (auch Auswahl-Karten als `<button>`): grauer Rahmen + Schatten rechts/unten; **Mouse-over: blauer Rahmen + blauer Schatten rundum**.
- `pn-surface` — Fläche, die Kacheln oder Felder umrahmt: Rahmen + Schatten rechts/unten, kein Mouse-over.
- `pn-none` — Ausnahme: normaler Knopf, Plakette, Reiter, farbiger Hinweis, Overlay (Dialog/Menü/Popover/Tooltip/Toast), Fortschrittsbalken, Chat-Nachricht.

Keine eigenen `shadow-*`/`hover:shadow-*`/`hover:border-*` an diesen Kästen; der Schatten kommt aus der Klasse.
Der Wächter `node scripts/rahmen-regel.mjs` läuft vor jedem Bau (`prebuild`) und bricht bei Verstößen ab.
Volle Regel: pulsenorth-ops `SHELL-STANDARD-LOOK-AND-FEEL.md` Teil 2.7.
