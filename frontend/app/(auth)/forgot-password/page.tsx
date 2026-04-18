"use client"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { ArrowLeft, Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AuthLeftPanel } from "@/components/auth-left-panel"

const SUPPORT_EMAIL = "cobwebb784@gmail.com"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [error, setError] = useState("")

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault()
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Please enter a valid email address.")
      return
    }
    const subject = encodeURIComponent("Password Reset Request — Harbours360")
    const body = encodeURIComponent(
      `Hi,\n\nI would like to reset my password for the following account:\n\nEmail: ${email.trim()}\n\nPlease send me a reset link.\n\nThank you.`
    )
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`
  }

  return (
    <>
      <AuthLeftPanel
        heading="Reset Your Password"
        description="Send us your registered email and our team will get you back into your account within one business day."
        benefits={[
          "Secure account recovery",
          "Response within 1 business day",
          "Your data is always protected",
        ]}
      />

      <div className="w-full lg:w-1/2 flex flex-col justify-center items-center px-6 py-12 bg-white">
        {/* Mobile Logo */}
        <div className="lg:hidden flex items-center gap-2 mb-8">
          <div className="w-10 h-10 rounded-lg overflow-hidden flex items-center justify-center bg-white border border-border">
            <Image src="/logo.jpeg" alt="Harbours360" width={40} height={40} className="w-full h-full object-contain" />
          </div>
          <span className="text-xl font-bold tracking-tight">
            <span className="text-navy">Harbours</span>
            <span className="text-ocean">360</span>
          </span>
        </div>

        <div className="w-full max-w-105">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-text-primary mb-2">Forgot your password?</h2>
            <p className="text-text-secondary text-sm leading-relaxed">
              Enter your email below. This will open your email client with a pre-filled recovery request to our support team.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="p-3 rounded-lg bg-danger/10 border border-danger/20">
                <p className="text-danger text-sm">{error}</p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Registered email address</Label>
              <Input
                id="email"
                type="email"
                placeholder="name@company.com"
                value={email}
                onChange={e => { setEmail(e.target.value); setError("") }}
                autoComplete="email"
              />
            </div>

            <Button
              type="submit"
              className="w-full bg-ocean hover:bg-ocean-dark text-white h-11 gap-2"
            >
              <Mail className="w-4 h-4" />
              Send Recovery Request
            </Button>

            <p className="text-center text-xs text-text-secondary">
              Opens your email client pre-filled and ready to send.
            </p>

            <div className="text-center pt-2">
              <Link href="/login" className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-navy transition-colors">
                <ArrowLeft className="w-3.5 h-3.5" /> Back to Sign In
              </Link>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
