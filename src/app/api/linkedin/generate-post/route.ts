import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { GoogleGenAI } from "@google/genai";
import { requireAuth } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

const schema = z.object({
  summary: z.string().min(1).max(2000),
  strengths: z.array(z.string()).default([]),
  improvements: z.array(z.string()).default([]),
  scoreOverall: z.number().min(0).max(100).nullable().default(null),
  conversationType: z.string().default(""),
  lang: z.enum(["de", "en", "fr", "it", "es", "pl", "cs"]).default("de"),
});

const LANG_LABELS: Record<string, string> = {
  de: "Deutsch",
  en: "English",
  fr: "Fran\u00e7ais",
  it: "Italiano",
  es: "Espa\u00f1ol",
  pl: "Polski",
  cs: "\u010Ce\u0161tina",
};

export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  // Rate limit: 5 Post-Generierungen pro Minute (Gemini-Kosten)
  const rlResponse = checkRateLimit(rateLimitKey(req, "li-generate-post"), 5, 60_000);
  if (rlResponse) return rlResponse;

  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { summary, strengths, improvements, scoreOverall, conversationType, lang } = parsed.data;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });
    }

    const ai = new GoogleGenAI({ apiKey });

    const prompt = `Du bist ein LinkedIn-Content-Experte. Erstelle einen professionellen, engagierenden LinkedIn-Post basierend auf den folgenden Coaching-Analyse-Ergebnissen.

ANALYSE-DATEN:
- Zusammenfassung: ${summary}
- Staerken: ${strengths.join(", ") || "keine angegeben"}
- Verbesserungspotential: ${improvements.join(", ") || "keine angegeben"}
- Gesamtscore: ${scoreOverall !== null ? `${scoreOverall}%` : "nicht verfuegbar"}
- Gespraechstyp: ${conversationType || "Coaching-Gespraech"}

ANFORDERUNGEN:
1. Schreibe den Post auf ${LANG_LABELS[lang] ?? "Deutsch"}
2. Laenge: 150-300 Woerter (ideal fuer LinkedIn Engagement)
3. Beginne mit einem aufmerksamkeitsstarken Hook (Frage oder provokante Aussage)
4. Teile 1-2 konkrete Erkenntnisse aus der Analyse (anonymisiert, keine persoenlichen Details)
5. Ende mit einem Call-to-Action oder einer Frage an die Community
6. Verwende relevante Hashtags (3-5, am Ende)
7. Verwende Emojis sparsam aber wirkungsvoll
8. Erwaehne Pulscraft AI als Tool fuer KI-gestuetztes Coaching
9. Ton: professionell, authentisch, inspirierend

Gib NUR den Post-Text zurueck, ohne Erklaerungen oder Metadaten.
Gib ausserdem eine kurze Headline (max 10 Woerter) fuer das Bild zurueck.

FORMAT:
---HEADLINE---
[Kurze Headline fuer das Bild]
---POST---
[Der LinkedIn Post Text]`;

    const response = await ai.models.generateContent({
      model: process.env.GEMINI_TEXT_MODEL ?? "gemini-1.5-flash",
      contents: prompt,
    });

    const text = response.text ?? "";

    // Parse headline and post from response
    let headline = "";
    let postText = text;

    const headlineMatch = text.match(/---HEADLINE---\s*([\s\S]*?)---POST---/);
    const postMatch = text.match(/---POST---\s*([\s\S]*)/);

    if (headlineMatch && postMatch) {
      headline = headlineMatch[1].trim();
      postText = postMatch[1].trim();
    }

    return NextResponse.json({ headline, postText });
  } catch (err: any) {
    console.error("[generate-post] Error:", err?.message ?? err);
    return NextResponse.json(
      { error: "Post generation failed", message: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
