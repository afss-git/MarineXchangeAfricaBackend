"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useAuth } from "@/lib/auth"
import { PageTour } from "@/components/tour/tour-engine"
import { AUCTIONS_TOUR } from "@/components/tour/tour-definitions"
import {
  Search,
  Clock,
  Flame,
  ShieldCheck,
  Gavel,
  Filter,
  TrendingUp,
  AlertCircle,
  Trophy,
  Loader2,
  CheckCircle2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { type PublicAuctionListItem, type MyAuctionBid } from "@/lib/api"
import { useAuctions, useAllMyBids } from "@/lib/hooks"

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "Ended"
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

const statusConfig: Record<string, { label: string; style: string; dot: string }> = {
  live:         { label: "Live",         style: "bg-success/10 text-success border-success/20",    dot: "bg-success" },
  ending_soon:  { label: "Ending Soon",  style: "bg-danger/10 text-danger border-danger/20",       dot: "bg-danger" },
  upcoming:     { label: "Upcoming",     style: "bg-gray-100 text-text-secondary border-gray-200", dot: "bg-gray-400" },
  closed:       { label: "Closed",       style: "bg-gray-100 text-text-secondary border-gray-200", dot: "bg-gray-400" },
}

const TAB_STATUS: Record<string, string | null> = {
  "All": null,
  "Live": "live",
  "Ending Soon": "ending_soon",
  "Upcoming": "upcoming",
}

function CardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden animate-pulse">
      <div className="h-44 bg-gray-200" />
      <div className="p-4 space-y-3">
        <div className="h-4 bg-gray-200 rounded w-3/4" />
        <div className="flex gap-2">
          <div className="h-5 bg-gray-200 rounded w-24" />
          <div className="h-5 bg-gray-200 rounded w-20" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="h-10 bg-gray-200 rounded" />
          <div className="h-10 bg-gray-200 rounded" />
        </div>
        <div className="h-9 bg-gray-200 rounded" />
      </div>
    </div>
  )
}

// ── My Bids Panel ──────────────────────────────────────────────────────────────

