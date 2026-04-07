"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  ClipboardList, Clock, CheckCircle2, XCircle, RefreshCw,
  ChevronDown, ChevronUp, AlertCircle, Loader2, DollarSign,
  Package, User, FileText, FileQuestion, Send, Shield,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  prAgent, kycAgent, AgentAssignedPRItem, AgentAssignedPRDetail,
  DocumentRequestResponse, DocumentTypeResponse,
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

function initials(name: string | null) {
  if (!name) return "?"
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
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

function DocRequestsPanel({ buyerId }: { buyerId: string }) {
  const [submissionId, setSubmissionId] = useState<string | null>(null)
  const [sent, setSent]                 = useState<DocumentRequestResponse[]>([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [sending, setSending]           = useState(false)

  // Draft list — each row is one document the agent wants to request
  const [drafts, setDrafts] = useState<DraftItem[]>([
    { id: crypto.randomUUID(), name: "", reason: "", priority: "required" },
  ])

  useEffect(() => {
    async function init() {
      try {
        const sub  = await kycAgent.ensureBuyerSubmission(buyerId)
        setSubmissionId(sub.submission_id)
        const reqs = await kycAgent.listDocumentRequests(sub.submission_id)
        setSent(reqs)
      } catch (e: unknown) {
        setError((e as Error)?.message ?? "Failed to load")
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [buyerId])

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
    if (!submissionId || valid.length === 0) {
      setError("Add at least one document name before sending.")
      return
    }
    setSending(true)
    setError(null)
    try {
      const result = await kycAgent.requestDocuments(submissionId,
        valid.map((d) => ({
          custom_document_name: d.name.trim(),
          reason: d.reason.trim() || undefined,
          priority: d.priority,
        }))
      )
      setSent((prev) => [...prev, ...result])
      // Reset to one blank row
      setDrafts([{ id: crypto.randomUUID(), name: "", reason: "", priority: "required" }])
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "Failed to send requests")
    } finally {
      setSending(false)
    }
  }

  async function handleWaive(reqId: string) {
    const waiveReason = prompt("Reason for waiving this request:")
    if (!waiveReason) return
    try {
      const updated = await kycAgent.waiveDocumentRequest(reqId, waiveReason)
      setSent((prev) => prev.map((r) => r.id === reqId ? updated : r))
    } catch { /* silent */ }
  }

  const STATUS_COLORS: Record<string, string> = {
    pending:  "bg-warning/10 text-warning border-warning/20",
    uploaded: "bg-success/10 text-success border-success/20",
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
                  <p className="text-sm font-medium">{req.document_type_name}</p>
                  {req.reason && <p className="text-xs text-text-secondary">{req.reason}</p>}
                </div>
                <Badge className={cn("text-xs border capitalize", STATUS_COLORS[req.status] ?? "")}>{req.status}</Badge>
                <Badge variant="secondary" className="text-xs capitalize">{req.priority}</Badge>
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
            disabled={sending || !submissionId || drafts.every((d) => !d.name.trim())}
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
  const [recommendation, setRecommendation]       = useState<"recommend_approve" | "recommend_reject">("recommend_approve")
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
        <DocRequestsPanel buyerId={item.buyer_id} />
      )}

      {/* Report tab */}
      {activeTab === "report" && <>
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
        <div>
          <p className="text-xs text-text-secondary mb-0.5">Assignment Status</p>
          <p className="font-medium text-text-primary capitalize">{(detail.assignment_status ?? "pending").replace(/_/g, " ")}</p>
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
              <Badge className={cn("text-xs border", detail.my_report.recommendation === "recommend_approve"
                ? "bg-success/10 text-success border-success/20"
                : "bg-danger/10 text-danger border-danger/20"
              )}>
                {detail.my_report.recommendation === "recommend_approve" ? "Recommend Approve" : "Recommend Reject"}
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
              {(["recommend_approve", "recommend_reject"] as const).map((rec) => (
                <button
                  key={rec}
                  onClick={() => setRecommendation(rec)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors",
                    recommendation === rec
                      ? rec === "recommend_approve"
                        ? "bg-success text-white border-success"
                        : "bg-danger text-white border-danger"
                      : "bg-white text-text-secondary border-border hover:border-gray-300"
                  )}
                >
                  {rec === "recommend_approve" ? "Recommend Approve" : "Recommend Reject"}
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
                  <div className="w-10 h-10 rounded-xl bg-ocean/10 flex items-center justify-center shrink-0">
                    <Package className="w-5 h-5 text-ocean" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-text-primary">
                        {item.product_title ?? "No specific product"}
                      </p>
                      <Badge variant="secondary" className="text-xs capitalize">
                        {item.purchase_type.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <p className="text-xs text-text-secondary truncate">
                      {item.buyer_name ?? "Unknown buyer"}
                      {" "}· Price: {fmtCurrency(item.offered_price, item.offered_currency)}
                      {" "}· Qty: {item.quantity}
                      {" "}· {fmtDate(item.created_at)}
                    </p>
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
