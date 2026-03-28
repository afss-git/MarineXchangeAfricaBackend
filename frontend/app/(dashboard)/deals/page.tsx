"use client"

import { useState } from "react"
import Link from "next/link"
import {
  Search,
  ChevronRight,
  ShieldCheck,
  Clock,
  CheckCircle2,
  Handshake,
  DollarSign,
  AlertCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { type Deal } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useDeals, useMySales } from "@/lib/hooks"
import { PageTour } from "@/components/tour/tour-engine"
import { DEALS_TOUR } from "@/components/tour/tour-definitions"

const statusConfig: Record<string, { label: string; style: string; icon: React.ElementType }> = {
  in_progress: { label: "In Progress", style: "bg-ocean/10 text-ocean border-ocean/20", icon: Handshake },
  awaiting_payment: { label: "Awaiting Payment", style: "bg-warning/10 text-warning border-warning/20", icon: DollarSign },
  payment_received: { label: "Payment Received", style: "bg-success/10 text-success border-success/20", icon: CheckCircle2 },
  completed: { label: "Completed", style: "bg-gray-100 text-text-secondary border-gray-200", icon: CheckCircle2 },
  disputed: { label: "Disputed", style: "bg-danger/10 text-danger border-danger/20", icon: Clock },
}

const tabs = ["All", "In Progress", "Awaiting Payment", "Completed"]

const tabToStatus: Record<string, string> = {
  "In Progress": "in_progress",
  "Awaiting Payment": "awaiting_payment",
  "Completed": "completed",
}

function CardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-border p-5 animate-pulse">
      <div className="flex gap-4">
        <div className="w-24 h-16 bg-gray-200 rounded-lg shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-gray-200 rounded w-3/4" />
          <div className="h-3 bg-gray-200 rounded w-1/2" />
          <div className="flex gap-4 mt-3">
            <div className="h-8 bg-gray-200 rounded w-24" />
            <div className="h-8 bg-gray-200 rounded w-20" />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function DealsPage() {
  const { user } = useAuth()
  const isSeller = user?.roles?.includes("seller") && !user?.roles?.includes("buyer")

  const [activeTab, setActiveTab] = useState("All")
  const [search, setSearch] = useState("")

  const params = {
    page_size: 50,
    status: activeTab !== "All" ? tabToStatus[activeTab] : undefined,
  }
  const { data: buyerData, isLoading: buyerLoading, error: buyerErr } = useDeals(isSeller ? undefined : params)
  const { data: sellerData, isLoading: sellerLoading, error: sellerErr } = useMySales(isSeller ? params : undefined)

  const data = isSeller ? sellerData : buyerData
  const isLoading = isSeller ? (!sellerData && sellerLoading) : (!buyerData && buyerLoading)
  const error = (isSeller ? sellerErr : buyerErr)?.message ?? null

  const filtered = (data?.items ?? []).filter((d) =>
    (d.product_title ?? "").toLowerCase().includes(search.toLowerCase())
  )

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })

  return (
    <div className="space-y-5">
      {user?.id && !isSeller && (
        <PageTour pageKey="deals" userId={String(user.id)} steps={DEALS_TOUR} />
      )}

      {/* Top bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div data-tour="deals-search" className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
          <Input
            placeholder="Search deals..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-white"
          />
        </div>
      </div>

      {/* Tabs */}
      <div data-tour="deals-tabs" className="flex gap-1 border-b border-border overflow-x-auto">
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
          <Button variant="outline" size="sm" className="ml-auto border-danger/30 text-danger">Retry</Button>
        </div>
      )}

      {/* Deal cards */}
      <div className="space-y-3">
        {isLoading
          ? Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)
          : filtered.length === 0
          ? (
            <div className="bg-white rounded-xl border border-border p-12 text-center">
              <Handshake className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-text-secondary">No deals found</p>
              <p className="text-xs text-text-secondary mt-1">
                {isSeller
                  ? "Deals will appear here once a buyer's purchase request is approved and converted."
                  : "Submit a purchase request from the marketplace to start a deal"}
              </p>
            </div>
          )
          : filtered.map((deal) => {
            const config = statusConfig[deal.status] ?? statusConfig["in_progress"]
            const StatusIcon = config.icon
            return (
              <Link key={deal.id} href={`/deals/${deal.id}`}>
                <div className="bg-white rounded-xl border border-border p-5 shadow-sm hover:shadow-md hover:border-ocean/30 transition-all group">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                    <div className="w-full sm:w-24 h-20 sm:h-16 bg-gray-100 rounded-lg shrink-0 flex items-center justify-center">
                      <Handshake className="w-6 h-6 text-gray-300" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <h3 className="font-semibold text-text-primary group-hover:text-ocean transition-colors line-clamp-1">
                            {deal.product_title ?? `Deal ${deal.reference}`}
                          </h3>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-text-secondary font-mono">{deal.reference}</span>
                          </div>
                        </div>
                        <Badge className={cn("text-xs border shrink-0 flex items-center gap-1", config.style)}>
                          <StatusIcon className="w-3 h-3" />
                          {config.label}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-6 mt-3 flex-wrap">
                        <div>
                          <p className="text-xs text-text-secondary">Agreed Price</p>
                          <p className="text-sm font-bold text-navy">
                            {deal.agreed_price
                              ? `$${Number(deal.agreed_price).toLocaleString()} ${deal.currency}`
                              : `$${Number(deal.asking_price).toLocaleString()} ${deal.currency}`}
                          </p>
                        </div>
                        {deal.escrow_status && (
                          <div>
                            <p className="text-xs text-text-secondary">Escrow</p>
                            <p className="text-sm text-text-secondary capitalize">
                              {deal.escrow_status.replace(/_/g, " ")}
                            </p>
                          </div>
                        )}
                        <div>
                          <p className="text-xs text-text-secondary">Created</p>
                          <p className="text-sm text-text-secondary">{formatDate(deal.created_at)}</p>
                        </div>
                        {deal.current_milestone && deal.status !== "completed" && (
                          <div className="flex items-center gap-2 text-sm ml-auto">
                            <div className="w-1.5 h-1.5 rounded-full bg-ocean animate-pulse" />
                            <span className="text-ocean font-medium capitalize">
                              {deal.current_milestone.replace(/_/g, " ")}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    <ChevronRight className="w-5 h-5 text-text-secondary group-hover:text-ocean transition-colors shrink-0 self-center hidden sm:block" />
                  </div>
                </div>
              </Link>
            )
          })}
      </div>

      <div data-tour="deals-escrow-footer" className="flex items-center justify-center gap-2 py-3 text-sm text-text-secondary">
        <ShieldCheck className="w-4 h-4 text-ocean" />
        <span>All deals are escrow-protected and fully audited</span>
      </div>
    </div>
  )
}
