"use client"

import { useState, useEffect } from "react"
import {
  ClipboardList, CheckCircle2, XCircle, RefreshCw,
  ChevronDown, ChevronUp, AlertCircle, Loader2,
  Package, FileText, FileQuestion, Send, Shield, ExternalLink,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  prAgent, AgentAssignedPRItem, AgentAssignedPRDetail, PRDocRequest,
} from "@/lib/api"
import { useAgentPurchaseRequests } from "@/lib/hooks"

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

function fmtCurrency(amount: number | null, currency = "USD") {
  if (!amount) return "—"
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 0 }).format(amount)
}

function ErrorBar({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger text-sm">
      <AlertCircle className="w-4 h-4 shrink-0" />{msg}
    </div>
  )
}

// ── Status config ──────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; className: string }> = {
  pending:           { label: "Pending",        className: "bg-warning/10 text-warning border-warning/20" },
  assigned:          { label: "Assigned",       className: "bg-ocean/10 text-ocean border-ocean/20" },
  under_review:      { label: "Under Review",   className: "bg-ocean/10 text-ocean border-ocean/20" },
  report_submitted:  { label: "Report Done",    className: "bg-success/10 text-success border-success/20" },
  accepted:          { label: "Accepted",       className: "bg-success/10 text-success border-success/20" },
  rejected:          { label: "Rejected",       className: "bg-danger/10 text-danger border-danger/20" },
  deal_created:      { label: "Deal Created",   className: "bg-navy/10 text-navy border-navy/20" },
  cancelled:         { label: "Cancelled",      className: "bg-gray-100 text-gray-500 border-gray-200" },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? { label: status, className: "bg-gray-100 text-gray-600 border-gray-200" }
  return <Badge className={cn("text-xs border capitalize", cfg.className)}>{cfg.label}</Badge>
}

// ── Document Requests Panel ───────────────────────────────────────────────────

interface DraftItem {
  id: string           // local key only
  name: string         // free-text document name
  reason: string
  priority: "required" | "recommended"
}

