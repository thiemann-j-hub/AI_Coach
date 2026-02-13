"use client"

import * as React from "react"
import { signInWithGoogle, signInWithEmail, signUpWithEmail } from "@/lib/auth-service"
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/providers/auth-provider"

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

  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = isControlled ? controlledOnOpenChange : setInternalOpen

  // Close modal when user is logged in
  React.useEffect(() => {
    if (user && open) {
      setOpen?.(false)
    }
  }, [user, open, setOpen])

  async function onGoogleSignIn() {
    setIsLoading(true)
    try {
      const { error } = await signInWithGoogle()
      if (error) throw error
    } catch (error: any) {
      toast({
        title: "Login failed",
        description: error?.message || "Something went wrong.",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>, mode: "login" | "register") {
    event.preventDefault()
    setIsLoading(true)

    const formData = new FormData(event.currentTarget)
    const email = formData.get("email") as string
    const password = formData.get("password") as string

    try {
      if (mode === "login") {
        const { error } = await signInWithEmail(email, password)
        if (error) throw error
      } else {
        const { error } = await signUpWithEmail(email, password)
        if (error) throw error
      }
    } catch (error: any) {
      toast({
        title: mode === "login" ? "Login failed" : "Registration failed",
        description: error?.message || "Something went wrong.",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {(!isControlled || children) && (
        <DialogTrigger asChild>
          {children || <Button variant="outline">Sign In</Button>}
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[425px]">

        <DialogHeader>
          <DialogTitle>Authentication</DialogTitle>
          <DialogDescription>
            Sign in to your account or create a new one to save your progress.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6">
          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Login</TabsTrigger>
              <TabsTrigger value="register">Register</TabsTrigger>
            </TabsList>
            <TabsContent value="login">
              <form onSubmit={(e) => onSubmit(e, "login")}>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="email-login">Email</Label>
                    <Input id="email-login" name="email" type="email" placeholder="m@example.com" required />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="password-login">Password</Label>
                    <Input id="password-login" name="password" type="password" required />
                  </div>
                  <Button type="submit" disabled={isLoading}>
                    {isLoading && (
                      <span className="mr-2 h-4 w-4 animate-spin">...</span>
                    )}
                    Sign In with Email
                  </Button>
                </div>
              </form>
            </TabsContent>
            <TabsContent value="register">
              <form onSubmit={(e) => onSubmit(e, "register")}>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="email-register">Email</Label>
                    <Input id="email-register" name="email" type="email" placeholder="m@example.com" required />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="password-register">Password</Label>
                    <Input id="password-register" name="password" type="password" required minLength={6} />
                  </div>
                  <Button type="submit" disabled={isLoading}>
                    {isLoading && (
                      <span className="mr-2 h-4 w-4 animate-spin">...</span>
                    )}
                    Create Account
                  </Button>
                </div>
              </form>
            </TabsContent>
          </Tabs>
          
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or continue with
              </span>
            </div>
          </div>

          <Button variant="outline" type="button" disabled={isLoading} onClick={onGoogleSignIn}>
            {isLoading ? (
              <span className="mr-2 h-4 w-4 animate-spin">...</span>
            ) : (
              <svg className="mr-2 h-4 w-4" aria-hidden="true" focusable="false" data-prefix="fab" data-icon="google" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 488 512">
                <path fill="currentColor" d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z"></path>
              </svg>
            )}
            Google
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
