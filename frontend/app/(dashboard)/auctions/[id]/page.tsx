"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import {
  ChevronLeft,
  Gavel,
  ShieldCheck,
  Lock,
  Clock,
  TrendingUp,
  Flame,
  AlertCircle,
  CheckCircle2,
  FileText,
  Package,
  Timer,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import {
  auctions as auctionsApi,
  type PublicAuctionDetail,
  type PublicBidItem,
  type PlaceBidResponse,
  ApiRequestError,
} from "@/lib/api"

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "Ended"
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${s}s`
  return `${m}m ${s}s`
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function PageSkeleton() {
  return (
    <div className="space-y-5 max-w-5xl animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-32" />
      <div className="h-10 bg-gray-200 rounded-xl" />
      <div className="flex gap-6">
        <div className="flex-1 space-y-4">
          <div className="h-80 bg-gray-200 rounded-xl" />
          <div className="h-40 bg-gray-200 rounded-xl" />
          <div className="h-48 bg-gray-200 rounded-xl" />
        </div>
        <div className="w-72 space-y-4">
          <div className="h-72 bg-gray-200 rounded-xl" />
          <div className="h-28 bg-gray-200 rounded-xl" />
        </div>
      </div>
    </div>
  )
}

const reserveBadge: Record<string, { label: string; style: string } | undefined> = {
  reserve_met: { label: "Reserve Met", style: "bg-success/10 text-success border-success/20" },
  reserve_not_met: { label: "Reserve Not Met", style: "bg-warning/10 text-warning border-warning/20" },
}

const statusConfig: Record<string, { label: string; style: string; dot: string }> = {
  live:         { label: "Live",         style: "bg-success/10 text-success border-success/20",  dot: "bg-success" },
  ending_soon:  { label: "Ending Soon",  style: "bg-danger/10 text-danger border-danger/20",     dot: "bg-danger" },
  upcoming:     { label: "Upcoming",     style: "bg-gray-100 text-text-secondary border-gray-200", dot: "bg-gray-400" },
  closed:       { label: "Closed",       style: "bg-gray-100 text-text-secondary border-gray-200", dot: "bg-gray-400" },
  cancelled:    { label: "Cancelled",    style: "bg-gray-100 text-text-secondary border-gray-200", dot: "bg-gray-400" },
}

export default function AuctionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [auction, setAuction] = useState<PublicAuctionDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Countdown timer
  const [countdown, setCountdown] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Bid state
  const [bidAmount, setBidAmount] = useState("")
  const [placing, setPlacing] = useState(false)
  const [bidSuccess, setBidSuccess] = useState<PlaceBidResponse | null>(null)
  const [bidError, setBidError] = useState<string | null>(null)

  const fetchAuction = useCallback(() => {
    if (!id) return
    auctionsApi.get(id)
      .then((data) => {
        setAuction(data)
        setCountdown(data.time_remaining_seconds)
      })
      .catch((e) => setError(e?.message ?? "Failed to load auction."))
      .finally(() => setIsLoading(false))
  }, [id])

  useEffect(() => {
    fetchAuction()
  }, [fetchAuction])

  // Live countdown
  useEffect(() => {
    if (countdown <= 0) return
    timerRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (timerRef.current) clearInterval(timerRef.current)
          return 0
        }
        return c - 1
      })
    }, 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [countdown > 0 ? "running" : "stopped"]) // eslint-disable-line react-hooks/exhaustive-deps

  const placeBid = async () => {
    if (!auction) return
    const amount = parseFloat(bidAmount.replace(/,/g, ""))
    if (isNaN(amount)) return
    setPlacing(true)
    setBidError(null)
    try {
      const res = await auctionsApi.placeBid(auction.id, amount)
      setBidSuccess(res)
      setBidAmount("")
      // Update auction state optimistically
      setAuction((prev) => prev ? {
        ...prev,
        current_highest_bid: res.amount,
        min_next_bid: res.min_next_bid,
        reserve_status: res.reserve_status,
        bid_count: prev.bid_count + 1,
        end_time: res.new_end_time,
        extensions_count: res.extensions_count,
        recent_bids: [
          {
            id: res.bid_id,
            bidder_company: "You",
            amount: res.amount,
            currency: res.currency,
            is_winning_bid: res.is_winning_bid,
            bid_time: res.bid_time,
          } as PublicBidItem,
          ...prev.recent_bids,
        ].slice(0, 10),
      } : prev)
    } catch (e) {
      const msg = e instanceof ApiRequestError ? e.message : "Failed to place bid."
      setBidError(msg)
    } finally {
      setPlacing(false)
    }
  }

  if (isLoading) return <PageSkeleton />

  if (error || !auction) {
    return (
      <div className="flex items-center gap-3 p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger max-w-2xl">
        <AlertCircle className="w-5 h-5 shrink-0" />
        <span className="text-sm">{error ?? "Auction not found."}</span>
        <Link href="/auctions">
          <Button variant="outline" size="sm" className="ml-auto border-danger/30 text-danger">Back</Button>
        </Link>
      </div>
    )
  }

  const minNextBid = parseFloat(auction.min_next_bid)
  const increment = parseFloat(auction.min_bid_increment_usd)
  const bidValue = parseFloat(bidAmount.replace(/,/g, "")) || 0
  const bidValid = bidValue >= minNextBid
  const isLive = auction.status === "live" || auction.status === "ending_soon"
  const isEndingSoon = auction.status === "ending_soon" || countdown < 3600
  const statusInfo = statusConfig[auction.status] ?? statusConfig["live"]
  const reserveInfo = reserveBadge[auction.reserve_status]
  const currentBid = auction.current_highest_bid
    ? `$${Number(auction.current_highest_bid).toLocaleString()}`
    : `$${Number(auction.starting_bid).toLocaleString()} (starting)`

  return (
    <div className="space-y-5 max-w-5xl">
      <Link
        href="/auctions"
        className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-ocean transition-colors"
      >
        <ChevronLeft className="w-4 h-4" /> Back to Auctions
      </Link>

      {/* Status banner */}
      {isLive && isEndingSoon && countdown > 0 && (
        <div className="bg-danger/10 border border-danger/20 rounded-xl px-5 py-3 flex items-center gap-3">
          <Flame className="w-4 h-4 text-danger shrink-0" />
          <p className="text-sm font-semibold text-danger">Auction ending in {formatCountdown(countdown)}</p>
          {auction.auto_extend_minutes > 0 && (
            <div className="ml-auto flex items-center gap-1.5 text-sm text-text-secondary">
              <Clock className="w-4 h-4" />
              <span className="hidden sm:block">Auto-extends {auction.auto_extend_minutes}m if bid placed near end</span>
            </div>
          )}
        </div>
      )}
      {isLive && !isEndingSoon && (
        <div className="bg-success/10 border border-success/20 rounded-xl px-5 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success" />
            </span>
            <p className="text-sm font-semibold text-success">Auction Live</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5 text-sm text-text-secondary">
            <Timer className="w-4 h-4" />
            <span>{formatCountdown(countdown)} remaining</span>
          </div>
        </div>
      )}
      {!isLive && (
        <div className="bg-gray-50 border border-border rounded-xl px-5 py-3 flex items-center gap-3">
          <Clock className="w-4 h-4 text-text-secondary shrink-0" />
          <p className="text-sm font-medium text-text-secondary capitalize">{statusInfo.label}</p>
        </div>
      )}

      {/* Bid success banner */}
      {bidSuccess && (
        <div className="flex items-center gap-3 p-4 bg-success/10 border border-success/20 rounded-xl text-success">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span className="text-sm font-medium">
            Bid of ${Number(bidSuccess.amount).toLocaleString()} placed successfully!
            {bidSuccess.is_winning_bid && " You are the highest bidder."}
            {bidSuccess.extended && ` Auction extended by ${auction.auto_extend_minutes} minutes.`}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* LEFT */}
        <div className="flex-1 space-y-5">

          {/* Gallery */}
          <div className="h-72 md:h-80 bg-gray-100 rounded-xl flex items-center justify-center">
            <Package className="w-16 h-16 text-gray-300" />
          </div>

          {/* Title + badges */}
          <div>
            <div className="flex items-start gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-text-primary">{auction.title}</h1>
              <Badge className={cn("text-xs border flex items-center gap-1", statusInfo.style)}>
                <span className={cn("w-1.5 h-1.5 rounded-full", isLive ? "animate-pulse" : "", statusInfo.dot)} />
                {statusInfo.label}
              </Badge>
            </div>
            <div className="flex gap-2 mt-2 flex-wrap">
              {reserveInfo && (
                <Badge className={cn("text-xs border", reserveInfo.style)}>
                  <CheckCircle2 className="w-3 h-3 mr-1" /> {reserveInfo.label}
                </Badge>
              )}
              {auction.extensions_count > 0 && (
                <Badge variant="secondary" className="text-xs">
                  Extended {auction.extensions_count}×
                </Badge>
              )}
            </div>
            {auction.description && (
              <p className="mt-3 text-sm text-text-secondary leading-relaxed">{auction.description}</p>
            )}
          </div>

          {/* Bid History */}
          <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-base font-semibold text-text-primary">Bid History</h2>
              <span className="text-sm text-text-secondary">{auction.bid_count} bid{auction.bid_count !== 1 ? "s" : ""} total</span>
            </div>
            {auction.recent_bids.length === 0 ? (
              <div className="p-8 text-center">
                <Gavel className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                <p className="text-sm text-text-secondary">No bids yet — be the first!</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {auction.recent_bids.map((bid, i) => (
                  <div key={bid.id ?? i} className={cn(
                    "flex items-center gap-4 px-5 py-3.5",
                    bid.is_winning_bid ? "bg-success/5" : ""
                  )}>
                    <Avatar className="w-8 h-8 shrink-0">
                      <AvatarFallback className={cn(
                        "text-xs font-semibold",
                        bid.bidder_company === "You" ? "bg-navy/10 text-navy" : "bg-gray-100 text-text-secondary"
                      )}>
                        {bid.bidder_company ? bid.bidder_company.slice(0, 2).toUpperCase() : "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-text-primary">
                        {bid.bidder_company ?? "Anonymous Bidder"}
                      </p>
                      <p className="text-xs text-text-secondary">{formatRelativeTime(bid.bid_time)}</p>
                    </div>
                    <div className="text-right">
                      <p className={cn("text-sm font-bold", bid.is_winning_bid ? "text-success" : "text-text-primary")}>
                        ${Number(bid.amount).toLocaleString()} {bid.currency}
                      </p>
                      {bid.is_winning_bid && (
                        <p className="text-xs text-success flex items-center gap-1 justify-end">
                          <TrendingUp className="w-3 h-3" /> Highest
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — bid card */}
        <div className="lg:w-72 shrink-0 space-y-4">
          {/* Main bid card */}
          <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden lg:sticky lg:top-24">
            {/* Current bid */}
            <div className="bg-navy p-5 text-white">
              <p className="text-sm text-white/70">
                {auction.current_highest_bid ? "Current Highest Bid" : "Starting Bid"}
              </p>
              <p className="text-3xl font-bold mt-1">{currentBid}</p>
              <div className="flex items-center gap-4 mt-3 text-sm text-white/70">
                <span className="flex items-center gap-1">
                  <Gavel className="w-4 h-4" /> {auction.bid_count} bid{auction.bid_count !== 1 ? "s" : ""}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-4 h-4" /> {countdown > 0 ? formatCountdown(countdown) : "Ended"}
                </span>
              </div>
            </div>

            <div className="p-5 space-y-4">
              {isLive ? (
                <>
                  {/* Bid error */}
                  {bidError && (
                    <div className="flex items-start gap-2 p-3 bg-danger/10 border border-danger/20 rounded-lg text-danger text-xs">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      {bidError}
                    </div>
                  )}

                  {/* Bid input */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-text-primary">Your Bid ({auction.currency})</label>
                    <Input
                      type="number"
                      placeholder={`Min. $${minNextBid.toLocaleString()}`}
                      value={bidAmount}
                      onChange={(e) => { setBidAmount(e.target.value); setBidError(null) }}
                      className={cn(bidAmount && !bidValid ? "border-danger focus-visible:ring-danger/20" : "")}
                    />
                    {bidAmount && !bidValid && (
                      <p className="text-xs text-danger flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        Minimum bid is ${minNextBid.toLocaleString()}
                      </p>
                    )}
                    <p className="text-xs text-text-secondary">
                      Min. increment: ${increment.toLocaleString()}
                    </p>
                  </div>

                  {/* Quick bid buttons */}
                  <div className="grid grid-cols-3 gap-2">
                    {[minNextBid, minNextBid + increment, minNextBid + 2 * increment].map((amount) => (
                      <button
                        key={amount}
                        onClick={() => setBidAmount(amount.toString())}
                        className="text-xs py-1.5 px-2 rounded-lg border border-border hover:border-ocean hover:text-ocean transition-colors text-text-secondary"
                      >
                        {amount >= 1000000
                          ? `$${(amount / 1000000).toFixed(2)}M`
                          : amount >= 1000
                          ? `$${(amount / 1000).toFixed(0)}K`
                          : `$${amount}`}
                      </button>
                    ))}
                  </div>

                  <Button
                    className="w-full h-12 bg-ocean hover:bg-ocean-dark text-white font-semibold"
                    disabled={!bidValid || placing || countdown <= 0}
                    onClick={placeBid}
                  >
                    <Gavel className="w-4 h-4 mr-2" />
                    {placing ? "Placing Bid..." : "Place Bid"}
                  </Button>
                </>
              ) : (
                <div className="py-4 text-center">
                  <p className="text-sm text-text-secondary">
                    {auction.status === "upcoming"
                      ? "Bidding opens when the auction starts."
                      : "This auction has ended."}
                  </p>
                </div>
              )}

              {/* Security */}
              <div className="space-y-2 pt-2 border-t border-border">
                {[
                  { icon: ShieldCheck, text: "KYC verified to bid" },
                  { icon: Lock, text: "Escrow-protected payment" },
                  { icon: FileText, text: "Binding bid — full audit trail" },
                ].map(({ icon: Icon, text }) => (
                  <div key={text} className="flex items-center gap-2 text-xs text-text-secondary">
                    <Icon className="w-3.5 h-3.5 text-ocean shrink-0" />
                    <span>{text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Auction info card */}
          <div className="bg-white rounded-xl border border-border p-4 shadow-sm space-y-2.5">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Auction Details</p>
            {[
              { label: "Starting Bid", value: `$${Number(auction.starting_bid).toLocaleString()} ${auction.currency}` },
              { label: "Total Bids", value: String(auction.bid_count) },
              { label: "Ends", value: new Date(auction.end_time).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between text-sm">
                <span className="text-text-secondary">{label}</span>
                <span className="font-medium text-text-primary">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
