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
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Phone,
  Loader2,
  FileQuestion,
  Upload,
  FileText,
  Lock,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  kycBuyer,
  type DocumentRequestResponse,
} from "@/lib/api"
import { useKycStatus } from "@/lib/hooks"


// ── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ stepNum, label, status }: {
  stepNum: number
  label: string
  status: "completed" | "active" | "upcoming"
}) {
  return (
    <div className="flex items-center gap-3">
      <div className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0",
        status === "completed" && "bg-success text-white",
        status === "active" && "bg-ocean text-white ring-4 ring-ocean/20",
        status === "upcoming" && "bg-gray-100 text-text-secondary",
      )}>
        {status === "completed" ? <Check className="w-4 h-4" /> : stepNum}
      </div>
      <span className={cn(
        "text-sm",
        status === "completed" && "text-success font-medium",
        status === "active" && "text-text-primary font-semibold",
        status === "upcoming" && "text-text-secondary",
      )}>
        {label}
      </span>
    </div>
  )
}

function ProgressStepper({ phoneVerified, hasDocRequests, docsUploaded, kycStatus }: {
  phoneVerified: boolean
  hasDocRequests: boolean
  docsUploaded: boolean
  kycStatus: string
}) {
  const isApproved = kycStatus === "approved"
  const isUnderReview = ["submitted", "under_review"].includes(kycStatus)

  const step1 = phoneVerified ? "completed" : "active"
  const step2 = !phoneVerified ? "upcoming" : (hasDocRequests && docsUploaded && (isUnderReview || isApproved)) ? "completed" : phoneVerified ? "active" : "upcoming"
  const step3 = isUnderReview ? "active" : isApproved ? "completed" : "upcoming"
  const step4 = isApproved ? "completed" : "upcoming"

  return (
    <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-text-primary mb-4">Verification Progress</h2>
      <div className="space-y-3">
        <StepIndicator stepNum={1} label="Verify Phone Number" status={step1} />
        <div className="ml-4 border-l-2 border-gray-200 h-3" />
        <StepIndicator stepNum={2} label="Upload Requested Documents" status={step2} />
        <div className="ml-4 border-l-2 border-gray-200 h-3" />
        <StepIndicator stepNum={3} label="Agent Review" status={step3} />
        <div className="ml-4 border-l-2 border-gray-200 h-3" />
        <StepIndicator stepNum={4} label="Verified — Full Trading Access" status={step4} />
      </div>
    </div>
  )
}


// ── Phone OTP Verification ───────────────────────────────────────────────────

