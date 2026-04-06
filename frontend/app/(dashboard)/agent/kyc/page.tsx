"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  ShieldCheck, Clock, Eye, CheckCircle2, XCircle, RefreshCw,
  ChevronDown, ChevronUp, AlertCircle, Loader2, FileText, User,
  Flag, AlertTriangle, Phone, PhoneCall, FileQuestion,
  ClipboardCheck, Send, X as XIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  kycAgent, KycSubmissionListItem, KycSubmissionResponse,
  KycAgentReviewRequest, KycDocumentResponse,
  ChecklistTemplateItem, DocumentVerificationResponse,
  DocumentRequestResponse, DocumentTypeResponse,
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

const VERIFY_STATUS_COLORS: Record<string, string> = {
  verified: "bg-success/10 text-success border-success/20",
  rejected: "bg-danger/10 text-danger border-danger/20",
  needs_clarification: "bg-warning/10 text-warning border-warning/20",
}

// ── Document Verification Panel ───────────────────────────────────────────────

function DocVerifyPanel({ doc, submissionId, onDone }: {
  doc: KycDocumentResponse
  submissionId: string
  onDone: () => void
}) {
  const [template, setTemplate] = useState<ChecklistTemplateItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [checks, setChecks] = useState<Record<string, { passed: boolean; value?: string }>>({})
  const [extracted, setExtracted] = useState<Record<string, string>>({})
  const [verdict, setVerdict] = useState<"verified" | "rejected" | "needs_clarification">("verified")
  const [rejectionReason, setRejectionReason] = useState("")
  const [notes, setNotes] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    kycAgent.getChecklistTemplate(doc.id)
      .then((r) => {
        setTemplate(r.checklist_template)
        if (r.checklist_template) {
          const init: typeof checks = {}
          r.checklist_template.forEach((item) => { init[item.key] = { passed: false } })
          setChecks(init)
        }
      })
      .catch(() => setTemplate(null))
      .finally(() => setLoading(false))
  }, [doc.id])

  async function handleSubmit() {
    if (verdict === "rejected" && !rejectionReason.trim()) {
      setError("Rejection reason is required.")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const checklistResults = template
        ? Object.entries(checks).reduce((acc, [key, val]) => {
            acc[key] = val
            return acc
          }, {} as Record<string, unknown>)
        : undefined

      await kycAgent.verifyDocument(doc.id, {
        status: verdict,
        checklist_results: checklistResults,
        extracted_data: Object.keys(extracted).length > 0 ? extracted : undefined,
        rejection_reason: verdict === "rejected" ? rejectionReason : undefined,
        notes: notes.trim() || undefined,
      })
      onDone()
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "Failed to submit verification")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="p-4 text-sm text-text-secondary flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading checklist...</div>

  return (
    <div className="p-4 bg-gray-50/50 space-y-4">
      {/* Document view link */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{doc.document_type_name}: {doc.original_name}</p>
        <a href={doc.signed_url} target="_blank" rel="noopener noreferrer"
           className="text-xs text-ocean hover:underline flex items-center gap-1">
          <Eye className="w-3.5 h-3.5" /> Open Document
        </a>
      </div>

      {/* Checklist */}
      {template && template.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Verification Checklist</p>
          <div className="space-y-1.5">
            {template.map((item) => (
              <label key={item.key} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checks[item.key]?.passed ?? false}
                  onChange={(e) => setChecks((prev) => ({
                    ...prev, [item.key]: { ...prev[item.key], passed: e.target.checked },
                  }))}
                  className="mt-0.5 rounded border-border"
                />
                <span className="text-sm text-text-primary">
                  {item.label}
                  {item.required && <span className="text-danger ml-1">*</span>}
                </span>
                {item.type === "date" && (
                  <Input
                    type="date"
                    className="ml-auto w-40 h-7 text-xs"
                    value={checks[item.key]?.value ?? ""}
                    onChange={(e) => setChecks((prev) => ({
                      ...prev, [item.key]: { ...prev[item.key], value: e.target.value },
                    }))}
                  />
                )}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Extracted data */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
          Extracted Data <span className="font-normal">(key info from the document)</span>
        </p>
        <div className="grid grid-cols-2 gap-2">
          {["full_name_on_doc", "id_number", "expiry_date", "issuing_authority"].map((field) => (
            <div key={field}>
              <label className="text-xs text-text-secondary block mb-0.5 capitalize">{field.replace(/_/g, " ")}</label>
              <Input
                className="h-7 text-xs"
                placeholder="..."
                value={extracted[field] ?? ""}
                onChange={(e) => setExtracted((prev) => ({ ...prev, [field]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Verdict */}
      <div>
        <label className="text-xs font-semibold text-text-secondary uppercase tracking-wide block mb-1.5">Document Verdict</label>
        <div className="flex gap-2">
          {(["verified", "rejected", "needs_clarification"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setVerdict(v)}
              className={cn(
                "px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors capitalize",
                verdict === v
                  ? VERIFY_STATUS_COLORS[v]
                  : "bg-white text-text-secondary border-border hover:border-gray-300"
              )}
            >
              {v === "needs_clarification" ? "Needs Clarification" : v}
            </button>
          ))}
        </div>
      </div>

      {verdict === "rejected" && (
        <div>
          <label className="text-xs text-text-secondary block mb-1">Rejection Reason <span className="text-danger">*</span></label>
          <Textarea rows={2} className="text-sm resize-none" placeholder="Why is this document rejected?"
            value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} />
        </div>
      )}

      <div>
        <label className="text-xs text-text-secondary block mb-1">Notes (optional)</label>
        <Textarea rows={2} className="text-sm resize-none" placeholder="Any observations..."
          value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {error && <ErrorBar msg={error} />}

      <div className="flex justify-end">
        <Button size="sm" onClick={handleSubmit} disabled={submitting} className="bg-ocean hover:bg-ocean-dark text-white gap-1.5">
          {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardCheck className="w-3.5 h-3.5" />}
          {submitting ? "Submitting..." : "Submit Verification"}
        </Button>
      </div>
    </div>
  )
}

// ── Call Panel ─────────────────────────────────────────────────────────────────

function CallPanel({ submissionId }: { submissionId: string }) {
  const [agentPhone, setAgentPhone] = useState("")
  const [buyerPhone, setBuyerPhone] = useState("")
  const [calling, setCalling] = useState(false)
  const [callResult, setCallResult] = useState<{ call_id: string } | null>(null)
  const [callOutcome, setCallOutcome] = useState("")
  const [callNotes, setCallNotes] = useState("")
  const [savingNotes, setSavingNotes] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notesSaved, setNotesSaved] = useState(false)

  async function handleCall() {
    if (!agentPhone.trim() || !buyerPhone.trim()) {
      setError("Both phone numbers are required (E.164 format, e.g. +234...).")
      return
    }
    setCalling(true)
    setError(null)
    try {
      const result = await kycAgent.initiateCall(submissionId, {
        agent_phone: agentPhone.trim(),
        buyer_phone: buyerPhone.trim(),
      })
      setCallResult(result)
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "Failed to initiate call")
    } finally {
      setCalling(false)
    }
  }

  async function handleSaveNotes() {
    if (!callResult || !callOutcome) return
    setSavingNotes(true)
    try {
      await kycAgent.saveCallNotes(callResult.call_id, {
        call_outcome: callOutcome,
        call_notes: callNotes.trim() || undefined,
      })
      setNotesSaved(true)
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "Failed to save notes")
    } finally {
      setSavingNotes(false)
    }
  }

  const OUTCOMES = [
    { value: "identity_confirmed", label: "Identity Confirmed" },
    { value: "identity_not_confirmed", label: "Not Confirmed" },
    { value: "additional_info_gathered", label: "Info Gathered" },
    { value: "callback_requested", label: "Callback Requested" },
    { value: "suspicious", label: "Suspicious" },
  ]

  return (
    <div className="p-5 space-y-4">
      <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Verification Call</p>

      {!callResult ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-text-secondary block mb-1">Your Phone (Agent)</label>
              <Input placeholder="+234..." value={agentPhone} onChange={(e) => setAgentPhone(e.target.value)} className="text-sm" />
            </div>
            <div>
              <label className="text-xs text-text-secondary block mb-1">Buyer&apos;s Phone</label>
              <Input placeholder="+234..." value={buyerPhone} onChange={(e) => setBuyerPhone(e.target.value)} className="text-sm" />
            </div>
          </div>
          <p className="text-xs text-text-secondary">
            Your phone will ring first. Once you answer, you&apos;ll be connected to the buyer. Call is recorded with consent notice.
          </p>
          {error && <ErrorBar msg={error} />}
          <Button size="sm" onClick={handleCall} disabled={calling} className="bg-ocean hover:bg-ocean-dark text-white gap-1.5">
            {calling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PhoneCall className="w-3.5 h-3.5" />}
            {calling ? "Connecting..." : "Start Call"}
          </Button>
        </>
      ) : notesSaved ? (
        <div className="flex items-center gap-2 p-3 bg-success/10 border border-success/20 rounded-lg text-success text-sm">
          <CheckCircle2 className="w-4 h-4" /> Call notes saved successfully.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 p-3 bg-ocean/10 border border-ocean/20 rounded-lg text-ocean text-sm">
            <Phone className="w-4 h-4" /> Call initiated. Complete notes after the call ends.
          </div>
          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1.5">Call Outcome</label>
            <div className="flex gap-2 flex-wrap">
              {OUTCOMES.map((o) => (
                <button
                  key={o.value}
                  onClick={() => setCallOutcome(o.value)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors",
                    callOutcome === o.value
                      ? "bg-ocean text-white border-ocean"
                      : "bg-white text-text-secondary border-border hover:border-gray-300"
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-text-secondary block mb-1">Call Notes</label>
            <Textarea rows={3} className="text-sm resize-none" placeholder="What was discussed, key observations..."
              value={callNotes} onChange={(e) => setCallNotes(e.target.value)} />
          </div>
          {error && <ErrorBar msg={error} />}
          <Button size="sm" onClick={handleSaveNotes} disabled={savingNotes || !callOutcome}
            className="bg-ocean hover:bg-ocean-dark text-white gap-1.5">
            {savingNotes ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Save Call Notes
          </Button>
        </div>
      )}
    </div>
  )
}

// ── Document Requests Panel ───────────────────────────────────────────────────

function DocRequestsPanel({ submissionId }: { submissionId: string }) {
  const [requests, setRequests] = useState<DocumentRequestResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [docTypes, setDocTypes] = useState<DocumentTypeResponse[]>([])
  const [selectedType, setSelectedType] = useState("")
  const [reason, setReason] = useState("")
  const [priority, setPriority] = useState<"required" | "recommended">("required")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadRequests = useCallback(() => {
    kycAgent.listDocumentRequests(submissionId)
      .then(setRequests)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [submissionId])

  useEffect(() => {
    loadRequests()
    // Load document types for the dropdown
    fetch("/api/v1/kyc/document-types").then(r => r.json()).then(setDocTypes).catch(() => {})
  }, [loadRequests])

  async function handleRequest() {
    if (!selectedType) { setError("Select a document type."); return }
    setSending(true)
    setError(null)
    try {
      const result = await kycAgent.requestDocuments(submissionId, [{
        document_type_id: selectedType,
        reason: reason.trim() || undefined,
        priority,
      }])
      setRequests((prev) => [...prev, ...result])
      setSelectedType("")
      setReason("")
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "Failed to send request")
    } finally {
      setSending(false)
    }
  }

  async function handleWaive(reqId: string) {
    const waiveReason = prompt("Reason for waiving this request:")
    if (!waiveReason) return
    try {
      const updated = await kycAgent.waiveDocumentRequest(reqId, waiveReason)
      setRequests((prev) => prev.map((r) => r.id === reqId ? updated : r))
    } catch { /* silent */ }
  }

  const REQ_STATUS_COLORS: Record<string, string> = {
    pending: "bg-warning/10 text-warning border-warning/20",
    uploaded: "bg-success/10 text-success border-success/20",
    waived: "bg-gray-100 text-gray-500 border-gray-200",
  }

  return (
    <div className="p-5 space-y-4">
      <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
        Document Requests ({requests.length})
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-text-secondary"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
      ) : (
        <>
          {requests.length > 0 && (
            <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
              {requests.map((req) => (
                <div key={req.id} className="flex items-center gap-3 px-4 py-3 bg-white">
                  <FileQuestion className="w-4 h-4 text-text-secondary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{req.document_type_name}</p>
                    {req.reason && <p className="text-xs text-text-secondary">{req.reason}</p>}
                  </div>
                  <Badge className={cn("text-xs border capitalize", REQ_STATUS_COLORS[req.status] ?? "")}>
                    {req.status}
                  </Badge>
                  <Badge variant="secondary" className="text-xs capitalize">{req.priority}</Badge>
                  {req.status === "pending" && (
                    <button onClick={() => handleWaive(req.id)} className="text-xs text-text-secondary hover:text-danger">
                      Waive
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* New request form */}
          <div className="p-3 bg-gray-50 rounded-lg border border-border space-y-3">
            <p className="text-xs font-medium text-text-secondary">Request a Document</p>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="h-9 rounded-md border border-border px-3 text-sm bg-white"
              >
                <option value="">Select document type...</option>
                {docTypes.map((dt) => (
                  <option key={dt.id} value={dt.id}>{dt.name}</option>
                ))}
              </select>
              <div className="flex gap-2">
                {(["required", "recommended"] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPriority(p)}
                    className={cn(
                      "px-3 py-1.5 rounded-lg border text-xs font-medium capitalize transition-colors flex-1",
                      priority === p
                        ? "bg-ocean text-white border-ocean"
                        : "bg-white text-text-secondary border-border"
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <Input
              placeholder="Reason (why is this document needed?)..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="text-sm"
            />
            {error && <ErrorBar msg={error} />}
            <Button size="sm" onClick={handleRequest} disabled={sending} className="bg-ocean hover:bg-ocean-dark text-white gap-1.5">
              {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Send Request
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Expanded submission detail panel ──────────────────────────────────────────

type TabKey = "documents" | "requests" | "call" | "assessment"

function SubmissionPanel({ sub, onReviewed }: {
  sub: KycSubmissionListItem
  onReviewed: () => void
}) {
  const [detail, setDetail] = useState<KycSubmissionResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [markingInReview, setMarkingInReview] = useState(false)
  const [activeTab, setActiveTab] = useState<TabKey>("documents")

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

  // Per-doc verification
  const [verifyingDocId, setVerifyingDocId] = useState<string | null>(null)
  const [verifications, setVerifications]   = useState<DocumentVerificationResponse[]>([])

  useEffect(() => {
    Promise.all([
      kycAgent.getSubmission(sub.id),
      kycAgent.getVerifications(sub.id).catch(() => [] as DocumentVerificationResponse[]),
    ])
      .then(([detail, verifs]) => {
        setDetail(detail)
        setVerifications(verifs)
      })
      .catch((e) => setError(e.message ?? "Failed to load submission"))
      .finally(() => setLoading(false))
  }, [sub.id])

  async function handleMarkInReview() {
    setMarkingInReview(true)
    try {
      await kycAgent.updateAssignment(sub.id, "in_review")
      setDetail((prev) => prev ? { ...prev, status: "in_review" } : prev)
    } catch {
      // silent
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

  const effectiveRisk = (isPep || sanctionsMatch) ? "high" : riskScore
  const forceReject   = isPep || sanctionsMatch

  if (loading) return (
    <div className="flex items-center justify-center py-10 gap-2 text-text-secondary text-sm border-t border-border">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading...
    </div>
  )
  if (error) return <div className="p-5 border-t border-border"><ErrorBar msg={error} /></div>
  if (!detail) return null

  const alreadyReviewed = detail.reviews.length > 0
  const myReview        = detail.reviews[detail.reviews.length - 1]
  const isInReview      = detail.assignment?.status === "in_review"
  const canReview       = !alreadyReviewed && !["approved","rejected","requires_resubmission"].includes(detail.status)

  const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
    { key: "documents", label: "Documents", icon: FileText },
    { key: "requests",  label: "Requests",  icon: FileQuestion },
    { key: "call",      label: "Call",       icon: Phone },
    { key: "assessment", label: "Assessment", icon: ShieldCheck },
  ]

  function getDocVerification(docId: string) {
    return verifications.find((v) => v.document_id === docId)
  }

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

      {/* Tabs */}
      <div className="flex border-b border-border">
        {TABS.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px",
                activeTab === tab.key
                  ? "border-ocean text-ocean"
                  : "border-transparent text-text-secondary hover:text-text-primary"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
              {tab.key === "documents" && (
                <span className="text-[10px] bg-gray-100 px-1.5 py-0.5 rounded-full">{detail.documents.length}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      {activeTab === "documents" && (
        <div className="px-5 pt-4 pb-3">
          {detail.documents.length === 0
            ? <p className="text-sm text-text-secondary">No documents uploaded.</p>
            : (
              <div className="space-y-2">
                {detail.documents.map((doc) => {
                  const verification = getDocVerification(doc.id)
                  const isVerifying = verifyingDocId === doc.id
                  return (
                    <div key={doc.id} className="rounded-lg border border-border overflow-hidden">
                      <div className="flex items-center gap-3 px-4 py-3 bg-white">
                        <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                          <FileText className="w-4 h-4 text-text-secondary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-text-primary">{doc.document_type_name}</p>
                          <p className="text-xs text-text-secondary">
                            {doc.original_name ?? "—"} · {fileSizeLabel(doc.file_size_bytes)} · {fmtDate(doc.uploaded_at)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {verification ? (
                            <Badge className={cn("text-xs border capitalize", VERIFY_STATUS_COLORS[verification.status] ?? "")}>
                              <CheckCircle2 className="w-3 h-3 mr-1" />
                              {verification.status === "needs_clarification" ? "Needs Info" : verification.status}
                            </Badge>
                          ) : (
                            <Button
                              size="sm" variant="outline"
                              onClick={() => setVerifyingDocId(isVerifying ? null : doc.id)}
                              className="text-xs gap-1"
                            >
                              <ClipboardCheck className="w-3.5 h-3.5" />
                              {isVerifying ? "Cancel" : "Verify"}
                            </Button>
                          )}
                          <a href={doc.signed_url} target="_blank" rel="noopener noreferrer"
                             className="flex items-center gap-1 text-xs text-ocean hover:underline">
                            <Eye className="w-3.5 h-3.5" /> View
                          </a>
                        </div>
                      </div>
                      {isVerifying && (
                        <DocVerifyPanel
                          doc={doc}
                          submissionId={sub.id}
                          onDone={() => {
                            setVerifyingDocId(null)
                            // Reload verifications
                            kycAgent.getVerifications(sub.id).then(setVerifications).catch(() => {})
                          }}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            )
          }
        </div>
      )}

      {activeTab === "requests" && (
        <DocRequestsPanel submissionId={sub.id} />
      )}

      {activeTab === "call" && (
        <CallPanel submissionId={sub.id} />
      )}

      {activeTab === "assessment" && (
        <>
          {/* Previous review */}
          {alreadyReviewed && myReview && (
            <div className="px-5 py-3">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">Your Assessment</p>
              <div className="p-3 bg-success/5 rounded-lg border border-success/20 text-sm space-y-1">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-success" />
                  <span className="font-medium text-success capitalize">
                    {myReview.recommendation.replace(/_/g, " ")}
                  </span>
                  <span className="text-text-secondary">· Risk: <strong className="capitalize">{myReview.risk_score}</strong></span>
                  {myReview.is_pep && <Badge className="bg-warning/10 text-warning border-warning/20 text-xs border">PEP</Badge>}
                  {myReview.sanctions_match && <Badge className="bg-danger/10 text-danger border-danger/20 text-xs border">Sanctions</Badge>}
                </div>
                <p className="text-text-secondary text-xs">{myReview.assessment}</p>
                <p className="text-xs text-text-secondary">{fmtDate(myReview.created_at)}</p>
              </div>
            </div>
          )}

          {/* Review form */}
          {submitted ? (
            <div className="px-5 py-4 bg-success/5">
              <div className="flex items-center gap-2 text-success text-sm font-medium">
                <CheckCircle2 className="w-4 h-4" /> Review submitted. Admin will make the final decision.
              </div>
            </div>
          ) : canReview ? (
            <div className="px-5 py-4 bg-gray-50/50 space-y-4">
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

              <div>
                <label className="text-xs font-medium text-text-secondary block mb-1">
                  Assessment <span className="text-danger">*</span>
                  <span className="font-normal ml-1">(min 10 characters)</span>
                </label>
                <Textarea
                  rows={4}
                  placeholder="Describe your assessment of the documents, identity, and compliance checks performed..."
                  value={assessment}
                  onChange={(e) => setAssessment(e.target.value)}
                  className="text-sm resize-none"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-text-secondary block mb-1">Additional Notes (optional)</label>
                <Textarea
                  rows={2}
                  placeholder="Any other observations..."
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
                  {submitting ? "Submitting..." : "Submit Assessment"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="px-5 py-4 bg-gray-50/50 text-sm text-text-secondary">
              This submission has been decided (<span className="font-medium capitalize">{detail.status.replace(/_/g, " ")}</span>).
            </div>
          )}
        </>
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
          <Loader2 className="w-5 h-5 animate-spin" /> Loading queue...
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
