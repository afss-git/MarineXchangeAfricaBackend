"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowLeft, User, ShieldCheck, Handshake, FileText, Activity,
  Mail, Phone, MapPin, Building2, Calendar, AlertCircle, Loader2,
  CheckCircle2, XCircle, Clock, RefreshCw, Eye, Ban, ChevronDown,
  ChevronUp, ExternalLink, UserX, UserCheck2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { adminBuyers, admin, kycAdmin, type AdminBuyerDetail, type KycSubmissionResponse } from "@/lib/api"

// ── Types ──────────────────────────────────────────────────────────────────────

interface BuyerProfile {
  id: string; full_name: string | null; email: string; company_name: string | null
  company_reg_no: string | null; phone: string | null; phone_verified?: boolean; country: string | null
  roles: string[]; kyc_status: string; kyc_expires_at: string | null
  kyc_attempt_count: number; is_active: boolean; created_at: string; updated_at: string
}

interface KycSubmission {
  id: string; status: string; cycle_number: number; created_at: string
  rejection_reason: string | null; agent_name: string | null; agent_email: string | null
  assignment_status: string | null; reviewed_at: string | null; doc_count: number
}

interface Deal {
  id: string; status: string; deal_type: string; total_price: string
  currency: string; created_at: string; product_title: string | null
  seller_name: string | null; seller_email: string | null
}

interface PurchaseRequest {
  id: string; status: string; request_type: string
  budget_min: number | null; budget_max: number | null; currency: string
  description: string; created_at: string; product_title: string | null
  agent_name: string | null
}

interface ActivityItem {
  action: string; resource_type: string; resource_id: string; created_at: string
}

