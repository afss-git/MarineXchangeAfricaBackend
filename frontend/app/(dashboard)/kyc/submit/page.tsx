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
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  kyc as kycApi,
  type KycDocument,
  type DocumentTypeResponse,
  ApiRequestError,
} from "@/lib/api"

// KycStatusResponse shape: { status: string, ... }

// ── Document Slot ─────────────────────────────────────────────────────────────

interface SlotProps {
  docType: DocumentTypeResponse
  uploaded: KycDocument | undefined
  onUpload: (typeId: string, file: File) => Promise<void>
  onDelete: (docId: string) => Promise<void>
  uploading: boolean
  deleting: boolean
}

function DocSlot({ docType, uploaded, onUpload, onDelete, uploading, deleting }: SlotProps) {
  const fileRef = useRef<HTMLInputElement>(null)

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await onUpload(docType.id, file)
    if (fileRef.current) fileRef.current.value = ""
  }

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
        <h3 className="text-sm font-semibold text-text-primary flex-1">{docType.name}</h3>
        <Badge
          className={cn(
            "text-xs border shrink-0",
            docType.is_required
              ? "bg-danger/10 text-danger border-danger/20"
              : "bg-gray-100 text-text-secondary border-gray-200"
          )}
        >
          {docType.is_required ? "Required" : "Optional"}
        </Badge>
      </div>

      <div className="p-5 space-y-3">
        {docType.description && (
          <p className="text-xs text-text-secondary flex items-start gap-1.5">
            <span className="text-ocean mt-0.5">•</span>
            {docType.description}
          </p>
        )}

        {uploaded ? (
          <div className="flex items-center gap-3 p-3 bg-success/5 border border-success/20 rounded-lg">
            <FileText className="w-5 h-5 text-success shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">{uploaded.original_name ?? uploaded.document_type_name}</p>
              <p className="text-xs text-text-secondary">
                {new Date(uploaded.uploaded_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </div>
            <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
            <button
              onClick={() => onDelete(uploaded.id)}
              disabled={deleting}
              className="p-1 rounded-md text-text-secondary hover:text-danger hover:bg-danger/5 transition-colors disabled:opacity-50"
              title="Remove file"
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
            </button>
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

  const [docTypes, setDocTypes] = useState<DocumentTypeResponse[]>([])
  const [myDocs, setMyDocs] = useState<KycDocument[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [submitSuccess, setSubmitSuccess] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Track if user already has an existing KYC (for resubmit vs submit)
  const [isResubmit, setIsResubmit] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const [types, docs, status] = await Promise.allSettled([
        kycApi.getDocumentTypes(),
        kycApi.listDocuments(),
        kycApi.getStatus(),
      ])
      if (types.status === "fulfilled") setDocTypes(types.value)
      if (docs.status === "fulfilled") setMyDocs(docs.value)
      if (status.status === "fulfilled") {
        const s = status.value
        // If already has rejected or requires_resubmission, use resubmit endpoint
        setIsResubmit(["rejected", "requires_resubmission"].includes(s?.status ?? ""))
      }
    } catch (e) {
      setLoadError(e instanceof ApiRequestError ? e.message : "Failed to load KYC data.")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleUpload = async (typeId: string, file: File) => {
    setUploadingId(typeId)
    setUploadError(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("document_type_id", typeId)
      const doc = await kycApi.uploadDocument(fd)
      setMyDocs((prev) => {
        // Replace existing doc for same type if any
        const filtered = prev.filter((d) => d.document_type_id !== typeId)
        return [...filtered, doc]
      })
    } catch (e) {
      setUploadError(e instanceof ApiRequestError ? e.message : "Upload failed.")
    } finally {
      setUploadingId(null)
    }
  }

  const handleDelete = async (docId: string) => {
    setDeletingId(docId)
    setUploadError(null)
    try {
      await kycApi.deleteDocument(docId)
      setMyDocs((prev) => prev.filter((d) => d.id !== docId))
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

  // Compute upload stats
  const requiredTypes = docTypes.filter((t) => t.is_required)
  const uploadedTypeIds = new Set(myDocs.map((d) => d.document_type_id))
  const allRequiredUploaded = requiredTypes.every((t) => uploadedTypeIds.has(t.id))
  const uploadedCount = myDocs.length
  const totalCount = docTypes.length

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
              Our KYC team will review your documents within 1–3 business days. Redirecting…
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Breadcrumb + step indicator */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex items-center gap-1 text-sm text-text-secondary">
          <Link href="/kyc" className="hover:text-ocean transition-colors">KYC</Link>
          <ChevronRight className="w-4 h-4" />
          <span className="text-text-primary font-medium">
            {isResubmit ? "Resubmit Documents" : "Submit Documents"}
          </span>
        </nav>
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <div className="flex gap-1">
            <div className="w-6 h-1.5 rounded-full bg-ocean" />
            <div className="w-6 h-1.5 rounded-full bg-gray-200" />
          </div>
          <span>Step 1 of 2 — Documents</span>
        </div>
      </div>

      {/* Security intro */}
      <div className="bg-ocean/5 border border-ocean/20 rounded-xl p-5 flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-ocean/10 flex items-center justify-center shrink-0 mt-0.5">
          <ShieldCheck className="w-5 h-5 text-ocean" />
        </div>
        <div>
          <p className="font-semibold text-text-primary">Secure Document Submission</p>
          <p className="text-sm text-text-secondary mt-1 leading-relaxed">
            All documents are encrypted and stored securely. Only our verified KYC team can access your documents.
            Your data is never shared with buyers or sellers on the platform.
          </p>
        </div>
      </div>

      {/* Progress bar */}
      {totalCount > 0 && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-ocean rounded-full transition-all duration-500"
              style={{ width: `${totalCount > 0 ? (uploadedCount / totalCount) * 100 : 0}%` }}
            />
          </div>
          <span className="text-sm text-text-secondary shrink-0">{uploadedCount}/{totalCount} uploaded</span>
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

      {/* Empty doc types */}
      {docTypes.length === 0 && (
        <div className="text-center py-10 text-text-secondary text-sm">
          No document types configured yet. Contact support.
        </div>
      )}

      {/* Document slots */}
      <div className="space-y-4">
        {docTypes.map((dt) => (
          <DocSlot
            key={dt.id}
            docType={dt}
            uploaded={myDocs.find((d) => d.document_type_id === dt.id)}
            onUpload={handleUpload}
            onDelete={handleDelete}
            uploading={uploadingId === dt.id}
            deleting={deletingId === myDocs.find((d) => d.document_type_id === dt.id)?.id}
          />
        ))}
      </div>

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
          disabled={!allRequiredUploaded || submitting}
          onClick={handleSubmit}
        >
          {submitting
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting…</>
            : <><Send className="w-4 h-4 mr-2" />{isResubmit ? "Resubmit for Verification" : "Submit for Verification"}<ArrowRight className="w-4 h-4 ml-2" /></>
          }
        </Button>
      </div>

      {!allRequiredUploaded && (
        <p className="text-xs text-center text-text-secondary">
          Upload all required documents to enable submission
        </p>
      )}
    </div>
  )
}
