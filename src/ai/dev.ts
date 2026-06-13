import { config } from 'dotenv';
config();

// Produktiv genutzte Genkit-Flows (vom /api/analyze-Pfad):
import '@/ai/flows/generate-tailored-feedback.ts';
import '@/ai/flows/score-competencies.ts';
