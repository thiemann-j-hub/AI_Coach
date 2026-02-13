"use client";

import { useAuth } from "@/providers/auth-provider";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { LoginModal } from "./login-modal";
import { Button } from "@/components/ui/button";

interface AuthGuardProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function AuthGuard({ children, fallback }: AuthGuardProps) {
  const { user, loading } = useAuth();
  const router = useRouter();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <p className="text-muted-foreground">Please sign in to access this page.</p>
        
        <LoginModal 
          open={true} 
          onOpenChange={(open) => {
            if (!open) {
              // If user closes modal without logging in, redirect to home
              router.push("/");
            }
          }}
        >
          <Button>Sign In</Button>
        </LoginModal>
      </div>
    );
  }

  return <>{children}</>;
}

