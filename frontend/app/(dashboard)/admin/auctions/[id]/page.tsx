"use client"

import React, { useState, useEffect, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft, RefreshCw, AlertCircle, CheckCircle2, XCircle,
  Clock, AlertTriangle, Gavel, Calendar, Zap, Trophy,
  Edit3, ChevronDown, ChevronUp, DollarSign, User,
  Shield, Ban, Send, Handshake, Loader2, X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  auctionAdmin,
  type AdminAuctionDetail,
  type AdminBidItem,
} from "@/lib/api"

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

function fmtDateTime(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

function fmtMoney(amount: string | null, currency: string) {
  if (!amount) return "—"
  const n = parseFloat(amount)
  return isNaN(n) ? amount : `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

// Convert UTC ISO to datetime-local string for <input type="datetime-local">
function toDatetimeLocal(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function toUTC(local: string): string {
  if (!local) return local
  return new Date(local).toISOString()
}

const STATUS_CFG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  draft:                   { label: "Draft",            color: "bg-gray-100 text-text-secondary border-gray-200", icon: Clock },
  scheduled:               { label: "Scheduled",        color: "bg-ocean/10 text-ocean border-ocean/20",          icon: Calendar },
  live:                    { label: "Live",              color: "bg-success/10 text-success border-success/20",    icon: Zap },
  closing_soon:            { label: "Closing Soon",      color: "bg-warning/10 text-warning border-warning/20",    icon: AlertTriangle },
  closed:                  { label: "Closed",            color: "bg-navy/10 text-navy border-navy/20",             icon: CheckCircle2 },
  cancelled:               { label: "Cancelled",         color: "bg-gray-100 text-text-secondary border-gray-200", icon: XCircle },
  winner_pending_approval: { label: "Winner Pending",    color: "bg-warning/10 text-warning border-warning/20",    icon: Trophy },
  winner_approved:         { label: "Winner Approved",   color: "bg-success/10 text-success border-success/20",    icon: Trophy },
  winner_rejected:         { label: "Winner Rejected",   color: "bg-danger/10 text-danger border-danger/20",       icon: Trophy },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? { label: status, color: "bg-gray-100 text-text-secondary border-gray-200", icon: Clock }
  const Icon = cfg.icon
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border", cfg.color)}>
      <Icon className="w-3.5 h-3.5" />{cfg.label}
    </span>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-2.5 border-b border-border last:border-0">
      <span className="text-xs text-text-secondary">{label}</span>
      <span className="text-xs font-medium text-text-primary text-right">{value}</span>
    </div>
  )
}

// ── Bid row ───────────────────────────────────────────────────────────────────

function BidRow({ bid, currency }: { bid: AdminBidItem; currency: string }) {
  return (
    <tr className={cn("hover:bg-gray-50/50", bid.is_winning_bid && "bg-success/5")}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-text-primary">{fmtMoney(bid.amount, currency)}</p>
          {bid.is_winning_bid && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-success bg-success/10 px-1.5 py-0.5 rounded">
              <Trophy className="w-3 h-3" /> Winner
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-xs text-text-secondary font-mono">{bid.bidder_id.slice(0, 8)}…</td>
      <td className="px-4 py-3 text-xs text-text-secondary">{bid.bidder_company ?? "—"}</td>
      <td className="px-4 py-3 text-xs text-text-secondary whitespace-nowrap">{fmtDateTime(bid.bid_time)}</td>
    </tr>
  )
}

// ── Edit form ─────────────────────────────────────────────────────────────────

interface EditFormState {
  title: string; description: string; starting_bid: string
  reserve_price: string; currency: string; min_bid_increment_usd: string
  start_time: string; end_time: string; auto_extend_minutes: string
  max_extensions: string; admin_notes: string
}

function EditPanel({
  auction,
  onSaved,
  onClose,
}: {
  auction: AdminAuctionDetail
  onSaved: (updated: AdminAuctionDetail) => void
  onClose: () => void
}) {
  const [form, setForm] = useState<EditFormState>({
    title:                 auction.title,
    description:           auction.description ?? "",
    starting_bid:          auction.starting_bid,
    reserve_price:         auction.reserve_price ?? "",
    currency:              auction.currency,
    min_bid_increment_usd: auction.min_bid_increment_usd,
    start_time:            toDatetimeLocal(auction.start_time),
    end_time:              toDatetimeLocal(auction.end_time),
    auto_extend_minutes:   String(auction.auto_extend_minutes),
    max_extensions:        String(auction.max_extensions),
    admin_notes:           auction.admin_notes ?? "",
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const set = (k: keyof EditFormState, v: string) => setForm((f) => ({ ...f, [k]: v }))

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const updated = await auctionAdmin.update(auction.id, {
        title:                 form.title || undefined,
        description:           form.description || undefined,
        starting_bid:          form.starting_bid ? parseFloat(form.starting_bid) : undefined,
        reserve_price:         form.reserve_price ? parseFloat(form.reserve_price) : undefined,
        currency:              form.currency || undefined,
        min_bid_increment_usd: form.min_bid_increment_usd ? parseFloat(form.min_bid_increment_usd) : undefined,
        start_time:            form.start_time ? toUTC(form.start_time) : undefined,
        end_time:              form.end_time ? toUTC(form.end_time) : undefined,
        auto_extend_minutes:   form.auto_extend_minutes ? parseInt(form.auto_extend_minutes) : undefined,
        max_extensions:        form.max_extensions ? parseInt(form.max_extensions) : undefined,
        admin_notes:           form.admin_notes || undefined,
      })
      onSaved(updated)
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "Update failed.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border-t border-border bg-gray-50/60 px-5 py-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-sm text-text-primary">Edit Auction</p>
        <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-xs font-medium text-text-secondary block mb-1">Title</label>
          <input
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
          />
        </div>
        <div className="col-span-2">
          <label className="text-xs font-medium text-text-secondary block mb-1">Description</label>
          <textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            rows={2}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean resize-none"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary block mb-1">Starting Bid</label>
          <input type="number" value={form.starting_bid} onChange={(e) => set("starting_bid", e.target.value)}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean" />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary block mb-1">Reserve Price</label>
          <input type="number" value={form.reserve_price} onChange={(e) => set("reserve_price", e.target.value)}
            placeholder="Optional"
            className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean" />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary block mb-1">Currency</label>
          <select value={form.currency} onChange={(e) => set("currency", e.target.value)}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean bg-white">
            {["USD", "EUR", "GBP", "ZAR", "NGN", "KES", "GHS"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary block mb-1">Min Increment (USD)</label>
          <input type="number" value={form.min_bid_increment_usd} onChange={(e) => set("min_bid_increment_usd", e.target.value)}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean" />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary block mb-1">Start Time</label>
          <input type="datetime-local" value={form.start_time} onChange={(e) => set("start_time", e.target.value)}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean" />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary block mb-1">End Time</label>
          <input type="datetime-local" value={form.end_time} onChange={(e) => set("end_time", e.target.value)}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean" />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary block mb-1">Auto-extend (mins)</label>
          <input type="number" value={form.auto_extend_minutes} onChange={(e) => set("auto_extend_minutes", e.target.value)}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean" />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary block mb-1">Max Extensions</label>
          <input type="number" value={form.max_extensions} onChange={(e) => set("max_extensions", e.target.value)}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean" />
        </div>
        <div className="col-span-2">
          <label className="text-xs font-medium text-text-secondary block mb-1">Admin Notes</label>
          <textarea
            value={form.admin_notes}
            onChange={(e) => set("admin_notes", e.target.value)}
            rows={2}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean resize-none"
          />
        </div>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="flex gap-2">
        <Button
          disabled={saving}
          className="bg-ocean hover:bg-ocean-dark text-white"
          onClick={handleSave}
        >
          {saving ? "Saving…" : "Save Changes"}
        </Button>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type AuctionTab = "bids" | "actions"

export default function AdminAuctionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [auction, setAuction]       = useState<AdminAuctionDetail | null>(null)
  const [isLoading, setIsLoading]   = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [activeTab, setActiveTab]   = useState<AuctionTab>("bids")
  const [showEdit, setShowEdit]     = useState(false)

  // Action state
  const [scheduling, setScheduling]               = useState(false)
  const [scheduleError, setScheduleError]         = useState<string | null>(null)

  const [showCancel, setShowCancel]               = useState(false)
  const [cancelReason, setCancelReason]           = useState("")
  const [cancelling, setCancelling]               = useState(false)
  const [cancelError, setCancelError]             = useState<string | null>(null)

  const [approveNotes, setApproveNotes]           = useState("")
  const [approving, setApproving]                 = useState(false)
  const [approveError, setApproveError]           = useState<string | null>(null)

  const [showReject, setShowReject]               = useState(false)
  const [rejectReason, setRejectReason]           = useState("")
  const [rejecting, setRejecting]                 = useState(false)
  const [rejectError, setRejectError]             = useState<string | null>(null)

  const [convertType, setConvertType]             = useState<"full_payment" | "financing">("full_payment")
  const [convertNotes, setConvertNotes]           = useState("")
  const [converting, setConverting]               = useState(false)
  const [convertError, setConvertError]           = useState<string | null>(null)
  const [convertedDealId, setConvertedDealId]     = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await auctionAdmin.get(id)
      setAuction(data)
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "Failed to load auction.")
    } finally {
      setIsLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  async function handleSchedule() {
    if (!confirm("Schedule this auction? It will become visible to buyers at the configured start time.")) return
    setScheduling(true)
    setScheduleError(null)
    try {
      setAuction(await auctionAdmin.schedule(id))
    } catch (e: unknown) {
      setScheduleError((e as Error)?.message ?? "Schedule failed.")
    } finally {
      setScheduling(false)
    }
  }

  async function handleCancel() {
    setCancelling(true)
    setCancelError(null)
    try {
      setAuction(await auctionAdmin.cancel(id, cancelReason || undefined))
      setShowCancel(false)
      setCancelReason("")
    } catch (e: unknown) {
      setCancelError((e as Error)?.message ?? "Cancel failed.")
    } finally {
      setCancelling(false)
    }
  }

  async function handleApprove() {
    if (!confirm("Approve the winner? This notifies them to proceed with the deal.")) return
    setApproving(true)
    setApproveError(null)
    try {
      setAuction(await auctionAdmin.approveWinner(id, approveNotes || undefined))
      setApproveNotes("")
    } catch (e: unknown) {
      setApproveError((e as Error)?.message ?? "Approve failed.")
    } finally {
      setApproving(false)
    }
  }

  async function handleReject() {
    if (!rejectReason.trim()) { setRejectError("Rejection reason is required."); return }
    setRejecting(true)
    setRejectError(null)
    try {
      setAuction(await auctionAdmin.rejectWinner(id, rejectReason))
      setShowReject(false)
      setRejectReason("")
    } catch (e: unknown) {
      setRejectError((e as Error)?.message ?? "Reject failed.")
    } finally {
      setRejecting(false)
    }
  }

  async function handleConvert() {
    if (!confirm(`Convert this auction to a ${convertType === "full_payment" ? "full payment" : "financing"} deal?`)) return
    setConverting(true)
    setConvertError(null)
    try {
      const result = await auctionAdmin.convertToDeal(id, convertType, convertNotes || undefined)
      setConvertedDealId(result.deal_id)
      load()
    } catch (e: unknown) {
      setConvertError((e as Error)?.message ?? "Convert failed.")
    } finally {
      setConverting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 bg-gray-100 rounded-xl w-64" />
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 bg-gray-100 rounded-xl" />
          ))}
        </div>
        <div className="h-80 bg-gray-100 rounded-xl" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <AlertCircle className="w-10 h-10 text-danger" />
        <p className="text-text-secondary">{error}</p>
        <div className="flex gap-2">
          <Button onClick={load} variant="outline">Retry</Button>
          <Button onClick={() => router.back()} variant="ghost">Go Back</Button>
        </div>
      </div>
    )
  }

  if (!auction) return null

  const sortedBids = [...auction.bids].sort(
    (a, b) => new Date(b.bid_time).getTime() - new Date(a.bid_time).getTime()
  )

  const isEditable = ["draft", "scheduled"].includes(auction.status)
  const canSchedule = auction.status === "draft"
  const canCancel = ["draft", "scheduled", "live", "closing_soon"].includes(auction.status)
  const canApproveReject = auction.status === "winner_pending_approval"
  const canConvert = auction.status === "winner_approved" && !auction.converted_deal_id

  return (
    <div className="space-y-6">
      {/* Back + title */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost" size="sm"
          onClick={() => router.push("/admin/auctions")}
          className="gap-1.5 text-text-secondary"
        >
          <ArrowLeft className="w-4 h-4" />Auctions
        </Button>
        <span className="text-text-secondary">/</span>
        <h1 className="text-lg font-bold text-text-primary truncate max-w-md">{auction.title}</h1>
        <StatusBadge status={auction.status} />
        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
            <RefreshCw className="w-4 h-4" />Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-6">

          {/* Auction overview card */}
          <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-2">
                <Gavel className="w-4 h-4 text-ocean" />
                <h2 className="font-semibold text-text-primary">Auction Overview</h2>
              </div>
              {isEditable && (
                <Button
                  variant="ghost" size="sm"
                  className="gap-1.5 text-text-secondary h-8"
                  onClick={() => setShowEdit((v) => !v)}
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  {showEdit ? "Close" : "Edit"}
                  {showEdit ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </Button>
              )}
            </div>

            {showEdit && isEditable && (
              <EditPanel
                auction={auction}
                onSaved={(updated) => { setAuction(updated); setShowEdit(false) }}
                onClose={() => setShowEdit(false)}
              />
            )}

            <div className="px-5 pb-5">
              <div className="grid grid-cols-2 gap-x-8">
                <div>
                  {[
                    ["Product", auction.product_title ?? auction.product_id.slice(0, 12) + "…"],
                    ["Starting Bid", fmtMoney(auction.starting_bid, auction.currency)],
                    ["Reserve Price", auction.reserve_price ? fmtMoney(auction.reserve_price, auction.currency) : "(none)"],
                    ["Min Increment", fmtMoney(auction.min_bid_increment_usd, "USD")],
                    ["Currency", auction.currency],
                  ].map(([l, v]) => <InfoRow key={l} label={l} value={v} />)}
                </div>
                <div>
                  {[
                    ["Start Time", fmtDateTime(auction.start_time)],
                    ["End Time", fmtDateTime(auction.end_time)],
                    ["Auto-extend", `${auction.auto_extend_minutes} min`],
                    ["Max Extensions", `${auction.max_extensions} (used: ${auction.extensions_count})`],
                    ["Created", fmtDate(auction.created_at)],
                  ].map(([l, v]) => <InfoRow key={l} label={l} value={v} />)}
                </div>
              </div>
              {auction.description && (
                <div className="mt-4 bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-text-secondary mb-1">Description</p>
                  <p className="text-sm text-text-primary">{auction.description}</p>
                </div>
              )}
              {auction.admin_notes && (
                <div className="mt-3 bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-text-secondary mb-1">Admin Notes</p>
                  <p className="text-sm text-text-primary">{auction.admin_notes}</p>
                </div>
              )}
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
            {([
              { key: "bids",    label: "Bids",    icon: DollarSign, count: auction.bid_count },
              { key: "actions", label: "Actions", icon: Shield },
            ] as { key: AuctionTab; label: string; icon: React.ElementType; count?: number }[]).map(({ key, label, icon: Icon, count }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
                  activeTab === key ? "bg-white text-ocean shadow-sm" : "text-text-secondary hover:text-text-primary"
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
                {count !== undefined && count > 0 && (
                  <span className={cn(
                    "ml-0.5 px-1.5 py-0.5 rounded-full text-xs font-semibold",
                    activeTab === key ? "bg-ocean/10 text-ocean" : "bg-gray-200 text-text-secondary"
                  )}>
                    {count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Bids tab */}
          {activeTab === "bids" && (
            <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-ocean" />
                <h2 className="font-semibold text-text-primary">All Bids</h2>
                <span className="text-xs text-text-secondary ml-1">· {auction.bid_count} total</span>
              </div>
              {sortedBids.length === 0 ? (
                <div className="py-12 text-center">
                  <Gavel className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                  <p className="text-sm text-text-secondary">No bids placed yet.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-border">
                        {["Amount", "Bidder ID", "Company", "Placed At"].map((h) => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wide">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {sortedBids.map((bid) => (
                        <BidRow key={bid.id} bid={bid} currency={auction.currency} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Actions tab */}
          {activeTab === "actions" && (
            <div className="space-y-4">

              {/* Schedule */}
              {canSchedule && (
                <div className="bg-white rounded-xl border border-border shadow-sm p-5">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-ocean/10 shrink-0">
                      <Calendar className="w-4 h-4 text-ocean" />
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-text-primary">Schedule Auction</p>
                      <p className="text-xs text-text-secondary mt-0.5">
                        Mark the auction as scheduled. It will become live automatically at the configured start time.
                      </p>
                      {scheduleError && <p className="text-xs text-danger mt-2">{scheduleError}</p>}
                    </div>
                    <Button
                      size="sm"
                      disabled={scheduling}
                      className="bg-ocean hover:bg-ocean-dark text-white gap-1.5 shrink-0"
                      onClick={handleSchedule}
                    >
                      <Send className="w-3.5 h-3.5" />
                      {scheduling ? "Scheduling…" : "Schedule"}
                    </Button>
                  </div>
                </div>
              )}

              {/* Cancel */}
              {canCancel && (
                <div className="bg-white rounded-xl border border-border shadow-sm p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Ban className="w-4 h-4 text-danger" />
                    <h3 className="font-semibold text-text-primary">Cancel Auction</h3>
                  </div>
                  {!showCancel ? (
                    <Button
                      variant="outline" size="sm"
                      className="gap-1.5 text-danger border-danger/30 hover:bg-danger/5"
                      onClick={() => { setShowCancel(true); setCancelError(null) }}
                    >
                      <XCircle className="w-3.5 h-3.5" />Cancel Auction
                    </Button>
                  ) : (
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-text-secondary block">Reason (optional)</label>
                      <textarea
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                        rows={2}
                        placeholder="Reason for cancellation…"
                        className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-danger/20 focus:border-danger resize-none"
                      />
                      {cancelError && <p className="text-xs text-danger">{cancelError}</p>}
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={cancelling}
                          className="bg-danger hover:bg-danger/90 text-white gap-1.5"
                          onClick={handleCancel}
                        >
                          {cancelling ? "Cancelling…" : "Confirm Cancel"}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setShowCancel(false)} disabled={cancelling}>
                          Back
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Approve / Reject winner */}
              {canApproveReject && (
                <div className="bg-white rounded-xl border border-border shadow-sm p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-warning" />
                    <h3 className="font-semibold text-text-primary">Winner Decision</h3>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-warning/5 border border-warning/20 rounded-xl">
                    <User className="w-4 h-4 text-warning shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-text-primary">
                        {auction.winner_company ?? "Unknown company"}
                      </p>
                      <p className="text-xs text-text-secondary">
                        Winning bid: {fmtMoney(auction.current_highest_bid, auction.currency)}
                      </p>
                    </div>
                  </div>

                  {/* Approve */}
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-text-secondary block">Approval Notes (optional)</label>
                    <textarea
                      value={approveNotes}
                      onChange={(e) => setApproveNotes(e.target.value)}
                      rows={2}
                      placeholder="Notes to include with the approval notification…"
                      className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-success/20 focus:border-success resize-none"
                    />
                    {approveError && <p className="text-xs text-danger">{approveError}</p>}
                    <Button
                      size="sm"
                      disabled={approving}
                      className="bg-success hover:bg-success/90 text-white gap-1.5"
                      onClick={handleApprove}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {approving ? "Approving…" : "Approve Winner"}
                    </Button>
                  </div>

                  <div className="border-t border-border pt-4">
                    {!showReject ? (
                      <Button
                        variant="outline" size="sm"
                        className="gap-1.5 text-danger border-danger/30 hover:bg-danger/5"
                        onClick={() => { setShowReject(true); setRejectError(null) }}
                      >
                        <XCircle className="w-3.5 h-3.5" />Reject Winner
                      </Button>
                    ) : (
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary block">
                          Rejection Reason <span className="text-danger">*</span>
                        </label>
                        <textarea
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          rows={2}
                          placeholder="Explain why the winner is being rejected…"
                          className="w-full px-3 py-2 text-sm border border-danger/30 rounded-lg focus:outline-none focus:ring-2 focus:ring-danger/20 focus:border-danger resize-none"
                        />
                        {rejectError && <p className="text-xs text-danger">{rejectError}</p>}
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={rejecting || !rejectReason.trim()}
                            className="bg-danger hover:bg-danger/90 text-white gap-1.5"
                            onClick={handleReject}
                          >
                            {rejecting ? "Rejecting…" : "Confirm Reject"}
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setShowReject(false)} disabled={rejecting}>
                            Back
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Convert to deal */}
              {canConvert && (
                <div className="bg-white rounded-xl border border-border shadow-sm p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <Handshake className="w-4 h-4 text-ocean" />
                    <h3 className="font-semibold text-text-primary">Convert to Deal</h3>
                  </div>
                  <p className="text-xs text-text-secondary">
                    Winner has been approved. Create a deal for{" "}
                    <span className="font-medium text-text-primary">{auction.winner_company ?? "the winner"}</span>{" "}
                    at {fmtMoney(auction.current_highest_bid, auction.currency)}.
                  </p>
                  <div>
                    <label className="text-xs font-medium text-text-secondary block mb-1">Deal Type</label>
                    <div className="flex gap-3">
                      {(["full_payment", "financing"] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setConvertType(t)}
                          className={cn(
                            "flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all",
                            convertType === t
                              ? "bg-ocean text-white border-ocean shadow-sm"
                              : "bg-white text-text-secondary border-border hover:border-ocean/50"
                          )}
                        >
                          {t === "full_payment" ? "Full Payment" : "Financing"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-text-secondary block mb-1">Admin Notes (optional)</label>
                    <textarea
                      value={convertNotes}
                      onChange={(e) => setConvertNotes(e.target.value)}
                      rows={2}
                      placeholder="Notes to attach to the new deal…"
                      className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean resize-none"
                    />
                  </div>
                  {convertError && <p className="text-xs text-danger">{convertError}</p>}
                  <Button
                    size="sm"
                    disabled={converting}
                    className="bg-ocean hover:bg-ocean-dark text-white gap-1.5"
                    onClick={handleConvert}
                  >
                    <Handshake className="w-3.5 h-3.5" />
                    {converting ? "Converting…" : "Convert to Deal"}
                  </Button>
                </div>
              )}

              {/* Post-convert: view deal link */}
              {(convertedDealId || auction.converted_deal_id) && (
                <div className="bg-success/10 border border-success/20 rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-4 h-4 text-success" />
                    <p className="font-semibold text-success">Deal created successfully</p>
                  </div>
                  <Link href={`/admin/deals/${convertedDealId ?? auction.converted_deal_id}`}>
                    <Button size="sm" className="bg-success hover:bg-success/90 text-white gap-1.5">
                      <Handshake className="w-3.5 h-3.5" />View Deal
                    </Button>
                  </Link>
                </div>
              )}

              {/* Winner info (approved/rejected states) */}
              {auction.status === "winner_approved" && !canConvert && !convertedDealId && !auction.converted_deal_id && (
                <div className="bg-white rounded-xl border border-border shadow-sm p-5">
                  <p className="text-sm text-text-secondary">Winner approved. Ready for deal conversion above.</p>
                </div>
              )}

              {auction.status === "winner_rejected" && auction.winner_rejection_reason && (
                <div className="bg-danger/10 border border-danger/20 rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <XCircle className="w-4 h-4 text-danger" />
                    <p className="font-semibold text-danger">Winner Rejected</p>
                  </div>
                  <p className="text-xs text-text-secondary">Reason: {auction.winner_rejection_reason}</p>
                </div>
              )}

              {/* Terminal states with no actions */}
              {["closed", "cancelled"].includes(auction.status) && !canApproveReject && !canConvert && (
                <div className="bg-white rounded-xl border border-border shadow-sm p-8 text-center">
                  <CheckCircle2 className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                  <p className="text-sm font-medium text-text-primary capitalize">{auction.status}</p>
                  <p className="text-xs text-text-secondary mt-1">No further admin actions available.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          {/* Stats card */}
          <div className="bg-white rounded-xl border border-border shadow-sm p-4">
            <div className="flex items-center gap-2 mb-4">
              <DollarSign className="w-4 h-4 text-ocean" />
              <h3 className="font-semibold text-text-primary text-sm">Live Stats</h3>
            </div>
            <div className="space-y-0">
              <InfoRow label="Status" value={<StatusBadge status={auction.status} />} />
              <InfoRow label="Current Bid" value={
                <span className="font-bold text-ocean">{fmtMoney(auction.current_highest_bid, auction.currency)}</span>
              } />
              <InfoRow label="Total Bids" value={auction.bid_count} />
              <InfoRow label="Extensions" value={`${auction.extensions_count} / ${auction.max_extensions}`} />
            </div>
          </div>

          {/* Winner card */}
          {auction.current_winner_id && (
            <div className="bg-white rounded-xl border border-border shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <Trophy className="w-4 h-4 text-warning" />
                <h3 className="font-semibold text-text-primary text-sm">Winner</h3>
              </div>
              <div className="bg-warning/5 rounded-xl p-3">
                <p className="font-semibold text-sm text-text-primary">{auction.winner_company ?? "—"}</p>
                <p className="text-xs text-text-secondary mt-0.5 font-mono">{auction.current_winner_id.slice(0, 12)}…</p>
                <p className="text-xs font-bold text-warning mt-1">{fmtMoney(auction.current_highest_bid, auction.currency)}</p>
              </div>
              {auction.winner_approved_at && (
                <div className="mt-3 space-y-0">
                  <InfoRow label="Approved By" value={auction.winner_approved_by ?? "—"} />
                  <InfoRow label="Approved At" value={fmtDate(auction.winner_approved_at)} />
                </div>
              )}
            </div>
          )}

          {/* Deal link */}
          {auction.converted_deal_id && (
            <div className="bg-white rounded-xl border border-border shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <Handshake className="w-4 h-4 text-ocean" />
                <h3 className="font-semibold text-text-primary text-sm">Converted Deal</h3>
              </div>
              <Link href={`/admin/deals/${auction.converted_deal_id}`}>
                <Button variant="outline" size="sm" className="w-full gap-1.5 text-ocean border-ocean/30 hover:bg-ocean/5">
                  <Handshake className="w-3.5 h-3.5" />View Deal
                </Button>
              </Link>
            </div>
          )}

          {/* Quick schedule / cancel sidebar shortcuts */}
          {(canSchedule || canCancel) && (
            <div className="bg-white rounded-xl border border-border shadow-sm p-4">
              <h3 className="font-semibold text-text-primary text-sm mb-3">Quick Actions</h3>
              <div className="space-y-2">
                {canSchedule && (
                  <Button
                    variant="outline" size="sm"
                    disabled={scheduling}
                    className="w-full gap-1.5 justify-start text-ocean border-ocean/30 hover:bg-ocean/5"
                    onClick={() => { setActiveTab("actions"); handleSchedule() }}
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    {scheduling ? <><Loader2 className="w-3 h-3 animate-spin" /> Scheduling…</> : "Schedule Auction"}
                  </Button>
                )}
                {canCancel && (
                  <Button
                    variant="outline" size="sm"
                    className="w-full gap-1.5 justify-start text-text-secondary"
                    onClick={() => { setActiveTab("actions"); setShowCancel(true) }}
                  >
                    <Ban className="w-3.5 h-3.5" />Cancel Auction
                  </Button>
                )}
                {canApproveReject && (
                  <Button
                    variant="outline" size="sm"
                    className="w-full gap-1.5 justify-start text-warning border-warning/30 hover:bg-warning/5"
                    onClick={() => setActiveTab("actions")}
                  >
                    <Trophy className="w-3.5 h-3.5" />Decide Winner
                  </Button>
                )}
              </div>
              {scheduleError && <p className="text-xs text-danger mt-2">{scheduleError}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