interface BuyerDetail {
  profile: BuyerProfile
  kyc: KycSubmission[]
  deals: Deal[]
  purchase_requests: PurchaseRequest[]
  activity: ActivityItem[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

function fmtDateTime(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

function fmtMoney(amount: string | number, currency: string) {
  return `${parseFloat(String(amount)).toLocaleString()} ${currency}`
}

function fileSizeLabel(bytes: number | null) {
  if (!bytes) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Status configs ─────────────────────────────────────────────────────────────

const KYC_CFG: Record<string, { label: string; className: string; icon: React.ElementType }> = {
  not_started: { label: "Not Started",  className: "bg-gray-100 text-gray-500 border-gray-200",     icon: Clock },
  pending:     { label: "Pending",      className: "bg-warning/10 text-warning border-warning/20",   icon: Clock },
  submitted:   { label: "Submitted",    className: "bg-ocean/10 text-ocean border-ocean/20",         icon: Clock },
  under_review:{ label: "Under Review", className: "bg-ocean/10 text-ocean border-ocean/20",         icon: Clock },
  approved:    { label: "Approved",     className: "bg-success/10 text-success border-success/20",   icon: CheckCircle2 },
  rejected:    { label: "Rejected",     className: "bg-danger/10 text-danger border-danger/20",      icon: XCircle },
  expired:     { label: "Expired",      className: "bg-orange-50 text-orange-600 border-orange-200", icon: AlertCircle },
  requires_resubmission: { label: "Resubmit", className: "bg-orange-50 text-orange-600 border-orange-200", icon: RefreshCw },
}

const DEAL_CFG: Record<string, { label: string; className: string }> = {
  pending_admin_approval: { label: "Pending Approval", className: "bg-warning/10 text-warning border-warning/20" },
  approved:     { label: "Approved",     className: "bg-ocean/10 text-ocean border-ocean/20" },
  active:       { label: "Active",       className: "bg-success/10 text-success border-success/20" },
  completed:    { label: "Completed",    className: "bg-success/10 text-success border-success/20" },
  cancelled:    { label: "Cancelled",    className: "bg-gray-100 text-gray-500 border-gray-200" },
  disputed:     { label: "Disputed",     className: "bg-danger/10 text-danger border-danger/20" },
  defaulted:    { label: "Defaulted",    className: "bg-danger/10 text-danger border-danger/20" },
}

const PR_CFG: Record<string, { label: string; className: string }> = {
  submitted:    { label: "Submitted",    className: "bg-ocean/10 text-ocean border-ocean/20" },
  under_review: { label: "Under Review", className: "bg-ocean/10 text-ocean border-ocean/20" },
  approved:     { label: "Approved",     className: "bg-success/10 text-success border-success/20" },
  rejected:     { label: "Rejected",     className: "bg-danger/10 text-danger border-danger/20" },
  completed:    { label: "Completed",    className: "bg-success/10 text-success border-success/20" },
}

// ── Components ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-border px-5 py-4">
      <p className="text-xs text-text-secondary mb-1">{label}</p>
      <p className="text-2xl font-bold text-text-primary">{value}</p>
      {sub && <p className="text-xs text-text-secondary mt-0.5">{sub}</p>}
    </div>
  )
}

function ErrorBar({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 p-3 bg-danger/10 border border-danger/20 rounded-lg text-danger text-sm">
      <AlertCircle className="w-4 h-4 shrink-0" />{msg}
    </div>
  )
}

// ── Inline KYC submission detail (with full action panel) ──────────────────────

function KycSubmissionDetail({ subId, onDecided }: { subId: string; onDecided: () => void }) {
  const [detail, setDetail] = useState<KycSubmissionResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Decision form
  const [decision, setDecision] = useState<"approve" | "reject" | "requires_resubmission">("approve")
  const [assessment, setAssessment] = useState("")
  const [riskScore, setRiskScore] = useState<"low" | "medium" | "high">("low")
  const [isPep, setIsPep] = useState(false)
  const [sanctionsMatch, setSanctionsMatch] = useState(false)
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [decideError, setDecideError] = useState<string | null>(null)
  const [decided, setDecided] = useState(false)

  useEffect(() => {
    kycAdmin.getSubmission(subId)
      .then(setDetail)
      .catch((e: Error) => setError(e.message ?? "Failed to load submission"))
      .finally(() => setLoading(false))
  }, [subId])

  async function handleDecide() {
    if (assessment.trim().length < 10) { setDecideError("Assessment must be at least 10 characters."); return }
    if ((decision === "reject" || decision === "requires_resubmission") && !reason.trim()) {
      setDecideError("Reason is required when rejecting or requesting resubmission."); return
    }
    setSubmitting(true); setDecideError(null)
    try {
      await kycAdmin.decide(subId, {
        decision, assessment: assessment.trim(), risk_score: riskScore,
        is_pep: isPep, sanctions_match: sanctionsMatch,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      })
      setDecided(true)
      onDecided()
    } catch (e: unknown) {
      setDecideError((e as Error)?.message ?? "Failed to submit decision")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return (
    <div className="flex items-center gap-2 py-6 px-5 text-text-secondary text-sm">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading submission…
    </div>
  )
  if (error) return <div className="p-5"><ErrorBar msg={error} /></div>
  if (!detail) return null

  const canDecide = !["approved", "rejected", "requires_resubmission"].includes(detail.status)

  return (
    <div className="border-t border-border bg-gray-50/30">
      {/* Documents */}
      <div className="px-5 pt-4 pb-3">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-3">
          Documents ({detail.documents.length})
        </p>
        {detail.documents.length === 0 ? (
          <p className="text-sm text-text-secondary">No documents uploaded yet.</p>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
            {detail.documents.map((doc) => (
              <div key={doc.id} className="flex items-center gap-3 px-4 py-3 bg-white">
                <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4 text-text-secondary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary">{doc.document_type_name}</p>
                  <p className="text-xs text-text-secondary">
                    {doc.original_name ?? "—"} · {fileSizeLabel(doc.file_size_bytes)} · {fmtDateTime(doc.uploaded_at)}
                  </p>
                </div>
                <a
                  href={doc.signed_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-ocean hover:underline shrink-0 font-medium"
                >
                  <Eye className="w-3.5 h-3.5" /> View
                </a>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Review history */}
      {detail.reviews.length > 0 && (
        <div className="px-5 pb-3">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">
            Review History
          </p>
          <div className="space-y-2">
            {detail.reviews.map((r) => (
              <div key={r.id} className="p-3 bg-white rounded-lg border border-border text-sm">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-text-primary">
                    {r.reviewer_name ?? r.reviewer_id.slice(0, 8) + "…"}
                  </span>
                  <span className="text-xs text-text-secondary">{fmtDateTime(r.created_at)}</span>
                </div>
                <p className="text-text-secondary text-xs">{r.assessment}</p>
                <div className="flex gap-3 mt-1.5 text-xs text-text-secondary">
                  {r.is_pep && <span className="text-warning font-medium">PEP flagged</span>}
                  {r.sanctions_match && <span className="text-danger font-medium">Sanctions match</span>}
                  <span>Recommendation: <span className="capitalize font-medium text-text-primary">{r.recommendation}</span></span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Assignment */}
      {detail.assignment && (
        <div className="px-5 pb-3">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-1">Assignment</p>
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <User className="w-4 h-4" />
            Assigned to <span className="font-medium text-text-primary ml-1">{detail.assignment.agent_name ?? detail.assignment.agent_id}</span>
            <span>·</span>
            <span className="capitalize">{detail.assignment.status}</span>
          </div>
        </div>
      )}

      {/* Decision panel */}
      {decided ? (
        <div className="px-5 py-4 bg-success/5 border-t border-border">
          <div className="flex items-center gap-2 text-success text-sm font-medium">
            <CheckCircle2 className="w-4 h-4" /> Decision submitted successfully.
          </div>
        </div>
      ) : canDecide ? (
        <div className="px-5 py-4 bg-white border-t border-border space-y-4">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Make Decision</p>

          <div className="grid grid-cols-3 gap-2">
            {(["approve", "reject", "requires_resubmission"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDecision(d)}
                className={cn(
                  "px-3 py-2 rounded-lg border text-xs font-medium transition-colors",
                  decision === d
                    ? d === "approve" ? "bg-success text-white border-success"
                      : d === "reject" ? "bg-danger text-white border-danger"
                      : "bg-warning text-white border-warning"
                    : "bg-white text-text-secondary border-border hover:border-gray-300"
                )}
              >
                {d === "requires_resubmission" ? "Requires Resubmission" : d.charAt(0).toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>

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

          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={isPep} onChange={(e) => setIsPep(e.target.checked)} className="rounded border-border" />
              <span className="text-sm text-text-primary">PEP (Politically Exposed Person)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={sanctionsMatch} onChange={(e) => setSanctionsMatch(e.target.checked)} className="rounded border-border" />
              <span className="text-sm text-text-primary">Sanctions Match</span>
            </label>
          </div>

          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1">
              Assessment <span className="text-danger">*</span>
              <span className="font-normal ml-1">(min 10 characters)</span>
            </label>
            <Textarea
              rows={3}
              placeholder="Describe your assessment of the applicant and documents reviewed…"
              value={assessment}
              onChange={(e) => setAssessment(e.target.value)}
              className="text-sm resize-none"
            />
          </div>

          {(decision === "reject" || decision === "requires_resubmission") && (
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">
                Reason for {decision === "reject" ? "Rejection" : "Resubmission"} <span className="text-danger">*</span>
              </label>
              <Textarea
                rows={2}
                placeholder="This will be shown to the applicant…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="text-sm resize-none"
              />
            </div>
          )}

          {decideError && <ErrorBar msg={decideError} />}

          <div className="flex justify-end">
            <Button
              onClick={handleDecide}
              disabled={submitting}
              className={cn(
                "gap-1.5 text-white",
                decision === "approve" ? "bg-success hover:bg-success/90"
                  : decision === "reject" ? "bg-danger hover:bg-danger/90"
                  : "bg-warning hover:bg-warning/90"
              )}
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              {submitting ? "Submitting…" : "Submit Decision"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="px-5 py-4 bg-gray-50/50 border-t border-border">
          <p className="text-sm text-text-secondary">
            This submission has already been decided (<span className="font-medium capitalize">{detail.status.replace(/_/g, " ")}</span>).
            {detail.rejection_reason && (
              <span className="block mt-1 text-danger text-xs">{detail.rejection_reason}</span>
            )}
          </p>
        </div>
      )}
    </div>
  )
}

// ── Tab: Overview ─────────────────────────────────────────────────────────────

function OverviewTab({ data }: { data: BuyerDetail }) {
  const { profile, deals, purchase_requests, kyc } = data
  const latestKyc = kyc[0]
  const kycc = KYC_CFG[profile.kyc_status] ?? KYC_CFG.not_started
  const KycIcon = kycc.icon

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Total Deals" value={deals.length} />
        <StatCard label="Active Deals" value={deals.filter(d => !["completed","cancelled","disputed","defaulted"].includes(d.status)).length} />
        <StatCard label="Purchase Requests" value={purchase_requests.length} />
        <StatCard label="KYC Attempts" value={profile.kyc_attempt_count ?? 0} />
      </div>

      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold text-text-primary">Profile Information</h3>
          <Badge className={cn("text-xs border gap-1", kycc.className)}>
            <KycIcon className="w-3 h-3" />{kycc.label}
          </Badge>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-border">
          <div className="p-6 space-y-4">
            {[
              { icon: User,      label: "Full Name",   value: profile.full_name || "—" },
              { icon: Mail,      label: "Email",       value: profile.email },
              { icon: Phone,     label: "Phone",       value: profile.phone ? `${profile.phone}${profile.phone_verified ? " ✓ Verified" : ""}` : "—" },
              { icon: MapPin,    label: "Country",     value: profile.country || "—" },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-text-secondary" />
                </div>
                <div>
                  <p className="text-xs text-text-secondary">{label}</p>
                  <p className="text-sm font-medium text-text-primary">{value}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="p-6 space-y-4">
            {[
              { icon: Building2,  label: "Company",     value: profile.company_name || "—" },
              { icon: FileText,   label: "Company Reg", value: profile.company_reg_no || "—" },
              { icon: Calendar,   label: "Joined",      value: fmtDate(profile.created_at) },
              { icon: ShieldCheck,label: "KYC Expires", value: fmtDate(profile.kyc_expires_at) },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-text-secondary" />
                </div>
                <div>
                  <p className="text-xs text-text-secondary">{label}</p>
                  <p className="text-sm font-medium text-text-primary">{value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="px-6 py-4 border-t border-border bg-gray-50/50">
          <p className="text-xs text-text-secondary mb-2">Roles</p>
          <div className="flex gap-2 flex-wrap">
            {profile.roles.map(r => (
              <span key={r} className="text-xs bg-ocean/10 text-ocean border border-ocean/20 px-2.5 py-1 rounded-full font-medium capitalize">
                {r.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </div>
      </div>

      {latestKyc && (
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold text-text-primary">Latest KYC Submission</h3>
            <Badge className={cn("text-xs border gap-1", (KYC_CFG[latestKyc.status] ?? KYC_CFG.not_started).className)}>
              {latestKyc.status.replace(/_/g, " ")}
            </Badge>
          </div>
          <div className="p-6 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div><p className="text-xs text-text-secondary mb-0.5">Submitted</p><p className="font-medium">{fmtDate(latestKyc.created_at)}</p></div>
            <div><p className="text-xs text-text-secondary mb-0.5">Reviewed By</p><p className="font-medium">{latestKyc.agent_name || "—"}</p></div>
            <div><p className="text-xs text-text-secondary mb-0.5">Documents</p><p className="font-medium">{latestKyc.doc_count}</p></div>
            <div><p className="text-xs text-text-secondary mb-0.5">Cycle</p><p className="font-medium">{latestKyc.cycle_number}</p></div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tab: KYC (expandable with full action panel) ───────────────────────────────

function KycTab({ submissions, onRefresh }: { submissions: KycSubmission[]; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState<string | null>(
    // Auto-expand the first actionable submission
    submissions.find(s => !["approved", "rejected"].includes(s.status))?.id ?? null
  )

  if (submissions.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-border p-12 text-center">
        <ShieldCheck className="w-10 h-10 text-gray-200 mx-auto mb-3" />
        <p className="text-text-secondary">No KYC submissions yet</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {submissions.map((s) => {
        const cfg = KYC_CFG[s.status] ?? KYC_CFG.not_started
        const Icon = cfg.icon
        const isOpen = expanded === s.id
        const isActionable = !["approved", "rejected"].includes(s.status)

        return (
          <div key={s.id} className="bg-white rounded-xl border border-border overflow-hidden shadow-sm">
            {/* Header row — click to expand */}
            <div
              className={cn("px-5 py-4 flex items-center gap-3 cursor-pointer transition-colors", isOpen ? "bg-gray-50" : "hover:bg-gray-50/50")}
              onClick={() => setExpanded(isOpen ? null : s.id)}
            >
              <div className="w-9 h-9 rounded-full bg-ocean/10 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-4 h-4 text-ocean" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-text-primary">Cycle {s.cycle_number}</p>
                  {isActionable && (
                    <span className="text-xs bg-warning/10 text-warning border border-warning/20 px-2 py-0.5 rounded-full font-medium">
                      Action Required
                    </span>
                  )}
                </div>
                <p className="text-xs text-text-secondary">
                  Submitted {fmtDate(s.created_at)}
                  {s.agent_name ? ` · Reviewer: ${s.agent_name}` : ""}
                  {" · "}{s.doc_count} document{s.doc_count !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge className={cn("text-xs border gap-1", cfg.className)}>
                  <Icon className="w-3 h-3" />{cfg.label}
                </Badge>
                {isOpen ? <ChevronUp className="w-4 h-4 text-text-secondary" /> : <ChevronDown className="w-4 h-4 text-text-secondary" />}
              </div>
            </div>

            {/* Summary row when collapsed */}
            {!isOpen && s.rejection_reason && (
              <div className="px-5 pb-3">
                <div className="bg-danger/5 rounded-lg p-3 border border-danger/10">
                  <p className="text-xs text-text-secondary mb-0.5">Rejection Reason</p>
                  <p className="text-sm text-danger">{s.rejection_reason}</p>
                </div>
              </div>
            )}

            {/* Expanded: full review panel */}
            {isOpen && (
              <KycSubmissionDetail subId={s.id} onDecided={onRefresh} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Tab: Deals ────────────────────────────────────────────────────────────────

function DealsTab({ deals }: { deals: Deal[] }) {
  const router = useRouter()

  if (deals.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-border p-12 text-center">
        <Handshake className="w-10 h-10 text-gray-200 mx-auto mb-3" />
        <p className="text-text-secondary">No deals yet</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-gray-50/50">
            <th className="text-left px-5 py-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">Product</th>
            <th className="text-left px-5 py-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">Seller</th>
            <th className="text-left px-5 py-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">Amount</th>
            <th className="text-left px-5 py-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">Type</th>
            <th className="text-left px-5 py-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">Status</th>
            <th className="text-left px-5 py-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">Date</th>
            <th className="w-12" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {deals.map((d) => {
            const cfg = DEAL_CFG[d.status] ?? { label: d.status, className: "bg-gray-100 text-gray-500 border-gray-200" }
            return (
              <tr
                key={d.id}
                className="hover:bg-gray-50/50 transition-colors cursor-pointer"
                onClick={() => router.push(`/admin/deals/${d.id}`)}
              >
                <td className="px-5 py-3.5 font-medium text-text-primary">{d.product_title || "—"}</td>
                <td className="px-5 py-3.5">
                  <p className="text-text-primary">{d.seller_name || "—"}</p>
                  {d.seller_email && <p className="text-xs text-text-secondary">{d.seller_email}</p>}
                </td>
                <td className="px-5 py-3.5 font-medium">{fmtMoney(d.total_price, d.currency)}</td>
                <td className="px-5 py-3.5 capitalize text-text-secondary">{d.deal_type.replace(/_/g, " ")}</td>
                <td className="px-5 py-3.5">
                  <Badge className={cn("text-xs border", cfg.className)}>{cfg.label}</Badge>
                </td>
                <td className="px-5 py-3.5 text-text-secondary">{fmtDate(d.created_at)}</td>
                <td className="px-5 py-3.5">
                  <ExternalLink className="w-3.5 h-3.5 text-text-secondary" />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Tab: Purchase Requests ────────────────────────────────────────────────────

function PurchaseRequestsTab({ requests }: { requests: PurchaseRequest[] }) {
  if (requests.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-border p-12 text-center">
        <FileText className="w-10 h-10 text-gray-200 mx-auto mb-3" />
        <p className="text-text-secondary">No purchase requests yet</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {requests.map((r) => {
        const cfg = PR_CFG[r.status] ?? { label: r.status, className: "bg-gray-100 text-gray-500 border-gray-200" }
        return (
          <div key={r.id} className="bg-white rounded-xl border border-border px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-semibold text-text-primary capitalize">{r.request_type.replace(/_/g, " ")}</p>
                  {r.product_title && <span className="text-xs text-text-secondary">· {r.product_title}</span>}
                </div>
                <p className="text-xs text-text-secondary line-clamp-2">{r.description}</p>
                <div className="flex items-center gap-4 mt-2 text-xs text-text-secondary">
                  {(r.budget_min || r.budget_max) && (
                    <span>Budget: {r.budget_min ? fmtMoney(r.budget_min, r.currency) : "—"} – {r.budget_max ? fmtMoney(r.budget_max, r.currency) : "—"}</span>
                  )}
                  {r.agent_name && <span>Agent: {r.agent_name}</span>}
                  <span>{fmtDate(r.created_at)}</span>
                </div>
              </div>
              <Badge className={cn("text-xs border shrink-0", cfg.className)}>{cfg.label}</Badge>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Tab: Activity ─────────────────────────────────────────────────────────────

function ActivityTab({ activity }: { activity: ActivityItem[] }) {
  if (activity.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-border p-12 text-center">
        <Activity className="w-10 h-10 text-gray-200 mx-auto mb-3" />
        <p className="text-text-secondary">No recent activity</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      <div className="divide-y divide-border">
        {activity.map((a, i) => (
          <div key={i} className="px-5 py-3 flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-ocean shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-text-primary font-medium">{a.action.replace(/_/g, " ")}</p>
              <p className="text-xs text-text-secondary capitalize">{a.resource_type} · {a.resource_id?.slice(0, 8)}…</p>
            </div>
            <p className="text-xs text-text-secondary shrink-0">{fmtDateTime(a.created_at)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const TABS = [
  { key: "overview",  label: "Overview",          icon: User },
  { key: "kyc",       label: "KYC",               icon: ShieldCheck },
  { key: "deals",     label: "Deals",             icon: Handshake },
  { key: "requests",  label: "Purchase Requests", icon: FileText },
  { key: "activity",  label: "Activity",          icon: Activity },
]

export default function BuyerDetailPage() {
  const params = useParams()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState("overview")
  const [data, setData] = useState<AdminBuyerDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const buyerId = params.id as string

  async function load() {
    setLoading(true); setError(null)
    try {
      setData(await adminBuyers.getDetail(buyerId))
    } catch (e: any) {
      setError(e.message ?? "Failed to load buyer")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [buyerId])

  async function toggleActive() {
    if (!data) return
    const isActive = data.profile.is_active
    const confirmed = window.confirm(
      isActive
        ? `Deactivate ${data.profile.full_name || data.profile.email}? They will lose access immediately.`
        : `Reactivate ${data.profile.full_name || data.profile.email}?`
    )
    if (!confirmed) return
    setActionLoading(true); setActionError(null)
    try {
      if (isActive) {
        await admin.deactivate(buyerId, "Deactivated by admin")
      } else {
        await admin.reactivate(buyerId)
      }
      await load()
    } catch (e: any) {
      setActionError(e.message ?? "Action failed")
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-24 gap-2 text-text-secondary">
      <Loader2 className="w-5 h-5 animate-spin" /> Loading buyer profile…
    </div>
  )

  if (error) return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-1.5"><ArrowLeft className="w-4 h-4" /> Back</Button>
      <div className="flex items-center gap-2 p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger text-sm">
        <AlertCircle className="w-4 h-4 shrink-0" />{error}
      </div>
    </div>
  )

  if (!data) return null
  const { profile } = data

  const pendingKyc = data.kyc.filter(s => !["approved", "rejected"].includes(s.status)).length

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-1.5 mt-0.5 shrink-0">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="w-12 h-12 rounded-full bg-ocean/10 flex items-center justify-center shrink-0">
              <span className="text-ocean font-bold text-lg">
                {(profile.full_name || profile.email || "?")[0].toUpperCase()}
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-text-primary">{profile.full_name || "Unnamed Buyer"}</h1>
                {!profile.is_active && <Badge className="bg-gray-100 text-gray-500 border-gray-200 border text-xs">Inactive</Badge>}
                {pendingKyc > 0 && (
                  <button
                    onClick={() => setActiveTab("kyc")}
                    className="text-xs bg-warning/10 text-warning border border-warning/20 px-2 py-0.5 rounded-full font-medium hover:bg-warning/20 transition-colors"
                  >
                    {pendingKyc} KYC pending
                  </button>
                )}
              </div>
              <p className="text-sm text-text-secondary">{profile.email} {profile.company_name ? `· ${profile.company_name}` : ""}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
            <RefreshCw className="w-4 h-4" /> Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={toggleActive}
            disabled={actionLoading}
            className={cn("gap-1.5", profile.is_active ? "text-danger border-danger/30 hover:bg-danger/5" : "text-success border-success/30 hover:bg-success/5")}
          >
            {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : profile.is_active ? <UserX className="w-4 h-4" /> : <UserCheck2 className="w-4 h-4" />}
            {profile.is_active ? "Deactivate" : "Activate"}
          </Button>
        </div>
      </div>

      {actionError && <ErrorBar msg={actionError} />}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const badge =
            tab.key === "deals" ? data.deals.length :
            tab.key === "requests" ? data.purchase_requests.length :
            tab.key === "kyc" ? data.kyc.length : null
          const pendingBadge = tab.key === "kyc" ? pendingKyc : 0
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors shrink-0",
                activeTab === tab.key ? "border-ocean text-ocean" : "border-transparent text-text-secondary hover:text-text-primary"
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
              {pendingBadge > 0 && (
                <span className="ml-1 text-xs bg-warning/10 text-warning rounded-full px-1.5">{pendingBadge}</span>
              )}
              {!pendingBadge && badge != null && badge > 0 && (
                <span className="ml-1 text-xs bg-ocean/10 text-ocean rounded-full px-1.5">{badge}</span>
              )}
            </button>
          )
        })}
      </div>

      {activeTab === "overview"  && <OverviewTab data={data} />}
      {activeTab === "kyc"       && <KycTab submissions={data.kyc} onRefresh={load} />}
      {activeTab === "deals"     && <DealsTab deals={data.deals} />}
      {activeTab === "requests"  && <PurchaseRequestsTab requests={data.purchase_requests} />}
      {activeTab === "activity"  && <ActivityTab activity={data.activity} />}
    </div>
  )
}
