/**
 * NanoBanana Pro (Gemini 3 Pro Image) - Image generation utility
 *
 * Generates styled LinkedIn post images using Google's NanoBanana Pro model.
 * Reference images (person photo + Pulscraft logo) are read from public/linkedin/.
 */

import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const NANOBANANA_MODEL = process.env.NANOBANANA_MODEL ?? "gemini-2.0-flash-exp";

const REF_DIR = path.join(process.cwd(), "public", "linkedin");
const PERSON_REF = path.join(REF_DIR, "person-reference.jpg");
const LOGO_REF = path.join(REF_DIR, "pulscraft-logo.png");

// Branding/Persona konfigurierbar statt hardcoded (LI-E9):
// leer = neutraler Stil ohne feste Person bzw. ohne Logo-Anforderung
const BRAND_NAME = (process.env.LINKEDIN_BRAND_NAME ?? "").trim();
const PERSON_DESCRIPTION = (process.env.LINKEDIN_IMAGE_PERSON ?? "").trim();

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fileToBase64(filePath: string): { base64: string; mimeType: string } | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
    };
    return {
      base64: buffer.toString("base64"),
      mimeType: mimeMap[ext] ?? "image/jpeg",
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Style prompt builder                                               */
/* ------------------------------------------------------------------ */

export interface ImagePromptRefs {
  hasPersonRef: boolean;
  hasLogoRef: boolean;
}

/**
 * Personen-Darstellung (LI-E9): Referenzfoto > ENV-Beschreibung > neutral
 * ohne erkennbare Person. Kein hardcodierter Default mehr.
 */
function buildPersonBlock(hasPersonRef: boolean): string {
  if (hasPersonRef) {
    return `Photo-realistic style featuring the business professional from the provided reference photo
(use the same face and build as in the reference):
- Professional business attire
- Relaxed, confident pose - leaning casually or arms crossed
- Background: modern concrete wall with subtle warm lighting

IMPORTANT VARIATIONS: Vary the clothing slightly (different shades of business attire)
and vary the background (sometimes exposed brick, sometimes modern office, sometimes
urban setting) to keep each image unique while maintaining the professional aesthetic.`;
  }
  if (PERSON_DESCRIPTION) {
    return `Photo-realistic style featuring a business professional:
- ${PERSON_DESCRIPTION}
- Relaxed, confident pose - leaning casually or arms crossed
- Background: modern concrete wall with subtle warm lighting

IMPORTANT VARIATIONS: Vary the clothing slightly and vary the background
(sometimes exposed brick, sometimes modern office, sometimes urban setting) to keep
each image unique while maintaining the professional aesthetic.`;
  }
  return `Clean, modern editorial style WITHOUT any recognizable person:
- Abstract professional setting (modern office architecture, workspace details,
  soft-focus urban scenery or elegant geometric composition)
- Subtle warm lighting, calm and premium feel

IMPORTANT VARIATIONS: Vary the setting and composition between generations to keep
each image unique while maintaining the professional aesthetic.`;
}

export function buildImagePrompt(
  postHeadline: string,
  postTopic: string,
  refs: ImagePromptRefs
): string {
  // Logo nur anfordern, wenn die Referenzdatei wirklich mitgegeben wird —
  // sonst erfindet das Modell ein Logo (LI-E8)
  const mustInclude = [
    "A prominent text overlay with the post headline - use bold, modern sans-serif font",
    ...(refs.hasLogoRef
      ? [`The provided ${BRAND_NAME || "brand"} logo positioned in the bottom-right corner`]
      : []),
    "Professional color grading with warm tones",
  ];

  return `Professional LinkedIn post image.
${buildPersonBlock(refs.hasPersonRef)}

The image MUST include:
${mustInclude.map((item, i) => `${i + 1}. ${item}`).join("\n")}

The overall mood should be: confident, approachable, thought-leadership.

TEXT OVERLAY on the image: "${postHeadline}"

The topic/theme of this post is: ${postTopic}

Generate a single high-quality image suitable for a LinkedIn post (1200x627 pixels aspect ratio, approximately 2:1).
Make the text clearly readable against the background. Use a semi-transparent overlay bar behind the text if needed for readability.`;
}

/* ------------------------------------------------------------------ */
/*  Generate image                                                     */
/* ------------------------------------------------------------------ */

export interface GenerateImageResult {
  imageBase64: string;
  mimeType: string;
  prompt: string;
}

export async function generateLinkedInImage(
  postHeadline: string,
  postTopic: string
): Promise<GenerateImageResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const ai = new GoogleGenAI({ apiKey });

  // Referenzen zuerst pruefen, damit der Prompt nur anfordert, was wirklich
  // mitgegeben wird — keine stille Branding-Degradation mehr (LI-E8)
  const personRef = fileToBase64(PERSON_REF);
  const logoRef = fileToBase64(LOGO_REF);
  if (!personRef) {
    console.warn(
      "[nanobanana] public/linkedin/person-reference.jpg fehlt — generiere ohne Personen-Referenz (neutraler Stil)."
    );
  }
  if (!logoRef) {
    console.warn(
      "[nanobanana] public/linkedin/pulscraft-logo.png fehlt — Logo-Anforderung wird aus dem Prompt entfernt."
    );
  }

  const prompt = buildImagePrompt(postHeadline, postTopic, {
    hasPersonRef: !!personRef,
    hasLogoRef: !!logoRef,
  });

  // Build content parts: reference images + text prompt
  const parts: any[] = [];

  if (personRef) {
    parts.push({
      text: "Reference photo of the person to feature in the image (use this face and build as reference):",
    });
    parts.push({
      inlineData: { mimeType: personRef.mimeType, data: personRef.base64 },
    });
  }

  if (logoRef) {
    parts.push({
      text: `The ${BRAND_NAME || "brand"} logo to include in the bottom-right corner:`,
    });
    parts.push({
      inlineData: { mimeType: logoRef.mimeType, data: logoRef.base64 },
    });
  }

  // Add the main generation prompt
  parts.push({ text: prompt });

  const response = await ai.models.generateContent({
    model: NANOBANANA_MODEL,
    contents: [{ role: "user", parts }],
    config: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  });

  // Extract image from response
  const candidates = response.candidates ?? [];
  for (const candidate of candidates) {
    const content = candidate.content;
    if (!content?.parts) continue;
    for (const part of content.parts) {
      if (part.inlineData?.data && part.inlineData?.mimeType?.startsWith("image/")) {
        return {
          imageBase64: part.inlineData.data,
          mimeType: part.inlineData.mimeType,
          prompt,
        };
      }
    }
  }

  throw new Error("NanoBanana Pro did not return an image. The model may not support image generation with this API key.");
}
