"use client"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import { useAuth } from "@/providers/auth-provider"
import { signOut } from "@/lib/auth-service"
import { useToast } from "@/hooks/use-toast"

export function UserNav() {
  const { user } = useAuth()
  const { toast } = useToast()

  if (!user) return null

  async function onSignOut() {
    const { error } = await signOut()
    if (error) {
      toast({
        title: "Sign out failed",
        description: error.message,
        variant: "destructive",
      })
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="text-right hidden sm:block">
        <div className="text-sm font-bold text-foreground leading-none mb-1">
          {user.displayName || "User"}
        </div>
        <button 
          onClick={onSignOut} 
          className="text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          Logout
        </button>
      </div>
      <Avatar className="h-10 w-10 border border-border shadow-neon">
        <AvatarImage src={user.photoURL || ""} alt={user.displayName || "User"} />
        <AvatarFallback className="bg-primary text-primary-foreground font-medium text-lg">
          {(user.displayName?.charAt(0) || user.email?.charAt(0) || "U").toUpperCase()}
        </AvatarFallback>
      </Avatar>
    </div>
  )
}
