"use client";

import { BrainCircuit } from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import { UserNav } from '@/components/auth/user-nav';
import { LoginModal } from '@/components/auth/login-modal';

export function AppHeader() {
  const { user, loading } = useAuth();

  return (
    <header className="border-b">
      <div className="container mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BrainCircuit className="h-8 w-8 text-primary" />
          <h1 className="font-headline text-2xl font-bold text-foreground">
            CommsCoach AI
          </h1>
        </div>
        <div>
          {!loading && (
            user ? <UserNav /> : <LoginModal />
          )}
        </div>
      </div>
    </header>
  );
}

