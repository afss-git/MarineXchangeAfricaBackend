"use client"

import { useState } from "react"
import Link from "next/link"
import {
  Gavel, Search, Filter, RefreshCw, AlertCircle, ArrowRight,
  CheckCircle2, XCircle, Clock, AlertTriangle, ChevronLeft,
  ChevronRight, Plus, Zap, Calendar, Trophy,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { auctionAdmin, type AdminAuctionListItem } from "@/lib/api"
import { useAdminAuctions } from "@/lib/hooks"

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

function fmtMoney(amount: string | null, currency: string) {
  if (!amount) return "—"
  const n = parseFloat(amount)
  return isNaN(n) ? amount : `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 0 })}`
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
      <Icon className="w-3 h-3" />{cfg.label}
    </span>
  )
}

function RowSkeleton() {
  return (
    <tr className="animate-pulse">
      {Array.from({ length: 8 }).map((_, i) => (
        <td key={i} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-full" /></td>
      ))}
    </tr>
  )
}

const STATUS_FILTERS = [
  { value: "",                       label: "All" },
  { value: "draft",                  label: "Draft" },
  { value: "scheduled",              label: "Scheduled" },
  { value: "live",                   label: "Live" },
  { value: "closing_soon",           label: "Closing" },
  { value: "closed",                 label: "Closed" },
  { value: "winner_pending_approval",label: "Winner Pending" },
  { value: "winner_approved",        label: "Winner Approved" },
  { value: "cancelled",              label: "Cancelled" },
]

const PAGE_SIZE = 20

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminAuctionsPage() {
  const [page, setPage]               = useState(1)
  const [status, setStatus]           = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch]           = useState("")

  const { data, isLoading, error: swrError, mutate } = useAdminAuctions({
    page, page_size: PAGE_SIZE,
    ...(status ? { status } : {}),
  })
  const items = data?.items ?? []
  const total = data?.total ?? 0
  const error = swrError?.message ?? null

  const filtered = search
    ? items.filter((a) =>
        a.title.toLowerCase().includes(search.toLowerCase()) ||
        a.product_title?.toLowerCase().includes(search.toLowerCase())
      )
    : items

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const counts = {
    live:    items.filter((a) => a.status === "live").length,
    draft:   items.filter((a) => a.status === "draft").length,
    pending: items.filter((a) => a.status === "winner_pending_approval").length,
    closed:  items.filter((a) => ["closed", "winner_approved"].includes(a.status)).length,
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-ocean/10">
            <Gavel className="w-5 h-5 text-ocean" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-text-primary">Auction Management</h1>
            <p className="text-sm text-text-secondary">
              {isLoading ? "Loading…" : `${total.toLocaleString()} auction${total !== 1 ? "s" : ""}`}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => mutate()} disabled={isLoading}>
            <RefreshCw className={cn("w-4 h-4 mr-1.5", isLoading && "animate-spin")} />Refresh
          </Button>
          <Link href="/admin/auctions/new">
            <Button size="sm" className="bg-ocean hover:bg-ocean-dark text-white gap-1.5">
              <Plus className="w-4 h-4" />New Auction
            </Button>
          </Link>
        </div>
      </div>

      {/* Summary cards */}
      {!isLoading && !error && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Live",           value: counts.live,    color: "text-success",         bg: "bg-success/10",  icon: Zap },
            { label: "Draft",          value: counts.draft,   color: "text-text-secondary",  bg: "bg-gray-100",    icon: Clock },
            { label: "Winner Pending", value: counts.pending, color: "text-warning",          bg: "bg-warning/10",  icon: Trophy },
            { label: "Closed",         value: counts.closed,  color: "text-navy",             bg: "bg-navy/10",     icon: CheckCircle2 },
          ].map(({ label, value, color, bg, icon: Icon }) => (
            <div key={label} className="bg-white rounded-xl border border-border p-4 flex items-center gap-3">
              <div className={cn("p-2 rounded-lg", bg)}>
                <Icon className={cn("w-5 h-5", color)} />
              </div>
              <div>
                <p className="text-2xl font-bold text-text-primary">{value}</p>
                <p className="text-xs text-text-secondary">{label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="text-sm">{error}</span>
          <Button variant="outline" size="sm" onClick={() => mutate()} className="ml-auto border-danger/30 text-danger">Retry</Button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border">
          <div className="flex gap-1 flex-wrap">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => { setStatus(f.value); setPage(1) }}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                  status === f.value ? "bg-ocean text-white" : "text-text-secondary hover:text-text-primary hover:bg-gray-50"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") setSearch(searchInput) }}
              placeholder="Search title or product…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => setSearch(searchInput)} className="gap-1.5">
            <Filter className="w-3.5 h-3.5" />Filter
          </Button>
          {search && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setSearchInput("") }} className="text-text-secondary">
              Clear
            </Button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-border">
                {["Title", "Product", "Status", "Starting Bid", "Current Bid", "Bids", "Starts", "Ends", ""].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading
                ? Array.from({ length: 8 }).map((_, i) => <RowSkeleton key={i} />)
                : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center">
                      <Gavel className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                      <p className="text-sm text-text-secondary">No auctions found</p>
                    </td>
                  </tr>
                ) : filtered.map((a) => (
                  <tr key={a.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-text-primary max-w-48 truncate">{a.title}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-text-secondary text-xs max-w-36 truncate">{a.product_title ?? "—"}</p>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-text-primary whitespace-nowrap">
                        {fmtMoney(a.starting_bid, a.currency)}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-ocean whitespace-nowrap">
                        {fmtMoney(a.current_highest_bid, a.currency)}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gray-100 text-xs font-bold text-text-primary">
                        {a.bid_count}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-secondary text-xs whitespace-nowrap">{fmtDate(a.start_time)}</td>
                    <td className="px-4 py-3 text-text-secondary text-xs whitespace-nowrap">{fmtDate(a.end_time)}</td>
                    <td className="px-4 py-3">
                      <Link href={`/admin/auctions/${a.id}`}>
                        <Button variant="ghost" size="sm" className="gap-1 text-ocean hover:text-ocean-dark">
                          Manage <ArrowRight className="w-3.5 h-3.5" />
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {!isLoading && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-gray-50/50">
            <p className="text-xs text-text-secondary">Page {page} of {totalPages} · {total} total</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="gap-1">
                <ChevronLeft className="w-4 h-4" />Prev
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="gap-1">
                Next<ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
