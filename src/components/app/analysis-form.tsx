'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { runAnalysisAction } from '@/lib/actions';
import type { AnalysisResult } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';

const formSchema = z.object({
  conversationType: z.string().min(1, 'Please select a conversation type.'),
  goal: z.string().min(3, 'Goal must be at least 3 characters.'),
  transcript: z.string().min(20, 'Transcript must be at least 20 characters.'),
});

type AnalysisFormProps = {
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  onAnalysisComplete: (result: AnalysisResult, runId: string) => void;
  sessionId: string | null;
};

export function AnalysisForm({ isLoading, setIsLoading, onAnalysisComplete, sessionId }: AnalysisFormProps) {
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      conversationType: '',
      goal: '',
      transcript: '',
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!sessionId) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Session not found. Please refresh the page.',
      });
      return;
    }
    setIsLoading(true);

    const formData = new FormData();
    formData.append('conversationType', values.conversationType);
    formData.append('goal', values.goal);
    formData.append('transcript', values.transcript);
    formData.append('sessionId', sessionId);

    const result = await runAnalysisAction(formData);

    if (result?.error) {
      const errorMsg = Object.values(result.error).flat().join(' ');
      toast({
        variant: 'destructive',
        title: 'Analysis Failed',
        description: errorMsg || 'An unknown error occurred.',
      });
      setIsLoading(false);
    } else if (result?.data) {
      onAnalysisComplete(result.data.analysis, result.data.runId);
      form.reset();
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline">Analyze a Conversation</CardTitle>
        <CardDescription>
          Enter the details of your conversation below to get AI-powered feedback.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="conversationType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Conversation Type</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a type..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="interview">Interview</SelectItem>
                      <SelectItem value="presentation">Presentation</SelectItem>
                      <SelectItem value="sales-call">Sales Call</SelectItem>
                      <SelectItem value="customer-support">Customer Support</SelectItem>
                      <SelectItem value="team-meeting">Team Meeting</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="goal"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>What is your goal?</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., To clearly explain the project proposal" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="transcript"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Conversation Transcript</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Paste your conversation transcript here..."
                      className="min-h-[200px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full bg-accent text-accent-foreground hover:bg-accent/90" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isLoading ? 'Analyzing...' : 'Get Feedback'}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
