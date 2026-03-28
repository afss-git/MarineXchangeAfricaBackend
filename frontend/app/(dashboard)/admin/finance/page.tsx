"use client"

import { useState } from "react"
import {
  DollarSign, Clock, CheckCircle2, XCircle, AlertCircle, RefreshCw,
  ExternalLink, Loader2, ChevronDown, ChevronUp, FileText, Eye,
} from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { financeAdmin, dealAdmin, DealPaymentRecord } from "@/lib/api"
import { useFinanceQueue } from "@/lib/hooks"

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

function fmtCurrency(amount: string, currency = "USD") {
  const num = parseFloat(amount)
  if (isNaN(num)) return amount
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 0 }).format(num)
}

function ErrorBar({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger text-sm">
      <AlertCircle className="w-4 h-4 shrink-0" />{msg}
    </div>
  )
}

// ── Status config ──────────────────────────────────────────────────────────────

const VERIFICATION_CFG: Record<string, { label: string; className: string; icon: React.ElementType }> = {
  pending:  { label: "Pending",  className: "bg-warning/10 text-warning border-warning/20",  icon: Clock         },
  verified: { label: "Verified", className: "bg-success/10 text-success border-success/20",  icon: CheckCircle2  },
  disputed: { label: "Disputed", className: "bg-danger/10 text-danger border-danger/20",     icon: XCircle       },
}

function VerificationBadge({ status }: { status: string }) {
  const cfg = VERIFICATION_CFG[status] ?? VERIFICATION_CFG.pending
  const Icon = cfg.icon
  return (
    <Badge className={cn("text-xs border gap-1", cfg.className)}>
      <Icon className="w-3 h-3" />{cfg.label}
    </Badge>
  )
}

// ── Payment row ────────────────────────────────────────────────────────────────

