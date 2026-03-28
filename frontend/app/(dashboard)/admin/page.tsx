"use client"

import { useState } from "react"
import Link from "next/link"
import {
  Users,
  ShieldCheck,
  Package,
  Handshake,
  DollarSign,
  AlertCircle,
  ArrowRight,
  TrendingUp,
  Activity,
  Gavel,
  FileText,
  RefreshCw,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { type AdminDashboardStats } from "@/lib/api"
import { useAdminDashboard } from "@/lib/hooks"

function formatRelativeTime(iso: string | null): string {
  if (!iso) return ""
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function humanizeAction(action: string, resourceType: string | null): string {
  const type = resourceType ?? ""
  const map: Record<string, string> = {
    kyc_submitted: "KYC submitted",
    kyc_approved: "KYC approved",
    kyc_rejected: "KYC rejected",
    deal_created: "Deal created",
    deal_status_changed: "Deal status updated",
    bid_placed: "Bid placed",
    listing_submitted: "Listing submitted for review",
    listing_approved: "Listing approved",
    purchase_request_submitted: "Purchase request submitted",
    purchase_request_approved: "Purchase request approved",
    auth_login: "User logged in",
    auth_signup: "New user registered",
    auth_account_deactivated: "Account deactivated",
    auth_role_changed: "User roles updated",
  }
  return map[action] ?? `${action.replace(/_/g, " ")} (${type})`
}

const activityIcon: Record<string, string> = {
  kyc_submitted: "kyc",
  kyc_approved: "kyc",
  kyc_rejected: "kyc",
  deal_created: "deal",
  deal_status_changed: "deal",
  bid_placed: "auction",
  listing_submitted: "listing",
  listing_approved: "listing",
  purchase_request_submitted: "purchase",
  purchase_request_approved: "purchase",
  auth_login: "user",
  auth_signup: "user",
  auth_account_deactivated: "user",
  auth_role_changed: "user",
}

const activityDotColor: Record<string, string> = {
  user: "bg-ocean",
  kyc: "bg-success",
  deal: "bg-navy",
  auction: "bg-warning",
  purchase: "bg-ocean",
  listing: "bg-ocean",
}

function StatSkeleton() {
  return <div className="bg-white rounded-xl border border-border p-5 h-28 animate-pulse bg-gray-100" />
}

export default function AdminDashboardPage() {
  const { data, isLoading, mutate } = useAdminDashboard()
  const [lastRefresh, setLastRefresh] = useState(Date.now())

  const stats = data ? [
    {
      label: "Total Users",
      value: data.users.total_users.toLocaleString(),
      sub: `${data.users.active_buyers} buyers · ${data.users.active_sellers} sellers`,
      up: true,
      icon: Users,
      href: "/admin/users",
    },
    {
      label: "Pending KYC",
      value: data.kyc.pending_kyc.toLocaleString(),
      sub: `${data.kyc.approved_kyc} approved · ${data.kyc.rejected_kyc} rejected`,
      up: data.kyc.pending_kyc === 0,
      icon: ShieldCheck,
      href: "/admin/kyc",
    },
    {
      label: "Active Deals",
      value: data.deals.active_deals.toLocaleString(),
      sub: `$${Number(data.deals.active_deals_value).toLocaleString()} in pipeline`,
      up: true,
      icon: Handshake,
      href: "/deals",
    },
    {
      label: "Revenue (This Month)",
      value: `$${Number(data.deals.revenue_this_month || 0).toLocaleString()}`,
      sub: `${data.deals.new_deals_this_month} new deals this month`,
      up: true,
      icon: DollarSign,
      href: "#",
    },
    {
      label: "Live Auctions",
      value: data.auctions.live_auctions.toLocaleString(),
      sub: `${data.auctions.scheduled_auctions} scheduled`,
      up: data.auctions.live_auctions > 0,
      icon: Gavel,
      href: "/auctions",
    },
    {
      label: "Active Disputes",
      value: data.deals.disputed_deals.toLocaleString(),
      sub: data.deals.disputed_deals > 0 ? "Requires attention" : "No active disputes",
      up: data.deals.disputed_deals === 0,
      icon: AlertCircle,
      href: "#",
    },
  ] : []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-text-secondary">
            Live platform stats · Last updated {formatRelativeTime(new Date(lastRefresh).toISOString())}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { mutate(); setLastRefresh(Date.now()) }} disabled={isLoading}>
          <RefreshCw className={cn("w-4 h-4 mr-1.5", isLoading && "animate-spin")} /> Refresh
        </Button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => <StatSkeleton key={i} />)
          : stats.map((stat) => (
          <Link key={stat.label} href={stat.href}>
            <div className="bg-white rounded-xl border border-border p-5 shadow-sm hover:border-ocean/30 hover:shadow-md transition-all group">
              <div className="flex items-start justify-between">
                <div className="p-2.5 rounded-lg bg-ocean/10">
                  <stat.icon className="w-5 h-5 text-ocean" />
                </div>
                <ArrowRight className="w-4 h-4 text-text-secondary group-hover:text-ocean transition-colors" />
              </div>
              <div className="mt-4">
                <p className="text-2xl font-bold text-text-primary">{stat.value}</p>
                <p className="text-sm text-text-secondary mt-0.5">{stat.label}</p>
                <div className={cn("flex items-center gap-1 mt-2 text-xs font-medium", stat.up ? "text-success" : "text-warning")}>
                  {stat.up ? <TrendingUp className="w-3 h-3" /> : <Activity className="w-3 h-3" />}
                  {stat.sub}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Platform overview */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-base font-semibold text-text-primary">Platform Overview</h2>
          </div>
          {isLoading ? (
            <div className="p-5 space-y-4 animate-pulse">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-12 bg-gray-100 rounded-lg" />
              ))}
            </div>
          ) : data ? (
            <div className="divide-y divide-border">
              {[
                {
                  icon: Users,
                  label: "User Registrations",
                  items: [
                    { label: "Total Users", value: data.users.total_users },
                    { label: "Buyers", value: data.users.active_buyers },
                    { label: "Sellers", value: data.users.active_sellers },
                    { label: "Agents", value: data.users.active_agents },
                    { label: "Deactivated", value: data.users.deactivated_users },
                  ],
                },
                {
                  icon: ShieldCheck,
                  label: "KYC Submissions",
                  items: [
                    { label: "Pending Review", value: data.kyc.pending_kyc },
                    { label: "Approved", value: data.kyc.approved_kyc },
                    { label: "Rejected", value: data.kyc.rejected_kyc },
                  ],
                },
                {
                  icon: Handshake,
                  label: "Deal Pipeline",
                  items: [
                    { label: "Active Deals", value: data.deals.active_deals },
                    { label: "Completed", value: data.deals.completed_deals },
                    { label: "Disputed", value: data.deals.disputed_deals },
                    { label: "New (Month)", value: data.deals.new_deals_this_month },
                  ],
                },
                {
                  icon: FileText,
                  label: "Purchase Requests",
                  items: [
                    { label: "Open Queue", value: data.purchase_requests.open_requests },
                    { label: "Approved", value: data.purchase_requests.approved_requests },
                    { label: "New (Month)", value: data.purchase_requests.new_requests_this_month },
                  ],
                },
              ].map(({ icon: Icon, label, items }) => (
                <div key={label} className="px-5 py-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Icon className="w-4 h-4 text-ocean" />
                    <p className="text-sm font-semibold text-text-primary">{label}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                    {items.map(({ label: itemLabel, value }) => (
                      <div key={itemLabel} className="bg-gray-50 rounded-lg px-3 py-2">
                        <p className="text-xs text-text-secondary">{itemLabel}</p>
                        <p className="text-base font-bold text-text-primary mt-0.5">{value.toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-gray-50/50">
            <Link href="/admin/users">
              <Button variant="ghost" size="sm" className="text-ocean hover:text-ocean-dark hover:bg-ocean/5">
                Manage Users <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
            <Link href="/admin/kyc">
              <Button variant="ghost" size="sm" className="text-ocean hover:text-ocean-dark hover:bg-ocean/5">
                Review KYC <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </div>
        </div>

        {/* Live activity feed */}
        <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
            <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
            <h2 className="text-base font-semibold text-text-primary">Live Activity</h2>
          </div>
          {isLoading ? (
            <div className="p-5 space-y-4 animate-pulse">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-gray-200 mt-1.5 shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-gray-200 rounded w-3/4" />
                    <div className="h-2.5 bg-gray-200 rounded w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : data?.recent_activity.length === 0 ? (
            <div className="p-8 text-center">
              <Activity className="w-8 h-8 text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-text-secondary">No recent activity</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {(data?.recent_activity ?? []).map((event, i) => {
                const dotColor = activityDotColor[activityIcon[event.action] ?? "user"] ?? "bg-ocean"
                return (
                  <div key={i} className="flex items-start gap-3 px-5 py-3.5">
                    <div className={cn("w-1.5 h-1.5 rounded-full mt-2 shrink-0", dotColor)} />
                    <div className="min-w-0">
                      {event.actor_name && (
                        <p className="text-xs font-medium text-text-primary truncate">{event.actor_name}</p>
                      )}
                      <p className="text-xs text-text-secondary leading-relaxed">
                        {humanizeAction(event.action, event.resource_type)}
                      </p>
                      {event.created_at && (
                        <p className="text-xs text-text-secondary/60 mt-0.5">
                          {formatRelativeTime(event.created_at)}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* KYC Queue highlight */}
      {data && data.kyc.pending_kyc > 0 && (
        <div className="bg-warning/5 border border-warning/20 rounded-xl p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-warning/10">
                <ShieldCheck className="w-5 h-5 text-warning" />
              </div>
              <div>
                <p className="font-semibold text-text-primary">
                  {data.kyc.pending_kyc} KYC submission{data.kyc.pending_kyc !== 1 ? "s" : ""} awaiting review
                </p>
                <p className="text-sm text-text-secondary mt-0.5">
                  Timely review ensures sellers can activate listings
                </p>
              </div>
            </div>
            <Link href="/admin/kyc">
              <Button className="bg-warning hover:bg-warning/90 text-white shrink-0">
                Review Queue <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
