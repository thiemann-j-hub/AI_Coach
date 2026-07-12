"use client"

import Link from "next/link"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import { useAuth } from "@/providers/auth-provider"
import { useTranslation } from "@/i18n/useTranslation"
import { signOut } from "@/lib/auth-service"
import { useToast } from "@/hooks/use-toast"

export function UserNav() {
  const { user } = useAuth()
  const { toast } = useToast()
  const { t } = useTranslation()

  if (!user) return null

  async function onSignOut() {
    const { error } = await signOut()
    if (error) {
      toast({
        title: t.auth.signOutFailed,
        description: error.message,
        variant: "destructive",
      })
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="text-right hidden sm:block">
        <div className="text-sm font-bold text-foreground leading-none mb-1">
          {user.displayName || t.auth.user}
        </div>
        <div className="text-xs text-muted-foreground flex items-center gap-2 justify-end">
          <Link href="/settings" className="hover:text-primary transition-colors">
            Einstellungen
          </Link>
          <span aria-hidden>·</span>
          <button onClick={onSignOut} className="hover:text-primary transition-colors">
            {t.auth.signOut}
          </button>
        </div>
      </div>
      <Avatar className="h-10 w-10 border border-border shadow-neon">
        <AvatarImage src={user.photoURL || ""} alt={user.displayName || t.auth.user} />
        <AvatarFallback className="bg-gradient-to-br from-primary to-accent text-white font-medium text-lg">
          {(user.displayName?.charAt(0) || user.email?.charAt(0) || "U").toUpperCase()}
        </AvatarFallback>
      </Avatar>
    </div>
  )
}
