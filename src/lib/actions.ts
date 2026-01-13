'use server';


import { z } from 'zod';
import { analyzeConversationTranscript } from '@/ai/flows/analyze-conversation-transcript';
import { db } from '@/lib/firebase';
import { collection, addDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore';

const analysisSchema = z.object({
  conversationType: z.string().min(1, 'Conversation type is required.'),
  goal: z.string().min(1, 'Goal is required.'),
  transcript: z.string().min(10, 'Transcript must be at least 10 characters.'),
});

export async function runAnalysisAction(formData: FormData) {
  const rawFormData = {
    conversationType: formData.get('conversationType'),
    goal: formData.get('goal'),
    transcript: formData.get('transcript'),
  };

  const validation = analysisSchema.safeParse(rawFormData);

  if (!validation.success) {
    return {
      error: validation.error.flatten().fieldErrors,
    };
  }

  const { conversationType, goal, transcript } = validation.data;
  const sessionId = formData.get('sessionId') as string;

  if (!sessionId) {
    return {
      error: { _form: ['Session ID is missing. Please refresh the page.'] },
    };
  }

  try {
    const analysisResult = await analyzeConversationTranscript({
      conversationType,
      goal,
      transcript,
    });

    const historyRef = await addDoc(collection(db, 'runs'), {
      sessionId,
      conversationType,
      goal,
      createdAt: serverTimestamp(),
      rating: 0,
    });

    return {
      data: {
        analysis: analysisResult,
        runId: historyRef.id,
      },
    };
  } catch (e) {
    console.error(e);
    return {
      error: { _form: ['Analysis failed. Please try again.'] },
    };
  }
}

const ratingSchema = z.object({
  runId: z.string(),
  rating: z.coerce.number().min(1).max(5),
});

export async function rateAnalysisAction(formData: FormData) {
  const rawFormData = {
    runId: formData.get('runId'),
    rating: formData.get('rating'),
  };

  const validation = ratingSchema.safeParse(rawFormData);

  if (!validation.success) {
    return {
      error: validation.error.flatten().fieldErrors,
    };
  }

  try {
    const { runId, rating } = validation.data;
    const runDocRef = doc(db, 'runs', runId);
    await updateDoc(runDocRef, { rating });
    return { success: true };
  } catch (e) {
    console.error(e);
    return {
      error: { _form: ['Failed to save rating.'] },
    };
  }
}
