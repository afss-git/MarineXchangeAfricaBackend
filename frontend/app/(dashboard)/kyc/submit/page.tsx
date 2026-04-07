"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  ChevronRight,
  Upload,
  ShieldCheck,
  Lock,
  FileText,
  X,
  CheckCircle2,
  ArrowRight,
  AlertCircle,
  Loader2,
  RefreshCw,
  Send,
  FileQuestion,
  XCircle,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  kyc as kycApi,
  kycBuyer,
  type KycDocument,
  type DocumentRequestResponse,
  ApiRequestError,
} from "@/lib/api"

// ── Request Slot — one slot per agent-requested document ─────────────────────

interface RequestSlotProps {
  request: DocumentRequestResponse
  uploaded: KycDocument | undefined
  verificationStatus?: "verified" | "rejected" | "needs_clarification" | null
  onUpload: (requestId: string, file: File) => Promise<void>
  onDelete: (docId: string, requestId: string) => Promise<void>
  onReplace: (requestId: string, file: File) => Promise<void>
  uploading: boolean
  deleting: boolean
  replacing: boolean
}

function RequestSlot({ request, uploaded, verificationStatus, onUpload, onDelete, onReplace, uploading, deleting, replacing }: RequestSlotProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const replaceRef = useRef<HTMLInputElement>(null)

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await onUpload(request.id, file)
    if (fileRef.current) fileRef.current.value = ""
  }

  const handleReplaceChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await onReplace(request.id, file)
    if (replaceRef.current) replaceRef.current.value = ""
  }

  const isUploaded = request.status === "uploaded" || !!uploaded
  const isVerified = verificationStatus === "verified"
  const isRejected = verificationStatus === "rejected"
  const needsInfo = verificationStatus === "needs_clarification"

  const headerBorderCls = isVerified
    ? "border-success/20"
    : isRejected
    ? "border-danger/20"
    : needsInfo
    ? "border-warning/20"
    : "border-border"

  return (
    <div className={cn("bg-white rounded-xl border shadow-sm overflow-hidden", headerBorderCls)}>
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
        <FileQuestion className="w-4 h-4 text-ocean shrink-0" />
        <h3 className="text-sm font-semibold text-text-primary flex-1">{request.document_type_name}</h3>
        <Badge
          className={cn(
            "text-xs border shrink-0",
            isVerified
              ? "bg-success/10 text-success border-success/20"
              : isRejected
              ? "bg-danger/10 text-danger border-danger/20"
              : needsInfo
              ? "bg-warning/10 text-warning border-warning/20"
              : isUploaded
              ? "bg-success/10 text-success border-success/20"
              : request.priority === "required"
              ? "bg-danger/10 text-danger border-danger/20"
              : "bg-warning/10 text-warning border-warning/20"
          )}
        >
          {isVerified ? "Verified" : isRejected ? "Rejected — Re-upload" : needsInfo ? "Needs Clarification" : isUploaded ? "Uploaded" : request.priority}
        </Badge>
      </div>

      <div className="p-5 space-y-3">
        {request.reason && (
          <p className="text-xs text-text-secondary flex items-start gap-1.5">
            <span className="text-ocean mt-0.5">•</span>
            {request.reason}
          </p>
        )}

        {/* Rejection / needs-info banner */}
        {isRejected && (
          <div className="flex items-start gap-2 p-3 bg-danger/5 border border-danger/20 rounded-lg text-danger text-xs">
            <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>This document was <strong>rejected</strong> by your verification agent. Delete the existing file and upload a corrected version.</span>
          </div>
        )}
        {needsInfo && (
          <div className="flex items-start gap-2 p-3 bg-warning/5 border border-warning/20 rounded-lg text-warning text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Your agent needs clarification on this document. You may replace it with a clearer version.</span>
          </div>
        )}

        {uploaded ? (
          <div className={cn(
            "flex items-center gap-3 p-3 rounded-lg border",
            isVerified
              ? "bg-success/5 border-success/20"
              : isRejected
              ? "bg-danger/5 border-danger/20"
              : needsInfo
              ? "bg-warning/5 border-warning/20"
              : "bg-success/5 border-success/20"
          )}>
            <FileText className={cn("w-5 h-5 shrink-0", isRejected ? "text-danger" : needsInfo ? "text-warning" : "text-success")} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">{uploaded.original_name ?? request.document_type_name}</p>
              <p className="text-xs text-text-secondary">
                {new Date(uploaded.uploaded_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </div>
            {isVerified ? (
              /* Verified — locked, cannot replace */
              <div className="flex items-center gap-1.5 text-success shrink-0">
                <CheckCircle2 className="w-4 h-4" />
                <Lock className="w-3.5 h-3.5 opacity-60" title="Verified documents cannot be removed" />
              </div>
            ) : (isRejected || needsInfo) ? (
              /* Rejected / needs-info — single "Replace" button via new endpoint */
              <>
                {isRejected
                  ? <XCircle className="w-5 h-5 text-danger shrink-0" />
                  : <AlertCircle className="w-5 h-5 text-warning shrink-0" />
                }
                <input
                  ref={replaceRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  className="hidden"
                  onChange={handleReplaceChange}
                />
                <button
                  onClick={() => replaceRef.current?.click()}
                  disabled={replacing}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50",
                    isRejected
                      ? "bg-danger/10 text-danger border-danger/20 hover:bg-danger/20"
                      : "bg-warning/10 text-warning border-warning/20 hover:bg-warning/20"
                  )}
                >
                  {replacing ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : <RefreshCw className="w-3.5 h-3.5 inline mr-1" />}
                  {replacing ? "Uploading…" : "Replace"}
                </button>
              </>
            ) : (
              /* Normal upload (no verdict yet) — allow delete */
              <>
                <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
                <button
                  onClick={() => onDelete(uploaded.id, request.id)}
                  disabled={deleting}
                  className="p-1 rounded-md text-text-secondary hover:text-danger hover:bg-danger/5 transition-colors disabled:opacity-50"
                  title="Remove file"
                >
                  {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                </button>
              </>
            )}
          </div>
        ) : request.status === "waived" ? (
          <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-text-secondary">
            This document has been waived by your verification agent.
          </div>
        ) : (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              className="hidden"
              onChange={handleChange}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="w-full border-2 border-dashed border-border rounded-xl p-6 hover:border-ocean hover:bg-ocean/5 transition-colors group text-center disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-7 h-7 text-ocean mx-auto mb-2 animate-spin" />
                  <p className="text-sm text-text-secondary">Uploading…</p>
                </>
              ) : (
                <>
                  <Upload className="w-7 h-7 text-text-secondary group-hover:text-ocean mx-auto mb-2 transition-colors" />
                  <p className="text-sm font-medium text-text-primary">Click to browse or drag & drop</p>
                  <p className="text-xs text-text-secondary mt-1">PDF, JPG, PNG — max 10MB</p>
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function KYCSubmitPage() {
  const router = useRouter()

  const [requests, setRequests] = useState<DocumentRequestResponse[]>([])
  const [myDocs, setMyDocs] = useState<KycDocument[]>([])
  const [statusDocs, setStatusDocs] = useState<KycDocument[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // uploadingId = request.id, deletingId = doc.id, replacingId = request.id
  const [uploadingId, setUploadingId]   = useState<string | null>(null)
  const [deletingId, setDeletingId]     = useState<string | null>(null)
  const [replacingId, setReplacingId]   = useState<string | null>(null)
  const [uploadError, setUploadError]   = useState<string | null>(null)

  const [submitting, setSubmitting]     = useState(false)
  const [submitSuccess, setSubmitSuccess] = useState(false)
  const [submitError, setSubmitError]   = useState<string | null>(null)
  const [isResubmit, setIsResubmit]     = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const [reqs, docs, status] = await Promise.allSettled([
        kycApi.listDocumentRequests(),
        kycApi.listDocuments(),
        kycApi.getStatus(),
      ])
      if (reqs.status === "fulfilled")   setRequests(reqs.value)
      if (docs.status === "fulfilled")   setMyDocs(docs.value)
      if (status.status === "fulfilled") {
        const s = status.value
        setIsResubmit(["rejected", "requires_resubmission"].includes(s?.kyc_status ?? ""))
        setStatusDocs(s?.documents ?? [])
      }
    } catch (e) {
      setLoadError(e instanceof ApiRequestError ? e.message : "Failed to load KYC data.")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Upload file, then fulfill the request
  const handleUpload = async (requestId: string, file: File) => {
    setUploadingId(requestId)
    setUploadError(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const doc = await kycApi.uploadDocument(fd)
      // Link the uploaded doc to the request
      await kycApi.fulfillDocumentRequest(requestId, doc.id)
      setMyDocs((prev) => [...prev, doc])
      setRequests((prev) => prev.map((r) => r.id === requestId ? { ...r, status: "uploaded" as const, fulfilled_doc_id: doc.id } : r))
    } catch (e) {
      setUploadError(e instanceof ApiRequestError ? e.message : "Upload failed.")
    } finally {
      setUploadingId(null)
    }
  }

  const handleReplace = async (requestId: string, file: File) => {
    setReplacingId(requestId)
    setUploadError(null)
    try {
      const newDoc = await kycBuyer.replaceDocumentForRequest(requestId, file)
      setMyDocs((prev) => {
        const req = requests.find((r) => r.id === requestId)
        const oldDocId = req?.fulfilled_doc_id
        return [...prev.filter((d) => d.id !== oldDocId), newDoc]
      })
      setRequests((prev) => prev.map((r) =>
        r.id === requestId ? { ...r, status: "uploaded" as const, fulfilled_doc_id: newDoc.id } : r
      ))
      setStatusDocs((prev) => {
        const req = requests.find((r) => r.id === requestId)
        const oldDocId = req?.fulfilled_doc_id
        return [...prev.filter((d) => d.id !== oldDocId), newDoc]
      })
    } catch (e) {
      setUploadError(e instanceof ApiRequestError ? e.message : "Replace failed.")
    } finally {
      setReplacingId(null)
    }
  }

  const handleDelete = async (docId: string, requestId: string) => {
    setDeletingId(docId)
    setUploadError(null)
    try {
      await kycApi.deleteDocument(docId)
      setMyDocs((prev) => prev.filter((d) => d.id !== docId))
      setRequests((prev) => prev.map((r) => r.id === requestId ? { ...r, status: "pending" as const, fulfilled_doc_id: null } : r))
    } catch (e) {
      setUploadError(e instanceof ApiRequestError ? e.message : "Delete failed.")
    } finally {
      setDeletingId(null)
    }
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    setSubmitError(null)
    try {
      if (isResubmit) {
        await kycApi.resubmit()
      } else {
        await kycApi.submit()
      }
      setSubmitSuccess(true)
      setTimeout(() => router.push("/kyc"), 2000)
    } catch (e) {
      setSubmitError(e instanceof ApiRequestError ? e.message : "Submission failed.")
    } finally {
      setSubmitting(false)
    }
  }

  // Only pending/required requests block submission
  const activeRequests  = requests.filter((r) => r.status !== "waived")
  const requiredPending = requests.filter((r) => r.priority === "required" && r.status === "pending")
  const allRequiredDone = requiredPending.length === 0
  const uploadedCount   = requests.filter((r) => r.status === "uploaded").length
  const totalActive     = activeRequests.length

  // ── Loading ───────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-ocean animate-spin" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="max-w-3xl space-y-4">
        <div className="flex items-center gap-3 p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="text-sm">{loadError}</span>
          <Button variant="outline" size="sm" onClick={load} className="ml-auto border-danger/30 text-danger">
            <RefreshCw className="w-4 h-4 mr-1.5" /> Retry
          </Button>
        </div>
      </div>
    )
  }

  // ── Success ───────────────────────────────────────────────────────────────────

  if (submitSuccess) {
    return (
      <div className="max-w-3xl">
        <div className="flex items-center gap-4 p-6 bg-success/10 border border-success/20 rounded-xl">
          <CheckCircle2 className="w-10 h-10 text-success shrink-0" />
          <div>
            <p className="font-semibold text-text-primary">
              {isResubmit ? "Resubmission received!" : "Documents submitted!"}
            </p>
            <p className="text-sm text-text-secondary mt-0.5">
              Your verification agent will review your documents shortly. Redirecting…
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Breadcrumb */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex items-center gap-1 text-sm text-text-secondary">
          <Link href="/kyc" className="hover:text-ocean transition-colors">KYC</Link>
          <ChevronRight className="w-4 h-4" />
          <span className="text-text-primary font-medium">
            {isResubmit ? "Resubmit Documents" : "Upload Documents"}
          </span>
        </nav>
        {totalActive > 0 && (
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <div className="flex gap-1">
              <div className="w-6 h-1.5 rounded-full bg-ocean" />
              <div className="w-6 h-1.5 rounded-full bg-gray-200" />
            </div>
            <span>{uploadedCount}/{totalActive} uploaded</span>
          </div>
        )}
      </div>

      {/* Security intro */}
      <div className="bg-ocean/5 border border-ocean/20 rounded-xl p-5 flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-ocean/10 flex items-center justify-center shrink-0 mt-0.5">
          <ShieldCheck className="w-5 h-5 text-ocean" />
        </div>
        <div>
          <p className="font-semibold text-text-primary">Upload Requested Documents</p>
          <p className="text-sm text-text-secondary mt-1 leading-relaxed">
            Your verification agent has requested the documents below. Upload each one to proceed.
            All files are encrypted and only accessible to your assigned agent.
          </p>
        </div>
      </div>

      {/* Progress bar */}
      {totalActive > 0 && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-ocean rounded-full transition-all duration-500"
              style={{ width: `${(uploadedCount / totalActive) * 100}%` }}
            />
          </div>
          <span className="text-sm text-text-secondary shrink-0">{uploadedCount}/{totalActive} uploaded</span>
        </div>
      )}

      {/* Upload error */}
      {uploadError && (
        <div className="flex items-center gap-2 p-3 bg-danger/10 border border-danger/20 rounded-lg text-danger text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {uploadError}
          <button onClick={() => setUploadError(null)} className="ml-auto"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* No requests yet */}
      {requests.length === 0 && (
        <div className="text-center py-12 bg-white rounded-xl border border-border">
          <FileQuestion className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="font-medium text-text-secondary">No documents requested yet</p>
          <p className="text-sm text-text-secondary mt-1">Your verification agent hasn&apos;t requested any documents yet. Check back soon.</p>
          <Link href="/kyc" className="inline-block mt-4">
            <Button variant="outline" size="sm">Back to KYC</Button>
          </Link>
        </div>
      )}

      {/* Request slots */}
      <div className="space-y-4">
        {activeRequests.map((req) => {
          const fulfilledDoc = myDocs.find((d) => d.id === req.fulfilled_doc_id)
          const verificationStatus =
            (statusDocs.find((d) => d.id === req.fulfilled_doc_id) ?? fulfilledDoc)
              ?.verification?.status ?? null
          return (
            <RequestSlot
              key={req.id}
              request={req}
              uploaded={fulfilledDoc}
              verificationStatus={verificationStatus}
              onUpload={handleUpload}
              onDelete={handleDelete}
              onReplace={handleReplace}
              uploading={uploadingId === req.id}
              deleting={deletingId === (fulfilledDoc?.id ?? "")}
              replacing={replacingId === req.id}
            />
          )
        })}
      </div>

      {requests.length > 0 && (
        <>
          {/* Security note */}
          <div className="flex items-center gap-2 text-sm text-text-secondary px-1">
            <Lock className="w-4 h-4 text-ocean shrink-0" />
            <span>Files are uploaded over a 256-bit encrypted connection and stored in secure cloud storage</span>
          </div>

          {/* Submit error */}
          {submitError && (
            <div className="flex items-center gap-2 p-3 bg-danger/10 border border-danger/20 rounded-lg text-danger text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {submitError}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-between pt-2">
            <Link href="/kyc">
              <Button variant="outline">Back to KYC</Button>
            </Link>
            <Button
              className="bg-ocean hover:bg-ocean-dark text-white h-12 px-8"
              disabled={!allRequiredDone || submitting}
              onClick={handleSubmit}
            >
              {submitting
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting…</>
                : <><Send className="w-4 h-4 mr-2" />{isResubmit ? "Resubmit for Verification" : "Submit for Verification"}<ArrowRight className="w-4 h-4 ml-2" /></>
              }
            </Button>
          </div>

          {!allRequiredDone && (
            <p className="text-xs text-center text-text-secondary">
              Upload all required documents to enable submission
            </p>
          )}
        </>
      )}
    </div>
  )
}
