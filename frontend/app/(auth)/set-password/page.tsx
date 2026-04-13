"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Eye, EyeOff, Anchor, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { AuthLeftPanel } from "@/components/auth-left-panel"
import { profile as profileApi, ApiRequestError } from "@/lib/api"

export default function SetPasswordPage() {
  const router = useRouter()
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [tokenError, setTokenError] = useState(false)
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [errors, setErrors] = useState<{ password?: string; confirm?: string; form?: string }>({})

  // Parse access_token from URL hash on mount (#access_token=...&type=invite)
  useEffect(() => {
    const hash = window.location.hash.slice(1)
    const params = new URLSearchParams(hash)
    const token = params.get("access_token")
    const type = params.get("type")
    if (token && (type === "invite" || type === "recovery")) {
      localStorage.setItem("access_token", token)
      setAccessToken(token)
    } else {
      setTokenError(true)
    }
  }, [])

  const validate = () => {
    const e: typeof errors = {}
    if (password.length < 12) e.password = "Password must be at least 12 characters"
    if (password !== confirm) e.confirm = "Passwords do not match"
    return e
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const e2 = validate()
    if (Object.keys(e2).length) { setErrors(e2); return }
    setErrors({})
    setIsLoading(true)
    try {
      const token = localStorage.getItem("access_token")
      console.log("[SetPassword] Token present:", !!token, "length:", token?.length)
      console.log("[SetPassword] Calling POST /auth/me/set-password...")
      await profileApi.setPassword({ new_password: password })
      console.log("[SetPassword] SUCCESS")
      localStorage.removeItem("access_token")
      localStorage.removeItem("refresh_token")
      setDone(true)
    } catch (err: unknown) {
      console.error("[SetPassword] Full error:", err)
      console.error("[SetPassword] Error type:", typeof err, err?.constructor?.name)
      let msg: string
      if (err instanceof ApiRequestError) {
        msg = `${err.message} (HTTP ${err.status})`
      } else if (err instanceof TypeError) {
        msg = `Network error — could not reach server. Check your connection. (${(err as TypeError).message})`
      } else {
        msg = `Unexpected error: ${String(err)}`
      }
      setErrors({ form: msg })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <AuthLeftPanel
        heading="Set Up Your Account"
        description="You've been invited to join Harbours360. Create a secure password to activate your staff account."
        benefits={[
          "KYC-verified buyers and sellers",
          "Escrow-protected payments",
          "Complete audit trail on every transaction",
        ]}
      />

      <div className="w-full lg:w-1/2 flex flex-col justify-center items-center px-6 py-12 bg-white">
        {/* Mobile Logo */}
        <div className="lg:hidden flex items-center gap-2 mb-8">
          <div className="w-10 h-10 rounded-lg bg-ocean/10 flex items-center justify-center">
            <Anchor className="w-6 h-6 text-ocean" />
          </div>
          <div className="flex flex-col">
            <span className="text-xl font-bold tracking-tight">
              <span className="text-navy">Marine</span>
              <span className="text-ocean">Xchange</span>
            </span>
            <span className="text-text-secondary text-xs tracking-wide">Africa</span>
          </div>
        </div>

        <div className="w-full max-w-[420px]">
          {tokenError ? (
            <div className="text-center space-y-4">
              <h2 className="text-2xl font-bold text-text-primary">Invalid or Expired Link</h2>
              <p className="text-text-secondary">
                This invitation link is invalid or has expired. Please ask your administrator to resend
                the invitation.
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => router.push("/login")}
              >
                Back to Login
              </Button>
            </div>
          ) : done ? (
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <CheckCircle2 className="w-14 h-14 text-success" />
              </div>
              <h2 className="text-2xl font-bold text-text-primary">Password Set!</h2>
              <p className="text-text-secondary">
                Your account is now active. You can log in with your email and new password.
              </p>
              <Button
                className="w-full bg-ocean hover:bg-ocean-dark text-white h-11 mt-4"
                onClick={() => router.push("/login")}
              >
                Go to Login
              </Button>
            </div>
          ) : (
            <>
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-text-primary mb-2">Create Your Password</h2>
                <p className="text-text-secondary">
                  Choose a strong password to activate your Harbours360 account.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                {errors.form && (
                  <div className="p-3 rounded-lg bg-danger/10 border border-danger/20">
                    <p className="text-danger text-sm">{errors.form}</p>
                  </div>
                )}

                {/* Password */}
                <div className="space-y-2">
                  <Label htmlFor="password">New Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Min. 12 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={`pr-10 ${errors.password ? "border-danger focus-visible:ring-danger/20" : ""}`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {errors.password && <p className="text-danger text-sm">{errors.password}</p>}
                  <p className="text-xs text-text-secondary">
                    Must be at least 12 characters with uppercase, lowercase, number, and special character.
                  </p>
                </div>

                {/* Confirm */}
                <div className="space-y-2">
                  <Label htmlFor="confirm">Confirm Password</Label>
                  <div className="relative">
                    <Input
                      id="confirm"
                      type={showConfirm ? "text" : "password"}
                      placeholder="Re-enter your password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      className={`pr-10 ${errors.confirm ? "border-danger focus-visible:ring-danger/20" : ""}`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(!showConfirm)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors"
                    >
                      {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {errors.confirm && <p className="text-danger text-sm">{errors.confirm}</p>}
                </div>

                <Button
                  type="submit"
                  disabled={isLoading || !accessToken}
                  className="w-full bg-ocean hover:bg-ocean-dark text-white h-11"
                >
                  {isLoading ? (
                    <>
                      <Spinner className="mr-2" />
                      Setting password...
                    </>
                  ) : (
                    "Activate Account"
                  )}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </>
  )
}