function PaymentRow({ record, onUpdated }: { record: DealPaymentRecord; onUpdated: () => void }) {
  const [open, setOpen] = useState(false)
  const [verifyStatus, setVerifyStatus] = useState<"verified" | "disputed">("verified")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function handleVerify() {
    setSaving(true)
    setError(null)
    try {
      await dealAdmin.verifyPayment(record.deal_id, record.id, {
        verification_status: verifyStatus,
        ...(notes.trim() ? { verification_notes: notes.trim() } : {}),
      })
      setDone(true)
      onUpdated()
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "Failed to submit verification")
    } finally {
      setSaving(false)
    }
  }

  const paymentTypeFmt = record.payment_type.replace(/_/g, " ")

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      {/* Header row */}
      <div
        className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setOpen((prev) => !prev)}
      >
        {/* Icon */}
        <div className="w-10 h-10 rounded-xl bg-ocean/10 flex items-center justify-center shrink-0">
          <DollarSign className="w-5 h-5 text-ocean" />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-text-primary">
              {fmtCurrency(record.amount, record.currency)}
            </p>
            <span className="text-xs text-text-secondary capitalize">{paymentTypeFmt}</span>
            {record.installment_number != null && (
              <Badge variant="secondary" className="text-xs">Installment #{record.installment_number}</Badge>
            )}
          </div>
          <p className="text-xs text-text-secondary truncate mt-0.5">
            Deal{" "}
            <Link
              href={`/admin/deals/${record.deal_id}`}
              className="text-ocean hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {record.deal_id.slice(0, 8)}…
              <ExternalLink className="w-3 h-3 inline ml-0.5" />
            </Link>
            {" "}· Recorded by {record.recorded_by_name ?? record.recorded_by.slice(0, 8) + "…"}
            {" "}· {fmtDate(record.recorded_at)}
          </p>
        </div>

        {/* Status + chevron */}
        <div className="flex items-center gap-3 shrink-0">
          <VerificationBadge status={record.verification_status} />
          {open ? <ChevronUp className="w-4 h-4 text-text-secondary" /> : <ChevronDown className="w-4 h-4 text-text-secondary" />}
        </div>
      </div>

      {/* Expanded */}
      {open && (
        <div className="border-t border-border">
          {/* Details grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 px-5 py-4 bg-gray-50/50 text-sm">
            {[
              ["Payment Date", fmtDate(record.payment_date)],
              ["Bank Name", record.bank_name ?? "—"],
              ["Bank Reference", record.bank_reference ?? "—"],
              ["Currency", record.currency],
              ["Recorded At", fmtDate(record.recorded_at)],
              ...(record.notes ? [["Notes", record.notes]] : []),
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-xs text-text-secondary mb-0.5">{label}</p>
                <p className="font-medium text-text-primary">{value}</p>
              </div>
            ))}
          </div>

          {/* Proof link */}
          {record.payment_proof_path && (
            <div className="px-5 py-3 border-t border-border flex items-center gap-2">
              <FileText className="w-4 h-4 text-text-secondary" />
              <span className="text-sm text-text-secondary">Payment Proof:</span>
              <a
                href={record.payment_proof_path}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm text-ocean hover:underline"
              >
                <Eye className="w-3.5 h-3.5" /> View Document
              </a>
            </div>
          )}

          {/* Verification action */}
          {done ? (
            <div className="px-5 py-4 bg-success/5 border-t border-border">
              <div className="flex items-center gap-2 text-success text-sm font-medium">
                <CheckCircle2 className="w-4 h-4" />
                Verification submitted.
              </div>
            </div>
          ) : record.verification_status !== "pending" ? (
            <div className="px-5 py-4 bg-gray-50/50 border-t border-border text-sm text-text-secondary">
              Already {record.verification_status}.
              {record.verification_notes && (
                <span className="block mt-1 text-text-primary">{record.verification_notes}</span>
              )}
              {record.verified_by_name && (
                <span className="block text-xs mt-0.5">
                  by {record.verified_by_name} on {fmtDate(record.verified_at)}
                </span>
              )}
            </div>
          ) : (
            <div className="px-5 py-4 bg-gray-50/50 border-t border-border space-y-3">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Verification Decision</p>

              {/* Decision toggle */}
              <div className="flex gap-2">
                <button
                  onClick={() => setVerifyStatus("verified")}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors",
                    verifyStatus === "verified"
                      ? "bg-success text-white border-success"
                      : "bg-white text-text-secondary border-border hover:border-gray-300"
                  )}
                >
                  <CheckCircle2 className="w-4 h-4" /> Verify
                </button>
                <button
                  onClick={() => setVerifyStatus("disputed")}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors",
                    verifyStatus === "disputed"
                      ? "bg-danger text-white border-danger"
                      : "bg-white text-text-secondary border-border hover:border-gray-300"
                  )}
                >
                  <XCircle className="w-4 h-4" /> Dispute
                </button>
              </div>

              {/* Notes */}
              <div>
                <label className="text-xs font-medium text-text-secondary block mb-1">
                  Verification Notes{verifyStatus === "disputed" && <span className="text-danger ml-1">*</span>}
                </label>
                <Textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={verifyStatus === "disputed" ? "Describe the issue with this payment…" : "Optional notes…"}
                  className="text-sm resize-none"
                />
              </div>

              {error && <ErrorBar msg={error} />}

              <div className="flex justify-end">
                <Button
                  onClick={handleVerify}
                  disabled={saving}
                  className={cn(
                    "gap-1.5 text-white",
                    verifyStatus === "verified" ? "bg-success hover:bg-success/90" : "bg-danger hover:bg-danger/90"
                  )}
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : verifyStatus === "verified" ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  {saving ? "Submitting…" : verifyStatus === "verified" ? "Confirm Verified" : "Mark Disputed"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

type Filter = "all" | "pending" | "verified" | "disputed"

export default function AdminFinancePage() {
  const [filter, setFilter] = useState<Filter>("pending")

  const { data: records = [], isLoading: loading, error: swrError, mutate } = useFinanceQueue()
  const error = swrError?.message ?? null

  const filtered = records.filter((r) =>
    filter === "all" ? true : r.verification_status === filter
  )

  const counts = {
    all:      records.length,
    pending:  records.filter((r) => r.verification_status === "pending").length,
    verified: records.filter((r) => r.verification_status === "verified").length,
    disputed: records.filter((r) => r.verification_status === "disputed").length,
  }

  const totalPending = records
    .filter((r) => r.verification_status === "pending")
    .reduce((sum, r) => sum + parseFloat(r.amount || "0"), 0)

  const FILTER_TABS: { value: Filter; label: string }[] = [
    { value: "pending",  label: "Pending Review" },
    { value: "disputed", label: "Disputed" },
    { value: "verified", label: "Verified" },
    { value: "all",      label: "All Payments" },
  ]

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-border shadow-sm p-4">
          <p className="text-xs text-text-secondary mb-1">Pending Review</p>
          <p className="text-2xl font-bold text-warning">{counts.pending}</p>
          <p className="text-xs text-text-secondary mt-0.5">
            {totalPending > 0 && `≈ $${(totalPending / 1000).toFixed(0)}K total`}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-border shadow-sm p-4">
          <p className="text-xs text-text-secondary mb-1">Disputed</p>
          <p className="text-2xl font-bold text-danger">{counts.disputed}</p>
        </div>
        <div className="bg-white rounded-xl border border-border shadow-sm p-4">
          <p className="text-xs text-text-secondary mb-1">Verified</p>
          <p className="text-2xl font-bold text-success">{counts.verified}</p>
        </div>
        <div className="bg-white rounded-xl border border-border shadow-sm p-4">
          <p className="text-xs text-text-secondary mb-1">Total Payments</p>
          <p className="text-2xl font-bold text-text-primary">{counts.all}</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 border-b border-border overflow-x-auto">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              className={cn(
                "px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px shrink-0",
                filter === tab.value
                  ? "border-ocean text-ocean"
                  : "border-transparent text-text-secondary hover:text-text-primary"
              )}
            >
              {tab.label}
              <span className={cn(
                "ml-2 px-1.5 py-0.5 rounded text-xs font-medium",
                filter === tab.value ? "bg-ocean/10 text-ocean" : "bg-gray-100 text-text-secondary"
              )}>
                {counts[tab.value]}
              </span>
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={() => mutate()} disabled={loading} className="gap-1.5 shrink-0 ml-3">
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {error && <ErrorBar msg={error} />}

      {/* List */}
      {loading && records.length === 0 ? (
        <div className="flex items-center justify-center py-16 gap-2 text-text-secondary text-sm">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading payments…
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-border p-12 text-center">
          <DollarSign className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-text-secondary">
            {filter === "pending" ? "No pending payments — all caught up!" : "No payments in this category"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((record) => (
            <PaymentRow key={record.id} record={record} onUpdated={() => mutate()} />
          ))}
        </div>
      )}
    </div>
  )
}
