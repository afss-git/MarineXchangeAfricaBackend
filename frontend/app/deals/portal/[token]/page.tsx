"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams } from "next/navigation"
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  Building,
  CreditCard,
  FileText,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { dealDetail, type DealPortal, ApiRequestError } from "@/lib/api"

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(amount: string | null, currency?: string) {
  if (!amount) return "—"
  const num = parseFloat(amount)
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
    (currency ? ` ${currency}` : "")
}

function fmtDate(d: string | null) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
}

// ── Schedule Table ────────────────────────────────────────────────────────────

function ScheduleTable({ portal }: { portal: DealPortal }) {
  const [open, setOpen] = useState(false)
  if (!portal.schedule_preview?.length) return null

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <span className="text-sm font-medium text-text-primary">Repayment Schedule Preview</span>
        {open ? <ChevronUp className="w-4 h-4 text-text-secondary" /> : <ChevronDown className="w-4 h-4 text-text-secondary" />}
      </button>
      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-border">
                {["#", "Due Date", "Amount Due", "Principal", "Finance Charge", "Closing Balance"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-semibold text-text-secondary">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {portal.schedule_preview.map((row) => (
                <tr key={row.installment_number} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-text-secondary">{row.installment_number}</td>
                  <td className="px-3 py-2 text-text-primary">{fmtDate(row.due_date)}</td>
                  <td className="px-3 py-2 font-medium text-text-primary">{fmt(row.amount_due)}</td>
                  <td className="px-3 py-2 text-text-secondary">{fmt(row.principal_amount)}</td>
                  <td className="px-3 py-2 text-text-secondary">{fmt(row.finance_charge)}</td>
                  <td className="px-3 py-2 text-text-secondary">{fmt(row.closing_balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── OTP Step ──────────────────────────────────────────────────────────────────

interface OtpStepProps {
  token: string
  onAccepted: () => void
}

function OtpStep({ token, onAccepted }: OtpStepProps) {
  const [stage, setStage] = useState<"request" | "verify">("request")
  const [otp, setOtp] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(0)

  useEffect(() => {
    if (countdown <= 0) return
    const t = setInterval(() => setCountdown((c) => c - 1), 1000)
    return () => clearInterval(t)
  }, [countdown])

  const handleRequestOtp = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await dealDetail.requestOtp(token)
      setCountdown(res.otp_expires_in_seconds ?? 300)
      setStage("verify")
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Failed to send OTP.")
    } finally {
      setLoading(false)
    }
  }

  const handleAccept = async () => {
    if (!otp.trim()) { setError("Enter the OTP code."); return }
    setLoading(true)
    setError(null)
    try {
      await dealDetail.accept(token, otp.trim())
      onAccepted()
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "OTP verification failed.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-border p-6 space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-5 h-5 text-ocean" />
        <h3 className="font-semibold text-text-primary">Verify & Accept Deal</h3>
      </div>
      <p className="text-sm text-text-secondary">
        By accepting this deal you confirm you have read all terms and agree to proceed.
        An OTP will be sent to your registered email/phone for verification.
      </p>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {stage === "request" ? (
        <Button
          onClick={handleRequestOtp}
          disabled={loading}
          className="w-full bg-ocean hover:bg-ocean/90 text-white"
        >
          {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {loading ? "Sending OTP…" : "Send OTP to My Email"}
        </Button>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-text-primary">Enter OTP *</Label>
            <Input
              placeholder="e.g. 123456"
              value={otp}
              onChange={(e) => { setOtp(e.target.value); setError(null) }}
              maxLength={10}
              className="text-center text-xl tracking-widest font-mono bg-white"
            />
            {countdown > 0 && (
              <p className="text-xs text-text-secondary text-center">
                OTP expires in {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, "0")}
              </p>
            )}
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={handleRequestOtp}
              disabled={loading || countdown > 270}
              size="sm"
            >
              Resend OTP
            </Button>
            <Button
              onClick={handleAccept}
              disabled={loading || !otp.trim()}
              className="flex-1 bg-success hover:bg-success/90 text-white"
            >
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {loading ? "Verifying…" : "Accept & Confirm Deal"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DealPortalPage() {
  const params = useParams<{ token: string }>()
  const token = params.token

  const [portal, setPortal] = useState<DealPortal | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [accepted, setAccepted] = useState(false)

  const fetchPortal = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await dealDetail.getPortal(token)
      setPortal(data)
      if (data.accepted_at) setAccepted(true)
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Could not load deal. The link may have expired.")
    } finally {
      setIsLoading(false)
    }
  }, [token])

  useEffect(() => { fetchPortal() }, [fetchPortal])

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="w-8 h-8 text-ocean animate-spin mx-auto" />
          <p className="text-text-secondary text-sm">Loading deal details…</p>
        </div>
      </div>
    )
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (error || !portal) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-border p-8 max-w-md w-full text-center space-y-4">
          <AlertCircle className="w-12 h-12 text-danger mx-auto" />
          <h2 className="text-lg font-semibold text-text-primary">Deal Not Found</h2>
          <p className="text-sm text-text-secondary">{error ?? "This deal link is invalid or has expired."}</p>
        </div>
      </div>
    )
  }

  // ── Accepted ─────────────────────────────────────────────────────────────────
  if (accepted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-border p-10 max-w-lg w-full text-center space-y-4">
          <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-9 h-9 text-success" />
          </div>
          <h2 className="text-xl font-bold text-text-primary">Deal Accepted!</h2>
          <p className="text-sm text-text-secondary">
            You have successfully accepted deal <span className="font-semibold text-text-primary">{portal.deal_ref}</span>.
            {portal.accepted_at && (
              <> Accepted on {fmtDate(portal.accepted_at)}.</>
            )}
          </p>
          <p className="text-sm text-text-secondary">
            Our team will be in touch with next steps. Please retain this confirmation for your records.
          </p>
        </div>
      </div>
    )
  }

  const isExpired = portal.portal_token_expires_at
    ? new Date(portal.portal_token_expires_at) < new Date()
    : false

  const isFinancing = portal.deal_type === "financing"

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Brand Header */}
      <header className="bg-white border-b border-border sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <span className="font-bold text-lg text-ocean">Harbours360</span>
            <span className="text-text-secondary text-sm hidden sm:block">/ Deal Portal</span>
          </div>
          <Badge
            className={cn(
              "text-xs border capitalize",
              portal.status === "accepted"
                ? "bg-success/10 text-success border-success/20"
                : portal.status === "pending_acceptance"
                ? "bg-warning/10 text-warning border-warning/20"
                : "bg-gray-100 text-text-secondary border-gray-200"
            )}
          >
            {portal.status.replace(/_/g, " ")}
          </Badge>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Title */}
        <div>
          <p className="text-sm text-text-secondary">Deal Reference</p>
          <h1 className="text-2xl font-bold text-text-primary">{portal.deal_ref}</h1>
          <p className="text-text-secondary mt-1">{portal.product_title}</p>
          {portal.product_description && (
            <p className="text-sm text-text-secondary/80 mt-1 max-w-2xl">{portal.product_description}</p>
          )}
        </div>

        {/* Expiry warning */}
        {portal.portal_token_expires_at && !isExpired && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-warning/10 border border-warning/20 text-warning text-sm">
            <Clock className="w-4 h-4 shrink-0" />
            This acceptance link expires on {fmtDate(portal.portal_token_expires_at)}.
          </div>
        )}

        {isExpired && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            This acceptance link has expired. Please contact your Harbours360 agent.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Deal Summary */}
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-border p-5 space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-border">
                <FileText className="w-4 h-4 text-ocean" />
                <h2 className="font-semibold text-text-primary">Deal Summary</h2>
                <Badge variant="secondary" className="text-xs capitalize ml-auto">{portal.deal_type.replace(/_/g, " ")}</Badge>
              </div>

              <div className="space-y-3">
                <Row label="Product Price" value={fmt(portal.total_price, portal.currency)} />
                <Row label="Arrangement Fee" value={fmt(portal.arrangement_fee, portal.currency)} />
                <Row label="Total Amount Payable" value={fmt(portal.total_amount_payable, portal.currency)} strong />

                {isFinancing && (
                  <>
                    <div className="border-t border-border pt-3 space-y-3">
                      <Row label="Initial Payment" value={fmt(portal.initial_payment_amount, portal.currency)} />
                      <Row label="Financed Amount" value={fmt(portal.financed_amount, portal.currency)} />
                      <Row label="Duration" value={portal.duration_months ? `${portal.duration_months} months` : "—"} />
                      <Row label="Monthly Finance Rate" value={portal.monthly_finance_rate_display ?? "—"} />
                      <Row label="Total Finance Charge" value={fmt(portal.total_finance_charge, portal.currency)} />
                      <Row label="First Monthly Payment" value={fmt(portal.first_monthly_payment, portal.currency)} />
                    </div>
                  </>
                )}

                {portal.payment_deadline && (
                  <Row label="Payment Deadline" value={fmtDate(portal.payment_deadline)} />
                )}
              </div>
            </div>

            {/* Repayment Schedule */}
            <ScheduleTable portal={portal} />
          </div>

          {/* Payment + Action */}
          <div className="space-y-6">
            {/* Payment Account */}
            {portal.payment_account && (
              <div className="bg-white rounded-2xl border border-border p-5 space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-border">
                  <Building className="w-4 h-4 text-ocean" />
                  <h2 className="font-semibold text-text-primary">Payment Account</h2>
                </div>
                <div className="space-y-3">
                  <Row label="Bank" value={portal.payment_account.bank_name} />
                  <Row label="Account Name" value={portal.payment_account.account_name} />
                  <Row label="Account Number" value={portal.payment_account.account_number} mono />
                  {portal.payment_account.sort_code && (
                    <Row label="Sort Code" value={portal.payment_account.sort_code} mono />
                  )}
                  {portal.payment_account.swift_code && (
                    <Row label="SWIFT / BIC" value={portal.payment_account.swift_code} mono />
                  )}
                  <Row label="Currency" value={portal.payment_account.currency} />
                  <Row label="Country" value={portal.payment_account.country} />
                </div>
              </div>
            )}

            {/* Payment instructions */}
            {portal.payment_instructions && (
              <div className="bg-white rounded-2xl border border-border p-5 space-y-2">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-ocean" />
                  <h2 className="font-semibold text-text-primary">Payment Instructions</h2>
                </div>
                <p className="text-sm text-text-secondary whitespace-pre-wrap">{portal.payment_instructions}</p>
              </div>
            )}

            {/* Accept section */}
            {!isExpired && portal.status !== "accepted" && (
              <OtpStep token={token} onAccepted={() => setAccepted(true)} />
            )}
          </div>
        </div>

        <p className="text-center text-xs text-text-secondary pb-4">
          Harbours360 &middot; Secure Deal Portal &middot; All transactions are monitored and recorded.
        </p>
      </main>
    </div>
  )
}

// ── Row helper ────────────────────────────────────────────────────────────────

function Row({ label, value, strong, mono }: { label: string; value: string; strong?: boolean; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-sm text-text-secondary shrink-0">{label}</span>
      <span className={cn(
        "text-sm text-right",
        strong ? "font-bold text-ocean text-base" : "font-medium text-text-primary",
        mono && "font-mono tracking-wide"
      )}>
        {value}
      </span>
    </div>
  )
}
