"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Search, ShieldCheck, ShieldX, FileText, Eye, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, Clock, AlertCircle, Plus, Settings2, RefreshCw,
  User, Loader2, ExternalLink, Tag, ToggleLeft, ToggleRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  kycAdmin,
  KycSubmissionListItem, KycSubmissionResponse, DocumentTypeResponse,
} from "@/lib/api"
import { useAdminKycQueue } from "@/lib/hooks"

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  })
}

function fileSizeLabel(bytes: number | null) {
  if (!bytes) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function initials(name: string | null) {
  if (!name) return "?"
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
}

// ── Sub-components ─────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; className: string; icon: React.ElementType }> = {
  draft:                  { label: "Draft",        className: "bg-gray-100 text-gray-600 border-gray-200",    icon: Clock },
  pending_review:         { label: "Pending",      className: "bg-warning/10 text-warning border-warning/20",  icon: Clock },
  in_review:              { label: "In Review",    className: "bg-ocean/10 text-ocean border-ocean/20",        icon: Eye },
  approved:               { label: "Approved",     className: "bg-success/10 text-success border-success/20",  icon: CheckCircle2 },
  rejected:               { label: "Rejected",     className: "bg-danger/10 text-danger border-danger/20",     icon: XCircle },
  requires_resubmission:  { label: "Resubmit",     className: "bg-orange-50 text-orange-600 border-orange-200", icon: RefreshCw },
  expired:                { label: "Expired",      className: "bg-gray-100 text-gray-500 border-gray-200",     icon: AlertCircle },
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

function RiskBadge({ score }: { score: string | null }) {
  if (!score) return <span className="text-xs text-text-secondary">—</span>
  const cfg: Record<string, string> = {
    low: "bg-success/10 text-success border-success/20",
    medium: "bg-warning/10 text-warning border-warning/20",
    high: "bg-danger/10 text-danger border-danger/20",
  }
  return (
    <Badge className={cn("text-xs border capitalize", cfg[score] ?? "bg-gray-100 text-gray-600 border-gray-200")}>
      {score}
    </Badge>
  )
}

function ErrorBar({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger text-sm">
      <AlertCircle className="w-4 h-4 shrink-0" />{msg}
    </div>
  )
}

// ── Expanded submission detail ─────────────────────────────────────────────────

function SubmissionDetail({ subId, onDecided }: { subId: string; onDecided: () => void }) {
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
      .catch((e) => setError(e.message ?? "Failed to load submission"))
      .finally(() => setLoading(false))
  }, [subId])

  async function handleDecide() {
    if (assessment.trim().length < 10) { setDecideError("Assessment must be at least 10 characters."); return }
    if ((decision === "reject" || decision === "requires_resubmission") && !reason.trim()) {
      setDecideError("Reason is required when rejecting or requesting resubmission.")
      return
    }
    setSubmitting(true)
    setDecideError(null)
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
    <div className="flex items-center justify-center py-10 gap-2 text-text-secondary text-sm">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading submission…
    </div>
  )
  if (error) return <div className="p-5"><ErrorBar msg={error} /></div>
  if (!detail) return null

  const canDecide = !["approved","rejected","requires_resubmission"].includes(detail.status)

  return (
    <div className="border-t border-border">
      {/* Documents */}
      <div className="px-5 pt-4 pb-2">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-3">
          Documents ({detail.documents.length})
        </p>
        {detail.documents.length === 0 && (
          <p className="text-sm text-text-secondary py-2">No documents uploaded yet.</p>
        )}
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
                href={doc.signed_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-ocean hover:underline shrink-0"
              >
                <Eye className="w-3.5 h-3.5" /> View
              </a>
            </div>
          ))}
        </div>
      </div>

      {/* Reviews */}
      {detail.reviews.length > 0 && (
        <div className="px-5 py-3">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-3">
            Review History
          </p>
          <div className="space-y-2">
            {detail.reviews.map((r) => (
              <div key={r.id} className="p-3 bg-gray-50 rounded-lg border border-border text-sm">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-text-primary">
                    {r.reviewer_name ?? r.reviewer_id.slice(0, 8) + "…"}
                  </span>
                  <div className="flex items-center gap-2">
                    <RiskBadge score={r.risk_score} />
                    <span className="text-xs text-text-secondary">{fmtDate(r.created_at)}</span>
                  </div>
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
        <div className="px-5 py-2">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">Assignment</p>
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
        <div className="px-5 py-4 bg-gray-50/50 border-t border-border space-y-4">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Make Decision</p>

          {/* Decision toggle */}
          <div className="grid grid-cols-3 gap-2">
            {(["approve", "reject", "requires_resubmission"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDecision(d)}
                className={cn(
                  "px-3 py-2 rounded-lg border text-xs font-medium transition-colors capitalize",
                  decision === d
                    ? d === "approve"
                      ? "bg-success text-white border-success"
                      : d === "reject"
                      ? "bg-danger text-white border-danger"
                      : "bg-warning text-white border-warning"
                    : "bg-white text-text-secondary border-border hover:border-gray-300"
                )}
              >
                {d === "requires_resubmission" ? "Requires Resubmission" : d.charAt(0).toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>

          {/* Risk score */}
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

          {/* Flags */}
          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isPep}
                onChange={(e) => setIsPep(e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-sm text-text-primary">PEP (Politically Exposed Person)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={sanctionsMatch}
                onChange={(e) => setSanctionsMatch(e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-sm text-text-primary">Sanctions Match</span>
            </label>
          </div>

          {/* Assessment */}
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

          {/* Reason (required for reject/resubmit) */}
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

// ── Submissions Tab ────────────────────────────────────────────────────────────

const STATUS_TABS = [
  { label: "All",              value: ""                    },
  { label: "Pending Review",   value: "pending_review"      },
  { label: "In Review",        value: "in_review"           },
  { label: "Approved",         value: "approved"            },
  { label: "Rejected",         value: "rejected"            },
  { label: "Requires Resubmit", value: "requires_resubmission" },
]

function SubmissionsTab() {
  const [statusFilter, setStatusFilter] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data, isLoading: loading, error: swrError, mutate } = useAdminKycQueue({
    kyc_status: statusFilter || undefined,
    page,
    page_size: 20,
  })
  const items = data?.items ?? []
  const total = data?.total ?? 0
  const pages = data?.pages ?? 1
  const error = swrError?.message ?? null

  const filtered = search.trim()
    ? items.filter((s) =>
        (s.buyer_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (s.buyer_company ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : items

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
          <Input
            placeholder="Search by name or company…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-white"
          />
        </div>
        <div className="flex items-center gap-2">
          {total > 0 && (
            <span className="text-sm text-text-secondary">
              <span className="w-2 h-2 rounded-full bg-warning animate-pulse inline-block mr-1.5 align-middle" />
              {total} submission{total !== 1 ? "s" : ""}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => mutate()} disabled={loading} className="gap-1.5">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => { setStatusFilter(tab.value); setExpanded(null); setPage(1) }}
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

      {error && <ErrorBar msg={error} />}

      {/* List */}
      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center py-16 gap-2 text-text-secondary text-sm">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading submissions…
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-border p-12 text-center">
          <ShieldCheck className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-text-secondary">No submissions found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((sub) => {
            const isOpen = expanded === sub.id
            return (
              <div key={sub.id} className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
                {/* Header row */}
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
                      {sub.assigned_agent && ` · Agent: ${sub.assigned_agent}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right hidden sm:block">
                      <p className="text-xs text-text-secondary">{sub.document_count} doc{sub.document_count !== 1 ? "s" : ""}</p>
                      {sub.risk_score && <RiskBadge score={sub.risk_score} />}
                    </div>
                    <StatusBadge status={sub.status} />
                    {isOpen
                      ? <ChevronUp className="w-4 h-4 text-text-secondary" />
                      : <ChevronDown className="w-4 h-4 text-text-secondary" />
                    }
                  </div>
                </div>

                {/* Expanded detail */}
                {isOpen && (
                  <SubmissionDetail subId={sub.id} onDecided={() => mutate()} />
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
            <Button variant="outline" size="sm" onClick={() => setPage((p) => p - 1)} disabled={page <= 1 || loading}>
              Previous
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page >= pages || loading}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Document Types Tab ─────────────────────────────────────────────────────────

function DocumentTypesTab() {
  const [docTypes, setDocTypes] = useState<DocumentTypeResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [description, setDescription] = useState("")
  const [isRequired, setIsRequired] = useState(false)
  const [displayOrder, setDisplayOrder] = useState("0")
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await kycAdmin.listDocumentTypes(true)
      setDocTypes(res)
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "Failed to load document types")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function openNew() {
    setEditId(null)
    setName(""); setSlug(""); setDescription(""); setIsRequired(false); setDisplayOrder("0")
    setFormError(null)
    setShowForm(true)
  }

  function openEdit(dt: DocumentTypeResponse) {
    setEditId(dt.id)
    setName(dt.name); setSlug(dt.slug); setDescription(dt.description ?? "")
    setIsRequired(dt.is_required); setDisplayOrder(String(dt.display_order))
    setFormError(null)
    setShowForm(true)
  }

  async function handleSave() {
    if (!name.trim()) { setFormError("Name is required."); return }
    if (!editId && !slug.trim()) { setFormError("Slug is required."); return }
    setSaving(true)
    setFormError(null)
    try {
      if (editId) {
        await kycAdmin.updateDocumentType(editId, {
          name: name.trim(),
          description: description.trim() || null,
          is_required: isRequired,
          display_order: parseInt(displayOrder) || 0,
        })
      } else {
        await kycAdmin.createDocumentType({
          name: name.trim(),
          slug: slug.trim(),
          description: description.trim() || undefined,
          is_required: isRequired,
          display_order: parseInt(displayOrder) || 0,
        })
      }
      setShowForm(false)
      load()
    } catch (e: unknown) {
      setFormError((e as Error)?.message ?? "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(dt: DocumentTypeResponse) {
    try {
      await kycAdmin.updateDocumentType(dt.id, { is_active: !dt.is_active })
      setDocTypes((prev) => prev.map((d) => d.id === dt.id ? { ...d, is_active: !d.is_active } : d))
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "Failed to update")
    }
  }

  const [seeding, setSeeding] = useState(false)

  async function seedDefaults() {
    const defaults = [
      { name: "Government ID", slug: "government_id", description: "Passport or national identity card", is_required: true, display_order: 1 },
      { name: "Business Registration", slug: "business_registration", description: "Certificate of incorporation or business registration", is_required: true, display_order: 2 },
      { name: "Proof of Address", slug: "proof_of_address", description: "Utility bill or bank statement dated within 3 months", is_required: true, display_order: 3 },
    ]
    setSeeding(true)
    setError(null)
    try {
      for (const dt of defaults) {
        await kycAdmin.createDocumentType(dt)
      }
      load()
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "Failed to seed defaults")
    } finally {
      setSeeding(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-secondary">
          Manage the document types required during KYC submission.
        </p>
        <div className="flex items-center gap-2">
          {!loading && docTypes.length === 0 && (
            <Button onClick={seedDefaults} disabled={seeding} variant="outline" size="sm" className="gap-1.5 text-ocean border-ocean/30 hover:bg-ocean/5">
              {seeding ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              {seeding ? "Seeding…" : "Seed Defaults"}
            </Button>
          )}
          <Button onClick={openNew} size="sm" className="bg-ocean hover:bg-ocean-dark text-white gap-1.5">
            <Plus className="w-4 h-4" /> New Type
          </Button>
        </div>
      </div>

      {error && <ErrorBar msg={error} />}

      {/* Create / Edit form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-border shadow-sm p-5 space-y-4">
          <h3 className="font-semibold text-text-primary">{editId ? "Edit Document Type" : "New Document Type"}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="text-xs font-medium text-text-secondary block mb-1">Name <span className="text-danger">*</span></label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Government ID" />
            </div>
            {!editId && (
              <div className="col-span-2 sm:col-span-1">
                <label className="text-xs font-medium text-text-secondary block mb-1">Slug <span className="text-danger">*</span></label>
                <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="e.g. government_id" className="font-mono" />
              </div>
            )}
            <div className="col-span-2">
              <label className="text-xs font-medium text-text-secondary block mb-1">Description</label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description shown to users" />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">Display Order</label>
              <Input type="number" value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)} />
            </div>
            <div className="flex items-center gap-2 pt-5">
              <input
                type="checkbox"
                id="is_required"
                checked={isRequired}
                onChange={(e) => setIsRequired(e.target.checked)}
                className="rounded border-border"
              />
              <label htmlFor="is_required" className="text-sm text-text-primary">Required document</label>
            </div>
          </div>
          {formError && <ErrorBar msg={formError} />}
          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={saving} className="bg-ocean hover:bg-ocean-dark text-white gap-1.5">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button variant="outline" onClick={() => setShowForm(false)} disabled={saving}>Cancel</Button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-12 gap-2 text-text-secondary text-sm">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-text-secondary uppercase tracking-wide hidden sm:table-cell">Slug</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">Required</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">Order</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">Active</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {docTypes.map((dt) => (
                <tr key={dt.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-text-primary">{dt.name}</p>
                    {dt.description && <p className="text-xs text-text-secondary">{dt.description}</p>}
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-text-secondary hidden sm:table-cell">{dt.slug}</td>
                  <td className="px-4 py-3">
                    {dt.is_required
                      ? <span className="text-xs text-success font-medium">Yes</span>
                      : <span className="text-xs text-text-secondary">No</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{dt.display_order}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleActive(dt)} className="text-text-secondary hover:text-text-primary transition-colors">
                      {dt.is_active
                        ? <ToggleRight className="w-5 h-5 text-success" />
                        : <ToggleLeft className="w-5 h-5 text-gray-300" />
                      }
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(dt)} className="h-7 px-2 text-xs gap-1">
                      <Settings2 className="w-3.5 h-3.5" /> Edit
                    </Button>
                  </td>
                </tr>
              ))}
              {docTypes.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-text-secondary text-sm">
                    No document types configured yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

type PageTab = "submissions" | "doc_types"

export default function AdminKYCPage() {
  const [tab, setTab] = useState<PageTab>("submissions")

  const PAGE_TABS: { value: PageTab; label: string; icon: React.ElementType }[] = [
    { value: "submissions", label: "Submissions",     icon: ShieldCheck  },
    { value: "doc_types",   label: "Document Types",  icon: Tag          },
  ]

  return (
    <div className="space-y-5">
      {/* Page-level tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {PAGE_TABS.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                tab === t.value ? "bg-white text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"
              )}
            >
              <Icon className="w-4 h-4" />{t.label}
            </button>
          )
        })}
      </div>

      {tab === "submissions" && <SubmissionsTab />}
      {tab === "doc_types"   && <DocumentTypesTab />}
    </div>
  )
}
