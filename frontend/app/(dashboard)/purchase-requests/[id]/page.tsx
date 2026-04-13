"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import {
  ChevronLeft, ShieldCheck, Clock, FileText, Lock,
  CheckCircle2, XCircle, Handshake, AlertCircle, Package,
  FileQuestion, Upload, ChevronRight, RotateCcw, Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { purchaseRequests as prApi, prBuyer, PRDocRequest, type PurchaseRequest } from "@/lib/api"

// ── Status config aligned to real backend statuses ────────────────────────────
const STATUS_CFG: Record<string, { label: string; style: string }> = {
  submitted:      { label: "Submitted",      style: "bg-warning/10 text-warning border-warning/20" },
  agent_assigned: { label: "Under Review",   style: "bg-ocean/10 text-ocean border-ocean/20" },
  docs_requested: { label: "Docs Requested", style: "bg-warning/10 text-warning border-warning/20" },
  under_review:   { label: "Under Review",   style: "bg-ocean/10 text-ocean border-ocean/20" },
  approved:       { label: "Approved",       style: "bg-success/10 text-success border-success/20" },
  converted:      { label: "Deal Created",   style: "bg-navy/10 text-navy border-navy/20" },
  rejected:       { label: "Rejected",       style: "bg-danger/10 text-danger border-danger/20" },
  cancelled:      { label: "Cancelled",      style: "bg-gray-100 text-text-secondary border-gray-200" },
}

const DOC_STATUS_CFG: Record<string, string> = {
  pending:  "bg-warning/10 text-warning border-warning/20",
  uploaded: "bg-success/10 text-success border-success/20",
  waived:   "bg-gray-100 text-text-secondary border-gray-200",
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  })
}

function PageSkeleton() {
  return (
    <div className="space-y-5 max-w-5xl animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-40" />
      <div className="flex gap-6">
        <div className="flex-1 space-y-4">
          <div className="h-40 bg-gray-200 rounded-xl" />
          <div className="h-32 bg-gray-200 rounded-xl" />
        </div>
        <div className="w-64 space-y-4">
          <div className="h-36 bg-gray-200 rounded-xl" />
          <div className="h-48 bg-gray-200 rounded-xl" />
        </div>
      </div>
    </div>
  )
}

// ── Document Requests section ────────────────────────────────────────────────

