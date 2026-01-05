'use client';

import { useState } from 'react';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { rateAnalysisAction } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';

type StarRatingProps = {
  runId: string;
};

export function StarRating({ runId }: StarRatingProps) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [isRated, setIsRated] = useState(false);
  const { toast } = useToast();

  const handleRate = async (newRating: number) => {
    if (isRated) return;

    const oldRating = rating;
    setRating(newRating);
    setIsRated(true);

    const formData = new FormData();
    formData.append('runId', runId);
    formData.append('rating', String(newRating));

    const result = await rateAnalysisAction(formData);

    if (result?.error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Could not save your rating.',
      });
      setRating(oldRating);
      setIsRated(false);
    } else {
      toast({
        title: 'Thank you!',
        description: 'Your feedback has been saved.',
      });
    }
  };
  
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onClick={() => handleRate(star)}
          onMouseEnter={() => !isRated && setHoverRating(star)}
          onMouseLeave={() => setHoverRating(0)}
          aria-label={`Rate ${star} stars`}
          disabled={isRated}
          className="disabled:cursor-not-allowed"
        >
          <Star
            className={cn(
              'h-6 w-6 transition-colors',
              isRated ? 'cursor-not-allowed' : 'cursor-pointer',
              (hoverRating || rating) >= star
                ? 'text-yellow-400 fill-yellow-400'
                : 'text-muted-foreground'
            )}
          />
        </button>
      ))}
    </div>
  );
}
