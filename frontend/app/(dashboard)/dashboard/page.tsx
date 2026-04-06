"use client"

import Link from "next/link"
import { useAuth } from "@/lib/auth"
import { PageTour } from "@/components/tour/tour-engine"
import { DASHBOARD_TOUR } from "@/components/tour/tour-definitions"
import {
  ShoppingCart,
  Handshake,
  ShieldCheck,
  ArrowRight,
  Clock,
  Package,
  Gavel,
  Store,
  Check,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  type PurchaseRequest,
  type Deal,
  type KycStatusResponse,
  type ProductListItem,
  type PublicAuctionListItem,
} from "@/lib/api"
import {
  usePurchaseRequests,
  useDeals,
  useKycStatus,
  useMarketplace,
  useAuctions,
} from "@/lib/hooks"

const prStatusStyle: Record<string, string> = {
  pending:      "bg-warning/10 text-warning border-warning/20",
  accepted:     "bg-success/10 text-success border-success/20",
  rejected:     "bg-danger/10 text-danger border-danger/20",
  negotiating:  "bg-ocean/10 text-ocean border-ocean/20",
  deal_created: "bg-navy/10 text-navy border-navy/20",
  cancelled:    "bg-gray-100 text-text-secondary border-gray-200",
}

const dealStatusStyle: Record<string, string> = {
  in_progress:      "bg-ocean/10 text-ocean border-ocean/20",
  awaiting_payment: "bg-warning/10 text-warning border-warning/20",
  payment_received: "bg-success/10 text-success border-success/20",
  completed:        "bg-gray-100 text-text-secondary border-gray-200",
  disputed:         "bg-danger/10 text-danger border-danger/20",
}

const kycStepLabels = ["Phone Verified", "Documents Uploaded", "Agent Review", "Verified"]

function kycStepIndex(status: string | null, phoneVerified?: boolean): number {
  if (status === "approved") return 4
  if (status === "under_review" || status === "submitted") return 3
  if (phoneVerified) return 1
  return 0
}

function StatSkeleton() {
  return <div className="bg-white rounded-xl border border-border p-5 h-24 animate-pulse" />
}

function SectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border"><div className="h-4 bg-gray-200 rounded w-40 animate-pulse" /></div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="px-5 py-4 flex items-center gap-3 animate-pulse">
            <div className="w-10 h-10 rounded-lg bg-gray-200 shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3 bg-gray-200 rounded w-1/2" />
              <div className="h-2.5 bg-gray-200 rounded w-1/3" />
            </div>
            <div className="h-5 bg-gray-200 rounded w-16 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { user } = useAuth()
  const { data: prData,  isLoading: prLoading  } = usePurchaseRequests({ page_size: 5 })
  const { data: dealData, isLoading: dealLoading } = useDeals({ page_size: 5 })
  const { data: kycData  } = useKycStatus()
  const { data: mktData  } = useMarketplace({ page_size: 3 })
  const { data: aucData  } = useAuctions({ status: "live", page_size: 3 })

  const isLoading    = (!prData && prLoading) || (!dealData && dealLoading)
  const prs          = prData?.items ?? []
  const deals        = dealData?.items ?? []
  const kyc          = kycData ?? null
  const listings     = mktData?.items ?? []
  const liveAuctions = aucData?.items ?? []

  const openDeals = deals.filter((d) => d.status !== "completed" && d.status !== "cancelled")
  const pendingPRs = prs.filter((p) => p.status === "pending" || p.status === "negotiating")
  const kycStatusLabel = kyc ? (kyc.kyc_status === "approved" ? "Verified" : kyc.kyc_status === "not_submitted" ? (kyc.phone_verified ? "Phone Verified" : "Not Started") : kyc.current_submission_status?.replace(/_/g, " ") ?? kyc.kyc_status) : "—"
  const kycApproved = kyc?.kyc_status === "approved"
  const kycStep = kycStepIndex(kyc?.kyc_status ?? null, kyc?.phone_verified)

  const stats = [
    {
      label: "Purchase Requests",
      value: isLoading ? "—" : prs.length.toString(),
      icon: ShoppingCart,
      badge: pendingPRs.length > 0 ? `${pendingPRs.length} pending` : null,
      href: "/purchase-requests",
      tourKey: undefined,
    },
    {
      label: "Open Deals",
      value: isLoading ? "—" : openDeals.length.toString(),
      icon: Handshake,
      badge: null,
      href: "/deals",
      tourKey: undefined,
    },
    {
      label: "Live Auctions",
      value: isLoading ? "—" : liveAuctions.length.toString(),
      icon: Gavel,
      badge: liveAuctions.length > 0 ? "Live now" : null,
      href: "/auctions",
      tourKey: undefined,
    },
    {
      label: "KYC Status",
      value: isLoading ? "—" : kycStatusLabel,
      icon: ShieldCheck,
      badge: !kycApproved && kyc ? "Action needed" : null,
      href: "/kyc",
      tourKey: "dashboard-kyc-stat",
    },
  ]

  return (
    <div className="space-y-6">
      {user?.id && (
        <PageTour pageKey="dashboard" userId={String(user.id)} steps={DASHBOARD_TOUR} />
      )}
      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => <StatSkeleton key={i} />)
          : stats.map((stat) => (
          <Link key={stat.label} href={stat.href} {...(stat.tourKey ? { "data-tour": stat.tourKey } : {})}>
            <div className="bg-white rounded-xl border border-border p-5 shadow-sm hover:border-ocean/30 hover:shadow-md transition-all group">
              <div className="flex items-start justify-between">
                <div className="p-2.5 rounded-lg bg-ocean/10">
                  <stat.icon className="w-5 h-5 text-ocean" />
                </div>
                {stat.badge && (
                  <Badge className="text-xs border bg-warning/10 text-warning border-warning/20">
                    {stat.badge}
                  </Badge>
                )}
              </div>
              <div className="mt-4">
                <p className="text-2xl font-semibold text-text-primary capitalize">{stat.value}</p>
                <p className="mt-1 text-sm text-text-secondary">{stat.label}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Two column */}
      <div className="grid gap-6 lg:grid-cols-2">

        {/* Recent Purchase Requests */}
        {isLoading ? <SectionSkeleton rows={4} /> : (
          <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-base font-semibold text-text-primary">Recent Purchase Requests</h2>
              <Link href="/purchase-requests">
                <Button variant="ghost" size="sm" className="text-ocean hover:text-ocean-dark hover:bg-ocean/5">
                  View all <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </Link>
            </div>
            {prs.length === 0 ? (
              <div className="p-8 text-center">
                <ShoppingCart className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                <p className="text-sm text-text-secondary">No purchase requests yet</p>
                <Link href="/marketplace">
                  <Button size="sm" className="mt-3 bg-ocean hover:bg-ocean-dark text-white">
                    Browse Marketplace
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {prs.map((pr) => (
                  <Link key={pr.id} href={`/purchase-requests/${pr.id}`}>
                    <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors">
                      <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                        <Package className="w-4 h-4 text-text-secondary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">
                          {pr.product_title ?? "Asset Request"}
                        </p>
                        <p className="text-xs text-text-secondary capitalize">
                          {pr.purchase_type.replace(/_/g, " ")} · {new Date(pr.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                        </p>
                      </div>
                      <Badge className={cn("text-xs border capitalize shrink-0", prStatusStyle[pr.status] ?? prStatusStyle["pending"])}>
                        {pr.status.replace(/_/g, " ")}
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* My Deals */}
        {isLoading ? <SectionSkeleton rows={4} /> : (
          <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-base font-semibold text-text-primary">My Deals</h2>
              <Link href="/deals">
                <Button variant="ghost" size="sm" className="text-ocean hover:text-ocean-dark hover:bg-ocean/5">
                  View all <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </Link>
            </div>
            {deals.length === 0 ? (
              <div className="p-8 text-center">
                <Handshake className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                <p className="text-sm text-text-secondary">No deals yet</p>
                <p className="text-xs text-text-secondary mt-1">Deals are created when a purchase request is accepted</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {deals.map((deal) => (
                  <Link key={deal.id} href={`/deals/${deal.id}`}>
                    <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors">
                      <div className="w-9 h-9 rounded-lg bg-navy/5 flex items-center justify-center shrink-0">
                        <Handshake className="w-4 h-4 text-navy" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">
                          {deal.product_title ?? `Deal ${deal.reference}`}
                        </p>
                        <p className="text-xs text-text-secondary font-mono">{deal.reference}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-navy">
                          ${Number(deal.agreed_price ?? deal.asking_price).toLocaleString()}
                        </p>
                        <Badge className={cn("text-xs border mt-0.5 capitalize", dealStatusStyle[deal.status] ?? dealStatusStyle["in_progress"])}>
                          {deal.status.replace(/_/g, " ")}
                        </Badge>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Live Auctions row */}
      {!isLoading && liveAuctions.length > 0 && (
        <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-danger animate-pulse" />
              <h2 className="text-base font-semibold text-text-primary">Live Auctions</h2>
            </div>
            <Link href="/auctions">
              <Button variant="ghost" size="sm" className="text-ocean hover:text-ocean-dark hover:bg-ocean/5">
                View all <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </div>
          <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-y-0 sm:divide-x">
            {liveAuctions.map((a) => (
              <Link key={a.id} href={`/auctions/${a.id}`}>
                <div className="px-5 py-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="text-sm font-semibold text-text-primary line-clamp-2">{a.title}</p>
                    <Badge className="bg-danger/10 text-danger border border-danger/20 text-xs shrink-0">Live</Badge>
                  </div>
                  <p className="text-lg font-bold text-navy">
                    ${Number(a.current_highest_bid ?? a.starting_bid).toLocaleString()}
                  </p>
                  <p className="text-xs text-text-secondary mt-1">{a.bid_count} bids</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* New Marketplace Listings */}
      {!isLoading && listings.length > 0 && (
        <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-base font-semibold text-text-primary">New Marketplace Listings</h2>
            <Link href="/marketplace">
              <Button variant="ghost" size="sm" className="text-ocean hover:text-ocean-dark hover:bg-ocean/5">
                Browse all <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </div>
          <div className="divide-y divide-border">
            {listings.map((item) => (
              <Link key={item.id} href={`/marketplace/${item.id}`}>
                <div className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors group">
                  <div className="w-16 h-12 rounded-lg bg-gray-100 flex items-center justify-center shrink-0 overflow-hidden">
                    {item.primary_image_url
                      ? <img src={item.primary_image_url} alt={item.title} className="w-full h-full object-cover" />
                      : <Store className="w-6 h-6 text-gray-300" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-text-primary truncate group-hover:text-ocean transition-colors">
                      {item.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      {item.category_name && (
                        <Badge variant="secondary" className="text-xs bg-ocean/10 text-ocean border-0">
                          {item.category_name}
                        </Badge>
                      )}
                      <span className="text-sm text-text-secondary">
                        ${Number(item.asking_price).toLocaleString()} {item.currency}
                      </span>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" className="shrink-0 border-ocean text-ocean hover:bg-ocean hover:text-white">
                    View
                  </Button>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* KYC Banner — only show if not approved */}
      {!isLoading && kyc && kyc.kyc_status !== "approved" && (
        <div className="bg-navy rounded-xl p-6 text-white shadow-lg">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex-1">
              <h3 className="text-lg font-semibold">
                {kyc.kyc_status === "not_submitted" && !kyc.phone_verified
                  ? "Verify your phone to start KYC"
                  : kyc.kyc_status === "not_submitted" && kyc.phone_verified
                  ? "Phone verified — waiting for document requests"
                  : kyc.current_submission_status === "under_review"
                  ? "Your KYC is being reviewed"
                  : kyc.current_submission_status === "rejected"
                  ? "KYC verification failed — resubmit required"
                  : "Complete KYC to unlock full trading"}
              </h3>
              <p className="mt-1 text-sm text-white/70">
                {kyc.kyc_status === "not_submitted" && !kyc.phone_verified
                  ? "Start by verifying your phone number. A verification agent will then request specific documents from you."
                  : kyc.kyc_status === "not_submitted" && kyc.phone_verified
                  ? "A verification agent will be assigned to review your profile and request the documents needed."
                  : kyc.current_submission_status === "under_review"
                  ? "Our verification team is reviewing your documents. This typically takes 1–2 business days."
                  : kyc.rejection_reason
                  ? `Reason: ${kyc.rejection_reason}`
                  : ""}
              </p>

              {/* Progress Steps */}
              <div className="mt-5">
                <div className="flex items-center gap-1">
                  {kycStepLabels.map((label, index) => {
                    const completed = index < kycStep
                    const current = index === kycStep
                    return (
                      <div key={label} className="flex items-center">
                        <div className="flex flex-col items-center">
                          <div className={cn(
                            "flex items-center justify-center w-7 h-7 rounded-full text-sm font-medium transition-colors",
                            completed ? "bg-success text-white"
                            : current ? "bg-ocean text-white"
                            : "bg-white/20 text-white/60"
                          )}>
                            {completed ? <Check className="w-3.5 h-3.5" /> : index + 1}
                          </div>
                          <span className={cn(
                            "mt-1.5 text-xs whitespace-nowrap hidden sm:block",
                            completed || current ? "text-white" : "text-white/50"
                          )}>
                            {label}
                          </span>
                        </div>
                        {index < kycStepLabels.length - 1 && (
                          <div className={cn("w-6 h-0.5 mx-1 mb-5 lg:w-10", completed ? "bg-success" : "bg-white/20")} />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {kyc.kyc_status !== "submitted" && kyc.current_submission_status !== "under_review" && (
              <Link href="/kyc">
                <Button size="lg" className="bg-ocean hover:bg-ocean-dark text-white shrink-0">
                  {kyc.kyc_status === "not_submitted" && !kyc.phone_verified
                    ? "Verify Phone"
                    : kyc.kyc_status === "not_submitted"
                    ? "View KYC Status"
                    : "Resubmit KYC"}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            )}

            {kyc.current_submission_status === "under_review" && (
              <div className="flex items-center gap-2 shrink-0 text-white/80">
                <Clock className="w-5 h-5" />
                <span className="text-sm">Review in progress</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* KYC approved — quick actions */}
      {!isLoading && kycApproved && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Link href="/marketplace">
            <Button className="w-full bg-ocean hover:bg-ocean-dark text-white">
              <Store className="w-4 h-4 mr-2" /> Browse Market
            </Button>
          </Link>
          <Link href="/auctions">
            <Button variant="outline" className="w-full">
              <Gavel className="w-4 h-4 mr-2" /> Live Auctions
            </Button>
          </Link>
          <Link href="/purchase-requests">
            <Button variant="outline" className="w-full">
              <ShoppingCart className="w-4 h-4 mr-2" /> My Requests
            </Button>
          </Link>
          <Link href="/deals">
            <Button variant="outline" className="w-full">
              <Handshake className="w-4 h-4 mr-2" /> My Deals
            </Button>
          </Link>
        </div>
      )}
    </div>
  )
}
