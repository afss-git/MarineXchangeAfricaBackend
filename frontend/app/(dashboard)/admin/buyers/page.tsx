"use client"

import { useState } from "react"
import Link from "next/link"
import { Search, RefreshCw, Users, AlertCircle, Loader2, ShieldCheck, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { useAdminUsers } from "@/lib/hooks"

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

const KYC_CFG: Record<string, { label: string; className: string }> = {
  not_started: { label: "Not Started",  className: "bg-gray-100 text-gray-500 border-gray-200" },
  pending:     { label: "Pending",      className: "bg-warning/10 text-warning border-warning/20" },
  submitted:   { label: "Submitted",    className: "bg-ocean/10 text-ocean border-ocean/20" },
  under_review:{ label: "Under Review", className: "bg-ocean/10 text-ocean border-ocean/20" },
  approved:    { label: "Approved",     className: "bg-success/10 text-success border-success/20" },
  rejected:    { label: "Rejected",     className: "bg-danger/10 text-danger border-danger/20" },
  expired:     { label: "Expired",      className: "bg-orange-50 text-orange-600 border-orange-200" },
}

const KYC_TABS = [
  { value: "",            label: "All" },
  { value: "approved",    label: "Approved" },
  { value: "submitted",   label: "Submitted" },
  { value: "under_review",label: "Under Review" },
  { value: "rejected",    label: "Rejected" },
  { value: "not_started", label: "Not Started" },
]

export default function AdminBuyersPage() {
  const [search, setSearch] = useState("")
  const [kycFilter, setKycFilter] = useState("")
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 20

  const { data, isLoading, error: swrError, mutate } = useAdminUsers({
    role: "buyer",
    page,
    page_size: PAGE_SIZE,
    search: search || undefined,
    kyc_status: kycFilter || undefined,
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const pages = Math.ceil(total / PAGE_SIZE) || 1

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Buyers</h1>
          <p className="text-sm text-text-secondary">{total} registered buyer{total !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
            <Input
              placeholder="Search name or email…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              className="pl-9 bg-white w-64"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => mutate()} disabled={isLoading} className="gap-1.5">
            <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} /> Refresh
          </Button>
        </div>
      </div>

      {/* KYC filter tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {KYC_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => { setKycFilter(tab.value); setPage(1) }}
            className={cn(
              "px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px shrink-0",
              kycFilter === tab.value
                ? "border-ocean text-ocean"
                : "border-transparent text-text-secondary hover:text-text-primary"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {swrError && (
        <div className="flex items-center gap-2 p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />{swrError.message}
        </div>
      )}

      {isLoading && items.length === 0 ? (
        <div className="flex items-center justify-center py-16 gap-2 text-text-secondary text-sm">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading buyers…
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-border p-12 text-center">
          <Users className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-text-secondary">No buyers found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((buyer) => {
            const kyc = KYC_CFG[buyer.kyc_status ?? "not_started"] ?? KYC_CFG.not_started
            return (
              <Link key={buyer.id} href={`/admin/buyers/${buyer.id}`}>
                <div className="bg-white rounded-xl border border-border shadow-sm px-5 py-4 flex items-center gap-4 hover:border-ocean/30 hover:shadow-md transition-all cursor-pointer group">
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-full bg-ocean/10 flex items-center justify-center shrink-0">
                    <span className="text-ocean font-bold text-sm">
                      {(buyer.full_name || buyer.email || "?")[0].toUpperCase()}
                    </span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-text-primary">{buyer.full_name || "—"}</p>
                      {!buyer.is_active && (
                        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full border border-gray-200">Inactive</span>
                      )}
                    </div>
                    <p className="text-xs text-text-secondary truncate">{buyer.email} {buyer.company_name ? `· ${buyer.company_name}` : ""} {buyer.country ? `· ${buyer.country}` : ""}</p>
                  </div>

                  {/* Stats */}
                  <div className="hidden sm:flex items-center gap-6 text-xs text-text-secondary shrink-0">
                    <div className="text-center">
                      <p className="font-semibold text-text-primary">{(buyer as any).total_deals ?? 0}</p>
                      <p>Deals</p>
                    </div>
                    <div className="text-center">
                      <p className="font-semibold text-text-primary">{(buyer as any).purchase_requests ?? 0}</p>
                      <p>Requests</p>
                    </div>
                    <div className="text-center">
                      <p className="font-semibold text-text-primary">{fmtDate(buyer.created_at)}</p>
                      <p>Joined</p>
                    </div>
                  </div>

                  {/* KYC badge */}
                  <Badge className={cn("text-xs border shrink-0", kyc.className)}>
                    <ShieldCheck className="w-3 h-3 mr-1" />{kyc.label}
                  </Badge>

                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-ocean transition-colors shrink-0" />
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-sm text-text-secondary">Page {page} of {pages} · {total} total</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page <= 1 || isLoading}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= pages || isLoading}>Next</Button>
          </div>
        </div>
      )}
    </div>
  )
}
