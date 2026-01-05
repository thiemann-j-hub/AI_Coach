'use client';

import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { HistoryItem } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { History, Star } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

type HistoryListProps = {
  sessionId: string | null;
};

export function HistoryList({ sessionId }: HistoryListProps) {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) {
      setIsLoading(false);
      return;
    }

    const q = query(
      collection(db, 'runs'),
      where('sessionId', '==', sessionId),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const items: HistoryItem[] = [];
      querySnapshot.forEach((doc) => {
        items.push({ id: doc.id, ...doc.data() } as HistoryItem);
      });
      setHistory(items);
      setIsLoading(false);
    }, (error) => {
        console.error("Error fetching history:", error);
        setIsLoading(false);
    });

    return () => unsubscribe();
  }, [sessionId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline flex items-center gap-2">
          <History className="h-5 w-5" />
          Run History
        </CardTitle>
        <CardDescription>
          Recent analyses from your current session.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : history.length > 0 ? (
          <ul className="space-y-4">
            {history.map((item) => (
              <li key={item.id} className="rounded-lg border p-3">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold capitalize">{item.conversationType.replace(/-/g, ' ')}</p>
                    <p className="text-sm text-muted-foreground truncate max-w-[150px]">
                      Goal: {item.goal}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    <div className="flex items-center justify-end gap-1 text-sm text-muted-foreground">
                      <Star className={`h-4 w-4 ${item.rating && item.rating > 0 ? 'text-yellow-400 fill-yellow-400' : ''}`} />
                      <span>{item.rating || 'N/A'}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {item.createdAt ? formatDistanceToNow(item.createdAt.toDate(), { addSuffix: true }) : ''}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">
            No history yet. Run an analysis to get started.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
