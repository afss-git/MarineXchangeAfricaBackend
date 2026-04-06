"use client"

import { useState, useEffect } from "react"
import { useAuth } from "@/lib/auth"
import { PageTour } from "@/components/tour/tour-engine"
import { KYC_TOUR } from "@/components/tour/tour-definitions"
import Link from "next/link"
import {
  ShieldCheck,
  Clock,
  Check,
  Mail,
  Unlock,
  ArrowRight,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Phone,
  Loader2,
  FileQuestion,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { kycBuyer, type DocumentRequestResponse } from "@/lib/api"
import { useKycStatus } from "@/lib/hooks"

const nextSteps = [
  {
    icon: ShieldCheck,
    title: "Document Review",
    desc: "Our team verifies your documents within 1–2 business days.",
  },
  {
    icon: Mail,
    title: "Email Notification",
    desc: "You'll be notified by email when approved or if more info is needed.",
  },
  {
    icon: Unlock,
    title: "Full Access",
    desc: "Once approved, submit purchase requests and bid in live auctions.",
  },
]

function statusBannerProps(status: string) {
  switch (status) {
    case "approved":
      return {
        bg: "bg-success/10 border-success/20",
        icon: CheckCircle2,
        iconColor: "text-success",
        iconBg: "bg-success/20",
        title: "KYC Verified",
        desc: "Your identity has been verified. You have full trading access.",
      }
    case "rejected":
      return {
        bg: "bg-danger/10 border-danger/20",
        icon: XCircle,
        iconColor: "text-danger",
        iconBg: "bg-danger/20",
        title: "KYC Rejected",
        desc: "Your application was rejected. Please review the reason and resubmit.",
      }
    case "requires_resubmission":
      return {
        bg: "bg-warning/10 border-warning/20",
        icon: RefreshCw,
        iconColor: "text-warning",
        iconBg: "bg-warning/20",
        title: "Resubmission Required",
        desc: "Additional documents or corrections are needed. Please resubmit.",
      }
    case "under_review":
    case "submitted":
      return {
        bg: "bg-warning/10 border-warning/20",
        icon: Clock,
        iconColor: "text-warning",
        iconBg: "bg-warning/20",
        title: "Verification Pending",
        desc: "Your documents are under review. This typically takes 1–2 business days.",
      }
    default:
      return {
        bg: "bg-ocean/10 border-ocean/20",
        icon: ShieldCheck,
        iconColor: "text-ocean",
        iconBg: "bg-ocean/20",
        title: "Not Submitted",
        desc: "Submit your documents to start the verification process.",
      }
  }
}

function stepIndex(status: string): number {
  switch (status) {
    case "approved": return 3
    case "under_review":
    case "submitted": return 2
    case "draft":
    case "requires_resubmission":
    case "rejected": return 1
    default: return 0
  }
}

function PageSkeleton() {
  return (
    <div className="space-y-6 max-w-4xl animate-pulse">
      <div className="h-24 bg-gray-200 rounded-xl" />
      <div className="h-32 bg-gray-200 rounded-xl" />
      <div className="h-48 bg-gray-200 rounded-xl" />
    </div>
  )
}

// ── Phone OTP Verification Card ───────────────────────────────────────────────

function PhoneVerificationCard() {
  const { user } = useAuth()
  const [phone, setPhone] = useState("")
  const [code, setCode] = useState("")
  const [step, setStep] = useState<"input" | "verify" | "done">("input")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // If already verified, show done state
  const isVerified = user?.phone_verified === true
  if (isVerified) {
    return (
      <div className="bg-white rounded-xl border border-border shadow-sm p-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center shrink-0">
            <Phone className="w-5 h-5 text-success" />
          </div>
          <div>
            <p className="font-semibold text-text-primary flex items-center gap-2">
              Phone Verified <CheckCircle2 className="w-4 h-4 text-success" />
            </p>
            <p className="text-sm text-text-secondary">{user?.phone ?? "Verified"}</p>
          </div>
        </div>
      </div>
    )
  }

  async function handleSendOtp() {
    if (!phone.trim() || !phone.startsWith("+")) {
      setError("Enter a valid phone number in E.164 format (e.g. +234...)")
      return
    }
    setLoading(true)
    setError(null)
    try {
      await kycBuyer.sendPhoneOtp(phone.trim())
      setStep("verify")
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "Failed to send OTP")
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyOtp() {
    if (!code.trim()) { setError("Enter the OTP code from your SMS."); return }
    setLoading(true)
    setError(null)
    try {
      await kycBuyer.verifyPhoneOtp(phone.trim(), code.trim())
      setStep("done")
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "Invalid or expired code")
    } finally {
      setLoading(false)
    }
  }

  if (step === "done") {
    return (
      <div className="bg-white rounded-xl border border-success/20 shadow-sm p-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-success" />
          </div>
          <div>
            <p className="font-semibold text-success">Phone Verified Successfully</p>
            <p className="text-sm text-text-secondary">{phone}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-ocean/10 flex items-center justify-center shrink-0">
          <Phone className="w-5 h-5 text-ocean" />
        </div>
        <div>
          <p className="font-semibold text-text-primary">Verify Your Phone Number</p>
          <p className="text-sm text-text-secondary">
            We&apos;ll send a one-time code via SMS to verify your phone number.
          </p>
        </div>
      </div>

      {step === "input" ? (
        <div className="flex gap-2">
          <Input
            placeholder="+234 801 234 5678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="flex-1"
          />
          <Button onClick={handleSendOtp} disabled={loading} className="bg-ocean hover:bg-ocean-dark text-white gap-1.5">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
            Send Code
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">
            Enter the 6-digit code sent to <strong>{phone}</strong>
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="Enter code..."
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={8}
              className="flex-1"
            />
            <Button onClick={handleVerifyOtp} disabled={loading} className="bg-ocean hover:bg-ocean-dark text-white gap-1.5">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Verify
            </Button>
          </div>
          <button
            onClick={() => { setStep("input"); setCode(""); setError(null) }}
            className="text-xs text-ocean hover:underline"
          >
            Change number or resend
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-3 bg-danger/10 border border-danger/20 rounded-lg text-danger text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}
    </div>
  )
}

// ── Document Requests Card ────────────────────────────────────────────────────

function DocumentRequestsCard() {
  const [requests, setRequests] = useState<DocumentRequestResponse[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    kycBuyer.listDocumentRequests()
      .then(setRequests)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const pending = requests.filter((r) => r.status === "pending")

  if (loading || pending.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-warning/20 shadow-sm overflow-hidden">
      <div className="px-5 py-4 bg-warning/5 border-b border-warning/20">
        <div className="flex items-center gap-3">
          <FileQuestion className="w-5 h-5 text-warning" />
          <div>
            <p className="font-semibold text-text-primary">Documents Requested</p>
            <p className="text-sm text-text-secondary">
              Our verification team needs the following documents from you.
            </p>
          </div>
        </div>
      </div>
      <div className="divide-y divide-border">
        {pending.map((req) => (
          <div key={req.id} className="flex items-center gap-3 px-5 py-3">
            <FileQuestion className="w-4 h-4 text-warning shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-text-primary">{req.document_type_name}</p>
              {req.reason && <p className="text-xs text-text-secondary">{req.reason}</p>}
            </div>
            <Badge className={cn(
              "text-xs border capitalize",
              req.priority === "required"
                ? "bg-danger/10 text-danger border-danger/20"
                : "bg-gray-100 text-text-secondary border-gray-200"
            )}>
              {req.priority}
            </Badge>
          </div>
        ))}
      </div>
      <div className="px-5 py-3 bg-gray-50 border-t border-border">
        <Link href="/kyc/submit">
          <Button size="sm" className="bg-ocean hover:bg-ocean-dark text-white gap-1.5">
            <ArrowRight className="w-3.5 h-3.5" /> Upload Requested Documents
          </Button>
        </Link>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function KYCPage() {
  const { user } = useAuth()
  const isBuyer = user?.roles?.includes("buyer")
  const { data: kycData, isLoading, error: swrError } = useKycStatus(!!isBuyer)
  const error = swrError?.message ?? null

  // Seller-only accounts don't need KYC
  if (user && !isBuyer) {
    return (
      <div className="space-y-6 max-w-2xl">
        <div>
          <h1 className="text-xl font-bold text-text-primary">KYC Verification</h1>
          <p className="text-text-secondary text-sm mt-1">Identity verification for trading access</p>
        </div>
        <div className="flex items-center gap-4 p-6 bg-gray-50 border border-border rounded-xl">
          <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-6 h-6 text-success" />
          </div>
          <div>
            <p className="font-semibold text-text-primary">KYC is not required for sellers</p>
            <p className="text-sm text-text-secondary mt-1">
              Seller accounts are verified through your listing review process. KYC applies to buyers placing purchase requests or bidding in auctions.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (isLoading && !kycData) return <PageSkeleton />

  if (error) {
    return (
      <div className="flex items-center gap-3 p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger max-w-2xl">
        <AlertCircle className="w-5 h-5 shrink-0" />
        <span className="text-sm">{error}</span>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()} className="ml-auto border-danger/30 text-danger">Retry</Button>
      </div>
    )
  }

  const status = kycData?.kyc_status ?? "not_submitted"
  const banner = statusBannerProps(status)
  const BannerIcon = banner.icon
  const currentStep = stepIndex(kycData?.current_submission_status ?? status)
  const steps = [
    { label: "Account Created", completed: currentStep >= 0 },
    { label: "Documents Submitted", completed: currentStep >= 1 },
    { label: "Under Review", completed: currentStep >= 2 },
    { label: "Verified & Trading", completed: currentStep >= 3 },
  ]

  const docStatusStyle: Record<string, string> = {
    submitted: "bg-ocean/10 text-ocean border-ocean/20",
    under_review: "bg-warning/10 text-warning border-warning/20",
    approved: "bg-success/10 text-success border-success/20",
    rejected: "bg-danger/10 text-danger border-danger/20",
  }

  const canSubmit = status === "not_submitted" || status === "rejected" || status === "requires_resubmission"

  return (
    <div className="space-y-6 max-w-4xl">
      {user?.id && (
        <PageTour pageKey="kyc" userId={String(user.id)} steps={KYC_TOUR} />
      )}

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-text-primary">KYC Verification</h1>
        <p className="text-text-secondary text-sm mt-1">
          Complete identity verification to unlock full trading capabilities
        </p>
      </div>

      {/* Status Banner */}
      <div data-tour="kyc-status-banner" className={cn("flex flex-col gap-4 border rounded-xl p-5", banner.bg)}>
        <div className="flex items-center gap-3">
          <div className={cn("w-10 h-10 rounded-full flex items-center justify-center shrink-0", banner.iconBg)}>
            <BannerIcon className={cn("w-5 h-5", banner.iconColor)} />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-text-primary">{banner.title}</p>
            <p className="text-sm text-text-secondary">{banner.desc}</p>
            {kycData?.rejection_reason && (
              <p className="text-sm text-danger mt-1 font-medium">Reason: {kycData.rejection_reason}</p>
            )}
          </div>
          {kycData?.kyc_expires_at && status === "approved" && (
            <div className="flex items-center gap-1.5 text-sm text-text-secondary shrink-0">
              <Clock className="w-4 h-4" />
              <span>Expires {new Date(kycData.kyc_expires_at).toLocaleDateString()}</span>
            </div>
          )}
        </div>
        {canSubmit && (
          <Link href="/kyc/submit" data-tour="kyc-action-btn" className="w-full sm:w-auto">
            <Button className="w-full sm:w-auto bg-ocean hover:bg-ocean-dark text-white gap-2 h-11 text-sm font-semibold">
              <ShieldCheck className="w-4 h-4" />
              {status === "not_submitted" ? "Start Verification — Submit Documents" : "Resubmit Documents"}
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        )}
      </div>

      {/* Progress Stepper */}
      <div data-tour="kyc-progress" className="bg-white rounded-xl border border-border p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-text-primary mb-6">Verification Progress</h2>
        <div className="flex items-start">
          {steps.map((step, index) => (
            <div key={step.label} className="flex items-center flex-1">
              <div className="flex flex-col items-center">
                <div className={cn(
                  "w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold transition-colors",
                  step.completed
                    ? index === currentStep && currentStep < 3
                      ? "bg-ocean text-white ring-4 ring-ocean/20"
                      : "bg-success text-white"
                    : "bg-gray-100 text-text-secondary"
                )}>
                  {step.completed && !(index === currentStep && currentStep < 3)
                    ? <Check className="w-4 h-4" />
                    : step.completed
                    ? <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-white" />
                      </span>
                    : index + 1}
                </div>
                <span className={cn(
                  "mt-2 text-xs text-center max-w-20",
                  step.completed ? "text-text-primary font-medium" : "text-text-secondary"
                )}>
                  {step.label}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div className={cn(
                  "flex-1 h-0.5 mx-2 mb-6",
                  steps[index + 1].completed ? "bg-success" : "bg-gray-200"
                )} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Documents Table */}
      {kycData && kycData.documents?.length > 0 && (
        <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <h2 className="text-base font-semibold text-text-primary">Submitted Documents</h2>
            {canSubmit && (
              <Link href="/kyc/submit">
                <Button variant="outline" size="sm" className="border-ocean text-ocean hover:bg-ocean/5">
                  <RefreshCw className="w-4 h-4 mr-1.5" /> Re-submit
                </Button>
              </Link>
            )}
          </div>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Document Type</TableHead>
                <TableHead className="hidden sm:table-cell">File</TableHead>
                <TableHead className="hidden md:table-cell">Uploaded</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {kycData.documents.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell className="font-medium text-sm text-text-primary">{doc.document_type_name}</TableCell>
                  <TableCell className="hidden sm:table-cell text-sm text-text-secondary">
                    {doc.original_name ?? doc.document_type_slug}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-text-secondary">
                    {new Date(doc.uploaded_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge className={cn("text-xs border", docStatusStyle["submitted"] ?? "bg-gray-100 text-text-secondary")}>
                      Submitted
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Phone Verification */}
      <PhoneVerificationCard />

      {/* Document Requests from Agent */}
      <DocumentRequestsCard />

      {/* What happens next */}
      <div>
        <h2 className="text-base font-semibold text-text-primary mb-4">What Happens Next</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {nextSteps.map((step) => (
            <div key={step.title} className="bg-white rounded-xl border border-border p-5 shadow-sm">
              <div className="w-10 h-10 rounded-lg bg-ocean/10 flex items-center justify-center mb-4">
                <step.icon className="w-5 h-5 text-ocean" />
              </div>
              <h3 className="font-semibold text-text-primary mb-1">{step.title}</h3>
              <p className="text-sm text-text-secondary leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Help Card */}
      <div className="bg-navy/5 border border-navy/10 rounded-xl p-5">
        <p className="font-semibold text-text-primary">Need help with verification?</p>
        <p className="text-sm text-text-secondary mt-1">
          Contact our team at{" "}
          <a href="mailto:kyc@marinexchange.africa" className="text-ocean hover:underline">
            kyc@marinexchange.africa
          </a>
        </p>
      </div>
    </div>
  )
}
