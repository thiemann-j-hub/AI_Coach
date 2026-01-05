'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Separator } from '@/components/ui/separator';
import { StarRating } from '@/components/app/star-rating';
import type { AnalysisResult } from '@/lib/types';
import { ThumbsUp, TrendingUp, PenSquare, ShieldAlert, Download, ArrowLeft } from 'lucide-react';
import { PolarGrid, PolarAngleAxis, Radar, RadarChart } from 'recharts';

type ResultsViewProps = {
  result: AnalysisResult;
  runId: string;
  onNewAnalysis: () => void;
};

const iconMap = {
  strengths: <ThumbsUp className="h-5 w-5 text-green-500" />,
  improvements: <TrendingUp className="h-5 w-5 text-blue-500" />,
  riskFlags: <ShieldAlert className="h-5 w-5 text-red-500" />,
};

export function ResultsView({ result, runId, onNewAnalysis }: ResultsViewProps) {
  const chartData = Object.entries(result.scores).map(([key, value]) => ({
    metric: key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1'),
    value: value,
  }));
  const chartConfig = {
    value: {
      label: 'Score',
      color: 'hsl(var(--primary))',
    },
  };

  const handleDownload = () => {
    const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(
      JSON.stringify(result, null, 2)
    )}`;
    const link = document.createElement('a');
    link.href = jsonString;
    link.download = `comms-coach-analysis-${runId}.json`;
    link.click();
  };

  return (
    <div className="animate-in fade-in-50 duration-500">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle className="font-headline text-2xl">Analysis Complete</CardTitle>
              <CardDescription>Here's the feedback on your conversation.</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onNewAnalysis}>
                <ArrowLeft className="mr-2 h-4 w-4" /> New Analysis
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownload}>
                <Download className="mr-2 h-4 w-4" /> Download
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-8">
          <section>
            <h3 className="font-headline text-lg font-semibold mb-2">Summary</h3>
            <p className="text-muted-foreground">{result.summary}</p>
          </section>

          <Separator />

          <section className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <h3 className="font-headline text-lg font-semibold mb-4">Feedback Breakdown</h3>
              <div className="space-y-4">
                <FeedbackSection title="Strengths" items={result.strengths} icon={iconMap.strengths} />
                <FeedbackSection title="Improvements" items={result.improvements} icon={iconMap.improvements} />
                <FeedbackSection title="Risk Flags" items={result.riskFlags} icon={iconMap.riskFlags} />
              </div>
            </div>
            <div>
              <h3 className="font-headline text-lg font-semibold mb-4">Performance Scores</h3>
              <Card>
                <CardContent className="pt-6">
                  <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
                    <RadarChart data={chartData}>
                      <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
                      <PolarAngleAxis dataKey="metric" />
                      <PolarGrid />
                      <Radar
                        dataKey="value"
                        fill="var(--color-value)"
                        fillOpacity={0.6}
                        dot={{
                          r: 4,
                          fillOpacity: 1,
                        }}
                      />
                    </RadarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            </div>
          </section>
          
          {result.rewrites && result.rewrites.length > 0 && (
            <>
              <Separator />
              <section>
                <h3 className="font-headline text-lg font-semibold mb-4 flex items-center gap-2">
                  <PenSquare className="h-5 w-5 text-purple-500" />
                  Suggested Rewrites
                </h3>
                <div className="space-y-4">
                  {result.rewrites.map((rewrite, index) => (
                    <Card key={index} className="bg-muted/50">
                      <CardContent className="p-4 space-y-2">
                        <p className="text-sm">
                          <Badge variant="secondary" className="mr-2">Original</Badge>
                          <span className="font-code text-muted-foreground">{rewrite.original}</span>
                        </p>
                        <p className="text-sm">
                          <Badge variant="default" className="mr-2 bg-green-600">Rewrite</Badge>
                          <span className="font-code">{rewrite.rewritten}</span>
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            </>
          )}
        </CardContent>
        <CardFooter className="flex-col items-start gap-2 border-t pt-6 bg-muted/30">
          <p className="text-sm font-medium">Was this feedback helpful?</p>
          <StarRating runId={runId} />
        </CardFooter>
      </Card>
    </div>
  );
}

function FeedbackSection({ title, items, icon }: { title: string; items: string[]; icon: React.ReactNode }) {
  if (!items || items.length === 0) return null;

  return (
    <div>
      <h4 className="flex items-center gap-2 text-md font-semibold mb-2">
        {icon}
        {title}
      </h4>
      <ul className="list-disc list-inside space-y-1 text-muted-foreground">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
