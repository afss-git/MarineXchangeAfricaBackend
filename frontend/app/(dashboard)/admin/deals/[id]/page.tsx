"use client"

import React, { useState, useEffect, useCallback, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowLeft, RefreshCw, AlertCircle, CheckCircle2, XCircle,
  Clock, AlertTriangle, DollarSign, Calendar, Plus, Trash2,
  User, Package, ChevronDown, ChevronUp, Shield,
  FileText, Banknote, X, Upload, Download, FolderOpen, Receipt,
  Loader2, Send, Ban, Zap, CreditCard, Bell,
  Settings2, ShieldAlert, Edit3, Eye, EyeOff,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  dealAdmin,
  payments,
  documents as documentsApi,
  type DealResponse,
  type PaymentScheduleOut,
  type ScheduleItemOut,
  type PaymentRecordOut,
  type DealPaymentSummary,
  type DocumentOut,
  type DocumentType,
  type InvoiceOut,
  type InvoiceType,
} from "@/lib/api"

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

function fmtDateTime(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function fmtCurrency(amount: string | null, currency: string) {
  if (!amount) return "—"
  const num = parseFloat(amount)
  if (isNaN(num)) return amount
  return `${currency} ${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const DEAL_STATUS_COLOR: Record<string, string> = {
  draft:            "bg-gray-100 text-text-secondary border-gray-200",
  offer_sent:       "bg-ocean/10 text-ocean border-ocean/20",
  accepted:         "bg-success/10 text-success border-success/20",
  active:           "bg-ocean/10 text-ocean border-ocean/20",
  completed:        "bg-navy/10 text-navy border-navy/20",
  cancelled:        "bg-gray-100 text-text-secondary border-gray-200",
  disputed:         "bg-danger/10 text-danger border-danger/20",
  defaulted:        "bg-danger/10 text-danger border-danger/20",
  pending_approval: "bg-warning/10 text-warning border-warning/20",
}

const ITEM_STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  pending:           { label: "Pending",            color: "bg-warning/10 text-warning border-warning/20",   icon: Clock },
  payment_submitted: { label: "Payment Submitted",  color: "bg-ocean/10 text-ocean border-ocean/20",         icon: Receipt },
  verified:          { label: "Verified",           color: "bg-success/10 text-success border-success/20",   icon: CheckCircle2 },
  overdue:           { label: "Overdue",            color: "bg-danger/10 text-danger border-danger/20",      icon: AlertTriangle },
  waived:            { label: "Waived",             color: "bg-gray-100 text-text-secondary border-gray-200", icon: Shield },
}

const RECORD_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending_verification: { label: "Awaiting Review", color: "bg-warning/10 text-warning border-warning/20" },
  verified:             { label: "Verified",        color: "bg-success/10 text-success border-success/20" },
  rejected:             { label: "Rejected",        color: "bg-danger/10 text-danger border-danger/20" },
}

// ── Sub-components ────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-2.5 border-b border-border last:border-0">
      <span className="text-xs text-text-secondary">{label}</span>
      <span className="text-xs font-medium text-text-primary text-right max-w-[200px]">{value}</span>
    </div>
  )
}

// ── Waive panel ───────────────────────────────────────────────────────────────

function WaivePanel({
  item,
  onDone,
  onClose,
}: {
  item: ScheduleItemOut
  onDone: (updated: ScheduleItemOut) => void
  onClose: () => void
}) {
  const [reason, setReason] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!reason.trim()) { setError("Waiver reason is required."); return }
    setIsLoading(true)
    setError(null)
    try {
      const updated = await payments.admin.waiveItem(item.id, reason)
      onDone(updated)
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "Waive failed.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-border bg-gray-50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-text-primary">Waive Installment</p>
        <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div>
        <label className="text-xs font-medium text-text-secondary block mb-1">
          Waiver Reason <span className="text-danger">*</span>
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="Explain why this installment is being waived…"
          className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-warning/20 focus:border-warning resize-none"
        />
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      <Button
        onClick={submit}
        disabled={isLoading}
        size="sm"
        className="w-full bg-warning hover:bg-warning/90 text-white"
      >
        {isLoading ? "Processing…" : "Confirm Waiver"}
      </Button>
    </div>
  )
}

// ── Evidence file button (fetches signed URL on click) ────────────────────────

function EvidenceFileButton({ evidenceId, fileName }: { evidenceId: string; fileName: string }) {
  const [loading, setLoading] = useState(false)

  async function open() {
    setLoading(true)
    try {
      const { signed_url } = await payments.admin.getEvidenceDownloadUrl(evidenceId)
      window.open(signed_url, "_blank", "noopener,noreferrer")
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  return (
    <button
      onClick={open}
      disabled={loading}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-ocean/5 border border-ocean/20 rounded-lg text-xs text-ocean hover:bg-ocean/10 hover:border-ocean/40 transition-colors disabled:opacity-50"
    >
      {loading
        ? <Loader2 className="w-3 h-3 animate-spin" />
        : <Download className="w-3 h-3" />}
      {fileName}
    </button>
  )
}

// ── Payment record row ────────────────────────────────────────────────────────

function RecordRow({
  record,
  onUpdate,
}: {
  record: PaymentRecordOut
  onUpdate: (updated: PaymentRecordOut) => void
}) {
  const [open, setOpen] = useState(record.status === "pending_verification")
  const [reviewMode, setReviewMode] = useState<"verify" | "reject" | null>(null)
  const [rejectReason, setRejectReason] = useState("")
  const [notes, setNotes] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cfg = RECORD_STATUS_CONFIG[record.status] ?? {
    label: record.status,
    color: "bg-gray-100 text-text-secondary border-gray-200",
  }
  const isPending = record.status === "pending_verification"

  async function submitReview() {
    if (!reviewMode) return
    if (reviewMode === "reject" && !rejectReason.trim()) {
      setError("Rejection reason is required.")
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      let updated: PaymentRecordOut
      if (reviewMode === "verify") {
        updated = await payments.admin.verifyPayment(record.id, notes || undefined)
      } else {
        updated = await payments.admin.rejectPayment(record.id, rejectReason)
      }
      onUpdate(updated)
      setReviewMode(null)
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "Action failed.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className={cn(
      "rounded-xl border bg-white overflow-hidden",
      isPending ? "border-warning/40 ring-1 ring-warning/20" : "border-border"
    )}>
      {/* Header row */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
      >
        <span className={cn("inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border", cfg.color)}>
          {cfg.label}
        </span>
        <span className="font-semibold text-sm text-text-primary">
          {fmtCurrency(record.amount_paid, record.currency)}
        </span>
        <span className="text-xs text-text-secondary">{fmtDate(record.payment_date)}</span>
        <span className="text-xs text-text-secondary capitalize ml-auto">
          {record.payment_method.replace(/_/g, " ")}
        </span>
        {isPending && (
          <span className="text-xs font-semibold text-warning bg-warning/10 px-2 py-0.5 rounded-full border border-warning/20 shrink-0">
            Needs Review
          </span>
        )}
        {open ? <ChevronUp className="w-4 h-4 text-text-secondary shrink-0" /> : <ChevronDown className="w-4 h-4 text-text-secondary shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-border">
          {/* Payment details */}
          <div className="px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-0">
            {[
              ["Submitted", fmtDateTime(record.submitted_at)],
              ["Bank Name", record.bank_name ?? "—"],
              ["Bank Reference", record.bank_reference ?? "—"],
              ["Reviewed At", fmtDateTime(record.reviewed_at)],
            ].map(([label, value]) => (
              <div key={label} className="py-1.5 border-b border-border/40 last:border-0">
                <p className="text-xs text-text-secondary">{label}</p>
                <p className="text-xs font-medium text-text-primary">{value}</p>
              </div>
            ))}
          </div>

          {record.notes && (
            <div className="mx-4 mb-3 px-3 py-2 bg-gray-50 rounded-lg">
              <p className="text-xs text-text-secondary mb-0.5">Buyer Notes</p>
              <p className="text-xs text-text-primary">{record.notes}</p>
            </div>
          )}

          {record.rejection_reason && (
            <div className="mx-4 mb-3 px-3 py-2 bg-danger/5 border border-danger/20 rounded-lg">
              <p className="text-xs font-semibold text-danger mb-0.5">Rejection Reason</p>
              <p className="text-xs text-text-primary">{record.rejection_reason}</p>
            </div>
          )}

          {/* Receipt / Evidence */}
          <div className="px-4 pb-3">
            <p className="text-xs font-semibold text-text-secondary mb-2">
              Payment Receipt {record.evidence.length > 0 ? `(${record.evidence.length})` : ""}
            </p>
            {record.evidence.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {record.evidence.map((ev) => (
                  <EvidenceFileButton key={ev.id} evidenceId={ev.id} fileName={ev.file_name} />
                ))}
              </div>
            ) : (
              <p className="text-xs text-text-secondary/60 italic">No receipt uploaded by buyer.</p>
            )}
          </div>

          {/* Approve / Reject actions — only for pending records */}
          {isPending && (
            <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
              {!reviewMode ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => setReviewMode("verify")}
                    className="flex-1 bg-success hover:bg-success/90 text-white gap-1.5"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Approve Payment
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setReviewMode("reject")}
                    className="flex-1 border-danger/40 text-danger hover:bg-danger/5 gap-1.5"
                  >
                    <XCircle className="w-3.5 h-3.5" /> Reject
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "text-sm font-semibold",
                      reviewMode === "verify" ? "text-success" : "text-danger"
                    )}>
                      {reviewMode === "verify" ? "Approving payment" : "Rejecting payment"}
                    </span>
                    <button onClick={() => { setReviewMode(null); setError(null) }} className="ml-auto text-text-secondary hover:text-text-primary">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {reviewMode === "verify" ? (
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      placeholder="Optional notes for your records…"
                      className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-success/20 focus:border-success resize-none"
                    />
                  ) : (
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      rows={2}
                      placeholder="Explain why this payment is rejected (buyer will see this)…"
                      className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-danger/20 focus:border-danger resize-none"
                    />
                  )}

                  {error && <p className="text-xs text-danger">{error}</p>}

                  <Button
                    onClick={submitReview}
                    disabled={isLoading}
                    size="sm"
                    className={cn(
                      "w-full gap-1.5",
                      reviewMode === "verify"
                        ? "bg-success hover:bg-success/90 text-white"
                        : "bg-danger hover:bg-danger/90 text-white"
                    )}
                  >
                    {isLoading
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing…</>
                      : reviewMode === "verify"
                      ? <><CheckCircle2 className="w-3.5 h-3.5" /> Confirm Approval</>
                      : <><XCircle className="w-3.5 h-3.5" /> Confirm Rejection</>}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Schedule item row ─────────────────────────────────────────────────────────

function ScheduleItemRow({
  item,
  records,
  onItemUpdate,
  onRecordUpdate,
}: {
  item: ScheduleItemOut
  records: PaymentRecordOut[]
  onItemUpdate: (updated: ScheduleItemOut) => void
  onRecordUpdate: (updated: PaymentRecordOut) => void
}) {
  const [showWaive, setShowWaive] = useState(false)
  const [open, setOpen] = useState(false)

  const cfg = ITEM_STATUS_CONFIG[item.status] ?? {
    label: item.status,
    color: "bg-gray-100 text-text-secondary border-gray-200",
    icon: Clock,
  }
  const Icon = cfg.icon

  const canWaive = item.status === "pending" || item.status === "overdue"
  const hasRecords = records.length > 0

  return (
    <div className="rounded-xl border border-border bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex items-center justify-center w-7 h-7 rounded-full bg-ocean/10 text-ocean text-xs font-bold shrink-0">
          {item.installment_number}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-sm text-text-primary">{item.label}</p>
            <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border", cfg.color)}>
              <Icon className="w-3 h-3" />
              {cfg.label}
            </span>
          </div>
          <p className="text-xs text-text-secondary mt-0.5">
            Due {fmtDate(item.due_date)}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-bold text-text-primary">{fmtCurrency(item.amount, item.currency)}</p>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="p-1 text-text-secondary hover:text-text-primary rounded-md hover:bg-gray-100 transition-colors"
        >
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Waiver info */}
      {item.status === "waived" && item.waiver_reason && (
        <div className="px-4 pb-3">
          <div className="bg-gray-50 rounded-lg px-3 py-2 flex items-start gap-2">
            <Shield className="w-3.5 h-3.5 text-text-secondary mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-medium text-text-secondary">Waiver reason</p>
              <p className="text-xs text-text-primary">{item.waiver_reason}</p>
            </div>
          </div>
        </div>
      )}

      {/* Expanded section */}
      {open && (
        <div className="border-t border-border px-4 py-4 space-y-4">
          {/* Records */}
          {hasRecords ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                Payment Records ({records.length})
              </p>
              {records.map((r) => (
                <RecordRow key={r.id} record={r} onUpdate={onRecordUpdate} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-secondary italic">No payment records submitted yet.</p>
          )}

          {/* Waive action */}
          {canWaive && (
            <div>
              {!showWaive ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowWaive(true)}
                  className="gap-1.5 text-warning border-warning/30 hover:bg-warning/5"
                >
                  <Shield className="w-3.5 h-3.5" />
                  Waive Installment
                </Button>
              ) : (
                <WaivePanel
                  item={item}
                  onDone={(updated) => { onItemUpdate(updated); setShowWaive(false) }}
                  onClose={() => setShowWaive(false)}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Create schedule form ──────────────────────────────────────────────────────

interface ManualInstallment {
  label: string
  amount: string
  due_date: string
}

function CreateSchedulePanel({
  dealId,
  currency,
  onCreated,
  onClose,
}: {
  dealId: string
  currency: string
  onCreated: (schedule: PaymentScheduleOut) => void
  onClose: () => void
}) {
  const [mode, setMode] = useState<"auto" | "manual">("auto")
  const [autoCount, setAutoCount] = useState("3")
  const [manualItems, setManualItems] = useState<ManualInstallment[]>([
    { label: "Installment 1", amount: "", due_date: "" },
  ])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function addItem() {
    setManualItems((prev) => [
      ...prev,
      { label: `Installment ${prev.length + 1}`, amount: "", due_date: "" },
    ])
  }

  function removeItem(i: number) {
    setManualItems((prev) => prev.filter((_, idx) => idx !== i))
  }

  function updateItem(i: number, field: keyof ManualInstallment, value: string) {
    setManualItems((prev) =>
      prev.map((item, idx) => (idx === i ? { ...item, [field]: value } : item))
    )
  }

  async function submit() {
    setIsLoading(true)
    setError(null)
    try {
      let payload: Parameters<typeof payments.admin.createSchedule>[1]
      if (mode === "auto") {
        const count = parseInt(autoCount)
        if (isNaN(count) || count < 1 || count > 24) {
          setError("Enter a number between 1 and 24.")
          setIsLoading(false)
          return
        }
        payload = { mode: "auto", installments: count, currency }
      } else {
        const items = manualItems.map((it) => ({
          label: it.label.trim(),
          amount: parseFloat(it.amount),
          due_date: it.due_date,
        }))
        if (items.some((it) => !it.label || isNaN(it.amount) || !it.due_date)) {
          setError("All installment fields are required.")
          setIsLoading(false)
          return
        }
        payload = { mode: "manual", installments: items, currency }
      }
      const schedule = await payments.admin.createSchedule(dealId, payload)
      onCreated(schedule)
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "Failed to create schedule.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-text-primary">Create Payment Schedule</h3>
        <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Mode tabs */}
      <div className="flex gap-2">
        {(["auto", "manual"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn(
              "flex-1 py-2 rounded-lg text-sm font-medium border transition-colors capitalize",
              mode === m
                ? "bg-ocean text-white border-ocean"
                : "bg-white text-text-secondary border-border hover:border-gray-300"
            )}
          >
            {m === "auto" ? "Auto (Equal Installments)" : "Manual (Custom)"}
          </button>
        ))}
      </div>

      {mode === "auto" ? (
        <div>
          <label className="text-xs font-medium text-text-secondary block mb-1">
            Number of Installments
          </label>
          <input
            type="number"
            min={1}
            max={24}
            value={autoCount}
            onChange={(e) => setAutoCount(e.target.value)}
            className="w-32 px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
          />
          <p className="text-xs text-text-secondary mt-1.5">
            The total deal amount will be split equally across {autoCount || "N"} installments.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {manualItems.map((item, i) => (
              <div key={i} className="flex gap-2 items-start">
                <div className="flex-1 grid grid-cols-3 gap-2">
                  <input
                    value={item.label}
                    onChange={(e) => updateItem(i, "label", e.target.value)}
                    placeholder="Label"
                    className="px-2.5 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-ocean/20 focus:border-ocean"
                  />
                  <input
                    type="number"
                    value={item.amount}
                    onChange={(e) => updateItem(i, "amount", e.target.value)}
                    placeholder={`Amount (${currency})`}
                    className="px-2.5 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-ocean/20 focus:border-ocean"
                  />
                  <input
                    type="date"
                    value={item.due_date}
                    onChange={(e) => updateItem(i, "due_date", e.target.value)}
                    className="px-2.5 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-ocean/20 focus:border-ocean"
                  />
                </div>
                <button
                  onClick={() => removeItem(i)}
                  disabled={manualItems.length === 1}
                  className="p-1.5 text-text-secondary hover:text-danger disabled:opacity-30 rounded-md hover:bg-danger/5 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={addItem}
            className="gap-1.5 text-ocean border-ocean/30 hover:bg-ocean/5"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Installment
          </Button>
        </div>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="flex gap-2">
        <Button
          onClick={submit}
          disabled={isLoading}
          className="bg-ocean hover:bg-ocean-dark text-white gap-1.5"
        >
          <Calendar className="w-4 h-4" />
          {isLoading ? "Creating…" : "Create Schedule"}
        </Button>
        <Button variant="outline" onClick={onClose} disabled={isLoading}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

// ── Document type options ─────────────────────────────────────────────────────

const DOC_TYPES: { value: DocumentType; label: string }[] = [
  { value: "contract",          label: "Contract" },
  { value: "inspection_report", label: "Inspection Report" },
  { value: "receipt",           label: "Receipt" },
  { value: "invoice",           label: "Invoice" },
  { value: "identification",    label: "Identification" },
  { value: "bank_statement",    label: "Bank Statement" },
  { value: "title_deed",        label: "Title Deed" },
  { value: "survey_report",     label: "Survey Report" },
  { value: "correspondence",    label: "Correspondence" },
  { value: "other",             label: "Other" },
]

// ── Admin Documents Panel ─────────────────────────────────────────────────────

function AdminDocumentsPanel({
  dealId,
  docs,
  onUpdate,
}: {
  dealId: string
  docs: DocumentOut[]
  onUpdate: (docs: DocumentOut[]) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Upload form state
  const [docType, setDocType] = useState<DocumentType>("contract")
  const [description, setDescription] = useState("")
  const [visibleBuyer, setVisibleBuyer] = useState(false)
  const [visibleSeller, setVisibleSeller] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // Edit visibility state
  const [editBuyer, setEditBuyer] = useState(false)
  const [editSeller, setEditSeller] = useState(false)
  const [editDesc, setEditDesc] = useState("")
  const [editSaving, setEditSaving] = useState(false)

  async function handleUpload() {
    if (!selectedFile) { setUploadError("Select a file first."); return }
    setUploading(true)
    setUploadError(null)
    const fd = new FormData()
    fd.append("file", selectedFile)
    fd.append("document_type", docType)
    if (description) fd.append("description", description)
    fd.append("is_visible_to_buyer", String(visibleBuyer))
    fd.append("is_visible_to_seller", String(visibleSeller))
    try {
      const doc = await documentsApi.admin.uploadDocument(dealId, fd)
      onUpdate([doc, ...docs])
      setShowUpload(false)
      setSelectedFile(null)
      setDescription("")
      setDocType("contract")
      setVisibleBuyer(false)
      setVisibleSeller(false)
    } catch (e: unknown) {
      setUploadError((e as Error)?.message ?? "Upload failed.")
    } finally {
      setUploading(false)
    }
  }

  async function handleDownload(doc: DocumentOut) {
    setDownloading(doc.id)
    try {
      const res = await documentsApi.downloadDocument(doc.id)
      window.open(res.signed_url, "_blank", "noopener")
    } catch (e: unknown) {
      alert((e as Error)?.message ?? "Download failed.")
    } finally {
      setDownloading(null)
    }
  }

  async function handleDelete(doc: DocumentOut) {
    const reason = prompt("Enter deletion reason (required):")
    if (!reason || reason.trim().length < 5) { alert("Reason must be at least 5 characters."); return }
    setDeleting(doc.id)
    try {
      await documentsApi.admin.deleteDocument(doc.id, reason)
      onUpdate(docs.map((d) => d.id === doc.id ? { ...d, is_deleted: true } : d))
    } catch (e: unknown) {
      alert((e as Error)?.message ?? "Delete failed.")
    } finally {
      setDeleting(null)
    }
  }

  async function handleSaveEdit(doc: DocumentOut) {
    setEditSaving(true)
    try {
      const updated = await documentsApi.admin.updateDocument(doc.id, {
        description: editDesc || null,
        is_visible_to_buyer: editBuyer,
        is_visible_to_seller: editSeller,
      })
      onUpdate(docs.map((d) => d.id === updated.id ? updated : d))
      setEditingId(null)
    } catch (e: unknown) {
      alert((e as Error)?.message ?? "Update failed.")
    } finally {
      setEditSaving(false)
    }
  }

  function startEdit(doc: DocumentOut) {
    setEditingId(doc.id)
    setEditBuyer(doc.is_visible_to_buyer)
    setEditSeller(doc.is_visible_to_seller)
    setEditDesc(doc.description ?? "")
  }

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-ocean" />
          <h2 className="font-semibold text-text-primary">Documents</h2>
          <span className="text-xs text-text-secondary ml-1">
            · {docs.filter((d) => !d.is_deleted).length} active
          </span>
        </div>
        <Button
          size="sm"
          onClick={() => setShowUpload((v) => !v)}
          className="gap-1.5 bg-ocean hover:bg-ocean-dark text-white"
        >
          <Upload className="w-3.5 h-3.5" />
          Upload Document
        </Button>
      </div>

      {/* Upload form */}
      {showUpload && (
        <div className="border-b border-border bg-gray-50/60 px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">Document Type</label>
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value as DocumentType)}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean bg-white"
              >
                {DOC_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">Description</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description…"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
              />
            </div>
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={visibleBuyer}
                onChange={(e) => setVisibleBuyer(e.target.checked)}
                className="rounded border-border accent-ocean"
              />
              <span className="text-text-secondary">Visible to Buyer</span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={visibleSeller}
                onChange={(e) => setVisibleSeller(e.target.checked)}
                className="rounded border-border accent-ocean"
              />
              <span className="text-text-secondary">Visible to Seller</span>
            </label>
          </div>
          <div className="flex items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 border border-dashed border-border rounded-lg text-sm text-text-secondary hover:border-ocean hover:text-ocean transition-colors"
            >
              <Upload className="w-4 h-4" />
              {selectedFile ? selectedFile.name : "Choose file…"}
            </button>
            {uploadError && <p className="text-xs text-danger">{uploadError}</p>}
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setShowUpload(false); setSelectedFile(null) }}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleUpload}
                disabled={uploading || !selectedFile}
                className="bg-ocean hover:bg-ocean-dark text-white gap-1.5"
              >
                {uploading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading…</> : "Upload"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {docs.length === 0 ? (
        <div className="py-12 text-center">
          <FolderOpen className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-sm text-text-secondary">No documents uploaded yet.</p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {docs.map((doc) => (
            <div key={doc.id} className={cn("px-5 py-4", doc.is_deleted && "opacity-50")}>
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-ocean/10 shrink-0">
                  <FileText className="w-4 h-4 text-ocean" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-text-primary">{doc.file_name}</p>
                    {doc.is_deleted && (
                      <span className="text-xs text-danger font-medium">[Deleted]</span>
                    )}
                    {doc.is_visible_to_buyer && (
                      <span className="inline-flex items-center gap-0.5 text-xs text-success bg-success/10 px-1.5 py-0.5 rounded">
                        <Eye className="w-3 h-3" /> Buyer
                      </span>
                    )}
                    {doc.is_visible_to_seller && (
                      <span className="inline-flex items-center gap-0.5 text-xs text-ocean bg-ocean/10 px-1.5 py-0.5 rounded">
                        <Eye className="w-3 h-3" /> Seller
                      </span>
                    )}
                    {!doc.is_visible_to_buyer && !doc.is_visible_to_seller && (
                      <span className="inline-flex items-center gap-0.5 text-xs text-text-secondary bg-gray-100 px-1.5 py-0.5 rounded">
                        <EyeOff className="w-3 h-3" /> Admin only
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-secondary mt-0.5">
                    {DOC_TYPES.find((t) => t.value === doc.document_type)?.label ?? doc.document_type}
                    {doc.description ? ` · ${doc.description}` : ""}
                    {doc.file_size_bytes ? ` · ${(doc.file_size_bytes / 1024).toFixed(1)} KB` : ""}
                    {` · ${fmtDate(doc.uploaded_at)}`}
                  </p>
                  {doc.acknowledgements_count > 0 && (
                    <p className="text-xs text-success mt-0.5">
                      <CheckCircle2 className="w-3 h-3 inline mr-0.5" />
                      Acknowledged by {doc.acknowledgements_count} user{doc.acknowledgements_count !== 1 ? "s" : ""}
                    </p>
                  )}

                  {/* Inline edit */}
                  {editingId === doc.id && (
                    <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-border space-y-2">
                      <input
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        placeholder="Description…"
                        className="w-full px-2.5 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-ocean/20 focus:border-ocean"
                      />
                      <div className="flex gap-4">
                        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                          <input type="checkbox" checked={editBuyer} onChange={(e) => setEditBuyer(e.target.checked)} className="accent-ocean" />
                          Visible to Buyer
                        </label>
                        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                          <input type="checkbox" checked={editSeller} onChange={(e) => setEditSeller(e.target.checked)} className="accent-ocean" />
                          Visible to Seller
                        </label>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleSaveEdit(doc)} disabled={editSaving}
                          className="bg-ocean hover:bg-ocean-dark text-white text-xs h-7">
                          {editSaving ? "Saving…" : "Save"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingId(null)} className="text-xs h-7">
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Actions */}
                {!doc.is_deleted && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => editingId === doc.id ? setEditingId(null) : startEdit(doc)}
                      className="h-7 px-2 text-xs text-text-secondary hover:text-text-primary"
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDownload(doc)}
                      disabled={downloading === doc.id}
                      className="h-7 px-2 text-ocean hover:text-ocean-dark"
                    >
                      {downloading === doc.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Download className="w-3.5 h-3.5" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(doc)}
                      disabled={deleting === doc.id}
                      className="h-7 px-2 text-danger hover:text-danger/80"
                    >
                      {deleting === doc.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Trash2 className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Admin Invoices Panel ──────────────────────────────────────────────────────

const INVOICE_STATUS_STYLE: Record<string, string> = {
  draft:  "bg-gray-100 text-text-secondary border-gray-200",
  issued: "bg-success/10 text-success border-success/20",
  void:   "bg-danger/10 text-danger border-danger/20",
}

function AdminInvoicesPanel({
  dealId,
  invoices,
  scheduleItems,
  currency,
  onUpdate,
}: {
  dealId: string
  invoices: InvoiceOut[]
  scheduleItems: ScheduleItemOut[]
  currency: string
  onUpdate: (invoices: InvoiceOut[]) => void
}) {
  const [showGenerate, setShowGenerate] = useState(false)
  const [invType, setInvType] = useState<InvoiceType>("proforma")
  const [scheduleItemId, setScheduleItemId] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [notes, setNotes] = useState("")
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [issuing, setIssuing] = useState<string | null>(null)
  const [voiding, setVoiding] = useState<string | null>(null)

  async function handleGenerate() {
    setGenerating(true)
    setGenError(null)
    try {
      const payload: {
        invoice_type: InvoiceType
        schedule_item_id?: string
        due_date?: string
        notes?: string
      } = { invoice_type: invType }
      if (invType === "installment" && scheduleItemId) payload.schedule_item_id = scheduleItemId
      if (dueDate) payload.due_date = dueDate
      if (notes) payload.notes = notes
      const inv = await documentsApi.admin.generateInvoice(dealId, payload)
      onUpdate([inv, ...invoices])
      setShowGenerate(false)
      setScheduleItemId("")
      setDueDate("")
      setNotes("")
    } catch (e: unknown) {
      setGenError((e as Error)?.message ?? "Failed to generate invoice.")
    } finally {
      setGenerating(false)
    }
  }

  async function handleIssue(inv: InvoiceOut) {
    setIssuing(inv.id)
    try {
      const updated = await documentsApi.admin.issueInvoice(inv.id)
      onUpdate(invoices.map((i) => (i.id === updated.id ? updated : i)))
    } catch (e: unknown) {
      alert((e as Error)?.message ?? "Issue failed.")
    } finally {
      setIssuing(null)
    }
  }

  async function handleVoid(inv: InvoiceOut) {
    const reason = prompt("Enter void reason (required):")
    if (!reason || reason.trim().length < 5) { alert("Reason must be at least 5 characters."); return }
    setVoiding(inv.id)
    try {
      const updated = await documentsApi.admin.voidInvoice(inv.id, reason)
      onUpdate(invoices.map((i) => (i.id === updated.id ? updated : i)))
    } catch (e: unknown) {
      alert((e as Error)?.message ?? "Void failed.")
    } finally {
      setVoiding(null)
    }
  }

  async function handleDownload(inv: InvoiceOut) {
    if (!inv.has_pdf) { alert("PDF not available for this invoice."); return }
    setDownloading(inv.id)
    try {
      const { blob } = await documentsApi.downloadInvoice(inv.id)
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = blobUrl
      a.download = `${inv.invoice_ref}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
    } catch (e: unknown) {
      alert((e as Error)?.message ?? "Download failed.")
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Receipt className="w-4 h-4 text-ocean" />
          <h2 className="font-semibold text-text-primary">Invoices</h2>
          <span className="text-xs text-text-secondary ml-1">· {invoices.length}</span>
        </div>
        <Button
          size="sm"
          onClick={() => setShowGenerate((v) => !v)}
          className="gap-1.5 bg-ocean hover:bg-ocean-dark text-white"
        >
          <Plus className="w-3.5 h-3.5" />
          Generate Invoice
        </Button>
      </div>

      {/* Generate form */}
      {showGenerate && (
        <div className="border-b border-border bg-gray-50/60 px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">Invoice Type</label>
              <select
                value={invType}
                onChange={(e) => setInvType(e.target.value as InvoiceType)}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean bg-white"
              >
                <option value="proforma">Proforma</option>
                <option value="installment">Installment</option>
                <option value="final">Final</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
              />
            </div>
          </div>

          {invType === "installment" && scheduleItems.length > 0 && (
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">
                Schedule Item <span className="text-danger">*</span>
              </label>
              <select
                value={scheduleItemId}
                onChange={(e) => setScheduleItemId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean bg-white"
              >
                <option value="">— Select installment —</option>
                {scheduleItems.map((it) => (
                  <option key={it.id} value={it.id}>
                    #{it.installment_number} · {it.label} · {currency} {Number(it.amount).toLocaleString()} · Due {fmtDate(it.due_date)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Internal notes…"
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean resize-none"
            />
          </div>

          {genError && <p className="text-xs text-danger">{genError}</p>}

          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleGenerate}
              disabled={generating || (invType === "installment" && !scheduleItemId)}
              className="bg-ocean hover:bg-ocean-dark text-white gap-1.5"
            >
              {generating
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…</>
                : <><Receipt className="w-3.5 h-3.5" /> Generate</>}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowGenerate(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {invoices.length === 0 ? (
        <div className="py-12 text-center">
          <Receipt className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-sm text-text-secondary">No invoices generated yet.</p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {invoices.map((inv) => (
            <div key={inv.id} className="flex items-start gap-3 px-5 py-4">
              <div className="p-2 rounded-lg bg-ocean/10 shrink-0 mt-0.5">
                <Receipt className="w-4 h-4 text-ocean" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-mono font-semibold text-text-primary">{inv.invoice_ref}</p>
                  <span className={cn(
                    "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize",
                    INVOICE_STATUS_STYLE[inv.status] ?? "bg-gray-100 text-text-secondary border-gray-200"
                  )}>
                    {inv.status}
                  </span>
                  <span className="text-xs text-text-secondary capitalize">{inv.invoice_type}</span>
                </div>
                <p className="text-xs font-semibold text-navy mt-0.5">
                  {inv.currency} {Number(inv.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  {inv.due_date && ` · Due ${fmtDate(inv.due_date)}`}
                  {inv.issued_at && ` · Issued ${fmtDate(inv.issued_at)}`}
                </p>
                {inv.notes && <p className="text-xs text-text-secondary mt-0.5">{inv.notes}</p>}
                {inv.void_reason && (
                  <p className="text-xs text-danger mt-0.5">Voided: {inv.void_reason}</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1.5 shrink-0">
                {inv.status === "draft" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleIssue(inv)}
                    disabled={issuing === inv.id}
                    className="gap-1 text-xs h-7 text-success border-success/30 hover:bg-success/5"
                  >
                    {issuing === inv.id
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <Send className="w-3 h-3" />}
                    Issue
                  </Button>
                )}
                {(inv.status === "draft" || inv.status === "issued") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleVoid(inv)}
                    disabled={voiding === inv.id}
                    className="h-7 px-2 text-danger hover:text-danger/80"
                  >
                    {voiding === inv.id
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <Ban className="w-3 h-3" />}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDownload(inv)}
                  disabled={downloading === inv.id || !inv.has_pdf}
                  className="h-7 px-2 text-ocean hover:text-ocean-dark"
                  title={!inv.has_pdf ? "No PDF" : "Download"}
                >
                  {downloading === inv.id
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <Download className="w-3 h-3" />}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminDealDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  type AdminTab = "payments" | "documents" | "invoices" | "actions"

  const [deal, setDeal] = useState<DealResponse | null>(null)
  const [schedule, setSchedule] = useState<PaymentScheduleOut | null>(null)
  const [records, setRecords] = useState<PaymentRecordOut[]>([])
  const [summary, setSummary] = useState<DealPaymentSummary | null>(null)
  const [docs, setDocs] = useState<DocumentOut[]>([])
  const [invoices, setInvoices] = useState<InvoiceOut[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreateSchedule, setShowCreateSchedule] = useState(false)
  const [deletingSchedule, setDeletingSchedule] = useState(false)
  const [activeTab, setActiveTab] = useState<AdminTab>("payments")

  // ── Actions tab state ───────────────────────────────────────────────────────
  const [showTermsForm, setShowTermsForm] = useState(false)
  const [termsForm, setTermsForm] = useState({ total_price: "", admin_notes: "", payment_deadline: "", payment_instructions: "" })
  const [termsSaving, setTermsSaving] = useState(false)
  const [termsError, setTermsError] = useState<string | null>(null)

  const [sendingOffer, setSendingOffer] = useState(false)
  const [offerError, setOfferError] = useState<string | null>(null)

  const [markAcceptNotes, setMarkAcceptNotes] = useState("")
  const [markingAccepted, setMarkingAccepted] = useState(false)
  const [markAcceptError, setMarkAcceptError] = useState<string | null>(null)
  const [markAcceptSuccess, setMarkAcceptSuccess] = useState(false)

  const [secApproveNotes, setSecApproveNotes] = useState("")
  const [secApproving, setSecApproving] = useState(false)
  const [secApproveError, setSecApproveError] = useState<string | null>(null)
  const [secApproveSuccess, setSecApproveSuccess] = useState(false)

  const payFileRef = useRef<HTMLInputElement>(null)
  const [payFile, setPayFile] = useState<File | null>(null)
  const [recPayForm, setRecPayForm] = useState({ amount: "", payment_date: "", bank_name: "", bank_reference: "", notes: "", payment_type: "full_payment" as "full_payment" | "initial_payment" | "installment" })
  const [recPaying, setRecPaying] = useState(false)
  const [recPayError, setRecPayError] = useState<string | null>(null)
  const [recPaySuccess, setRecPaySuccess] = useState(false)

  const [reminderType, setReminderType] = useState<"payment_reminder" | "overdue_warning" | "installment_due" | "installment_overdue">("payment_reminder")
  const [reminderMsg, setReminderMsg] = useState("")
  const [sendingReminder, setSendingReminder] = useState(false)
  const [reminderError, setReminderError] = useState<string | null>(null)
  const [reminderSuccess, setReminderSuccess] = useState(false)

  const [defaultReason, setDefaultReason] = useState("")
  const [markingDefault, setMarkingDefault] = useState(false)
  const [defaultError, setDefaultError] = useState<string | null>(null)

  const [cancelReason, setCancelReason] = useState("")
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const dealData = await dealAdmin.get(id)
      setDeal(dealData)

      const [schedRes, recRes, sumRes, docsRes, invoicesRes] = await Promise.allSettled([
        payments.admin.getSchedule(id),
        payments.admin.listRecords(id),
        payments.admin.getSummary(id),
        documentsApi.listDocuments(id),
        documentsApi.listInvoices(id),
      ])

      if (schedRes.status === "fulfilled") setSchedule(schedRes.value)
      if (recRes.status === "fulfilled") setRecords(recRes.value)
      if (sumRes.status === "fulfilled") setSummary(sumRes.value)
      if (docsRes.status === "fulfilled") setDocs(docsRes.value)
      if (invoicesRes.status === "fulfilled") setInvoices(invoicesRes.value)
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "Failed to load deal.")
    } finally {
      setIsLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  function handleItemUpdate(updated: ScheduleItemOut) {
    setSchedule((prev) =>
      prev
        ? { ...prev, items: prev.items.map((it) => (it.id === updated.id ? updated : it)) }
        : prev
    )
    // Refresh summary
    payments.admin.getSummary(id).then(setSummary).catch(() => {})
  }

  function handleRecordUpdate(updated: PaymentRecordOut) {
    setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
    payments.admin.getSummary(id).then(setSummary).catch(() => {})
  }

  async function handleDeleteSchedule() {
    if (!confirm("Delete this payment schedule? This cannot be undone.")) return
    setDeletingSchedule(true)
    try {
      await payments.admin.deleteSchedule(id)
      setSchedule(null)
      setRecords([])
      setSummary(null)
    } catch (e: unknown) {
      alert((e as Error)?.message ?? "Failed to delete schedule.")
    } finally {
      setDeletingSchedule(false)
    }
  }

  // Group records by schedule_item_id
  const recordsByItem = records.reduce<Record<string, PaymentRecordOut[]>>((acc, r) => {
    const key = r.schedule_item_id ?? "__unlinked"
    if (!acc[key]) acc[key] = []
    acc[key].push(r)
    return acc
  }, {})

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 bg-gray-100 rounded-xl w-64" />
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 bg-gray-100 rounded-xl" />
          ))}
        </div>
        <div className="h-80 bg-gray-100 rounded-xl" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <AlertCircle className="w-10 h-10 text-danger" />
        <p className="text-text-secondary">{error}</p>
        <div className="flex gap-2">
          <Button onClick={load} variant="outline">Retry</Button>
          <Button onClick={() => router.back()} variant="ghost">Go Back</Button>
        </div>
      </div>
    )
  }

  if (!deal) return null

  const statusColor = DEAL_STATUS_COLOR[deal.status] ?? "bg-gray-100 text-text-secondary border-gray-200"

  // Payment progress
  const progressPct = summary && Number(summary.total_amount) > 0
    ? Math.min(100, Math.round((Number(summary.verified_amount) / Number(summary.total_amount)) * 100))
    : 0

  return (
    <div className="space-y-6">
      {/* Back + title */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/admin/deals")}
          className="gap-1.5 text-text-secondary"
        >
          <ArrowLeft className="w-4 h-4" />
          Deals
        </Button>
        <span className="text-text-secondary">/</span>
        <h1 className="text-lg font-bold text-text-primary">
          {deal.deal_ref || deal.id.slice(0, 8)}
        </h1>
        <span className={cn("inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ml-1", statusColor)}>
          {deal.status}
        </span>
        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column — deal info + tabs */}
        <div className="lg:col-span-2 space-y-6">
          {/* Deal overview (always visible) */}
          <div className="bg-white rounded-xl border border-border shadow-sm p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-gray-100 shrink-0 overflow-hidden flex items-center justify-center">
                {deal.product_primary_image_url ? (
                  <img src={deal.product_primary_image_url} alt={deal.product_title ?? "Product"} className="w-full h-full object-cover" />
                ) : (
                  <Package className="w-5 h-5 text-gray-300" />
                )}
              </div>
              <h2 className="font-semibold text-text-primary">Deal Overview</h2>
            </div>
            <div className="grid grid-cols-2 gap-x-8">
              <div className="space-y-0">
                {[
                  ["Product", deal.product_title ?? "—"],
                  ["Total Price", fmtCurrency(deal.total_price, deal.currency)],
                  ["Deal Type", deal.deal_type],
                  ["Arrangement Fee", fmtCurrency(deal.arrangement_fee, deal.currency)],
                ].map(([label, value]) => (
                  <InfoRow key={label} label={label} value={value} />
                ))}
              </div>
              <div className="space-y-0">
                {[
                  ["Status", deal.status],
                  ["Created", fmtDate(deal.created_at)],
                  ["Updated", fmtDate(deal.updated_at)],
                  ["Accepted At", fmtDate(deal.accepted_at)],
                ].map(([label, value]) => (
                  <InfoRow key={label} label={label} value={value} />
                ))}
              </div>
            </div>
            {deal.admin_notes && (
              <div className="mt-4 bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-text-secondary mb-1">Admin Notes</p>
                <p className="text-sm text-text-primary">{deal.admin_notes}</p>
              </div>
            )}
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
            {([
              { key: "payments",  label: "Payments",  icon: DollarSign },
              { key: "documents", label: "Documents", icon: FolderOpen, count: docs.filter((d) => !d.is_deleted).length },
              { key: "invoices",  label: "Invoices",  icon: Receipt,    count: invoices.length },
              { key: "actions",   label: "Actions",   icon: Settings2 },
            ] as { key: AdminTab; label: string; icon: React.ElementType; count?: number }[]).map(({ key, label, icon: Icon, count }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
                  activeTab === key
                    ? "bg-white text-ocean shadow-sm"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
                {count !== undefined && count > 0 && (
                  <span className={cn(
                    "ml-0.5 px-1.5 py-0.5 rounded-full text-xs font-semibold",
                    activeTab === key ? "bg-ocean/10 text-ocean" : "bg-gray-200 text-text-secondary"
                  )}>
                    {count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Payments tab */}
          {activeTab === "payments" && (
            <div className="space-y-6">
              {/* Payment summary */}
              {summary && (
                <div className="bg-white rounded-xl border border-border shadow-sm p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <DollarSign className="w-4 h-4 text-ocean" />
                    <h2 className="font-semibold text-text-primary">Payment Summary</h2>
                  </div>
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    {[
                      { label: "Total", value: fmtCurrency(summary.total_amount, deal.currency), color: "text-text-primary" },
                      { label: "Verified", value: fmtCurrency(summary.verified_amount, deal.currency), color: "text-success" },
                      { label: "Outstanding", value: fmtCurrency(summary.outstanding_amount, deal.currency), color: "text-warning" },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="bg-gray-50 rounded-xl p-3 text-center">
                        <p className={cn("text-lg font-bold", color)}>{value}</p>
                        <p className="text-xs text-text-secondary mt-0.5">{label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-text-secondary">
                      <span>Payment Progress</span>
                      <span>{progressPct}%</span>
                    </div>
                    <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all", progressPct === 100 ? "bg-success" : "bg-ocean")}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-3 mt-4">
                    {[
                      { label: "Total Items", value: summary.total_items },
                      { label: "Verified", value: summary.verified_count },
                      { label: "Pending", value: summary.pending_count },
                      { label: "Overdue", value: summary.overdue_count },
                    ].map(({ label, value }) => (
                      <div key={label} className="text-center">
                        <p className="text-xl font-bold text-text-primary">{value}</p>
                        <p className="text-xs text-text-secondary">{label}</p>
                      </div>
                    ))}
                  </div>
                  {summary.is_complete && (
                    <div className="mt-4 flex items-center gap-2 px-4 py-3 bg-success/10 border border-success/20 rounded-xl">
                      <CheckCircle2 className="w-4 h-4 text-success" />
                      <p className="text-sm font-medium text-success">All payments verified — deal complete</p>
                    </div>
                  )}
                </div>
              )}

              {/* Payment schedule */}
              <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-ocean" />
                    <h2 className="font-semibold text-text-primary">Payment Schedule</h2>
                    {schedule && (
                      <span className="text-xs text-text-secondary ml-1">
                        · {schedule.mode} · {schedule.total_items} items
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {schedule ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDeleteSchedule}
                        disabled={deletingSchedule}
                        className="gap-1.5 text-danger border-danger/30 hover:bg-danger/5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {deletingSchedule ? "Deleting…" : "Delete Schedule"}
                      </Button>
                    ) : (
                      !showCreateSchedule && (
                        <Button
                          size="sm"
                          onClick={() => setShowCreateSchedule(true)}
                          className="gap-1.5 bg-ocean hover:bg-ocean-dark text-white"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Create Schedule
                        </Button>
                      )
                    )}
                  </div>
                </div>
                <div className="p-5 space-y-4">
                  {showCreateSchedule && !schedule && (
                    <CreateSchedulePanel
                      dealId={id}
                      currency={deal.currency}
                      onCreated={(sched) => {
                        setSchedule(sched)
                        setShowCreateSchedule(false)
                        payments.admin.getSummary(id).then(setSummary).catch(() => {})
                      }}
                      onClose={() => setShowCreateSchedule(false)}
                    />
                  )}
                  {!schedule && !showCreateSchedule && (
                    <div className="text-center py-10">
                      <Calendar className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                      <p className="text-sm font-medium text-text-primary">No payment schedule yet</p>
                      <p className="text-xs text-text-secondary mt-1 mb-4">
                        Create a schedule to track installment payments for this deal.
                      </p>
                      <Button size="sm" onClick={() => setShowCreateSchedule(true)}
                        className="gap-1.5 bg-ocean hover:bg-ocean-dark text-white mx-auto">
                        <Plus className="w-3.5 h-3.5" /> Create Schedule
                      </Button>
                    </div>
                  )}
                  {schedule && schedule.items.length > 0 && (
                    <div className="space-y-3">
                      {schedule.items
                        .sort((a, b) => a.installment_number - b.installment_number)
                        .map((item) => (
                          <ScheduleItemRow
                            key={item.id}
                            item={item}
                            records={recordsByItem[item.id] ?? []}
                            onItemUpdate={handleItemUpdate}
                            onRecordUpdate={handleRecordUpdate}
                          />
                        ))}
                    </div>
                  )}
                  {recordsByItem["__unlinked"]?.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Unlinked Records</p>
                      {recordsByItem["__unlinked"].map((r) => (
                        <RecordRow key={r.id} record={r} onUpdate={handleRecordUpdate} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Documents tab */}
          {activeTab === "documents" && (
            <AdminDocumentsPanel
              dealId={id}
              docs={docs}
              onUpdate={setDocs}
            />
          )}

          {/* Invoices tab */}
          {activeTab === "invoices" && (
            <AdminInvoicesPanel
              dealId={id}
              invoices={invoices}
              scheduleItems={schedule?.items ?? []}
              currency={deal.currency}
              onUpdate={setInvoices}
            />
          )}

          {/* Actions tab */}
          {activeTab === "actions" && (
            <div className="space-y-4">

              {/* 1. Update Deal Terms (draft only) */}
              {deal.status === "draft" && (
                <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
                  <button
                    onClick={() => { setShowTermsForm((v) => !v); setTermsError(null) }}
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Edit3 className="w-4 h-4 text-ocean" />
                      <span className="font-semibold text-text-primary">Update Deal Terms</span>
                      <span className="text-xs text-text-secondary">· Draft only</span>
                    </div>
                    {showTermsForm ? <ChevronUp className="w-4 h-4 text-text-secondary" /> : <ChevronDown className="w-4 h-4 text-text-secondary" />}
                  </button>
                  {showTermsForm && (
                    <div className="border-t border-border px-5 py-4 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-medium text-text-secondary block mb-1">Total Price ({deal.currency})</label>
                          <input
                            type="number"
                            value={termsForm.total_price}
                            onChange={(e) => setTermsForm((f) => ({ ...f, total_price: e.target.value }))}
                            placeholder={deal.total_price}
                            className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-text-secondary block mb-1">Payment Deadline</label>
                          <input
                            type="date"
                            value={termsForm.payment_deadline}
                            onChange={(e) => setTermsForm((f) => ({ ...f, payment_deadline: e.target.value }))}
                            className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-text-secondary block mb-1">Payment Instructions</label>
                        <textarea
                          value={termsForm.payment_instructions}
                          onChange={(e) => setTermsForm((f) => ({ ...f, payment_instructions: e.target.value }))}
                          rows={2}
                          placeholder={deal.payment_instructions ?? "Wire transfer details, account info…"}
                          className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean resize-none"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-text-secondary block mb-1">Admin Notes</label>
                        <textarea
                          value={termsForm.admin_notes}
                          onChange={(e) => setTermsForm((f) => ({ ...f, admin_notes: e.target.value }))}
                          rows={2}
                          placeholder={deal.admin_notes ?? "Internal notes…"}
                          className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean resize-none"
                        />
                      </div>
                      {termsError && <p className="text-xs text-danger">{termsError}</p>}
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={termsSaving}
                          className="bg-ocean hover:bg-ocean-dark text-white gap-1.5"
                          onClick={async () => {
                            setTermsSaving(true)
                            setTermsError(null)
                            try {
                              const body: Parameters<typeof dealAdmin.update>[1] = {}
                              if (termsForm.total_price) body.total_price = parseFloat(termsForm.total_price)
                              if (termsForm.payment_deadline) body.payment_deadline = termsForm.payment_deadline
                              if (termsForm.payment_instructions) body.payment_instructions = termsForm.payment_instructions
                              if (termsForm.admin_notes) body.admin_notes = termsForm.admin_notes
                              const updated = await dealAdmin.update(id, body)
                              setDeal(updated)
                              setShowTermsForm(false)
                              setTermsForm({ total_price: "", admin_notes: "", payment_deadline: "", payment_instructions: "" })
                            } catch (e: unknown) {
                              setTermsError((e as Error)?.message ?? "Update failed.")
                            } finally {
                              setTermsSaving(false)
                            }
                          }}
                        >
                          {termsSaving ? "Saving…" : "Save Terms"}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setShowTermsForm(false)}>Cancel</Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 2. Send Offer (draft → offer_sent) */}
              {deal.status === "draft" && (
                <div className="bg-white rounded-xl border border-border shadow-sm p-5">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-ocean/10 shrink-0">
                      <Zap className="w-4 h-4 text-ocean" />
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-text-primary">Send Offer to Buyer</p>
                      <p className="text-xs text-text-secondary mt-0.5">
                        Sends the deal offer to the buyer and transitions status to <strong>Offer Sent</strong>.
                      </p>
                      {offerError && <p className="text-xs text-danger mt-2">{offerError}</p>}
                    </div>
                    <Button
                      size="sm"
                      disabled={sendingOffer}
                      className="bg-ocean hover:bg-ocean-dark text-white gap-1.5 shrink-0"
                      onClick={async () => {
                        if (!confirm("Send offer to buyer?")) return
                        setSendingOffer(true)
                        setOfferError(null)
                        try {
                          const updated = await dealAdmin.sendOffer(id)
                          setDeal(updated)
                        } catch (e: unknown) {
                          setOfferError((e as Error)?.message ?? "Failed to send offer.")
                        } finally {
                          setSendingOffer(false)
                        }
                      }}
                    >
                      <Send className="w-3.5 h-3.5" />
                      {sendingOffer ? "Sending…" : "Send Offer"}
                    </Button>
                  </div>
                </div>
              )}

              {/* 3. Mark as Accepted Offline (offer_sent status) */}
              {deal.status === "offer_sent" && (
                <div className="bg-white rounded-xl border border-ocean/20 shadow-sm p-5">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle2 className="w-4 h-4 text-ocean" />
                    <h3 className="font-semibold text-text-primary">Mark as Accepted (Offline)</h3>
                  </div>
                  <p className="text-xs text-text-secondary mb-3">
                    Use this when the buyer has confirmed acceptance outside the portal (phone call, email, WhatsApp, etc.).
                    This advances the deal to <strong>In Progress</strong> so payment can be recorded.
                  </p>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-text-secondary block">
                      Reason / Evidence <span className="text-danger">*</span>
                    </label>
                    <textarea
                      value={markAcceptNotes}
                      onChange={(e) => setMarkAcceptNotes(e.target.value)}
                      rows={2}
                      placeholder="e.g. Buyer confirmed acceptance via phone call on 12 Apr 2026"
                      className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean resize-none"
                    />
                    {markAcceptError && <p className="text-xs text-danger">{markAcceptError}</p>}
                    {markAcceptSuccess && (
                      <p className="text-xs text-success flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Deal marked as accepted. Payment can now be recorded.
                      </p>
                    )}
                    <Button
                      size="sm"
                      disabled={markingAccepted || markAcceptSuccess || markAcceptNotes.trim().length < 5}
                      className="bg-ocean hover:bg-ocean-dark text-white gap-1.5"
                      onClick={async () => {
                        setMarkingAccepted(true)
                        setMarkAcceptError(null)
                        try {
                          const updated = await dealAdmin.markAccepted(id, markAcceptNotes.trim())
                          setDeal(updated)
                          setMarkAcceptSuccess(true)
                        } catch (e: unknown) {
                          setMarkAcceptError((e as Error)?.message ?? "Failed to mark as accepted.")
                        } finally {
                          setMarkingAccepted(false)
                        }
                      }}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {markingAccepted ? "Updating…" : "Confirm Offline Acceptance"}
                    </Button>
                  </div>
                </div>
              )}

              {/* 4. Second Approval (pending_approval status) */}
              {deal.requires_second_approval && deal.status === "pending_approval" && !deal.second_approved_at && (
                <div className="bg-white rounded-xl border border-border shadow-sm p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <ShieldAlert className="w-4 h-4 text-warning" />
                    <h3 className="font-semibold text-text-primary">Second Approval Required</h3>
                  </div>
                  <p className="text-xs text-text-secondary mb-3">
                    This high-value deal requires a second approval before it can proceed.
                  </p>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-text-secondary block">Notes (optional)</label>
                    <textarea
                      value={secApproveNotes}
                      onChange={(e) => setSecApproveNotes(e.target.value)}
                      rows={2}
                      placeholder="Approval notes…"
                      className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-warning/20 focus:border-warning resize-none"
                    />
                    {secApproveError && <p className="text-xs text-danger">{secApproveError}</p>}
                    {secApproveSuccess && (
                      <p className="text-xs text-success flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Approved successfully.
                      </p>
                    )}
                    <Button
                      size="sm"
                      disabled={secApproving || secApproveSuccess}
                      className="bg-warning hover:bg-warning/90 text-white gap-1.5"
                      onClick={async () => {
                        setSecApproving(true)
                        setSecApproveError(null)
                        try {
                          const updated = await dealAdmin.secondApprove(id, secApproveNotes || undefined)
                          setDeal(updated)
                          setSecApproveSuccess(true)
                        } catch (e: unknown) {
                          setSecApproveError((e as Error)?.message ?? "Approval failed.")
                        } finally {
                          setSecApproving(false)
                        }
                      }}
                    >
                      <Shield className="w-3.5 h-3.5" />
                      {secApproving ? "Approving…" : "Grant Second Approval"}
                    </Button>
                  </div>
                </div>
              )}

              {/* 4. Record Payment */}
              {(deal.status === "accepted" || deal.status === "active") && (
                <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
                  <button
                    onClick={() => { setRecPayError(null); setRecPaySuccess(false) }}
                    className="w-full flex items-center gap-3 px-5 py-4 border-b border-border"
                  >
                    <CreditCard className="w-4 h-4 text-ocean" />
                    <span className="font-semibold text-text-primary">Record Payment</span>
                    <span className="text-xs text-text-secondary">· Admin records on behalf of buyer</span>
                  </button>
                  <div className="px-5 py-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-text-secondary block mb-1">Payment Type <span className="text-danger">*</span></label>
                        <select
                          value={recPayForm.payment_type}
                          onChange={(e) => setRecPayForm((f) => ({ ...f, payment_type: e.target.value as typeof f.payment_type }))}
                          className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean bg-white"
                        >
                          <option value="full_payment">Full Payment</option>
                          <option value="initial_payment">Initial Payment</option>
                          <option value="installment">Installment</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-text-secondary block mb-1">Amount ({deal.currency}) <span className="text-danger">*</span></label>
                        <input
                          type="number"
                          value={recPayForm.amount}
                          onChange={(e) => setRecPayForm((f) => ({ ...f, amount: e.target.value }))}
                          placeholder="0.00"
                          className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-text-secondary block mb-1">Payment Date <span className="text-danger">*</span></label>
                        <input
                          type="date"
                          value={recPayForm.payment_date}
                          onChange={(e) => setRecPayForm((f) => ({ ...f, payment_date: e.target.value }))}
                          className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-text-secondary block mb-1">Bank Name</label>
                        <input
                          value={recPayForm.bank_name}
                          onChange={(e) => setRecPayForm((f) => ({ ...f, bank_name: e.target.value }))}
                          placeholder="e.g. Standard Bank"
                          className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-text-secondary block mb-1">Bank Reference</label>
                        <input
                          value={recPayForm.bank_reference}
                          onChange={(e) => setRecPayForm((f) => ({ ...f, bank_reference: e.target.value }))}
                          placeholder="TRN-XXXX"
                          className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-text-secondary block mb-1">Notes</label>
                      <textarea
                        value={recPayForm.notes}
                        onChange={(e) => setRecPayForm((f) => ({ ...f, notes: e.target.value }))}
                        rows={2}
                        placeholder="Internal notes about this payment…"
                        className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean resize-none"
                      />
                    </div>
                    <div className="flex items-center gap-3">
                      <input ref={payFileRef} type="file" className="hidden" onChange={(e) => setPayFile(e.target.files?.[0] ?? null)} />
                      <button
                        onClick={() => payFileRef.current?.click()}
                        className="flex items-center gap-2 px-3 py-2 border border-dashed border-border rounded-lg text-sm text-text-secondary hover:border-ocean hover:text-ocean transition-colors"
                      >
                        <Upload className="w-4 h-4" />
                        {payFile ? payFile.name : "Attach proof (optional)"}
                      </button>
                      {payFile && (
                        <button onClick={() => setPayFile(null)} className="text-text-secondary hover:text-danger">
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    {recPayError && <p className="text-xs text-danger">{recPayError}</p>}
                    {recPaySuccess && (
                      <p className="text-xs text-success flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Payment recorded successfully.
                      </p>
                    )}
                    <Button
                      size="sm"
                      disabled={recPaying || !recPayForm.amount || !recPayForm.payment_date}
                      className="bg-ocean hover:bg-ocean-dark text-white gap-1.5"
                      onClick={async () => {
                        setRecPaying(true)
                        setRecPayError(null)
                        setRecPaySuccess(false)
                        try {
                          const fd = new FormData()
                          fd.append("payload", JSON.stringify({
                            payment_type: recPayForm.payment_type,
                            amount: parseFloat(recPayForm.amount),
                            currency: deal.currency,
                            payment_date: recPayForm.payment_date,
                            bank_name: recPayForm.bank_name || null,
                            bank_reference: recPayForm.bank_reference || null,
                            notes: recPayForm.notes || null,
                          }))
                          if (payFile) fd.append("proof", payFile)
                          await dealAdmin.recordPayment(id, fd)
                          setRecPaySuccess(true)
                          setRecPayForm({ amount: "", payment_date: "", bank_name: "", bank_reference: "", notes: "", payment_type: "full_payment" })
                          setPayFile(null)
                          payments.admin.getSummary(id).then(setSummary).catch(() => {})
                        } catch (e: unknown) {
                          setRecPayError((e as Error)?.message ?? "Failed to record payment.")
                        } finally {
                          setRecPaying(false)
                        }
                      }}
                    >
                      <DollarSign className="w-3.5 h-3.5" />
                      {recPaying ? "Recording…" : "Record Payment"}
                    </Button>
                  </div>
                </div>
              )}

              {/* 5. Send Reminder */}
              {(deal.status === "accepted" || deal.status === "active") && (
                <div className="bg-white rounded-xl border border-border shadow-sm p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Bell className="w-4 h-4 text-ocean" />
                    <h3 className="font-semibold text-text-primary">Send Reminder</h3>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-medium text-text-secondary block mb-1">Message Type</label>
                      <select
                        value={reminderType}
                        onChange={(e) => setReminderType(e.target.value as typeof reminderType)}
                        className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean bg-white"
                      >
                        <option value="payment_reminder">Payment Reminder</option>
                        <option value="overdue_warning">Overdue Warning</option>
                        <option value="installment_due">Installment Due</option>
                        <option value="installment_overdue">Installment Overdue</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-text-secondary block mb-1">Custom Message (optional)</label>
                      <textarea
                        value={reminderMsg}
                        onChange={(e) => setReminderMsg(e.target.value)}
                        rows={2}
                        placeholder="Additional context for the buyer…"
                        className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean resize-none"
                      />
                    </div>
                    {reminderError && <p className="text-xs text-danger">{reminderError}</p>}
                    {reminderSuccess && (
                      <p className="text-xs text-success flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Reminder sent successfully.
                      </p>
                    )}
                    <Button
                      size="sm"
                      disabled={sendingReminder}
                      className="bg-ocean hover:bg-ocean-dark text-white gap-1.5"
                      onClick={async () => {
                        setSendingReminder(true)
                        setReminderError(null)
                        setReminderSuccess(false)
                        try {
                          await dealAdmin.sendReminder(id, {
                            message_type: reminderType,
                            ...(reminderMsg ? { custom_message: reminderMsg } : {}),
                          })
                          setReminderSuccess(true)
                          setReminderMsg("")
                        } catch (e: unknown) {
                          setReminderError((e as Error)?.message ?? "Failed to send reminder.")
                        } finally {
                          setSendingReminder(false)
                        }
                      }}
                    >
                      <Bell className="w-3.5 h-3.5" />
                      {sendingReminder ? "Sending…" : "Send Reminder"}
                    </Button>
                  </div>
                </div>
              )}

              {/* 6. Mark Defaulted */}
              {(deal.status === "active" || deal.status === "disputed") && (
                <div className="bg-white rounded-xl border border-danger/20 shadow-sm p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="w-4 h-4 text-danger" />
                    <h3 className="font-semibold text-danger">Mark as Defaulted</h3>
                  </div>
                  <p className="text-xs text-text-secondary mb-3">
                    Mark this deal as defaulted due to non-payment or breach. This action cannot be easily reversed.
                  </p>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-text-secondary block">Default Reason <span className="text-danger">*</span></label>
                    <textarea
                      value={defaultReason}
                      onChange={(e) => setDefaultReason(e.target.value)}
                      rows={2}
                      placeholder="Describe the reason for marking this deal as defaulted…"
                      className="w-full px-3 py-2 text-sm border border-danger/30 rounded-lg focus:outline-none focus:ring-2 focus:ring-danger/20 focus:border-danger resize-none"
                    />
                    {defaultError && <p className="text-xs text-danger">{defaultError}</p>}
                    <Button
                      size="sm"
                      disabled={markingDefault || !defaultReason.trim()}
                      className="bg-danger hover:bg-danger/90 text-white gap-1.5"
                      onClick={async () => {
                        if (!confirm("Mark this deal as defaulted? This is a serious action.")) return
                        setMarkingDefault(true)
                        setDefaultError(null)
                        try {
                          const updated = await dealAdmin.markDefaulted(id, defaultReason)
                          setDeal(updated)
                          setDefaultReason("")
                        } catch (e: unknown) {
                          setDefaultError((e as Error)?.message ?? "Action failed.")
                        } finally {
                          setMarkingDefault(false)
                        }
                      }}
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {markingDefault ? "Processing…" : "Mark Defaulted"}
                    </Button>
                  </div>
                </div>
              )}

              {/* 7. Cancel Deal */}
              {(deal.status === "draft" || deal.status === "offer_sent" || deal.status === "active") && (
                <div className="bg-white rounded-xl border border-border shadow-sm p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <XCircle className="w-4 h-4 text-danger" />
                    <h3 className="font-semibold text-text-primary">Cancel Deal</h3>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-text-secondary block">Cancellation Reason <span className="text-danger">*</span></label>
                    <textarea
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      rows={2}
                      placeholder="Reason for cancellation…"
                      className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-danger/20 focus:border-danger resize-none"
                    />
                    {cancelError && <p className="text-xs text-danger">{cancelError}</p>}
                    <Button
                      size="sm"
                      disabled={cancelling || !cancelReason.trim()}
                      className="bg-danger hover:bg-danger/90 text-white gap-1.5"
                      onClick={async () => {
                        if (!confirm("Cancel this deal?")) return
                        setCancelling(true)
                        setCancelError(null)
                        try {
                          const updated = await dealAdmin.cancel(id, cancelReason)
                          setDeal(updated)
                          setCancelReason("")
                        } catch (e: unknown) {
                          setCancelError((e as Error)?.message ?? "Cancellation failed.")
                        } finally {
                          setCancelling(false)
                        }
                      }}
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      {cancelling ? "Cancelling…" : "Cancel Deal"}
                    </Button>
                  </div>
                </div>
              )}

              {/* Completed / terminal state placeholder */}
              {(deal.status === "completed" || deal.status === "cancelled" || deal.status === "defaulted") && (
                <div className="bg-white rounded-xl border border-border shadow-sm p-8 text-center">
                  <CheckCircle2 className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                  <p className="text-sm font-medium text-text-primary capitalize">{deal.status}</p>
                  <p className="text-xs text-text-secondary mt-1">No further actions available for this deal.</p>
                  {deal.cancellation_reason && (
                    <div className="mt-4 bg-gray-50 rounded-lg p-3 text-left">
                      <p className="text-xs text-text-secondary">Reason:</p>
                      <p className="text-xs text-text-primary">{deal.cancellation_reason}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          {/* Parties */}
          <div className="bg-white rounded-xl border border-border shadow-sm p-4">
            <div className="flex items-center gap-2 mb-4">
              <User className="w-4 h-4 text-ocean" />
              <h3 className="font-semibold text-text-primary text-sm">Deal Parties</h3>
            </div>

            <div className="space-y-3">
              <div className="bg-ocean/5 rounded-xl p-3">
                <p className="text-xs text-text-secondary mb-0.5">Buyer</p>
                <p className="font-semibold text-sm text-text-primary">{deal.buyer_name ?? "—"}</p>
                {deal.buyer_email && (
                  <p className="text-xs text-text-secondary mt-0.5">{deal.buyer_email}</p>
                )}
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-text-secondary mb-0.5">Seller</p>
                <p className="font-semibold text-sm text-text-primary">{deal.seller_name ?? "—"}</p>
              </div>
            </div>
          </div>

          {/* Financial */}
          <div className="bg-white rounded-xl border border-border shadow-sm p-4">
            <div className="flex items-center gap-2 mb-3">
              <Banknote className="w-4 h-4 text-ocean" />
              <h3 className="font-semibold text-text-primary text-sm">Financials</h3>
            </div>
            {[
              ["Currency", deal.currency],
              ["Total Price", fmtCurrency(deal.total_price, deal.currency)],
              ["Arrangement Fee", fmtCurrency(deal.arrangement_fee, deal.currency)],
              ["Total Payable", fmtCurrency(deal.total_amount_payable, deal.currency)],
            ].map(([label, value]) => (
              <InfoRow key={label} label={label} value={value} />
            ))}
            {deal.deal_type === "financing" && (
              <>
                <InfoRow label="Financed Amount" value={fmtCurrency(deal.financed_amount, deal.currency)} />
                <InfoRow label="Monthly Rate" value={deal.monthly_finance_rate ? `${deal.monthly_finance_rate}%` : "—"} />
                <InfoRow label="Duration" value={deal.duration_months ? `${deal.duration_months} months` : "—"} />
              </>
            )}
          </div>

          {/* Quick status actions */}
          {(deal.status === "draft" || deal.status === "offer_sent" || deal.status === "active") && (
            <div className="bg-white rounded-xl border border-border shadow-sm p-4">
              <h3 className="font-semibold text-text-primary text-sm mb-3">Quick Actions</h3>
              <div className="space-y-2">
                {deal.status === "draft" && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={sendingOffer}
                    className="w-full gap-1.5 justify-start text-ocean border-ocean/30 hover:bg-ocean/5"
                    onClick={async () => {
                      if (!confirm("Send offer to buyer?")) return
                      setSendingOffer(true)
                      setOfferError(null)
                      try {
                        const updated = await dealAdmin.sendOffer(id)
                        setDeal(updated)
                      } catch (e: unknown) {
                        setOfferError((e as Error)?.message ?? "Failed.")
                      } finally {
                        setSendingOffer(false)
                      }
                    }}
                  >
                    <Send className="w-3.5 h-3.5" />
                    {sendingOffer ? "Sending…" : "Send Offer"}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-1.5 justify-start text-text-secondary"
                  onClick={() => setActiveTab("actions")}
                >
                  <Settings2 className="w-3.5 h-3.5" />
                  More Actions
                </Button>
              </div>
              {offerError && <p className="text-xs text-danger mt-2">{offerError}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
