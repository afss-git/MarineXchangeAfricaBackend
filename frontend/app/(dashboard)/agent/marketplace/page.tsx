"use client"

import { useState, useEffect } from "react"
import {
  Search, Clock, CheckCircle2, XCircle, RefreshCw, Eye,
  ChevronDown, ChevronUp, AlertCircle, Loader2, Package,
  FileText, ExternalLink, ImageIcon,
} from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  verificationAgent,
  VerificationAssignmentItem, VerificationAssignmentDetail,
} from "@/lib/api"
import { useAgentAssignments } from "@/lib/hooks"

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

function ErrorBar({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger text-sm">
      <AlertCircle className="w-4 h-4 shrink-0" />{msg}
    </div>
  )
}

// ── Status config ──────────────────────────────────────────────────────────────

const ASSIGN_STATUS_CFG: Record<string, { label: string; className: string }> = {
  assigned:          { label: "Assigned",       className: "bg-warning/10 text-warning border-warning/20" },
  in_progress:       { label: "In Progress",    className: "bg-ocean/10 text-ocean border-ocean/20" },
  report_submitted:  { label: "Report Done",    className: "bg-success/10 text-success border-success/20" },
  completed:         { label: "Completed",      className: "bg-gray-100 text-gray-500 border-gray-200" },
}

function AssignBadge({ status }: { status: string }) {
  const cfg = ASSIGN_STATUS_CFG[status] ?? { label: status, className: "bg-gray-100 text-gray-600 border-gray-200" }
  return <Badge className={cn("text-xs border capitalize", cfg.className)}>{cfg.label}</Badge>
}

// ── Expanded assignment detail + report form ───────────────────────────────────