function PhoneVerificationStep({ phone: existingPhone, verified, onVerified }: {
  phone?: string | null
  verified: boolean
  onVerified: () => void
}) {
  const [phone, setPhone] = useState(existingPhone || "")
  const [code, setCode] = useState("")
  const [step, setStep] = useState<"input" | "verify" | "done">(verified ? "done" : "input")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (verified || step === "done") {
    return (
      <div className="bg-white rounded-xl border border-success/20 shadow-sm p-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center shrink-0">
            <Phone className="w-5 h-5 text-success" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-text-primary flex items-center gap-2">
              Phone Verified <CheckCircle2 className="w-4 h-4 text-success" />
            </p>
            <p className="text-sm text-text-secondary">{existingPhone || phone || "Verified"}</p>
          </div>
          <Badge className="bg-success/10 text-success border-success/20 text-xs">Step 1 Complete</Badge>
        </div>
      </div>
    )
  }

  async function handleSendOtp() {
    if (!phone.trim() || !phone.startsWith("+")) {
      setError("Enter a valid phone number in E.164 format (e.g. +2348012345678)")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await kycBuyer.sendPhoneOtp(phone.trim())
      if (res.code) setCode(res.code)
      setStep("verify")
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "Failed to send OTP")
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyOtp() {
    if (!code.trim()) { setError("Enter the OTP code."); return }
    setLoading(true)
    setError(null)
    try {
      await kycBuyer.verifyPhoneOtp(phone.trim(), code.trim())
      setStep("done")
      onVerified()
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "Invalid or expired code")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-ocean/20 shadow-sm overflow-hidden">
      <div className="px-5 py-4 bg-ocean/5 border-b border-ocean/20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-ocean text-white flex items-center justify-center text-sm font-semibold">1</div>
          <div>
            <p className="font-semibold text-text-primary">Verify Your Phone Number</p>
            <p className="text-sm text-text-secondary">We&apos;ll send a one-time code via SMS to verify your number.</p>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {step === "input" ? (
          <div className="flex gap-2">
            <Input
              placeholder="+2348012345678"
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
    </div>
  )
}


// ── Document Requests & Upload (Step 2) ──────────────────────────────────────

function DocumentRequestsStep({ phoneVerified }: { phoneVerified: boolean }) {
  const [requests, setRequests] = useState<DocumentRequestResponse[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!phoneVerified) { setLoading(false); return }
    kycBuyer.listDocumentRequests()
      .then(setRequests)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [phoneVerified])

  if (!phoneVerified) {
    return (
      <div className="bg-gray-50 rounded-xl border border-border p-5 opacity-60">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gray-200 text-text-secondary flex items-center justify-center text-sm font-semibold">2</div>
          <div>
            <p className="font-semibold text-text-secondary">Upload Documents</p>
            <p className="text-sm text-text-secondary">Complete phone verification first to unlock this step.</p>
          </div>
          <Lock className="w-5 h-5 text-text-secondary ml-auto" />
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-border p-8 flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-ocean animate-spin" />
      </div>
    )
  }

  const pending = requests.filter((r) => r.status === "pending")
  const fulfilled = requests.filter((r) => r.status === "uploaded")
  const waived = requests.filter((r) => r.status === "waived")

  if (requests.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-ocean/20 shadow-sm overflow-hidden">
        <div className="px-5 py-4 bg-ocean/5 border-b border-ocean/20">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-ocean text-white flex items-center justify-center text-sm font-semibold">2</div>
            <div>
              <p className="font-semibold text-text-primary">Upload Documents</p>
              <p className="text-sm text-text-secondary">A verification agent will review your profile and request specific documents.</p>
            </div>
          </div>
        </div>
        <div className="p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-ocean/10 flex items-center justify-center mx-auto mb-4">
            <Clock className="w-7 h-7 text-ocean" />
          </div>
          <p className="font-semibold text-text-primary">Waiting for Agent Assignment</p>
          <p className="text-sm text-text-secondary mt-1 max-w-sm mx-auto">
            Your phone is verified. A verification agent will be assigned to your profile
            and will request the specific documents needed. You&apos;ll be notified by email.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-ocean/20 shadow-sm overflow-hidden">
      <div className="px-5 py-4 bg-ocean/5 border-b border-ocean/20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-ocean text-white flex items-center justify-center text-sm font-semibold">2</div>
          <div className="flex-1">
            <p className="font-semibold text-text-primary">Requested Documents</p>
            <p className="text-sm text-text-secondary">
              Upload the documents your verification agent has requested.
            </p>
          </div>
          {pending.length > 0 && (
            <Badge className="bg-warning/10 text-warning border-warning/20 text-xs">
              {pending.length} pending
            </Badge>
          )}
        </div>
      </div>

      <div className="divide-y divide-border">
        {requests.map((req) => (
          <div key={req.id} className="flex items-center gap-3 px-5 py-4">
            {req.status === "uploaded" ? (
              <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
            ) : req.status === "waived" ? (
              <Check className="w-5 h-5 text-text-secondary shrink-0" />
            ) : (
              <FileQuestion className="w-5 h-5 text-warning shrink-0" />
            )}
            <div className="flex-1">
              <p className="text-sm font-medium text-text-primary">{req.document_type_name}</p>
              {req.reason && <p className="text-xs text-text-secondary mt-0.5">{req.reason}</p>}
            </div>
            <Badge className={cn(
              "text-xs border capitalize",
              req.status === "uploaded" ? "bg-success/10 text-success border-success/20" :
              req.status === "waived" ? "bg-gray-100 text-text-secondary border-gray-200" :
              req.priority === "required" ? "bg-danger/10 text-danger border-danger/20" :
              "bg-warning/10 text-warning border-warning/20"
            )}>
              {req.status === "uploaded" ? "Uploaded" : req.status === "waived" ? "Waived" : req.priority}
            </Badge>
          </div>
        ))}
      </div>

      {pending.length > 0 && (
        <div className="px-5 py-4 bg-gray-50 border-t border-border">
          <Link href="/kyc/submit">
            <Button className="bg-ocean hover:bg-ocean-dark text-white gap-1.5">
              <Upload className="w-4 h-4" /> Upload Requested Documents
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      )}

      {pending.length === 0 && fulfilled.length > 0 && (
        <div className="px-5 py-4 bg-success/5 border-t border-success/20">
          <div className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="w-4 h-4" />
            <span className="font-medium">All requested documents uploaded — under agent review</span>
          </div>
        </div>
      )}
    </div>
  )
}


// ── Review Status (Step 3) ───────────────────────────────────────────────────

function ReviewStatusStep({ kycStatus, rejectionReason, expiresAt }: {
  kycStatus: string
  rejectionReason?: string | null
  expiresAt?: string | null
}) {
  if (kycStatus === "approved") {
    return (
      <div className="bg-success/5 rounded-xl border border-success/20 shadow-sm p-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-success" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-success">KYC Verified — Full Trading Access</p>
            <p className="text-sm text-text-secondary">
              Your identity has been verified. You can submit purchase requests and bid in auctions.
            </p>
          </div>
          {expiresAt && (
            <div className="flex items-center gap-1.5 text-sm text-text-secondary shrink-0">
              <Clock className="w-4 h-4" />
              <span>Expires {new Date(expiresAt).toLocaleDateString()}</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (kycStatus === "rejected") {
    return (
      <div className="bg-danger/5 rounded-xl border border-danger/20 shadow-sm p-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-danger/10 flex items-center justify-center shrink-0">
            <XCircle className="w-5 h-5 text-danger" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-danger">Verification Rejected</p>
            <p className="text-sm text-text-secondary">
              Please review the reason below and contact support if needed.
            </p>
            {rejectionReason && (
              <p className="text-sm text-danger mt-2 font-medium bg-danger/5 p-3 rounded-lg border border-danger/10">
                {rejectionReason}
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (["submitted", "under_review"].includes(kycStatus)) {
    return (
      <div className="bg-warning/5 rounded-xl border border-warning/20 shadow-sm p-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-warning/10 flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5 text-warning" />
          </div>
          <div>
            <p className="font-semibold text-text-primary">Documents Under Review</p>
            <p className="text-sm text-text-secondary">
              Your verification agent is reviewing your documents. This typically takes 1–2 business days.
              You&apos;ll be notified by email when complete.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return null
}


// ── Uploaded Documents Table ─────────────────────────────────────────────────

interface KycDocBrief {
  id: string
  document_type_name: string
  document_type_slug: string
  original_name: string | null
  uploaded_at: string
}

function UploadedDocumentsTable({ documents }: { documents: KycDocBrief[] }) {
  if (!documents || documents.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="text-sm font-semibold text-text-primary">Your Submitted Documents</h2>
      </div>
      <div className="divide-y divide-border">
        {documents.map((doc) => (
          <div key={doc.id} className="flex items-center gap-3 px-5 py-3">
            <FileText className="w-4 h-4 text-ocean shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">
                {doc.original_name ?? doc.document_type_name}
              </p>
              <p className="text-xs text-text-secondary">{doc.document_type_name}</p>
            </div>
            <span className="text-xs text-text-secondary shrink-0">
              {new Date(doc.uploaded_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}


// ── Loading skeleton ─────────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <div className="space-y-5 max-w-3xl animate-pulse">
      <div className="h-8 w-48 bg-gray-200 rounded" />
      <div className="h-32 bg-gray-200 rounded-xl" />
      <div className="h-48 bg-gray-200 rounded-xl" />
      <div className="h-32 bg-gray-200 rounded-xl" />
    </div>
  )
}


// ── Main Page ────────────────────────────────────────────────────────────────

export default function KYCPage() {
  const { user } = useAuth()
  const isBuyer = user?.roles?.includes("buyer")
  const { data: kycData, isLoading, error: swrError, mutate } = useKycStatus(!!isBuyer)
  const error = swrError?.message ?? null

  // Use kycData for phone_verified (freshest source), fall back to user context
  const phoneVerified = kycData?.phone_verified ?? user?.phone_verified ?? false
  const kycStatus = kycData?.kyc_status ?? "not_submitted"

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
        <Button variant="outline" size="sm" onClick={() => mutate()} className="ml-auto border-danger/30 text-danger">Retry</Button>
      </div>
    )
  }

  const hasDocRequests = false // Will be determined by DocumentRequestsStep internally
  const docsUploaded = (kycData?.uploaded_document_count ?? 0) > 0

  return (
    <div className="space-y-5 max-w-3xl">
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

      {/* Progress Stepper */}
      <ProgressStepper
        phoneVerified={phoneVerified}
        hasDocRequests={docsUploaded}
        docsUploaded={docsUploaded}
        kycStatus={kycStatus}
      />

      {/* Review Status Banner (if applicable) */}
      <ReviewStatusStep
        kycStatus={kycStatus}
        rejectionReason={kycData?.rejection_reason}
        expiresAt={kycData?.kyc_expires_at}
      />

      {/* Step 1: Phone Verification */}
      <PhoneVerificationStep
        phone={kycData?.phone}
        verified={phoneVerified}
        onVerified={() => mutate()}
      />

      {/* Step 2: Document Requests */}
      <DocumentRequestsStep phoneVerified={phoneVerified} />

      {/* Uploaded Documents */}
      <UploadedDocumentsTable documents={kycData?.documents ?? []} />

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
