"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Eye, EyeOff, Anchor } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { AuthLeftPanel } from "@/components/auth-left-panel"
import { useAuth } from "@/lib/auth"
import { ApiRequestError } from "@/lib/api"

export default function LoginPage() {
  const router = useRouter()
  const { login } = useAuth()
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({})
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  })

  const validateForm = () => {
    const newErrors: { email?: string; password?: string } = {}
    
    if (!formData.email) {
      newErrors.email = "Email is required"
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = "Please enter a valid email address"
    }
    
    if (!formData.password) {
      newErrors.password = "Password is required"
    }
    
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) return

    setIsLoading(true)
    setErrors({})

    try {
      const data = await login(formData.email, formData.password)
      // Redirect based on role
      const roles = data.user.roles
      if (roles.includes("admin") || roles.includes("finance_admin")) {
        router.push("/admin")
      } else if (roles.includes("verification_agent") || roles.includes("buyer_agent")) {
        router.push("/agent/kyc")
      } else if (roles.includes("seller") && !roles.includes("buyer")) {
        router.push("/seller")
      } else {
        router.push("/dashboard")
      }
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.status === 403) {
          // 403 = email not confirmed — show the actual backend message
          setErrors({ form: err.message || "Please verify your email address before logging in." })
        } else if (err.status === 401) {
          setErrors({ form: "Invalid email or password." })
        } else if (err.status === 429) {
          setErrors({ form: "Too many attempts. Please try again later." })
        } else {
          setErrors({ form: err.message })
        }
      } else {
        setErrors({ form: "Something went wrong. Please try again." })
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <AuthLeftPanel
        heading="Trade with Confidence"
        description="Africa's most trusted B2B marketplace for maritime and industrial assets. Verified companies, secure transactions, complete transparency."
        benefits={[
          "KYC-verified buyers and sellers",
          "Escrow-protected payments",
          "Complete audit trail on every transaction",
        ]}
      />

      {/* Right Panel */}
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
          {/* Header */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-text-primary mb-2">Welcome back</h2>
            <p className="text-text-secondary">Sign in to your account</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Form Error */}
            {errors.form && (
              <div className="p-3 rounded-lg bg-danger/10 border border-danger/20">
                <p className="text-danger text-sm">{errors.form}</p>
              </div>
            )}

            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="name@company.com"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                aria-invalid={!!errors.email}
                className={errors.email ? "border-danger focus-visible:border-danger focus-visible:ring-danger/20" : ""}
              />
              {errors.email && (
                <p className="text-danger text-sm">{errors.email}</p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  aria-invalid={!!errors.password}
                  className={`pr-10 ${errors.password ? "border-danger focus-visible:border-danger focus-visible:ring-danger/20" : ""}`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && (
                <p className="text-danger text-sm">{errors.password}</p>
              )}
            </div>

            {/* Forgot Password */}
            <div className="flex justify-end">
              <Link 
                href="/forgot-password" 
                className="text-sm text-ocean hover:text-ocean-dark transition-colors"
              >
                Forgot password?
              </Link>
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={isLoading}
              className="w-full bg-ocean hover:bg-ocean-dark text-white h-11"
            >
              {isLoading ? (
                <>
                  <Spinner className="mr-2" />
                  Signing in...
                </>
              ) : (
                "Sign In"
              )}
            </Button>
          </form>

          {/* Divider */}
          <div className="relative my-8">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-white px-4 text-text-secondary">or</span>
            </div>
          </div>

          {/* Sign Up Links */}
          <div className="text-center space-y-3">
            <p className="text-text-secondary text-sm">{"Don't have an account?"}</p>
            <div className="flex items-center justify-center gap-4">
              <Link 
                href="/signup/buyer" 
                className="text-ocean hover:text-ocean-dark font-medium text-sm transition-colors"
              >
                Sign up as Buyer
              </Link>
              <span className="text-border">|</span>
              <Link 
                href="/signup/seller" 
                className="text-ocean hover:text-ocean-dark font-medium text-sm transition-colors"
              >
                Sign up as Seller
              </Link>
            </div>
          </div>

          {/* Terms */}
          <p className="mt-10 text-center text-xs text-text-secondary">
            By signing in, you agree to our{" "}
            <Link href="/terms" className="text-ocean hover:underline">Terms of Service</Link>
            {" "}and{" "}
            <Link href="/privacy" className="text-ocean hover:underline">Privacy Policy</Link>
          </p>
        </div>
      </div>
    </>
  )
}
