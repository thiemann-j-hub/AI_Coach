/**
 * Spielbücher der Standard-Szenarien (erzeugt mit `scripts/spielbuch-erzeugen.mts`, Opus @eu).
 * Liegen als Inhalt im Repo, damit sie versioniert und lesbar sind; `hash` bindet sie an den Stand
 * der Rollen-DNA — ändert sich die DNA, greift der Zwischenspeicher nicht mehr und der Server
 * erzeugt im Hintergrund ein neues (oder das Skript wird erneut ausgeführt).
 * DIESE DATEI WIRD VOM SKRIPT GESCHRIEBEN.
 */
import s0 from "./sim-appraisal-stone.json";
import s1 from "./sim-azubi-roth.json";
import s2 from "./sim-coaching-morgan-abwehrend.json";
import s3 from "./sim-coaching-morgan.json";
import s4 from "./sim-cold-kessler-freundlich.json";
import s5 from "./sim-cold-kessler.json";
import s6 from "./sim-complaint-hartmann-resigniert.json";
import s7 from "./sim-complaint-hartmann.json";
import s8 from "./sim-critique-vance-charmant.json";
import s9 from "./sim-critique-vance.json";
import s10 from "./sim-discovery-weber-offen.json";
import s11 from "./sim-discovery-weber-skeptisch.json";
import s12 from "./sim-discovery-weber.json";
import s13 from "./sim-disengaged-keller-gereizt.json";
import s14 from "./sim-disengaged-keller.json";
import s15 from "./sim-media-vogt-sanft.json";
import s16 from "./sim-media-vogt.json";
import s17 from "./sim-merge-brandt.json";
import s18 from "./sim-peer-falk.json";
import s19 from "./sim-peer-lang-polternd.json";
import s20 from "./sim-peer-lang.json";
import s21 from "./sim-performance-reed.json";
import s22 from "./sim-price-faber.json";
import s23 from "./sim-promotion-albrecht-abgetaucht.json";
import s24 from "./sim-promotion-albrecht-fordernd.json";
import s25 from "./sim-promotion-albrecht.json";

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
  [s8.scenarioId]: s8,
  [s9.scenarioId]: s9,
  [s10.scenarioId]: s10,
  [s11.scenarioId]: s11,
  [s12.scenarioId]: s12,
  [s13.scenarioId]: s13,
  [s14.scenarioId]: s14,
  [s15.scenarioId]: s15,
  [s16.scenarioId]: s16,
  [s17.scenarioId]: s17,
  [s18.scenarioId]: s18,
  [s19.scenarioId]: s19,
  [s20.scenarioId]: s20,
  [s21.scenarioId]: s21,
  [s22.scenarioId]: s22,
  [s23.scenarioId]: s23,
  [s24.scenarioId]: s24,
  [s25.scenarioId]: s25,
};