function MyBidsPanel() {
  const { data: bids = [], isLoading: loading, error: swrError, mutate } = useAllMyBids()
  const error = swrError?.message ?? null

  if (loading && !bids.length) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-ocean animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger">
        <AlertCircle className="w-5 h-5 shrink-0" />
        <span className="text-sm">{error}</span>
        <button onClick={() => mutate()} className="ml-auto text-sm underline">Retry</button>
      </div>
    )
  }

  if (!bids.length) {
    return (
      <div className="py-16 text-center">
        <Gavel className="w-12 h-12 text-gray-200 mx-auto mb-3" />
        <p className="text-text-secondary">You haven&apos;t placed any bids yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {bids.map((bid) => (
        <Link key={bid.id} href={`/auctions/${bid.auction_id}`}>
          <div className="bg-white rounded-xl border border-border p-4 hover:shadow-sm transition-shadow">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-text-primary">
                    {parseFloat(bid.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} {bid.currency}
                  </p>
                  {bid.is_winning ? (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-success/10 text-success font-medium border border-success/20">
                      <Trophy className="w-3 h-3" /> Winning
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-text-secondary border border-gray-200">
                      Outbid
                    </span>
                  )}
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded-full border capitalize",
                    bid.auction_status === "live" || bid.auction_status === "ending_soon"
                      ? "bg-success/10 text-success border-success/20"
                      : "bg-gray-100 text-text-secondary border-gray-200"
                  )}>
                    {bid.auction_status.replace(/_/g, " ")}
                  </span>
                </div>
                <p className="text-xs text-text-secondary mt-1">
                  Auction ID: {bid.auction_id.slice(0, 8)}…
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-text-secondary">
                  {new Date(bid.placed_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </p>
              </div>
            </div>
          </div>
        </Link>
      ))}
      <p className="text-center text-xs text-text-secondary pt-2">
        {bids.length} bid{bids.length !== 1 ? "s" : ""} placed across all auctions
      </p>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AuctionsPage() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState("All")
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(t)
  }, [search])

  const aucParams = activeTab !== "My Bids"
    ? { page_size: 50, ...(TAB_STATUS[activeTab] ? { status: TAB_STATUS[activeTab]! } : {}) }
    : undefined
  const { data: aucData, isLoading: swrLoading, error: swrError, mutate } = useAuctions(aucParams)
  const items = aucData?.items ?? []
  const isLoading = !aucData && swrLoading && activeTab !== "My Bids"
  const error = swrError?.message ?? null

  const liveCount = items.filter((a) => a.status === "live" || a.status === "ending_soon").length

  const filtered = items.filter((a) => {
    if (!debouncedSearch) return true
    const q = debouncedSearch.toLowerCase()
    return (a.title ?? "").toLowerCase().includes(q) || (a.product_title ?? "").toLowerCase().includes(q)
  })

  const tabs = [
    { label: "All",          count: null },
    { label: "Live",         count: null },
    { label: "Ending Soon",  count: null },
    { label: "Upcoming",     count: null },
    { label: "My Bids",      count: null },
  ]

  return (
    <div className="space-y-5">
      {user?.id && (
        <PageTour pageKey="auctions" userId={String(user.id)} steps={AUCTIONS_TOUR} />
      )}

      {/* Live banner */}
      <div data-tour="auction-live-banner" className="bg-navy rounded-xl p-4 flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-success" />
          </span>
          <span className="text-white font-semibold text-sm">
            {isLoading ? "Loading..." : `${liveCount} Live Auction${liveCount !== 1 ? "s" : ""}`}
          </span>
        </div>
        <span className="text-white/50 text-sm hidden sm:block">·</span>
        <span className="text-white/70 text-sm hidden sm:block">KYC verification required to place bids</span>
        <div className="ml-auto flex items-center gap-1.5 text-white/60 text-sm">
          <ShieldCheck className="w-4 h-4 text-ocean" />
          <span className="hidden sm:block">Escrow-protected</span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="text-sm">{error}</span>
          <Button variant="outline" size="sm" onClick={() => mutate()} className="ml-auto border-danger/30 text-danger">Retry</Button>
        </div>
      )}

      {/* Search + filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div data-tour="auction-search" className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
          <Input
            placeholder="Search auctions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-white"
          />
        </div>
        <Button variant="outline" size="sm">
          <Filter className="w-4 h-4 mr-1.5" /> Filter
        </Button>
      </div>

      {/* Tabs */}
      <div data-tour="auction-tabs" className="flex gap-1 border-b border-border overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.label}
            onClick={() => setActiveTab(tab.label)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px shrink-0",
              activeTab === tab.label
                ? "border-ocean text-ocean"
                : "border-transparent text-text-secondary hover:text-text-primary"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* My Bids panel */}
      {activeTab === "My Bids" && <MyBidsPanel />}

      {/* Auction cards grid */}
      {activeTab !== "My Bids" && <div data-tour="auction-grid" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)
          : filtered.length === 0
          ? (
            <div className="col-span-full py-16 text-center">
              <Gavel className="w-12 h-12 text-gray-200 mx-auto mb-3" />
              <p className="text-text-secondary">No auctions found</p>
              {search && (
                <Button variant="ghost" size="sm" className="mt-3 text-ocean" onClick={() => setSearch("")}>
                  Clear search
                </Button>
              )}
            </div>
          )
          : filtered.map((auction) => {
            const status = statusConfig[auction.status] ?? statusConfig["live"]
            const isEndingSoon = auction.status === "ending_soon"
            const currentBid = auction.current_highest_bid ?? auction.starting_bid
            const isLive = auction.status === "live" || auction.status === "ending_soon"
            return (
              <Link key={auction.id} href={`/auctions/${auction.id}`}>
                <div className={cn(
                  "bg-white rounded-xl border overflow-hidden hover:shadow-lg transition-all group",
                  isEndingSoon ? "border-danger/30" : "border-border"
                )}>
                  {/* Image placeholder */}
                  <div className="relative h-44 bg-gray-100 flex items-center justify-center">
                    <Gavel className="w-10 h-10 text-gray-300" />
                    <Badge className={cn("absolute top-3 left-3 text-xs border flex items-center gap-1", status.style)}>
                      <span className={cn("w-1.5 h-1.5 rounded-full", isLive ? "animate-pulse" : "", status.dot)} />
                      {status.label}
                    </Badge>
                    {auction.reserve_status === "reserve_met" && (
                      <div className="absolute top-3 right-3 flex items-center gap-1 bg-success text-white text-xs px-2 py-1 rounded-full">
                        <ShieldCheck className="w-3 h-3" />
                        <span>Reserve Met</span>
                      </div>
                    )}
                    {isEndingSoon && (
                      <div className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-danger text-white text-xs px-2.5 py-1.5 rounded-lg font-semibold">
                        <Flame className="w-3.5 h-3.5" />
                        Ends in {formatCountdown(auction.time_remaining_seconds)}
                      </div>
                    )}
                  </div>

                  {/* Body */}
                  <div className="p-4">
                    <h3 className="font-semibold text-text-primary line-clamp-1 group-hover:text-ocean transition-colors">
                      {auction.title}
                    </h3>

                    {/* Bid info */}
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-xs text-text-secondary">Starting Bid</p>
                        <p className="text-sm font-medium text-text-secondary">
                          ${Number(auction.starting_bid).toLocaleString()} {auction.currency}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-text-secondary">
                          {auction.current_highest_bid ? "Current Bid" : "Starting Bid"}
                        </p>
                        <p className="text-sm font-bold text-navy">
                          ${Number(currentBid).toLocaleString()} {auction.currency}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between mt-3">
                      <div className="flex items-center gap-1.5 text-sm text-text-secondary">
                        <Gavel className="w-4 h-4" />
                        <span>{auction.bid_count} bid{auction.bid_count !== 1 ? "s" : ""}</span>
                      </div>
                      {!isEndingSoon && auction.time_remaining_seconds > 0 && (
                        <div className="flex items-center gap-1 text-sm text-text-secondary">
                          <Clock className="w-4 h-4" />
                          <span>{formatCountdown(auction.time_remaining_seconds)}</span>
                        </div>
                      )}
                      {auction.current_highest_bid && (
                        <div className="flex items-center gap-1 text-xs text-success">
                          <TrendingUp className="w-3 h-3" />
                          <span>Active bidding</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="px-4 pb-4">
                    <Button className={cn(
                      "w-full text-white",
                      isEndingSoon ? "bg-danger hover:bg-danger/90" : "bg-ocean hover:bg-ocean-dark"
                    )}>
                      <Gavel className="w-4 h-4 mr-2" />
                      {auction.status === "upcoming" ? "View Auction" : "Place Bid"}
                    </Button>
                  </div>
                </div>
              </Link>
            )
          })
        }
      </div>}

      {activeTab !== "My Bids" && (
        <div className="flex items-center justify-center gap-2 py-3 text-sm text-text-secondary">
          <ShieldCheck className="w-4 h-4 text-ocean" />
          <span>All auction bids are KYC-verified and escrow-protected</span>
        </div>
      )}
    </div>
  )
}
