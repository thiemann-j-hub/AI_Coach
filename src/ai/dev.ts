import { config } from 'dotenv';
config();

import '@/ai/flows/generate-tailored-feedback.ts';
import '@/ai/flows/contextual-enrichment.ts';
import '@/ai/flows/analyze-conversation-transcript.ts';