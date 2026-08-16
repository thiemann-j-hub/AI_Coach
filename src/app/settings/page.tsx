import { redirect } from "next/navigation";

// 16.08. (Owner-Vorgabe): Kein eigener Einstellungen-Ort mehr — Konto & Daten
// leben als Karten auf der Profil-Seite. Alt-Lesezeichen landen dort.
export default function SettingsPage() {
  redirect("/profile");
}
