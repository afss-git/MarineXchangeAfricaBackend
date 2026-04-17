"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { Eye, EyeOff, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { AuthLeftPanel } from "@/components/auth-left-panel"
import { auth as authApi, ApiRequestError } from "@/lib/api"

const AFRICAN_COUNTRIES = [
  "Nigeria",
  "Ghana",
  "Kenya",
  "South Africa",
  "Tanzania",
  "Egypt",
  "Senegal",
  "Cameroon",
  "Mozambique",
  "Angola",
  "Other",
]

interface FormErrors {
  fullName?: string
  email?: string
  country?: string
  companyName?: string
  companyRegNumber?: string
  password?: string
  confirmPassword?: string
  terms?: string
}

export default function SellerSignupPage() {
  const router = useRouter()
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [errors, setErrors] = useState<FormErrors>({})
  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    phone: "",
    country: "",
    companyName: "",
    companyRegNumber: "",
    password: "",
    confirmPassword: "",
  })

  const validatePassword = (password: string) => {
    const hasUpperCase = /[A-Z]/.test(password)
    const hasLowerCase = /[a-z]/.test(password)
    const hasNumber = /[0-9]/.test(password)
    const hasMinLength = password.length >= 12

    if (!hasMinLength) return "Password must be at least 12 characters"
    if (!hasUpperCase) return "Password must contain an uppercase letter"
    if (!hasLowerCase) return "Password must contain a lowercase letter"
    if (!hasNumber) return "Password must contain a number"
    return null
  }

  const validateForm = () => {
    const newErrors: FormErrors = {}
    
    if (!formData.fullName.trim()) {
      newErrors.fullName = "This field is required"
    }
    
    if (!formData.email) {
      newErrors.email = "This field is required"
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = "Please enter a valid email address"
    }
    
    if (!formData.country) {
      newErrors.country = "This field is required"
    }
    
    if (!formData.companyName.trim()) {
      newErrors.companyName = "Company name is required for seller accounts"
    }
    
    if (!formData.companyRegNumber.trim()) {
      newErrors.companyRegNumber = "Company registration number is required"
    }
    
    if (!formData.password) {
      newErrors.password = "This field is required"
    } else {
      const passwordError = validatePassword(formData.password)
      if (passwordError) newErrors.password = passwordError
    }
    
    if (!formData.confirmPassword) {
      newErrors.confirmPassword = "This field is required"
    } else if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = "Passwords do not match"
    }
    
    if (!agreedToTerms) {
      newErrors.terms = "You must agree to the terms and conditions"
    }
    
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) return

    setIsLoading(true)
    setFormError(null)

    try {
      await authApi.sellerSignup({
        email: formData.email,
        password: formData.password,
        full_name: formData.fullName,
        phone: formData.phone,
        country: formData.country,
        company_name: formData.companyName,
        company_reg_no: formData.companyRegNumber,
      })
      setSuccess(true)
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.status === 409) {
          setFormError("An account with this email already exists.")
        } else if (err.status === 422) {
          setFormError("Please check your inputs. Password must be at least 12 characters with uppercase, lowercase, and a number.")
        } else if (err.status === 429) {
          setFormError("Too many attempts. Please try again later.")
        } else {
          setFormError(err.message)
        }
      } else {
        setFormError("Something went wrong. Please try again.")
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <AuthLeftPanel
        heading="List Your Maritime Assets to Buyers Across Africa"
        description="Join as a seller to list vessels, equipment, and industrial assets. Reach verified buyers in 15+ African markets."
        benefits={[
          "List unlimited maritime and industrial assets",
          "Receive purchase requests from verified buyers",
          "Create auctions for competitive pricing",
        ]}
      />

      {/* Right Panel */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center items-center px-6 py-12 bg-white overflow-y-auto">
        {/* Mobile Logo */}
        <div className="lg:hidden flex items-center gap-2 mb-8">
          <div className="w-10 h-10 rounded-lg overflow-hidden flex items-center justify-center bg-white">
            <Image src="/logo.jpeg" alt="Harbours360" width={40} height={40} className="w-full h-full object-contain" />
          </div>
          <div className="flex flex-col">
            <span className="text-xl font-bold tracking-tight">
              <span className="text-navy">Harbours</span>
              <span className="text-ocean">360</span>
            </span>
          </div>
        </div>

        <div className="w-full max-w-[480px]">
          {success ? (
            <div className="text-center py-12">
              <div className="mx-auto w-16 h-16 rounded-full bg-ocean/10 flex items-center justify-center mb-6">
                <CheckCircle2 className="w-8 h-8 text-ocean" />
              </div>
              <h2 className="text-2xl font-bold text-text-primary mb-3">Check Your Email</h2>
              <p className="text-text-secondary mb-6 max-w-sm mx-auto">
                We&apos;ve sent a verification link to <strong className="text-text-primary">{formData.email}</strong>.
                Please verify your email to activate your account.
              </p>
              <p className="text-text-secondary text-sm mb-8">
                Once verified, you can start listing products for sale.
              </p>
              <Link href="/login">
                <Button className="bg-ocean hover:bg-ocean-dark text-white">
                  Go to Login
                </Button>
              </Link>
            </div>
          ) : (
          <>
          {/* Header */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-text-primary mb-2">Create Seller Account</h2>
            <p className="text-text-secondary">Company details are required for seller accounts</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Form Error */}
            {formError && (
              <div className="p-3 rounded-lg bg-danger/10 border border-danger/20">
                <p className="text-danger text-sm">{formError}</p>
              </div>
            )}
            {/* Full Name */}
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name <span className="text-danger">*</span></Label>
              <Input
                id="fullName"
                type="text"
                value={formData.fullName}
                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                aria-invalid={!!errors.fullName}
                className={errors.fullName ? "border-danger focus-visible:border-danger focus-visible:ring-danger/20" : ""}
              />
              {errors.fullName && (
                <p className="text-danger text-sm">{errors.fullName}</p>
              )}
            </div>

            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email">Email Address <span className="text-danger">*</span></Label>
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

            {/* Phone */}
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="+234 800 000 0000"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
              <p className="text-text-secondary text-xs">Include country code</p>
            </div>

            {/* Country */}
            <div className="space-y-2">
              <Label htmlFor="country">Country <span className="text-danger">*</span></Label>
              <Select
                value={formData.country}
                onValueChange={(value) => setFormData({ ...formData, country: value })}
              >
                <SelectTrigger 
                  className={`w-full ${errors.country ? "border-danger focus-visible:border-danger focus-visible:ring-danger/20" : ""}`}
                  aria-invalid={!!errors.country}
                >
                  <SelectValue placeholder="Select your country" />
                </SelectTrigger>
                <SelectContent>
                  {AFRICAN_COUNTRIES.map((country) => (
                    <SelectItem key={country} value={country}>
                      {country}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.country && (
                <p className="text-danger text-sm">{errors.country}</p>
              )}
            </div>

            {/* Company Name */}
            <div className="space-y-2">
              <Label htmlFor="companyName">Company Name <span className="text-danger">*</span></Label>
              <Input
                id="companyName"
                type="text"
                value={formData.companyName}
                onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                aria-invalid={!!errors.companyName}
                className={errors.companyName ? "border-danger focus-visible:border-danger focus-visible:ring-danger/20" : ""}
              />
              {errors.companyName ? (
                <p className="text-danger text-sm">{errors.companyName}</p>
              ) : (
                <p className="text-text-secondary text-xs">Required for seller accounts</p>
              )}
            </div>

            {/* Company Registration Number */}
            <div className="space-y-2">
              <Label htmlFor="companyRegNumber">Company Registration Number <span className="text-danger">*</span></Label>
              <Input
                id="companyRegNumber"
                type="text"
                value={formData.companyRegNumber}
                onChange={(e) => setFormData({ ...formData, companyRegNumber: e.target.value })}
                aria-invalid={!!errors.companyRegNumber}
                className={errors.companyRegNumber ? "border-danger focus-visible:border-danger focus-visible:ring-danger/20" : ""}
              />
              {errors.companyRegNumber ? (
                <p className="text-danger text-sm">{errors.companyRegNumber}</p>
              ) : (
                <p className="text-text-secondary text-xs">Your official business registration number</p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-2">
              <Label htmlFor="password">Password <span className="text-danger">*</span></Label>
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
              {errors.password ? (
                <p className="text-danger text-sm">{errors.password}</p>
              ) : (
                <p className="text-text-secondary text-xs">Minimum 12 characters with uppercase, lowercase, and number</p>
              )}
            </div>

            {/* Confirm Password */}
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password <span className="text-danger">*</span></Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  aria-invalid={!!errors.confirmPassword}
                  className={`pr-10 ${errors.confirmPassword ? "border-danger focus-visible:border-danger focus-visible:ring-danger/20" : ""}`}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors"
                  aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.confirmPassword && (
                <p className="text-danger text-sm">{errors.confirmPassword}</p>
              )}
            </div>

            {/* Terms Checkbox */}
            <div className="space-y-2">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="terms"
                  checked={agreedToTerms}
                  onCheckedChange={(checked) => setAgreedToTerms(checked as boolean)}
                  aria-invalid={!!errors.terms}
                />
                <Label htmlFor="terms" className="text-sm font-normal leading-relaxed cursor-pointer">
                  I agree to the{" "}
                  <Link href="/terms" className="text-ocean hover:underline">Terms of Service</Link>
                  {" "}and{" "}
                  <Link href="/privacy" className="text-ocean hover:underline">Privacy Policy</Link>
                </Label>
              </div>
              {errors.terms && (
                <p className="text-danger text-sm">{errors.terms}</p>
              )}
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
                  Creating Account...
                </>
              ) : (
                "Create Seller Account"
              )}
            </Button>
          </form>

          {/* Sign In Link */}
          <div className="mt-6 text-center text-sm text-text-secondary">
            <p>
              Already have an account?{" "}
              <Link href="/login" className="text-ocean hover:text-ocean-dark font-medium transition-colors">
                Sign in
              </Link>
            </p>
            <p className="mt-2">
              <Link href="/signup/buyer" className="text-ocean hover:text-ocean-dark font-medium transition-colors">
                Sign up as Buyer instead
              </Link>
            </p>
          </div>

          {/* Note */}
          <p className="mt-6 text-center text-xs text-text-secondary">
            After registration, verify your email. Then complete KYC to start listing.
          </p>

          {/* Both Access Link */}
          <p className="mt-4 text-center text-xs text-text-secondary">
            Need both buyer and seller access?{" "}
            <Link href="/signup/seller-buyer" className="text-ocean hover:underline">
              Register as both
            </Link>
          </p>
          </>
          )}
        </div>
      </div>
    </>
  )
}
