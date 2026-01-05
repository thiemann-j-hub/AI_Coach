import { BrainCircuit } from 'lucide-react';

export function AppHeader() {
  return (
    <header className="border-b">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center gap-3">
          <BrainCircuit className="h-8 w-8 text-primary" />
          <h1 className="font-headline text-2xl font-bold text-foreground">
            CommsCoach AI
          </h1>
        </div>
      </div>
    </header>
  );
}
