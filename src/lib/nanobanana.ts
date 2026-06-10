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

const BASE_STYLE = `Professional LinkedIn post image.
Photo-realistic style featuring a distinguished business professional:
- Male, approximately 55 years old, slim build
- Wearing a light-gray suit with a black shirt underneath, no tie
- Relaxed, confident pose - leaning casually or arms crossed
- Background: modern concrete wall with subtle warm lighting

IMPORTANT VARIATIONS: Vary the clothing slightly (different shades of gray suits,
occasional navy or charcoal, sometimes with subtle patterns) and vary the background
(sometimes exposed brick, sometimes modern office, sometimes urban setting) to keep
each image unique while maintaining the professional aesthetic.

The image MUST include:
1. A prominent text overlay with the post headline - use bold, modern sans-serif font
2. The Pulscraft AI logo positioned in the bottom-right corner
3. Professional color grading with warm tones

The overall mood should be: confident, approachable, thought-leadership.`;

export function buildImagePrompt(postHeadline: string, postTopic: string): string {
  return `${BASE_STYLE}

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

  const prompt = buildImagePrompt(postHeadline, postTopic);

  // Build content parts: reference images + text prompt
  const parts: any[] = [];

  // Add person reference image if available
  const personRef = fileToBase64(PERSON_REF);
  if (personRef) {
    parts.push({
      text: "Reference photo of the person to feature in the image (use this face and build as reference):",
    });
    parts.push({
      inlineData: { mimeType: personRef.mimeType, data: personRef.base64 },
    });
  }

  // Add logo reference if available
  const logoRef = fileToBase64(LOGO_REF);
  if (logoRef) {
    parts.push({
      text: "The Pulscraft AI logo to include in the bottom-right corner:",
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
