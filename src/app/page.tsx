'use client';

import { useState } from 'react';
import { AppHeader } from '@/components/app/header';
import { AnalysisForm } from '@/components/app/analysis-form';
import { ResultsView } from '@/components/app/results-view';
import { HistoryList } from '@/components/app/history-list';
import type { AnalysisResult } from '@/lib/types';
import { useSessionId } from '@/lib/session';

export default function Home() {
  const [isLoading, setIsLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);

  const sessionId = useSessionId();

  const handleAnalysisComplete = (result: AnalysisResult, runId: string) => {
    setAnalysisResult(result);
    setCurrentRunId(runId);
    setIsLoading(false);
  };

  const handleNewAnalysis = () => {
    setAnalysisResult(null);
    setCurrentRunId(null);
  };

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main className="flex-1">
        <div className="container mx-auto grid flex-1 gap-12 px-4 py-8 md:grid-cols-[2fr_1fr]">
          <div className="flex flex-col gap-8">
            {analysisResult && currentRunId ? (
              <ResultsView
                result={analysisResult}
                runId={currentRunId}
                onNewAnalysis={handleNewAnalysis}
              />
            ) : (
              <AnalysisForm
                isLoading={isLoading}
                setIsLoading={setIsLoading}
                onAnalysisComplete={handleAnalysisComplete}
                sessionId={sessionId}
              />
            )}
          </div>
          <div className="flex flex-col gap-8">
            <HistoryList sessionId={sessionId} />
          </div>
        </div>
      </main>
    </div>
  );
}