function AssignmentPanel({ item, onReported }: {
  item: VerificationAssignmentItem
  onReported: () => void
}) {
  const [detail, setDetail]   = useState<VerificationAssignmentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [markingProgress, setMarkingProgress] = useState(false)

  // Report form
  const [conditionConfirmed, setConditionConfirmed]   = useState("")
  const [priceAssessment, setPriceAssessment]         = useState("")
  const [documentationComplete, setDocumentationComplete] = useState(true)
  const [notes, setNotes]                             = useState("")
  const [recommendation, setRecommendation]           = useState<"approve" | "reject" | "request_corrections">("approve")
  const [submitting, setSubmitting]                   = useState(false)
  const [reportError, setReportError]                 = useState<string | null>(null)
  const [submitted, setSubmitted]                     = useState(false)

  useEffect(() => {
    verificationAgent.getAssignment(item.id)
      .then(setDetail)
      .catch((e) => setError(e.message ?? "Failed to load assignment"))
      .finally(() => setLoading(false))
  }, [item.id])

  async function handleMarkInProgress() {
    setMarkingProgress(true)
    try {
      await verificationAgent.updateAssignment(item.id, "in_progress")
      setDetail((prev) => prev ? { ...prev, status: "in_progress" } : prev)
    } catch {
      // silent
    } finally {
      setMarkingProgress(false)
    }
  }

  async function handleSubmitReport() {
    if (!conditionConfirmed.trim()) { setReportError("Condition confirmation is required."); return }
    if (!priceAssessment.trim())    { setReportError("Price assessment is required."); return }
    if (notes.trim().length < 10)   { setReportError("Notes must be at least 10 characters."); return }

    setSubmitting(true)
    setReportError(null)
    try {
      await verificationAgent.submitReport(item.id, {
        condition_confirmed: conditionConfirmed.trim(),
        price_assessment: priceAssessment.trim(),
        documentation_complete: documentationComplete,
        notes: notes.trim(),
        recommendation,
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

  const product      = detail
  const hasReport    = !!detail.report
  const isAssigned   = item.status === "assigned"
  const canSubmit    = !hasReport && !["completed"].includes(item.status)

  return (
    <div className="border-t border-border">
      {/* Mark in-progress banner */}
      {isAssigned && canSubmit && (
        <div className="flex items-center justify-between px-5 py-3 bg-ocean/5 border-b border-border">
          <p className="text-sm text-ocean">Mark this assignment as In Progress to begin your inspection.</p>
          <Button
            size="sm" onClick={handleMarkInProgress} disabled={markingProgress}
            className="bg-ocean hover:bg-ocean-dark text-white gap-1.5"
          >
            {markingProgress ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
            Start Verification
          </Button>
        </div>
      )}

      {/* Product summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 px-5 py-4 bg-gray-50/50 text-sm">
        <div>
          <p className="text-xs text-text-secondary mb-0.5">Seller</p>
          <p className="font-medium text-text-primary">{product.seller_company ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-text-secondary mb-0.5">Asking Price</p>
          <p className="font-medium text-text-primary">
            {product.asking_price ? parseFloat(product.asking_price).toLocaleString() : "—"} {product.currency ?? ""}
          </p>
        </div>
        <div>
          <p className="text-xs text-text-secondary mb-0.5">Condition</p>
          <p className="font-medium text-text-primary capitalize">{product.condition?.replace(/_/g, " ") ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-text-secondary mb-0.5">Location</p>
          <p className="font-medium text-text-primary">{product.location_country ?? "—"}{product.location_port ? `, ${product.location_port}` : ""}</p>
        </div>
        <div>
          <p className="text-xs text-text-secondary mb-0.5">Category</p>
          <p className="font-medium text-text-primary">{product.category_name ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-text-secondary mb-0.5">Availability</p>
          <p className="font-medium text-text-primary capitalize">{product.availability_type?.replace(/_/g, " ") ?? "—"}</p>
        </div>
      </div>

      {/* Description */}
      {product.description && (
        <div className="px-5 pb-4">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">Description</p>
          <p className="text-sm text-text-primary whitespace-pre-line">{product.description}</p>
        </div>
      )}

      {/* Images */}
      {(product.images?.length ?? 0) > 0 && (
        <div className="px-5 pb-4">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">
            Images ({product.images?.length ?? 0})
          </p>
          <div className="flex gap-3 flex-wrap">
            {product.images.map((img) => (
              <a key={img.id} href={img.signed_url} target="_blank" rel="noopener noreferrer">
                <div className="w-24 h-24 rounded-lg border border-border overflow-hidden bg-gray-100 hover:opacity-80 transition-opacity">
                  <img src={img.signed_url} alt="" className="w-full h-full object-cover" />
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Attribute values */}
      {(product.attribute_values?.length ?? 0) > 0 && (
        <div className="px-5 pb-4">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">Specifications</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {product.attribute_values.map((attr) => (
              <div key={attr.attribute_id} className="p-2.5 bg-gray-50 rounded-lg border border-border">
                <p className="text-xs text-text-secondary">{attr.attribute_name}</p>
                <p className="text-sm font-medium text-text-primary">
                  {attr.value_text ?? attr.value_numeric ?? (attr.value_boolean != null ? (attr.value_boolean ? "Yes" : "No") : "—")}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Existing report */}
      {hasReport && detail.report && (
        <div className="px-5 py-3 border-t border-border">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">Your Verification Report</p>
          <div className="p-4 bg-success/5 rounded-lg border border-success/20 space-y-2 text-sm">
            <div className="flex items-center gap-3 flex-wrap">
              <Badge className={cn("text-xs border", {
                "bg-success/10 text-success border-success/20": detail.report.recommendation === "approve",
                "bg-danger/10 text-danger border-danger/20":    detail.report.recommendation === "reject",
                "bg-warning/10 text-warning border-warning/20": detail.report.recommendation === "request_corrections",
              })}>
                {detail.report.recommendation === "approve" ? "Recommend Approve"
                  : detail.report.recommendation === "reject" ? "Recommend Reject"
                  : "Request Corrections"}
              </Badge>
              <span className="text-text-secondary">
                Documentation: <strong>{detail.report.documentation_complete ? "Complete" : "Incomplete"}</strong>
              </span>
            </div>
            <p className="text-text-secondary font-medium">Condition: {detail.report.condition_confirmed}</p>
            <p className="text-text-secondary">Price: {detail.report.price_assessment}</p>
            <p className="text-text-secondary text-xs">{detail.report.notes}</p>
            <p className="text-xs text-text-secondary">{fmtDate(detail.report.created_at)}</p>
          </div>
        </div>
      )}

      {/* Report form */}
      {submitted ? (
        <div className="px-5 py-4 bg-success/5 border-t border-border">
          <div className="flex items-center gap-2 text-success text-sm font-medium">
            <CheckCircle2 className="w-4 h-4" /> Report submitted. Admin will make the final decision.
          </div>
        </div>
      ) : canSubmit ? (
        <div className="px-5 py-4 bg-gray-50/50 border-t border-border space-y-4">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Submit Verification Report</p>

          {/* Condition */}
          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1">
              Condition (as verified) <span className="text-danger">*</span>
            </label>
            <input
              value={conditionConfirmed}
              onChange={(e) => setConditionConfirmed(e.target.value)}
              placeholder="e.g. Good — minor surface rust, all systems operational"
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
            />
          </div>

          {/* Price assessment */}
          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1">
              Price Assessment <span className="text-danger">*</span>
            </label>
            <input
              value={priceAssessment}
              onChange={(e) => setPriceAssessment(e.target.value)}
              placeholder="e.g. Fairly priced at market value / Overpriced by ~15%"
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
            />
          </div>

          {/* Documentation */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="docs_complete"
              checked={documentationComplete}
              onChange={(e) => setDocumentationComplete(e.target.checked)}
              className="rounded border-border"
            />
            <label htmlFor="docs_complete" className="text-sm text-text-primary">
              Documentation is complete and verified
            </label>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1">
              Inspection Notes <span className="text-danger">*</span>
              <span className="font-normal ml-1">(min 10 characters)</span>
            </label>
            <Textarea
              rows={4}
              placeholder="Detailed notes from your physical or remote inspection…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="text-sm resize-none"
            />
          </div>

          {/* Recommendation */}
          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1.5">Recommendation</label>
            <div className="flex gap-2 flex-wrap">
              {(["approve", "reject", "request_corrections"] as const).map((rec) => (
                <button
                  key={rec}
                  onClick={() => setRecommendation(rec)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors",
                    recommendation === rec
                      ? rec === "approve"
                        ? "bg-success text-white border-success"
                        : rec === "reject"
                        ? "bg-danger text-white border-danger"
                        : "bg-warning text-white border-warning"
                      : "bg-white text-text-secondary border-border hover:border-gray-300"
                  )}
                >
                  {rec === "approve" ? "Approve" : rec === "reject" ? "Reject" : "Request Corrections"}
                </button>
              ))}
            </div>
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
          {hasReport ? "Report already submitted." : `No further action required (${item.status.replace(/_/g, " ")}).`}
        </div>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AgentMarketplacePage() {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState("")

  const { data, isLoading: loading, error: swrError, mutate } = useAgentAssignments({
    status: statusFilter || undefined,
  })
  const items = data?.items ?? []
  const error = swrError?.message ?? null

  const FILTER_TABS = [
    { value: "",                 label: "All" },
    { value: "assigned",         label: "Assigned" },
    { value: "in_progress",      label: "In Progress" },
    { value: "report_submitted", label: "Report Done" },
  ]

  const pending    = items.filter((i) => i.status === "assigned").length
  const inProgress = items.filter((i) => i.status === "in_progress").length

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-border shadow-sm p-4">
          <p className="text-xs text-text-secondary mb-1">Total Assigned</p>
          <p className="text-2xl font-bold text-text-primary">{items.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-border shadow-sm p-4">
          <p className="text-xs text-text-secondary mb-1">Pending Start</p>
          <p className="text-2xl font-bold text-warning">{pending}</p>
        </div>
        <div className="bg-white rounded-xl border border-border shadow-sm p-4">
          <p className="text-xs text-text-secondary mb-1">In Progress</p>
          <p className="text-2xl font-bold text-ocean">{inProgress}</p>
        </div>
      </div>

      {/* Filter tabs + refresh */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 border-b border-border overflow-x-auto">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => { setStatusFilter(tab.value); setExpanded(null) }}
              className={cn(
                "px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px shrink-0",
                statusFilter === tab.value
                  ? "border-ocean text-ocean"
                  : "border-transparent text-text-secondary hover:text-text-primary"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={() => mutate()} disabled={loading} className="gap-1.5 ml-3 shrink-0">
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
          <Search className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-text-secondary font-medium">No verification assignments</p>
          <p className="text-text-secondary text-sm mt-1">Listings assigned to you for verification will appear here.</p>
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
                    <p className="text-sm font-semibold text-text-primary">{item.product_title}</p>
                    <p className="text-xs text-text-secondary truncate">
                      {item.seller_company ?? "—"} · Assigned {fmtDate(item.assigned_at)}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <AssignBadge status={item.status} />
                    {isOpen ? <ChevronUp className="w-4 h-4 text-text-secondary" /> : <ChevronDown className="w-4 h-4 text-text-secondary" />}
                  </div>
                </div>

                {isOpen && (
                  <AssignmentPanel item={item} onReported={() => mutate()} />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
