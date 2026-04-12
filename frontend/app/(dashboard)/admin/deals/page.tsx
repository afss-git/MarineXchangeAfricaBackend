"use client"

import { useState } from "react"
import Link from "next/link"
import {
  Handshake, Search, Filter, RefreshCw, AlertCircle,
  ArrowRight, CheckCircle2, XCircle, Clock, AlertTriangle,
  ChevronLeft, ChevronRight, DollarSign, Plus, Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useAdminDeals } from "@/lib/hooks"

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  })
}

function fmtMoney(amount: string, currency: string) {
  const n = parseFloat(amount)
  if (isNaN(n)) return amount
  return `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const STATUS_CFG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  draft:            { label: "Draft",            color: "bg-gray-100 text-text-secondary border-gray-200", icon: Clock },
  offer_sent:       { label: "Offer Sent",       color: "bg-ocean/10 text-ocean border-ocean/20",          icon: Zap },
  accepted:         { label: "Accepted",         color: "bg-success/10 text-success border-success/20",    icon: CheckCircle2 },
  active:           { label: "Active",           color: "bg-ocean/10 text-ocean border-ocean/20",          icon: CheckCircle2 },
  completed:        { label: "Completed",        color: "bg-navy/10 text-navy border-navy/20",             icon: CheckCircle2 },
  cancelled:        { label: "Cancelled",        color: "bg-gray-100 text-text-secondary border-gray-200", icon: XCircle },
  disputed:         { label: "Disputed",         color: "bg-danger/10 text-danger border-danger/20",       icon: AlertTriangle },
  defaulted:        { label: "Defaulted",        color: "bg-danger/10 text-danger border-danger/20",       icon: AlertTriangle },
  pending_approval: { label: "Pending Approval", color: "bg-warning/10 text-warning border-warning/20",   icon: Clock },
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
  { value: "",                label: "All" },
  { value: "draft",           label: "Draft" },
  { value: "offer_sent",      label: "Offer Sent" },
  { value: "accepted",        label: "Accepted" },
  { value: "active",          label: "Active" },
  { value: "completed",       label: "Completed" },
  { value: "disputed",        label: "Disputed" },
  { value: "cancelled",       label: "Cancelled" },
]

const TYPE_FILTERS = [
  { value: "",              label: "All Types" },
  { value: "full_payment",  label: "Full Payment" },
  { value: "financing",     label: "Financing" },
]

const PAGE_SIZE = 20

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminDealsPage() {
  const [page, setPage]             = useState(1)
  const [status, setStatus]         = useState("")
  const [dealType, setDealType]     = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch]         = useState("")

  const { data: deals = [], isLoading, error: swrError, mutate } = useAdminDeals({
    page, page_size: PAGE_SIZE,
    ...(status ? { status } : {}),
    ...(dealType ? { deal_type: dealType } : {}),
  })
  const total = deals.length
  const error = swrError?.message ?? null

  const filtered = search
    ? deals.filter((d) =>
        d.deal_ref?.toLowerCase().includes(search.toLowerCase()) ||
        d.product_title?.toLowerCase().includes(search.toLowerCase()) ||
        d.buyer_name?.toLowerCase().includes(search.toLowerCase()) ||
        d.buyer_email?.toLowerCase().includes(search.toLowerCase()) ||
        d.seller_name?.toLowerCase().includes(search.toLowerCase())
      )
    : deals

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const counts = {
    active:    deals.filter((d) => d.status === "active").length,
    draft:     deals.filter((d) => d.status === "draft").length,
    disputed:  deals.filter((d) => d.status === "disputed").length,
    completed: deals.filter((d) => d.status === "completed").length,
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-ocean/10">
            <Handshake className="w-5 h-5 text-ocean" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-text-primary">Deal Management</h1>
            <p className="text-sm text-text-secondary">
              {isLoading ? "Loading…" : `${total.toLocaleString()} deal${total !== 1 ? "s" : ""}`}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => mutate()} disabled={isLoading}>
            <RefreshCw className={cn("w-4 h-4 mr-1.5", isLoading && "animate-spin")} />Refresh
          </Button>
          <Link href="/admin/deals/new">
            <Button size="sm" className="bg-ocean hover:bg-ocean-dark text-white gap-1.5">
              <Plus className="w-4 h-4" />New Deal
            </Button>
          </Link>
        </div>
      </div>

      {/* Summary cards */}
      {!isLoading && !error && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Active",    value: counts.active,    color: "text-success",        bg: "bg-success/10",  icon: CheckCircle2 },
            { label: "Draft",     value: counts.draft,     color: "text-text-secondary", bg: "bg-gray-100",    icon: Clock },
            { label: "Disputed",  value: counts.disputed,  color: "text-danger",         bg: "bg-danger/10",   icon: AlertTriangle },
            { label: "Completed", value: counts.completed, color: "text-navy",           bg: "bg-navy/10",     icon: DollarSign },
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
          {/* Status tabs */}
          <div className="flex gap-1">
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
          {/* Type filter */}
          <select
            value={dealType}
            onChange={(e) => { setDealType(e.target.value); setPage(1) }}
            className="px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean bg-white text-text-secondary"
          >
            {TYPE_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>

          <div className="flex-1" />

          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") setSearch(searchInput) }}
              placeholder="Search ref, buyer, product…"
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
                {["Reference", "Product", "Type", "Buyer", "Seller", "Value", "Status", "Created", ""].map((h) => (
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
                      <Handshake className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                      <p className="text-sm text-text-secondary">No deals found</p>
                    </td>
                  </tr>
                ) : filtered.map((deal) => (
                  <tr key={deal.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs font-semibold text-text-primary">{deal.deal_ref}</span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-text-primary max-w-40 truncate">{deal.product_title ?? "—"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
                        deal.deal_type === "financing" ? "bg-ocean/10 text-ocean" : "bg-gray-100 text-text-secondary"
                      )}>
                        {deal.deal_type === "financing" ? "Financing" : "Full Pay"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-text-primary font-medium truncate max-w-30">{deal.buyer_name ?? "—"}</p>
                      {deal.buyer_email && <p className="text-xs text-text-secondary truncate max-w-30">{deal.buyer_email}</p>}
                    </td>
                    <td className="px-4 py-3 text-text-primary">{deal.seller_name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-text-primary whitespace-nowrap">
                        {fmtMoney(deal.total_price, deal.currency)}
                      </p>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={deal.status} /></td>
                    <td className="px-4 py-3 text-text-secondary text-xs whitespace-nowrap">{fmtDate(deal.created_at)}</td>
                    <td className="px-4 py-3">
                      <Link href={`/admin/deals/${deal.id}`}>
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