function DocRequestsSection({ pr }: { pr: PurchaseRequest }) {
  const [requests, setRequests] = useState<PRDocRequest[]>([])
  const [loading, setLoading]   = useState(true)

  const load = useCallback(async () => {
    try {
      const data = await prBuyer.listDocumentRequests(pr.id)
      setRequests(data)
    } catch {
      // silently ignore — no requests yet
    } finally {
      setLoading(false)
    }
  }, [pr.id])

  useEffect(() => { load() }, [load])

  if (loading) return (
    <div className="bg-white rounded-xl border border-border shadow-sm p-5 flex items-center gap-2 text-sm text-text-secondary">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading documents…
    </div>
  )

  if (requests.length === 0) return null

  const pending  = requests.filter(r => r.status === "pending")
  const uploaded = requests.filter(r => r.status === "uploaded")

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 className="text-base font-semibold text-text-primary flex items-center gap-2">
          <FileQuestion className="w-4 h-4 text-ocean" />
          Documents Requested
        </h2>
        <div className="flex gap-2">
          {pending.length > 0 && (
            <Badge className="bg-warning/10 text-warning border-warning/20 text-xs border">
              {pending.length} pending
            </Badge>
          )}
          {uploaded.length > 0 && (
            <Badge className="bg-success/10 text-success border-success/20 text-xs border">
              {uploaded.length} uploaded
            </Badge>
          )}
        </div>
      </div>

      <div className="divide-y divide-border">
        {requests.map((req) => (
          <div key={req.id} className="flex items-start gap-3 px-5 py-4">
            <div className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5",
              req.status === "uploaded" ? "bg-success/10" : req.status === "waived" ? "bg-gray-100" : "bg-warning/10"
            )}>
              {req.status === "uploaded"
                ? <CheckCircle2 className="w-4 h-4 text-success" />
                : req.status === "waived"
                ? <XCircle className="w-4 h-4 text-text-secondary" />
                : <FileQuestion className="w-4 h-4 text-warning" />}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-medium text-text-primary">{req.document_name}</p>
                <Badge className={cn("text-xs border capitalize", DOC_STATUS_CFG[req.status] ?? "")}>
                  {req.status}
                </Badge>
                <Badge variant="secondary" className="text-xs capitalize">{req.priority}</Badge>
              </div>
              {req.reason && <p className="text-xs text-text-secondary mt-0.5">{req.reason}</p>}
              {req.status === "uploaded" && req.file_name && (
                <p className="text-xs text-success mt-0.5 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> {req.file_name}
                </p>
              )}
              {req.status === "waived" && req.waive_reason && (
                <p className="text-xs text-text-secondary mt-0.5 italic">Waived: {req.waive_reason}</p>
              )}
            </div>

            {req.status === "pending" && (
              <Link
                href={`/purchase-requests/${pr.id}/documents?req=${req.id}`}
                className="shrink-0"
              >
                <Button size="sm" className="bg-ocean hover:bg-ocean-dark text-white gap-1.5 text-xs">
                  <Upload className="w-3.5 h-3.5" /> Upload
                </Button>
              </Link>
            )}
          </div>
        ))}
      </div>

      {pending.length > 0 && (
        <div className="px-5 py-3 bg-warning/5 border-t border-warning/20 flex items-center justify-between">
          <p className="text-xs text-warning font-medium">
            {pending.length} document{pending.length > 1 ? "s" : ""} still required
          </p>
          <Link href={`/purchase-requests/${pr.id}/documents`}>
            <Button size="sm" variant="outline" className="text-xs border-warning/30 text-warning hover:bg-warning/5 gap-1">
              Upload All <ChevronRight className="w-3 h-3" />
            </Button>
          </Link>
        </div>
      )}
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function PurchaseRequestDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [pr, setPr]           = useState<PurchaseRequest | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    if (!id) return
    prApi.get(id)
      .then(setPr)
      .catch((e) => setError(e?.message ?? "Failed to load request."))
      .finally(() => setIsLoading(false))
  }, [id])

  const handleCancel = async () => {
    if (!pr || !confirm("Cancel this purchase request?")) return
    setCancelling(true)
    try {
      await prApi.cancel(pr.id)
      setPr((p) => p ? { ...p, status: "cancelled" } : p)
    } catch (e: unknown) {
      alert((e as Error)?.message ?? "Failed to cancel.")
    } finally {
      setCancelling(false)
    }
  }

  if (isLoading) return <PageSkeleton />

  if (error || !pr) {
    return (
      <div className="flex items-center gap-3 p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger max-w-2xl">
        <AlertCircle className="w-5 h-5 shrink-0" />
        <span className="text-sm">{error ?? "Request not found."}</span>
        <Link href="/purchase-requests">
          <Button variant="outline" size="sm" className="ml-auto border-danger/30 text-danger">Back</Button>
        </Link>
      </div>
    )
  }

  const cfg       = STATUS_CFG[pr.status] ?? STATUS_CFG["submitted"]
  const showDocs  = ["docs_requested", "agent_assigned", "under_review", "approved", "converted"].includes(pr.status)

  const timeline = [
    { label: "Purchase request submitted", date: fmtDate(pr.created_at), icon: FileText },
    ...(["agent_assigned", "docs_requested", "under_review", "approved", "converted"].includes(pr.status)
      ? [{ label: "Agent assigned — review in progress", date: "", icon: ShieldCheck }] : []),
    ...(pr.status === "docs_requested"
      ? [{ label: "Documents requested by agent", date: "", icon: FileQuestion }] : []),
    ...(pr.status === "under_review"
      ? [{ label: "Documents submitted — under review", date: "", icon: RotateCcw }] : []),
    ...(pr.reviewed_at && ["approved", "converted", "rejected"].includes(pr.status)
      ? [{ label: `Request ${pr.status}`, date: fmtDate(pr.reviewed_at), icon: pr.status === "rejected" ? XCircle : CheckCircle2 }] : []),
    ...(pr.converted_deal_id
      ? [{ label: "Deal created", date: "", icon: Handshake }] : []),
  ]

  return (
    <div className="space-y-5 max-w-5xl">
      <Link
        href="/purchase-requests"
        className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-ocean transition-colors"
      >
        <ChevronLeft className="w-4 h-4" /> Back to Purchase Requests
      </Link>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* LEFT */}
        <div className="flex-1 space-y-5">

          {/* Header card */}
          <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="w-full sm:w-28 h-20 bg-gray-100 rounded-lg shrink-0 overflow-hidden flex items-center justify-center">
                {pr.product_primary_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={pr.product_primary_image_url}
                    alt={pr.product_title ?? "Product"}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Package className="w-8 h-8 text-gray-300" />
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <h1 className="text-lg font-bold text-text-primary">
                      {pr.product_title ?? "Asset Listing"}
                    </h1>
                    <p className="text-sm text-text-secondary mt-0.5 capitalize">
                      {pr.purchase_type.replace(/_/g, " ")}
                    </p>
                  </div>
                  <Badge className={cn("text-xs border", cfg.style)}>{cfg.label}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-x-8 gap-y-2 mt-4 sm:grid-cols-4">
                  {pr.offered_price && (
                    <div>
                      <p className="text-xs text-text-secondary">Your Offer</p>
                      <p className="text-sm font-bold text-navy">
                        ${Number(pr.offered_price).toLocaleString()} {pr.offered_currency}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-text-secondary">Quantity</p>
                    <p className="text-sm text-text-secondary">{pr.quantity}</p>
                  </div>
                  <div>
                    <p className="text-xs text-text-secondary">Submitted</p>
                    <p className="text-sm text-text-secondary">{shortDate(pr.created_at)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-text-secondary">Request ID</p>
                    <p className="text-sm font-mono text-text-secondary truncate">{pr.id.slice(0, 8)}…</p>
                  </div>
                </div>
              </div>
            </div>

            {pr.message && (
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-2">Your Message</p>
                <p className="text-sm text-text-primary leading-relaxed">{pr.message}</p>
              </div>
            )}
            {pr.admin_notes && (
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-2">Admin Note</p>
                <p className="text-sm text-text-primary">{pr.admin_notes}</p>
              </div>
            )}
          </div>

          {/* Status banners */}
          {pr.status === "submitted" && (
            <div className="bg-warning/5 border border-warning/20 rounded-xl p-4 flex items-center gap-3">
              <Clock className="w-4 h-4 text-warning shrink-0" />
              <p className="text-sm text-text-primary flex-1">Your request is awaiting agent assignment.</p>
              <Button size="sm" variant="outline" className="text-danger border-danger/30 hover:bg-danger/5 shrink-0"
                onClick={handleCancel} disabled={cancelling}>
                <XCircle className="w-4 h-4 mr-1.5" /> Cancel
              </Button>
            </div>
          )}

          {pr.status === "agent_assigned" && (
            <div className="bg-ocean/5 border border-ocean/20 rounded-xl p-4 flex items-center gap-3">
              <ShieldCheck className="w-4 h-4 text-ocean shrink-0" />
              <p className="text-sm text-text-primary">An agent has been assigned and is reviewing your request.</p>
            </div>
          )}

          {pr.status === "docs_requested" && (
            <div className="bg-warning/5 border border-warning/20 rounded-xl p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FileQuestion className="w-4 h-4 text-warning shrink-0" />
                <p className="text-sm text-text-primary font-medium">
                  Your agent has requested documents. Please upload them to continue.
                </p>
              </div>
              <Link href={`/purchase-requests/${pr.id}/documents`} className="shrink-0">
                <Button size="sm" className="bg-warning hover:bg-warning/90 text-white gap-1.5">
                  <Upload className="w-4 h-4" /> Upload Documents
                </Button>
              </Link>
            </div>
          )}

          {pr.status === "under_review" && (
            <div className="bg-ocean/5 border border-ocean/20 rounded-xl p-4 flex items-center gap-3">
              <RotateCcw className="w-4 h-4 text-ocean shrink-0" />
              <p className="text-sm text-text-primary">Documents submitted. Agent is finalising their report.</p>
            </div>
          )}

          {pr.status === "approved" && !pr.converted_deal_id && (
            <div className="bg-success/5 border border-success/20 rounded-xl p-4 flex items-center gap-3">
              <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
              <p className="text-sm text-text-primary font-medium">
                Request approved — Harbours360 will prepare your deal shortly.
              </p>
            </div>
          )}

          {pr.converted_deal_id && (
            <div className="bg-navy/5 border border-navy/20 rounded-xl p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Handshake className="w-4 h-4 text-navy shrink-0" />
                <p className="text-sm text-text-primary font-medium">Deal has been created for this request.</p>
              </div>
              <Link href="/deals">
                <Button size="sm" className="bg-navy hover:bg-navy/90 text-white shrink-0 gap-1">
                  View Deal <ChevronRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          )}

          {pr.status === "rejected" && (
            <div className="bg-danger/5 border border-danger/20 rounded-xl p-4 flex items-center gap-3">
              <AlertCircle className="w-4 h-4 text-danger shrink-0" />
              <div>
                <p className="text-sm font-medium text-danger">This request was declined.</p>
                {pr.admin_notes && (
                  <p className="text-xs text-text-secondary mt-0.5">Reason: {pr.admin_notes}</p>
                )}
              </div>
              <Link href="/marketplace" className="ml-auto shrink-0">
                <Button size="sm" variant="outline">Browse Marketplace</Button>
              </Link>
            </div>
          )}

          {pr.status === "cancelled" && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex items-center gap-3">
              <XCircle className="w-4 h-4 text-text-secondary shrink-0" />
              <p className="text-sm text-text-secondary">You cancelled this request.</p>
            </div>
          )}

          {/* Document requests section */}
          {showDocs && <DocRequestsSection pr={pr} />}
        </div>

        {/* RIGHT sidebar */}
        <div className="lg:w-64 shrink-0 space-y-4">
          {/* Activity timeline */}
          <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-text-primary mb-4">Activity</h3>
            <div className="space-y-4">
              {timeline.map((event, i) => {
                const Icon = event.icon
                return (
                  <div key={i} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="w-7 h-7 rounded-full bg-ocean/10 flex items-center justify-center shrink-0">
                        <Icon className="w-3.5 h-3.5 text-ocean" />
                      </div>
                      {i < timeline.length - 1 && (
                        <div className="w-px flex-1 bg-border mt-1" />
                      )}
                    </div>
                    <div className="pb-4">
                      <p className="text-sm text-text-primary">{event.label}</p>
                      {event.date && <p className="text-xs text-text-secondary mt-0.5">{event.date}</p>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Platform assurance */}
          <div className="bg-white rounded-xl border border-border p-5 shadow-sm space-y-3">
            <h3 className="text-sm font-semibold text-text-primary">Platform Assurance</h3>
            {[
              { icon: ShieldCheck, text: "All parties KYC verified" },
              { icon: Lock,        text: "End-to-end encrypted" },
              { icon: FileText,    text: "Full audit trail kept" },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-2 text-xs text-text-secondary">
                <Icon className="w-3.5 h-3.5 text-ocean shrink-0" />{text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
