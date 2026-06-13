# LinkedIn Reference Images (optional)

Beide Dateien sind **optional**. Fehlen sie, degradiert die Bild-Generierung
kontrolliert (mit Server-Warnung im Log, siehe `src/lib/nanobanana.ts`):

1. **person-reference.jpg** — Foto der Person, die auf den generierten
   Post-Bildern erscheinen soll.
   - Vorhanden: das Modell nutzt Gesicht/Statur als Referenz.
   - Fehlt: neutraler Editorial-Stil ohne erkennbare Person
     (alternativ Beschreibung per ENV `LINKEDIN_IMAGE_PERSON`).
   - Empfehlung: klares Gesichtsfoto, professionelles Setting.

2. **pulscraft-logo.png** — Logo für die untere rechte Bildecke.
   - Vorhanden: Logo wird als Referenz mitgegeben und im Prompt angefordert.
   - Fehlt: die Logo-Anforderung wird komplett aus dem Prompt entfernt
     (kein frei erfundenes Logo mehr).
   - Empfehlung: transparentes PNG, mindestens 200x200px.

Der Markenname in Prompts kommt aus ENV `LINKEDIN_BRAND_NAME`
(leer = neutral, keine Erwähnung im Post-Text).
