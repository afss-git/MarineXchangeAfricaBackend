"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  ShieldCheck, Clock, Eye, CheckCircle2, XCircle, RefreshCw,
  ChevronDown, ChevronUp, AlertCircle, Loader2, FileText, User,
  Flag, AlertTriangle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  kycAgent, KycSubmissionListItem, KycSubmissionResponse,
  KycAgentReviewRequest,
} from "@/lib/api"
import { useAgentKycQueue } from "@/lib/hooks"

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

function fileSizeLabel(bytes: number | null) {
  if (!bytes) return "—"
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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

const STATUS_CFG: Record<string, { label: string; className: string; icon: React.ElementType }> = {
  pending_review:        { label: "Pending",    className: "bg-warning/10 text-warning border-warning/20",  icon: Clock },
  in_review:             { label: "In Review",  className: "bg-ocean/10 text-ocean border-ocean/20",        icon: Eye },
  approved:              { label: "Approved",   className: "bg-success/10 text-success border-success/20",  icon: CheckCircle2 },
  rejected:              { label: "Rejected",   className: "bg-danger/10 text-danger border-danger/20",     icon: XCircle },
  requires_resubmission: { label: "Resubmit",  className: "bg-orange-50 text-orange-600 border-orange-200", icon: RefreshCw },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? { label: status, className: "bg-gray-100 text-gray-600 border-gray-200", icon: Clock }
  const Icon = cfg.icon
  return (
    <Badge className={cn("text-xs border gap-1 capitalize", cfg.className)}>
      <Icon className="w-3 h-3" />{cfg.label}
    </Badge>
  )
}

// ── Expanded submission detail + review form ───────────────────────────────────

function SubmissionPanel({ sub, onReviewed }: {
  sub: KycSubmissionListItem
  onReviewed: () => void
}) {
  const [detail, setDetail] = useState<KycSubmissionResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [markingInReview, setMarkingInReview] = useState(false)

  // Review form
  const [assessment, setAssessment]       = useState("")
  const [riskScore, setRiskScore]         = useState<"low" | "medium" | "high">("low")
  const [isPep, setIsPep]                 = useState(false)
  const [sanctionsMatch, setSanctionsMatch] = useState(false)
  const [recommendation, setRecommendation] = useState<KycAgentReviewRequest["recommendation"]>("recommend_approve")
  const [notes, setNotes]                 = useState("")
  const [submitting, setSubmitting]       = useState(false)
  const [reviewError, setReviewError]     = useState<string | null>(null)
  const [submitted, setSubmitted]         = useState(false)

  useEffect(() => {
    kycAgent.getSubmission(sub.id)
      .then(setDetail)
      .catch((e) => setError(e.message ?? "Failed to load submission"))
      .finally(() => setLoading(false))
  }, [sub.id])

  async function handleMarkInReview() {
    setMarkingInReview(true)
    try {
      await kycAgent.updateAssignment(sub.id, "in_review")
      setDetail((prev) => prev ? { ...prev, status: "in_review" } : prev)
    } catch {
      // silent — status may already be in_review
    } finally {
      setMarkingInReview(false)
    }
  }

  async function handleSubmitReview() {
    if (assessment.trim().length < 10) { setReviewError("Assessment must be at least 10 characters."); return }
    setSubmitting(true)
    setReviewError(null)
    try {
      await kycAgent.submitReview(sub.id, {
        assessment: assessment.trim(),
        risk_score: riskScore,
        is_pep: isPep,
        sanctions_match: sanctionsMatch,
        recommendation,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      })
      setSubmitted(true)
      onReviewed()
    } catch (e: unknown) {
      setReviewError((e as Error)?.message ?? "Failed to submit review")
    } finally {
      setSubmitting(false)
    }
  }

  // Force high risk when PEP or sanctions
  const effectiveRisk = (isPep || sanctionsMatch) ? "high" : riskScore
  const forceReject   = isPep || sanctionsMatch

  if (loading) return (
    <div className="flex items-center justify-center py-10 gap-2 text-text-secondary text-sm border-t border-border">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading…
    </div>
  )
  if (error) return <div className="p-5 border-t border-border"><ErrorBar msg={error} /></div>
  if (!detail) return null

  const alreadyReviewed = detail.reviews.length > 0
  const myReview        = detail.reviews[detail.reviews.length - 1]
  const isInReview      = detail.assignment?.status === "in_review"
  const canReview       = !alreadyReviewed && !["approved","rejected","requires_resubmission"].includes(detail.status)

  return (
    <div className="border-t border-border">
      {/* Mark in-review banner */}
      {!isInReview && canReview && (
        <div className="flex items-center justify-between px-5 py-3 bg-ocean/5 border-b border-border">
          <p className="text-sm text-ocean">Start reviewing to mark this submission as In Review.</p>
          <Button
            size="sm" onClick={handleMarkInReview} disabled={markingInReview}
            className="bg-ocean hover:bg-ocean-dark text-white gap-1.5"
          >
            {markingInReview ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
            Mark In Review
          </Button>
        </div>
      )}

      {/* Documents */}
      <div className="px-5 pt-4 pb-3">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-3">
          Documents ({detail.documents.length})
        </p>
        {detail.documents.length === 0
          ? <p className="text-sm text-text-secondary">No documents uploaded.</p>
          : (
            <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
              {detail.documents.map((doc) => (
                <div key={doc.id} className="flex items-center gap-3 px-4 py-3 bg-white">
                  <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-text-secondary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary">{doc.document_type_name}</p>
                    <p className="text-xs text-text-secondary">
                      {doc.original_name ?? "—"} · {fileSizeLabel(doc.file_size_bytes)} · {fmtDate(doc.uploaded_at)}
                    </p>
                  </div>
                  <a
                    href={doc.signed_url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-ocean hover:underline shrink-0"
                  >
                    <Eye className="w-3.5 h-3.5" /> View
                  </a>
                </div>
              ))}
            </div>
          )
        }
      </div>

      {/* Previous review (if any) */}
      {alreadyReviewed && myReview && (
        <div className="px-5 py-3 border-t border-border">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">Your Assessment</p>
          <div className="p-3 bg-success/5 rounded-lg border border-success/20 text-sm space-y-1">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-success" />
              <span className="font-medium text-success capitalize">
                {myReview.recommendation.replace(/_/g, " ")}
              </span>
              <span className="text-text-secondary">· Risk: <strong className="capitalize">{myReview.risk_score}</strong></span>
              {myReview.is_pep        && <Badge className="bg-warning/10 text-warning border-warning/20 text-xs border">PEP</Badge>}
              {myReview.sanctions_match && <Badge className="bg-danger/10 text-danger border-danger/20 text-xs border">Sanctions</Badge>}
            </div>
            <p className="text-text-secondary text-xs">{myReview.assessment}</p>
            <p className="text-xs text-text-secondary">{fmtDate(myReview.created_at)}</p>
          </div>
        </div>
      )}

      {/* Review form */}
      {submitted ? (
        <div className="px-5 py-4 bg-success/5 border-t border-border">
          <div className="flex items-center gap-2 text-success text-sm font-medium">
            <CheckCircle2 className="w-4 h-4" /> Review submitted. Admin will make the final decision.
          </div>
        </div>
      ) : canReview ? (
        <div className="px-5 py-4 bg-gray-50/50 border-t border-border space-y-4">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Submit Your Assessment</p>

          {/* PEP + Sanctions flags */}
          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={isPep} onChange={(e) => setIsPep(e.target.checked)} className="rounded border-border" />
              <span className="text-sm text-text-primary flex items-center gap-1">
                <Flag className="w-3.5 h-3.5 text-warning" /> PEP (Politically Exposed Person)
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={sanctionsMatch} onChange={(e) => setSanctionsMatch(e.target.checked)} className="rounded border-border" />
              <span className="text-sm text-text-primary flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-danger" /> Sanctions Match
              </span>
            </label>
          </div>

          {(isPep || sanctionsMatch) && (
            <div className="flex items-center gap-2 p-3 bg-danger/10 border border-danger/20 rounded-lg text-danger text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              PEP / Sanctions flag detected — risk is forced to High and recommendation restricted.
            </div>
          )}

          {/* Risk score */}
          {!forceReject && (
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1.5">Risk Score</label>
              <div className="flex gap-2">
                {(["low", "medium", "high"] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRiskScore(r)}
                    className={cn(
                      "px-3 py-1.5 rounded-lg border text-xs font-medium capitalize transition-colors",
                      riskScore === r
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
          )}

          {/* Recommendation */}
          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1.5">
              Recommendation
              <span className="font-normal ml-1">(admin makes the final decision)</span>
            </label>
            <div className="flex gap-2 flex-wrap">
              {(forceReject
                ? ["recommend_reject", "requires_resubmission"] as const
                : ["recommend_approve", "recommend_reject", "requires_resubmission"] as const
              ).map((rec) => (
                <button
                  key={rec}
                  onClick={() => setRecommendation(rec)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors capitalize",
                    recommendation === rec
                      ? rec === "recommend_approve"
                        ? "bg-success text-white border-success"
                        : rec === "recommend_reject"
                        ? "bg-danger text-white border-danger"
                        : "bg-warning text-white border-warning"
                      : "bg-white text-text-secondary border-border hover:border-gray-300"
                  )}
                >
                  {rec === "recommend_approve" ? "Recommend Approve"
                    : rec === "recommend_reject" ? "Recommend Reject"
                    : "Requires Resubmission"}
                </button>
              ))}
            </div>
          </div>

          {/* Assessment */}
          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1">
              Assessment <span className="text-danger">*</span>
              <span className="font-normal ml-1">(min 10 characters)</span>
            </label>
            <Textarea
              rows={4}
              placeholder="Describe your assessment of the documents, identity, and compliance checks performed…"
              value={assessment}
              onChange={(e) => setAssessment(e.target.value)}
              className="text-sm resize-none"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1">Additional Notes (optional)</label>
            <Textarea
              rows={2}
              placeholder="Any other observations…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="text-sm resize-none"
            />
          </div>

          {reviewError && <ErrorBar msg={reviewError} />}

          <div className="flex justify-end">
            <Button
              onClick={handleSubmitReview}
              disabled={submitting}
              className="bg-ocean hover:bg-ocean-dark text-white gap-1.5"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              {submitting ? "Submitting…" : "Submit Assessment"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="px-5 py-4 bg-gray-50/50 border-t border-border text-sm text-text-secondary">
          This submission has been decided (<span className="font-medium capitalize">{detail.status.replace(/_/g, " ")}</span>).
        </div>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AgentKycQueuePage() {
  const router = useRouter()
  const [page, setPage]         = useState(1)
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data, isLoading: loading, error: swrError, mutate } = useAgentKycQueue({ page, page_size: 20 })
  const items = data?.items ?? []
  const total = data?.total ?? 0
  const pages = data?.pages ?? 1
  const error = swrError?.message ?? null

  const pending   = items.filter((s) => s.status === "pending_review").length
  const inReview  = items.filter((s) => s.status === "in_review").length

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-border shadow-sm p-4">
          <p className="text-xs text-text-secondary mb-1">Assigned to Me</p>
          <p className="text-2xl font-bold text-text-primary">{total}</p>
        </div>
        <div className="bg-white rounded-xl border border-border shadow-sm p-4">
          <p className="text-xs text-text-secondary mb-1">Pending Review</p>
          <p className="text-2xl font-bold text-warning">{pending}</p>
        </div>
        <div className="bg-white rounded-xl border border-border shadow-sm p-4">
          <p className="text-xs text-text-secondary mb-1">In Review</p>
          <p className="text-2xl font-bold text-ocean">{inReview}</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-secondary">My Assigned Submissions</h2>
        <Button variant="outline" size="sm" onClick={() => mutate()} disabled={loading} className="gap-1.5">
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /> Refresh
        </Button>
      </div>

      {error && <ErrorBar msg={error} />}

      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center py-16 gap-2 text-text-secondary text-sm">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading queue…
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-border p-12 text-center">
          <ShieldCheck className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-text-secondary font-medium">Your queue is empty</p>
          <p className="text-text-secondary text-sm mt-1">New submissions will appear here when assigned by an admin.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((sub) => {
            const isOpen = expanded === sub.id
            return (
              <div key={sub.id} className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
                {/* Header */}
                <div
                  className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => setExpanded(isOpen ? null : sub.id)}
                >
                  <Avatar className="w-10 h-10 shrink-0">
                    <AvatarFallback className="bg-ocean/10 text-ocean text-sm font-semibold">
                      {initials(sub.buyer_name)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-text-primary">
                        {sub.buyer_name ?? "Unknown User"}
                      </p>
                      {sub.cycle_number > 1 && (
                        <Badge variant="secondary" className="text-xs">Cycle {sub.cycle_number}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-text-secondary truncate">
                      {sub.buyer_company ?? "—"} · Submitted {fmtDate(sub.submitted_at)}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right hidden sm:block">
                      <p className="text-xs text-text-secondary">{sub.document_count} doc{sub.document_count !== 1 ? "s" : ""}</p>
                    </div>
                    <StatusBadge status={sub.status} />
                    {isOpen ? <ChevronUp className="w-4 h-4 text-text-secondary" /> : <ChevronDown className="w-4 h-4 text-text-secondary" />}
                  </div>
                </div>

                {isOpen && (
                  <SubmissionPanel sub={sub} onReviewed={() => mutate()} />
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-sm text-text-secondary">Page {page} of {pages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => p - 1)} disabled={page <= 1 || loading}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page >= pages || loading}>Next</Button>
          </div>
        </div>
      )}
    </div>
  )
}
