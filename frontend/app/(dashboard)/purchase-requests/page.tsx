"use client"

import { useState } from "react"
import Link from "next/link"
import {
  Search,
  Plus,
  ChevronRight,
  ShieldCheck,
  Clock,
  CheckCircle2,
  XCircle,
  MessageSquare,
  AlertCircle,
  FileText,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { type PurchaseRequest } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { usePurchaseRequests } from "@/lib/hooks"
import { PageTour } from "@/components/tour/tour-engine"
import { PURCHASE_REQUESTS_TOUR } from "@/components/tour/tour-definitions"

const statusConfig: Record<string, { label: string; style: string; icon: React.ElementType }> = {
  pending: { label: "Pending", style: "bg-warning/10 text-warning border-warning/20", icon: Clock },
  accepted: { label: "Accepted", style: "bg-success/10 text-success border-success/20", icon: CheckCircle2 },
  rejected: { label: "Rejected", style: "bg-danger/10 text-danger border-danger/20", icon: XCircle },
  negotiating: { label: "Negotiating", style: "bg-ocean/10 text-ocean border-ocean/20", icon: MessageSquare },
  deal_created: { label: "Deal Created", style: "bg-navy/10 text-navy border-navy/20", icon: ShieldCheck },
  cancelled: { label: "Cancelled", style: "bg-gray-100 text-text-secondary border-gray-200", icon: XCircle },
}

const tabs = ["All", "Pending", "Negotiating", "Accepted", "Deal Created", "Rejected"]

function CardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-border p-5 animate-pulse">
      <div className="flex gap-4">
        <div className="w-24 h-16 bg-gray-200 rounded-lg shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-gray-200 rounded w-3/4" />
          <div className="h-3 bg-gray-200 rounded w-1/2" />
          <div className="flex gap-4 mt-3">
            <div className="h-8 bg-gray-200 rounded w-20" />
            <div className="h-8 bg-gray-200 rounded w-24" />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function PurchaseRequestsPage() {
  const { user } = useAuth()
  const isSeller = user?.roles?.includes("seller") && !user?.roles?.includes("buyer")

  const [activeTab, setActiveTab] = useState("All")
  const [search, setSearch] = useState("")

  const tabToStatus: Record<string, string> = {
    "Pending": "pending",
    "Negotiating": "negotiating",
    "Accepted": "accepted",
    "Deal Created": "deal_created",
    "Rejected": "rejected",
  }

  const prParams = isSeller ? undefined : {
    page_size: 50,
    status: activeTab !== "All" ? tabToStatus[activeTab] : undefined,
  }
  const { data, isLoading: swrLoading, error: swrError, mutate } = usePurchaseRequests(prParams)
  const isLoading = !isSeller && !data && swrLoading
  const error = swrError?.message ?? null

  const filtered = (data?.items ?? []).filter((r) =>
    (r.product_title ?? "").toLowerCase().includes(search.toLowerCase())
  )

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })

  return (
    <div className="space-y-5">
      {user?.id && !isSeller && (
        <PageTour pageKey="purchase-requests" userId={String(user.id)} steps={PURCHASE_REQUESTS_TOUR} />
      )}

      {/* Top bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div data-tour="pr-search" className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
          <Input
            placeholder="Search requests..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-white"
          />
        </div>
        {!isSeller && (
          <Link href="/marketplace" data-tour="pr-new-btn">
            <Button className="bg-ocean hover:bg-ocean-dark text-white">
              <Plus className="w-4 h-4 mr-2" /> New Request
            </Button>
          </Link>
        )}
      </div>

      {/* Tabs */}
      <div data-tour="pr-tabs" className="flex gap-1 border-b border-border overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px shrink-0",
              activeTab === tab
                ? "border-ocean text-ocean"
                : "border-transparent text-text-secondary hover:text-text-primary"
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="text-sm">{error}</span>
          <Button variant="outline" size="sm" onClick={() => mutate()} className="ml-auto border-danger/30 text-danger">Retry</Button>
        </div>
      )}

      {/* Request cards */}
      <div className="space-y-3">
        {isLoading
          ? Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)
          : filtered.length === 0
          ? (
            <div className="bg-white rounded-xl border border-border p-12 text-center">
              <FileText className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-text-secondary">No purchase requests found</p>
              {isSeller ? (
                <p className="text-xs text-text-secondary mt-2">
                  Purchase requests are submitted by buyers. List products on the marketplace to receive requests.
                </p>
              ) : (
                <Link href="/marketplace">
                  <Button size="sm" className="mt-4 bg-ocean hover:bg-ocean-dark text-white">
                    Browse Marketplace
                  </Button>
                </Link>
              )}
            </div>
          )
          : filtered.map((req) => {
            const config = statusConfig[req.status] ?? statusConfig["pending"]
            const StatusIcon = config.icon
            return (
              <Link key={req.id} href={`/purchase-requests/${req.id}`}>
                <div className="bg-white rounded-xl border border-border p-5 shadow-sm hover:shadow-md hover:border-ocean/30 transition-all group">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                    <div className="w-full sm:w-24 h-20 sm:h-16 bg-gray-100 rounded-lg shrink-0" />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <h3 className="font-semibold text-text-primary group-hover:text-ocean transition-colors line-clamp-1">
                            {req.product_title ?? "Asset Listing"}
                          </h3>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="secondary" className="text-xs capitalize">
                              {req.purchase_type.replace(/_/g, " ")}
                            </Badge>
                            <span className="text-xs text-text-secondary">
                              Qty: {req.quantity}
                            </span>
                          </div>
                        </div>
                        <Badge className={cn("text-xs border shrink-0 flex items-center gap-1", config.style)}>
                          <StatusIcon className="w-3 h-3" />
                          {config.label}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-6 mt-3 flex-wrap">
                        {req.offered_price && (
                          <div>
                            <p className="text-xs text-text-secondary">Your Offer</p>
                            <p className="text-sm font-semibold text-navy">
                              ${Number(req.offered_price).toLocaleString()} {req.offered_currency}
                            </p>
                          </div>
                        )}
                        <div>
                          <p className="text-xs text-text-secondary">Submitted</p>
                          <p className="text-sm text-text-secondary">{formatDate(req.created_at)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-text-secondary">Last Update</p>
                          <p className="text-sm text-text-secondary">{formatDate(req.updated_at)}</p>
                        </div>
                        {req.converted_deal_id && (
                          <div className="flex items-center gap-1.5 text-sm text-success">
                            <CheckCircle2 className="w-4 h-4" />
                            <span className="font-medium">Deal created</span>
                          </div>
                        )}
                      </div>

                      {req.message && (
                        <p className="mt-2 text-sm text-text-secondary line-clamp-1 italic">
                          "{req.message}"
                        </p>
                      )}
                    </div>

                    <ChevronRight className="w-5 h-5 text-text-secondary group-hover:text-ocean transition-colors shrink-0 self-center hidden sm:block" />
                  </div>
                </div>
              </Link>
            )
          })}
      </div>

      <div data-tour="pr-audit-footer" className="flex items-center justify-center gap-2 py-3 text-sm text-text-secondary">
        <ShieldCheck className="w-4 h-4 text-ocean" />
        <span>All purchase requests are recorded in the audit trail</span>
      </div>
    </div>
  )
}
