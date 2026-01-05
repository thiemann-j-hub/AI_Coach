import type { AnalyzeConversationTranscriptOutput } from '@/ai/flows/analyze-conversation-transcript';
import type { Timestamp } from 'firebase/firestore';

export type AnalysisResult = AnalyzeConversationTranscriptOutput;

export interface HistoryItem {
  id: string;
  sessionId: string;
  conversationType: string;
  goal: string;
  rating?: number;
  createdAt: Timestamp;
}
