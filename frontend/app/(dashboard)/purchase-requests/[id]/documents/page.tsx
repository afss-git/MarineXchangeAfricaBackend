"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import Link from "next/link"
import {
  ChevronLeft, Upload, CheckCircle2, XCircle, AlertCircle,
  FileText, Loader2, FileQuestion,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { prBuyer, PRDocRequest } from "@/lib/api"

const ACCEPTED = ".jpg,.jpeg,.png,.webp,.pdf"
const MAX_MB   = 10

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface UploadState {
  file:     File | null
  status:   "idle" | "uploading" | "done" | "error"
  error:    string | null
}

function DocUploadCard({
  req,
  requestId,
  onFulfilled,
}: {
  req:        PRDocRequest
  requestId:  string
  onFulfilled: (updated: PRDocRequest) => void
}) {
  const inputRef              = useRef<HTMLInputElement>(null)
  const [state, setState]     = useState<UploadState>({ file: null, status: "idle", error: null })

  // If already fulfilled, show completed state
  if (req.status === "uploaded") {
    return (
      <div className="bg-white rounded-xl border border-success/30 p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5 text-success" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-text-primary">{req.document_name}</p>
            {req.reason && <p className="text-xs text-text-secondary mt-0.5">{req.reason}</p>}
            <p className="text-xs text-success mt-1 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Uploaded: {req.file_name}
            </p>
          </div>
          <Badge className="bg-success/10 text-success border-success/20 text-xs border">Uploaded</Badge>
        </div>
      </div>
    )
  }

  if (req.status === "waived") {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm opacity-60">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
            <XCircle className="w-5 h-5 text-text-secondary" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-text-primary">{req.document_name}</p>
            {req.waive_reason && <p className="text-xs text-text-secondary mt-0.5">Waived: {req.waive_reason}</p>}
          </div>
          <Badge className="bg-gray-100 text-text-secondary border-gray-200 text-xs border">Waived</Badge>
        </div>
      </div>
    )
  }

  function handleSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > MAX_MB * 1024 * 1024) {
      setState({ file: null, status: "error", error: `File too large. Maximum is ${MAX_MB} MB.` })
      return
    }
    setState({ file, status: "idle", error: null })
  }

  async function handleUpload() {
    if (!state.file) return
    setState((s) => ({ ...s, status: "uploading", error: null }))
    try {
      const updated = await prBuyer.fulfillDocumentRequest(requestId, req.id, state.file)
      setState({ file: null, status: "done", error: null })
      onFulfilled(updated)
    } catch (e: unknown) {
      setState((s) => ({ ...s, status: "error", error: (e as Error)?.message ?? "Upload failed. Please try again." }))
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (file.size > MAX_MB * 1024 * 1024) {
      setState({ file: null, status: "error", error: `File too large. Maximum is ${MAX_MB} MB.` })
      return
    }
    setState({ file, status: "idle", error: null })
  }

  return (
    <div className="bg-white rounded-xl border border-border p-5 shadow-sm space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-warning/10 flex items-center justify-center shrink-0">
          <FileQuestion className="w-5 h-5 text-warning" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-text-primary">{req.document_name}</p>
            <Badge className={cn(
              "text-xs border capitalize",
              req.priority === "required"
                ? "bg-danger/10 text-danger border-danger/20"
                : "bg-warning/10 text-warning border-warning/20"
            )}>
              {req.priority}
            </Badge>
          </div>
          {req.reason && <p className="text-xs text-text-secondary mt-0.5">{req.reason}</p>}
        </div>
      </div>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors",
          state.file ? "border-ocean bg-ocean/5" : "border-border hover:border-ocean/50 hover:bg-gray-50"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          onChange={handleSelect}
          className="hidden"
        />
        {state.file ? (
          <>
            <FileText className="w-8 h-8 text-ocean" />
            <p className="text-sm font-medium text-text-primary text-center">{state.file.name}</p>
            <p className="text-xs text-text-secondary">{fmtSize(state.file.size)}</p>
            <button
              onClick={(e) => { e.stopPropagation(); setState({ file: null, status: "idle", error: null }) }}
              className="text-xs text-danger hover:underline mt-1"
            >
              Remove
            </button>
          </>
        ) : (
          <>
            <Upload className="w-8 h-8 text-text-secondary" />
            <p className="text-sm text-text-secondary text-center">
              <span className="font-medium text-ocean">Click to browse</span> or drag and drop
            </p>
            <p className="text-xs text-text-secondary">JPEG, PNG, WebP, PDF — max {MAX_MB} MB</p>
          </>
        )}
      </div>

      {/* Error */}
      {state.error && (
        <div className="flex items-center gap-2 p-3 bg-danger/10 border border-danger/20 rounded-lg text-danger text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />{state.error}
        </div>
      )}

      {/* Upload button */}
      <Button
        onClick={handleUpload}
        disabled={!state.file || state.status === "uploading"}
        className="w-full bg-ocean hover:bg-ocean-dark text-white gap-2"
      >
        {state.status === "uploading"
          ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</>
          : <><Upload className="w-4 h-4" /> Upload Document</>}
      </Button>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PRDocumentsPage() {
  const { id }      = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const router      = useRouter()
  const focusReqId  = searchParams.get("req")

  const [requests, setRequests] = useState<PRDocRequest[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await prBuyer.listDocumentRequests(id)
      setRequests(data)
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "Failed to load document requests.")
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  function handleFulfilled(updated: PRDocRequest) {
    setRequests((prev) => prev.map((r) => r.id === updated.id ? updated : r))
  }

  const pending   = requests.filter(r => r.status === "pending")
  const completed = requests.filter(r => r.status !== "pending")
  const allDone   = pending.length === 0 && requests.length > 0

  // Sort: if focusReqId passed, put that one first
  const sorted = focusReqId
    ? [...requests].sort((a, b) => (a.id === focusReqId ? -1 : b.id === focusReqId ? 1 : 0))
    : requests

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/purchase-requests/${id}`}
          className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-ocean transition-colors"
        >
          <ChevronLeft className="w-4 h-4" /> Back to Request
        </Link>
      </div>

      <div>
        <h1 className="text-xl font-bold text-text-primary">Upload Required Documents</h1>
        <p className="text-sm text-text-secondary mt-1">
          Your agent has requested the following documents to process your purchase request.
          Upload each one using the form below.
        </p>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-text-secondary py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading document requests…
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      {!loading && !error && requests.length === 0 && (
        <div className="text-center py-12 text-text-secondary text-sm">
          No document requests found for this purchase request.
        </div>
      )}

      {allDone && (
        <div className="bg-success/5 border border-success/20 rounded-xl p-5 flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center">
            <CheckCircle2 className="w-6 h-6 text-success" />
          </div>
          <div>
            <p className="text-base font-semibold text-success">All documents uploaded!</p>
            <p className="text-sm text-text-secondary mt-1">
              Your agent will review them and continue processing your request.
            </p>
          </div>
          <Button
            onClick={() => router.push(`/purchase-requests/${id}`)}
            className="bg-success hover:bg-success/90 text-white mt-1"
          >
            Back to Request
          </Button>
        </div>
      )}

      {!loading && !allDone && (
        <>
          {/* Progress bar */}
          {requests.length > 0 && (
            <div className="bg-white rounded-xl border border-border p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Progress</p>
                <p className="text-xs text-text-secondary">
                  {completed.length} / {requests.length} uploaded
                </p>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div
                  className="bg-ocean h-2 rounded-full transition-all"
                  style={{ width: `${(completed.length / requests.length) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Pending documents first */}
          {pending.length > 0 && (
            <div className="space-y-4">
              <p className="text-sm font-semibold text-text-primary">
                Pending ({pending.length})
              </p>
              {sorted
                .filter(r => r.status === "pending")
                .map(req => (
                  <DocUploadCard
                    key={req.id}
                    req={req}
                    requestId={id}
                    onFulfilled={handleFulfilled}
                  />
                ))}
            </div>
          )}

          {/* Completed / waived */}
          {completed.length > 0 && (
            <div className="space-y-4">
              <p className="text-sm font-semibold text-text-secondary">
                Completed ({completed.length})
              </p>
              {sorted
                .filter(r => r.status !== "pending")
                .map(req => (
                  <DocUploadCard
                    key={req.id}
                    req={req}
                    requestId={id}
                    onFulfilled={handleFulfilled}
                  />
                ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
