/**
 * Spielbücher der Standard-Szenarien (erzeugt mit `scripts/spielbuch-erzeugen.mts`, Opus @eu).
 * Liegen als Inhalt im Repo, damit sie versioniert und lesbar sind; `hash` bindet sie an den Stand
 * der Rollen-DNA — ändert sich die DNA, greift der Zwischenspeicher nicht mehr und der Server
 * erzeugt im Hintergrund ein neues (oder das Skript wird erneut ausgeführt).
 * DIESE DATEI WIRD VOM SKRIPT GESCHRIEBEN.
 */
import s0 from "./sim-appraisal-stone.json";
import s1 from "./sim-azubi-roth.json";
import s2 from "./sim-coaching-morgan.json";
import s3 from "./sim-critique-vance.json";
import s4 from "./sim-merge-brandt.json";
import s5 from "./sim-peer-falk.json";
import s6 from "./sim-peer-lang.json";
import s7 from "./sim-performance-reed.json";

export interface SpielbuchEintrag {
  scenarioId: string;
  hash: string;
  model: string;
  createdAt: string;
  text: string;
}

export const SPIELBUECHER_BUILTIN: Readonly<Record<string, SpielbuchEintrag>> = {
  [s0.scenarioId]: s0,
  [s1.scenarioId]: s1,
  [s2.scenarioId]: s2,
  [s3.scenarioId]: s3,
  [s4.scenarioId]: s4,
  [s5.scenarioId]: s5,
  [s6.scenarioId]: s6,
  [s7.scenarioId]: s7,
};
