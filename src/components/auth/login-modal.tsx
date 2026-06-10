"use client"

import * as React from "react"
import { signInWithMicrosoft } from "@/lib/auth-service"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { useAuth } from "@/providers/auth-provider"
import { useTranslation } from "@/i18n/useTranslation"
import { LanguageSwitcher } from "@/components/language-switcher"

interface LoginModalProps {
  children?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function LoginModal({ children, open: controlledOpen, onOpenChange: controlledOnOpenChange }: LoginModalProps) {
  const [internalOpen, setInternalOpen] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(false)
  const { toast } = useToast()
  const { user } = useAuth()
  const { t } = useTranslation()

  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = isControlled ? controlledOnOpenChange : setInternalOpen

  // Close modal when user is logged in
  React.useEffect(() => {
    if (user && open) {
      setOpen?.(false)
    }
  }, [user, open, setOpen])

  async function onMicrosoftSignIn() {
    setIsLoading(true)
    try {
      const { error } = await signInWithMicrosoft()
      if (error) throw error
      // isLoading bleibt true — der Browser navigiert zur Microsoft-Anmeldung
    } catch (error: any) {
      toast({
        title: t.auth.loginFailed,
        description: error?.message || t.auth.genericError,
        variant: "destructive",
      })
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {(!isControlled || children) && (
        <DialogTrigger asChild>
          {children || <Button variant="outline">{t.auth.signIn}</Button>}
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{t.auth.authTitle}</DialogTitle>
          <DialogDescription>
            {t.auth.authDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-2">
          <Button type="button" disabled={isLoading} onClick={onMicrosoftSignIn} className="w-full">
            {isLoading ? (
              <span className="mr-2 h-4 w-4 animate-spin">...</span>
            ) : (
              <svg className="mr-2 h-4 w-4" aria-hidden="true" viewBox="0 0 23 23" xmlns="http://www.w3.org/2000/svg">
                <rect x="1" y="1" width="10" height="10" fill="#f25022" />
                <rect x="12" y="1" width="10" height="10" fill="#7fba00" />
                <rect x="1" y="12" width="10" height="10" fill="#00a4ef" />
                <rect x="12" y="12" width="10" height="10" fill="#ffb900" />
              </svg>
            )}
            {t.auth.signInWithMicrosoft}
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            {t.auth.microsoftHint}
          </p>

          <div className="flex justify-center">
            <LanguageSwitcher compact />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
