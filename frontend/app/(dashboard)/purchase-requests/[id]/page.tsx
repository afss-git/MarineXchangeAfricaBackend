"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import {
  ChevronLeft,
  ShieldCheck,
  Clock,
  MessageSquare,
  Send,
  FileText,
  Lock,
  CheckCircle2,
  XCircle,
  Handshake,
  AlertCircle,
  Package,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { purchaseRequests as prApi, type PurchaseRequest } from "@/lib/api"

const statusConfig: Record<string, { label: string; style: string }> = {
  pending:      { label: "Pending",      style: "bg-warning/10 text-warning border-warning/20" },
  accepted:     { label: "Accepted",     style: "bg-success/10 text-success border-success/20" },
  rejected:     { label: "Rejected",     style: "bg-danger/10 text-danger border-danger/20" },
  negotiating:  { label: "Negotiating",  style: "bg-ocean/10 text-ocean border-ocean/20" },
  deal_created: { label: "Deal Created", style: "bg-navy/10 text-navy border-navy/20" },
  cancelled:    { label: "Cancelled",    style: "bg-gray-100 text-text-secondary border-gray-200" },
}

function PageSkeleton() {
  return (
    <div className="space-y-5 max-w-5xl animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-40" />
      <div className="flex gap-6">
        <div className="flex-1 space-y-4">
          <div className="h-40 bg-gray-200 rounded-xl" />
          <div className="h-32 bg-gray-200 rounded-xl" />
          <div className="h-64 bg-gray-200 rounded-xl" />
        </div>
        <div className="w-64 space-y-4">
          <div className="h-36 bg-gray-200 rounded-xl" />
          <div className="h-48 bg-gray-200 rounded-xl" />
        </div>
      </div>
    </div>
  )
}

export default function PurchaseRequestDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [pr, setPr] = useState<PurchaseRequest | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [messageText, setMessageText] = useState("")
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

  const config = statusConfig[pr.status] ?? statusConfig["pending"]
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
  const shortDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })

  const timeline = [
    { label: "Purchase request submitted", date: formatDate(pr.created_at), icon: FileText },
    ...(pr.reviewed_at ? [{ label: `Request ${pr.status}`, date: formatDate(pr.reviewed_at), icon: pr.status === "accepted" ? CheckCircle2 : XCircle }] : []),
    ...(pr.converted_deal_id ? [{ label: "Deal created", date: "", icon: Handshake }] : []),
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
              <div className="w-full sm:w-28 h-20 bg-gray-100 rounded-lg shrink-0 flex items-center justify-center">
                <Package className="w-8 h-8 text-gray-300" />
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
                  <Badge className={cn("text-xs border", config.style)}>{config.label}</Badge>
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

            {/* Original message */}
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

          {/* Status action banners */}
          {pr.status === "negotiating" && (
            <div className="bg-ocean/5 border border-ocean/20 rounded-xl p-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2 flex-1">
                <MessageSquare className="w-4 h-4 text-ocean shrink-0" />
                <p className="text-sm text-text-primary">Negotiation in progress.</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" className="bg-ocean hover:bg-ocean-dark text-white">
                  <Handshake className="w-4 h-4 mr-1.5" /> Accept & Create Deal
                </Button>
                <Button size="sm" variant="outline" className="text-danger border-danger/30 hover:bg-danger/5" onClick={handleCancel} disabled={cancelling}>
                  <XCircle className="w-4 h-4 mr-1.5" /> Decline
                </Button>
              </div>
            </div>
          )}

          {pr.status === "accepted" && !pr.converted_deal_id && (
            <div className="bg-success/5 border border-success/20 rounded-xl p-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2 flex-1">
                <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                <p className="text-sm text-text-primary font-medium">
                  Request accepted — a deal will be created by MarineXchange.
                </p>
              </div>
            </div>
          )}

          {pr.converted_deal_id && (
            <div className="bg-navy/5 border border-navy/20 rounded-xl p-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2 flex-1">
                <Handshake className="w-4 h-4 text-navy shrink-0" />
                <p className="text-sm text-text-primary font-medium">Deal created from this request.</p>
              </div>
              <Link href="/deals">
                <Button size="sm" className="bg-navy hover:bg-navy/90 text-white shrink-0">
                  View Deal
                </Button>
              </Link>
            </div>
          )}

          {pr.status === "rejected" && (
            <div className="bg-danger/5 border border-danger/20 rounded-xl p-4 flex items-center gap-3">
              <AlertCircle className="w-4 h-4 text-danger shrink-0" />
              <div>
                <p className="text-sm text-text-primary">This request was declined.</p>
                {pr.cancelled_reason && (
                  <p className="text-xs text-text-secondary mt-0.5">Reason: {pr.cancelled_reason}</p>
                )}
              </div>
              <Link href="/marketplace" className="ml-auto shrink-0">
                <Button size="sm" variant="outline">Browse Marketplace</Button>
              </Link>
            </div>
          )}

          {pr.status === "pending" && (
            <div className="bg-warning/5 border border-warning/20 rounded-xl p-4 flex items-center gap-3">
              <Clock className="w-4 h-4 text-warning shrink-0" />
              <p className="text-sm text-text-primary">Awaiting seller response.</p>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto text-danger border-danger/30 hover:bg-danger/5"
                onClick={handleCancel}
                disabled={cancelling}
              >
                <XCircle className="w-4 h-4 mr-1.5" /> Cancel Request
              </Button>
            </div>
          )}

          {/* Message thread (static — messaging API not yet implemented) */}
          <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="text-base font-semibold text-text-primary">Messages</h2>
            </div>
            <div className="p-5 min-h-30 flex items-center justify-center">
              <p className="text-sm text-text-secondary text-center">
                In-deal messaging is handled through the deal portal after acceptance.
              </p>
            </div>
            {["pending", "negotiating"].includes(pr.status) && (
              <div className="px-5 pb-5 space-y-2">
                <Textarea
                  placeholder="Type a message to the seller..."
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  rows={3}
                  className="resize-none"
                />
                <div className="flex justify-between items-center">
                  <p className="text-xs text-text-secondary flex items-center gap-1">
                    <Lock className="w-3 h-3" /> Messages are encrypted
                  </p>
                  <Button
                    size="sm"
                    className="bg-ocean hover:bg-ocean-dark text-white"
                    disabled={!messageText.trim()}
                  >
                    <Send className="w-4 h-4 mr-1.5" /> Send
                  </Button>
                </div>
              </div>
            )}
          </div>
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

          {/* Security assurance */}
          <div className="bg-white rounded-xl border border-border p-5 shadow-sm space-y-3">
            <h3 className="text-sm font-semibold text-text-primary">Platform Assurance</h3>
            {[
              { icon: ShieldCheck, text: "All parties KYC verified" },
              { icon: Lock, text: "End-to-end encrypted" },
              { icon: FileText, text: "Full audit trail kept" },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-2 text-xs text-text-secondary">
                <Icon className="w-3.5 h-3.5 text-ocean shrink-0" />
                {text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