function DocRequestsPanel({ requestId }: { requestId: string }) {
  const [sent, setSent]       = useState<PRDocRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const [drafts, setDrafts] = useState<DraftItem[]>([
    { id: crypto.randomUUID(), name: "", reason: "", priority: "required" },
  ])

  useEffect(() => {
    async function init() {
      try {
        const reqs = await prAgent.listDocumentRequests(requestId)
        setSent(reqs)
      } catch (e: unknown) {
        setError((e as Error)?.message ?? "Failed to load")
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [requestId])

  function addRow() {
    setDrafts((prev) => [...prev, { id: crypto.randomUUID(), name: "", reason: "", priority: "required" }])
  }

  function removeRow(id: string) {
    setDrafts((prev) => prev.filter((d) => d.id !== id))
  }

  function updateRow(id: string, field: keyof DraftItem, value: string) {
    setDrafts((prev) => prev.map((d) => d.id === id ? { ...d, [field]: value } : d))
  }

  async function handleSendAll() {
    const valid = drafts.filter((d) => d.name.trim())
    if (valid.length === 0) {
      setError("Add at least one document name before sending.")
      return
    }
    setSending(true)
    setError(null)
    try {
      const result = await prAgent.requestDocuments(
        requestId,
        valid.map((d) => ({
          document_name: d.name.trim(),
          reason:        d.reason.trim() || undefined,
          priority:      d.priority,
        }))
      )
      setSent((prev) => [...prev, ...result])
      setDrafts([{ id: crypto.randomUUID(), name: "", reason: "", priority: "required" }])
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "Failed to send requests")
    } finally {
      setSending(false)
    }
  }

  async function handleViewDoc(req: PRDocRequest) {
    try {
      const token = localStorage.getItem("mx_access_token")
      const res = await fetch(prAgent.docDownloadUrl(req.id), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const win = window.open(url, "_blank")
      // Revoke after 60 s to free memory
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      if (!win) {
        // Popup blocked — fall back to download
        const a = document.createElement("a")
        a.href = url
        a.download = req.file_name ?? "document"
        a.click()
      }
    } catch (e: unknown) {
      alert("Could not load document: " + ((e as Error)?.message ?? "unknown error"))
    }
  }

  async function handleWaive(reqId: string) {
    const waiveReason = prompt("Reason for waiving this request:")
    if (!waiveReason) return
    try {
      const updated = await prAgent.waiveDocumentRequest(reqId, waiveReason)
      setSent((prev) => prev.map((r) => r.id === reqId ? updated : r))
    } catch { /* silent */ }
  }

  async function handleReviewDoc(reqId: string, action: "approve" | "reject") {
    let notes: string | undefined
    if (action === "reject") {
      const input = prompt("Reason for rejection (optional):")
      if (input === null) return // cancelled
      notes = input.trim() || undefined
    }
    try {
      const updated = await prAgent.reviewDocumentRequest(reqId, action, notes)
      setSent((prev) => prev.map((r) => r.id === reqId ? updated : r))
    } catch (e: unknown) {
      alert("Review failed: " + ((e as Error)?.message ?? "unknown error"))
    }
  }

  const STATUS_COLORS: Record<string, string> = {
    pending:  "bg-warning/10 text-warning border-warning/20",
    uploaded: "bg-blue-50 text-blue-700 border-blue-200",
    approved: "bg-success/10 text-success border-success/20",
    rejected: "bg-danger/10 text-danger border-danger/20",
    waived:   "bg-gray-100 text-gray-500 border-gray-200",
  }

  if (loading) return (
    <div className="flex items-center gap-2 py-6 px-5 text-sm text-text-secondary">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading…
    </div>
  )

  return (
    <div className="p-5 space-y-5">

      {/* Already-sent requests */}
      {sent.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">
            Sent Requests ({sent.length})
          </p>
          <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
            {sent.map((req) => (
              <div key={req.id} className="flex items-center gap-3 px-4 py-3 bg-white">
                <FileQuestion className="w-4 h-4 text-text-secondary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{req.document_name}</p>
                  {req.reason && <p className="text-xs text-text-secondary">{req.reason}</p>}
                </div>
                <Badge className={cn("text-xs border capitalize", STATUS_COLORS[req.status] ?? "")}>{req.status}</Badge>
                <Badge variant="secondary" className="text-xs capitalize">{req.priority}</Badge>
                {req.status === "uploaded" && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleViewDoc(req) }}
                      className="flex items-center gap-1 text-xs text-ocean hover:underline transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" /> View
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleReviewDoc(req.id, "approve") }}
                      className="text-xs font-medium text-success hover:text-success/80 border border-success/30 rounded px-2 py-0.5 transition-colors"
                    >
                      Approve
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleReviewDoc(req.id, "reject") }}
                      className="text-xs font-medium text-danger hover:text-danger/80 border border-danger/30 rounded px-2 py-0.5 transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                )}
                {(req.status === "approved" || req.status === "rejected") && req.review_notes && (
                  <span className="text-xs text-text-secondary italic truncate max-w-30" title={req.review_notes}>
                    {req.review_notes}
                  </span>
                )}
                {req.status === "pending" && (
                  <button onClick={() => handleWaive(req.id)} className="text-xs text-text-secondary hover:text-danger transition-colors">
                    Waive
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Draft builder */}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-ocean/5 border-b border-border flex items-center justify-between">
          <p className="text-sm font-semibold text-text-primary">Request Documents from Buyer</p>
          <button
            onClick={addRow}
            className="flex items-center gap-1.5 text-xs text-ocean hover:text-ocean-dark font-medium transition-colors"
          >
            <Send className="w-3.5 h-3.5 rotate-90" /> Add another
          </button>
        </div>

        <div className="divide-y divide-border">
          {drafts.map((draft, i) => (
            <div key={draft.id} className="p-4 space-y-2 bg-white">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-ocean/10 text-ocean text-xs font-semibold flex items-center justify-center shrink-0">
                  {i + 1}
                </span>
                <Input
                  placeholder="Document name (e.g. Passport, Business Registration, Proof of Address…)"
                  value={draft.name}
                  onChange={(e) => updateRow(draft.id, "name", e.target.value)}
                  className="text-sm flex-1"
                />
                {drafts.length > 1 && (
                  <button
                    onClick={() => removeRow(draft.id)}
                    className="p-1 text-text-secondary hover:text-danger transition-colors"
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                )}
              </div>
              <Input
                placeholder="Reason — why is this document needed? (optional)"
                value={draft.reason}
                onChange={(e) => updateRow(draft.id, "reason", e.target.value)}
                className="text-sm text-text-secondary"
              />
              <div className="flex gap-2">
                {(["required", "recommended"] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => updateRow(draft.id, "priority", p)}
                    className={cn(
                      "px-3 py-1 rounded-lg border text-xs font-medium capitalize transition-colors",
                      draft.priority === p
                        ? p === "required" ? "bg-danger/10 text-danger border-danger/30" : "bg-warning/10 text-warning border-warning/30"
                        : "bg-white text-text-secondary border-border"
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="px-4 py-3 bg-gray-50 border-t border-border">
          {error && <div className="mb-3"><ErrorBar msg={error} /></div>}
          <Button
            onClick={handleSendAll}
            disabled={sending || drafts.every((d) => !d.name.trim())}
            className="bg-ocean hover:bg-ocean-dark text-white gap-1.5 w-full sm:w-auto"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {sending ? "Sending…" : `Send ${drafts.filter(d => d.name.trim()).length || ""} Request${drafts.filter(d => d.name.trim()).length !== 1 ? "s" : ""} to Buyer`}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Expanded PR detail + report form ──────────────────────────────────────────

function PRPanel({ item, onReported }: {
  item: AgentAssignedPRItem
  onReported: () => void
}) {
  const [detail, setDetail]   = useState<AgentAssignedPRDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"documents" | "report">("documents")

  // Report form
  const [financialCapacity, setFinancialCapacity] = useState("")
  const [riskRating, setRiskRating]               = useState<"low" | "medium" | "high">("low")
  const [recommendation, setRecommendation]       = useState<"approve" | "reject" | "requires_resubmission">("approve")
  const [verificationNotes, setVerificationNotes] = useState("")
  const [submitting, setSubmitting]               = useState(false)
  const [reportError, setReportError]             = useState<string | null>(null)
  const [submitted, setSubmitted]                 = useState(false)

  useEffect(() => {
    prAgent.get(item.id)
      .then(setDetail)
      .catch((e) => setError(e.message ?? "Failed to load request"))
      .finally(() => setLoading(false))
  }, [item.id])

  async function handleSubmitReport() {
    if (!financialCapacity || isNaN(parseFloat(financialCapacity))) {
      setReportError("Financial capacity must be a valid number."); return
    }
    if (verificationNotes.trim().length < 10) {
      setReportError("Verification notes must be at least 10 characters."); return
    }
    setSubmitting(true)
    setReportError(null)
    try {
      await prAgent.submitReport(item.id, {
        financial_capacity_usd: parseFloat(financialCapacity),
        risk_rating: riskRating,
        recommendation,
        verification_notes: verificationNotes.trim(),
      })
      setSubmitted(true)
      onReported()
    } catch (e: unknown) {
      setReportError((e as Error)?.message ?? "Failed to submit report")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-10 gap-2 text-text-secondary text-sm border-t border-border">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading…
    </div>
  )
  if (error) return <div className="p-5 border-t border-border"><ErrorBar msg={error} /></div>
  if (!detail) return null

  const hasReport   = !!detail.my_report
  const canSubmit   = !hasReport && !["rejected", "deal_created", "cancelled"].includes(detail.status)

  return (
    <div className="border-t border-border">
      {/* Tabs */}
      <div className="flex gap-1 px-5 pt-3 border-b border-border">
        {([
          { key: "documents", label: "Document Requests", icon: FileQuestion },
          { key: "report",    label: "Due-Diligence Report", icon: Shield },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px",
              activeTab === key
                ? "border-ocean text-ocean"
                : "border-transparent text-text-secondary hover:text-text-primary"
            )}
          >
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {/* Document requests tab */}
      {activeTab === "documents" && (
        <DocRequestsPanel requestId={item.id} />
      )}

      {/* Report tab */}
      {activeTab === "report" && <>
      {/* Product + Buyer info */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 px-5 py-4 bg-gray-50/50 text-sm border-b border-border">
        {detail.product_description && (
          <div className="col-span-2 sm:col-span-3">
            <p className="text-xs text-text-secondary mb-0.5">Product Description</p>
            <p className="text-sm text-text-primary leading-relaxed">{detail.product_description}</p>
          </div>
        )}
        {detail.product_condition && (
          <div>
            <p className="text-xs text-text-secondary mb-0.5">Condition</p>
            <p className="font-medium text-text-primary capitalize">{detail.product_condition.replace(/_/g, " ")}</p>
          </div>
        )}
        {detail.product_asking_price && (
          <div>
            <p className="text-xs text-text-secondary mb-0.5">Asking Price</p>
            <p className="font-medium text-text-primary">{fmtCurrency(Number(detail.product_asking_price), detail.product_currency ?? "USD")}</p>
          </div>
        )}
        {(detail.product_location_country || detail.product_location_port) && (
          <div>
            <p className="text-xs text-text-secondary mb-0.5">Location</p>
            <p className="font-medium text-text-primary">
              {[detail.product_location_port, detail.product_location_country].filter(Boolean).join(", ")}
            </p>
          </div>
        )}
      </div>

      {/* Buyer details */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 px-5 py-4 bg-ocean/3 text-sm border-b border-border">
        <p className="col-span-2 sm:col-span-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">Buyer Information</p>
        <div>
          <p className="text-xs text-text-secondary mb-0.5">Name</p>
          <p className="font-medium text-text-primary">{detail.buyer_name ?? "—"}</p>
        </div>
        {detail.buyer_company && (
          <div>
            <p className="text-xs text-text-secondary mb-0.5">Company</p>
            <p className="font-medium text-text-primary">{detail.buyer_company}</p>
          </div>
        )}
        {detail.buyer_email && (
          <div>
            <p className="text-xs text-text-secondary mb-0.5">Email</p>
            <p className="font-medium text-text-primary">{detail.buyer_email}</p>
          </div>
        )}
        {detail.buyer_phone && (
          <div>
            <p className="text-xs text-text-secondary mb-0.5">Phone</p>
            <p className="font-medium text-text-primary">{detail.buyer_phone}</p>
          </div>
        )}
        <div>
          <p className="text-xs text-text-secondary mb-0.5">KYC Status</p>
          <p className={cn("font-medium capitalize", {
            "text-success": detail.buyer_kyc_status === "approved",
            "text-warning": ["pending","under_review"].includes(detail.buyer_kyc_status ?? ""),
            "text-danger": detail.buyer_kyc_status === "rejected",
          })}>
            {(detail.buyer_kyc_status ?? "unknown").replace(/_/g, " ")}
          </p>
        </div>
        <div>
          <p className="text-xs text-text-secondary mb-0.5">Assignment Status</p>
          <p className="font-medium text-text-primary capitalize">{(detail.assignment_status ?? "pending").replace(/_/g, " ")}</p>
        </div>
      </div>

      {/* Request details */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 px-5 py-4 bg-gray-50/50 text-sm">
        <div>
          <p className="text-xs text-text-secondary mb-0.5">Purchase Type</p>
          <p className="font-medium text-text-primary capitalize">{detail.purchase_type.replace(/_/g, " ")}</p>
        </div>
        <div>
          <p className="text-xs text-text-secondary mb-0.5">Offered Price</p>
          <p className="font-medium text-text-primary">
            {fmtCurrency(detail.offered_price, detail.offered_currency)}
          </p>
        </div>
        <div>
          <p className="text-xs text-text-secondary mb-0.5">Quantity</p>
          <p className="font-medium text-text-primary">{detail.quantity}</p>
        </div>
      </div>

      {/* Message */}
      {detail.message && (
      <div className="px-5 pb-4">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">Buyer Message</p>
        <p className="text-sm text-text-primary whitespace-pre-line">{detail.message}</p>
      </div>
      )}

      {/* Existing report */}
      {hasReport && detail.my_report && (
        <div className="px-5 py-3 border-t border-border">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">Your Due-Diligence Report</p>
          <div className="p-4 bg-success/5 rounded-lg border border-success/20 space-y-2 text-sm">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-medium text-text-primary">
                Financial Capacity: {fmtCurrency(Number(detail.my_report.financial_capacity_usd))}
              </span>
              <Badge className={cn("text-xs border capitalize", {
                "bg-success/10 text-success border-success/20": detail.my_report.risk_rating === "low",
                "bg-warning/10 text-warning border-warning/20": detail.my_report.risk_rating === "medium",
                "bg-danger/10 text-danger border-danger/20":   detail.my_report.risk_rating === "high",
              })}>
                {detail.my_report.risk_rating} risk
              </Badge>
              <Badge className={cn("text-xs border",
                detail.my_report.recommendation === "approve"
                  ? "bg-success/10 text-success border-success/20"
                  : detail.my_report.recommendation === "requires_resubmission"
                  ? "bg-warning/10 text-warning border-warning/20"
                  : "bg-danger/10 text-danger border-danger/20"
              )}>
                {{
                  approve: "Recommend Approve",
                  reject: "Recommend Reject",
                  requires_resubmission: "Requires Resubmission",
                }[detail.my_report.recommendation] ?? detail.my_report.recommendation}
              </Badge>
            </div>
            <p className="text-text-secondary">{detail.my_report.verification_notes}</p>
            <p className="text-xs text-text-secondary">Submitted {fmtDate(detail.my_report.created_at)}</p>
          </div>
        </div>
      )}

      {/* Report form */}
      {submitted ? (
        <div className="px-5 py-4 bg-success/5 border-t border-border">
          <div className="flex items-center gap-2 text-success text-sm font-medium">
            <CheckCircle2 className="w-4 h-4" /> Report submitted. Admin will review and take action.
          </div>
        </div>
      ) : canSubmit ? (
        <div className="px-5 py-4 bg-gray-50/50 border-t border-border space-y-4">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Submit Due-Diligence Report</p>

          {/* Financial capacity */}
          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1">
              Estimated Financial Capacity (USD) <span className="text-danger">*</span>
            </label>
            <Input
              type="number"
              step="1000"
              placeholder="e.g. 500000"
              value={financialCapacity}
              onChange={(e) => setFinancialCapacity(e.target.value)}
            />
          </div>

          {/* Risk rating */}
          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1.5">Risk Rating</label>
            <div className="flex gap-2">
              {(["low", "medium", "high"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRiskRating(r)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg border text-xs font-medium capitalize transition-colors",
                    riskRating === r
                      ? r === "low" ? "bg-success text-white border-success"
                        : r === "medium" ? "bg-warning text-white border-warning"
                        : "bg-danger text-white border-danger"
                      : "bg-white text-text-secondary border-border hover:border-gray-300"
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Recommendation */}
          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1.5">Recommendation</label>
            <div className="flex gap-2">
              {([
                { value: "approve",              label: "Recommend Approve",    active: "bg-success text-white border-success" },
                { value: "reject",               label: "Recommend Reject",     active: "bg-danger text-white border-danger" },
                { value: "requires_resubmission",label: "Requires Resubmission",active: "bg-warning text-white border-warning" },
              ] as const).map(({ value, label, active }) => (
                <button
                  key={value}
                  onClick={() => setRecommendation(value)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors",
                    recommendation === value ? active : "bg-white text-text-secondary border-border hover:border-gray-300"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Verification notes */}
          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1">
              Verification Notes <span className="text-danger">*</span>
              <span className="font-normal ml-1">(min 10 characters)</span>
            </label>
            <Textarea
              rows={4}
              placeholder="Summarise your due-diligence findings — financial standing, business history, risk observations…"
              value={verificationNotes}
              onChange={(e) => setVerificationNotes(e.target.value)}
              className="text-sm resize-none"
            />
          </div>

          {reportError && <ErrorBar msg={reportError} />}

          <div className="flex justify-end">
            <Button
              onClick={handleSubmitReport}
              disabled={submitting}
              className="bg-ocean hover:bg-ocean-dark text-white gap-1.5"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              {submitting ? "Submitting…" : "Submit Report"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="px-5 py-4 border-t border-border text-sm text-text-secondary">
          {hasReport ? "Report already submitted for this request." : `No further action required (status: ${detail.status.replace(/_/g, " ")}).`}
        </div>
      )}
      </>}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AgentPurchaseRequestsPage() {
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data, isLoading: loading, error: swrError, mutate } = useAgentPurchaseRequests()
  const items = data?.items ?? []
  const error = swrError?.message ?? null

  const pending       = items.filter((i) => ["pending", "assigned"].includes(i.assignment_status ?? "")).length
  const reportDone    = items.filter((i) => i.report_submitted).length

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-border shadow-sm p-4">
          <p className="text-xs text-text-secondary mb-1">Total Assigned</p>
          <p className="text-2xl font-bold text-text-primary">{items.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-border shadow-sm p-4">
          <p className="text-xs text-text-secondary mb-1">Awaiting Report</p>
          <p className="text-2xl font-bold text-warning">{pending}</p>
        </div>
        <div className="bg-white rounded-xl border border-border shadow-sm p-4">
          <p className="text-xs text-text-secondary mb-1">Report Submitted</p>
          <p className="text-2xl font-bold text-success">{reportDone}</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-secondary">My Assigned Purchase Requests</h2>
        <Button variant="outline" size="sm" onClick={() => mutate()} disabled={loading} className="gap-1.5">
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /> Refresh
        </Button>
      </div>

      {error && <ErrorBar msg={error} />}

      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center py-16 gap-2 text-text-secondary text-sm">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-border p-12 text-center">
          <ClipboardList className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-text-secondary font-medium">No requests assigned yet</p>
          <p className="text-text-secondary text-sm mt-1">Purchase requests assigned to you will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const isOpen = expanded === item.id
            return (
              <div key={item.id} className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
                <div
                  className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => setExpanded(isOpen ? null : item.id)}
                >
                  {/* Product image */}
                  <div className="w-14 h-14 rounded-xl bg-gray-100 shrink-0 overflow-hidden flex items-center justify-center">
                    {item.product_image_url
                      ? <img src={item.product_image_url} alt={item.product_title ?? ""} className="w-full h-full object-cover" />
                      : <Package className="w-6 h-6 text-gray-300" />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-text-primary">
                        {item.product_title ?? "No specific product"}
                      </p>
                      <Badge variant="secondary" className="text-xs capitalize">
                        {item.purchase_type.replace(/_/g, " ")}
                      </Badge>
                      {/* KYC status inline */}
                      {item.buyer_kyc_status && (
                        <Badge className={cn("text-xs border capitalize", {
                          "bg-success/10 text-success border-success/20": item.buyer_kyc_status === "approved",
                          "bg-warning/10 text-warning border-warning/20": item.buyer_kyc_status === "pending" || item.buyer_kyc_status === "under_review",
                          "bg-danger/10 text-danger border-danger/20": item.buyer_kyc_status === "rejected",
                        })}>
                          KYC: {item.buyer_kyc_status.replace(/_/g, " ")}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-text-secondary truncate mt-0.5">
                      {item.buyer_name ?? "Unknown buyer"}
                      {item.buyer_company ? ` · ${item.buyer_company}` : ""}
                      {" "}· {fmtCurrency(item.offered_price, item.offered_currency)}
                      {" "}· Qty: {item.quantity}
                      {" "}· {fmtDate(item.created_at)}
                    </p>
                    {(item.product_location_country || item.product_location_port) && (
                      <p className="text-xs text-text-secondary truncate">
                        {[item.product_location_port, item.product_location_country].filter(Boolean).join(", ")}
                        {item.product_condition ? ` · ${item.product_condition}` : ""}
                        {item.product_asking_price ? ` · Ask: ${fmtCurrency(Number(item.product_asking_price), item.product_currency ?? "USD")}` : ""}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <StatusBadge status={item.status} />
                    {item.report_submitted && (
                      <Badge className="text-xs bg-success/10 text-success border border-success/20">Report Done</Badge>
                    )}
                    {isOpen ? <ChevronUp className="w-4 h-4 text-text-secondary" /> : <ChevronDown className="w-4 h-4 text-text-secondary" />}
                  </div>
                </div>

                {isOpen && (
                  <PRPanel item={item} onReported={() => mutate()} />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
