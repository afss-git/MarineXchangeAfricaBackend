"use client"

import { useState } from "react"
import {
  MessageSquare,
  Handshake,
  Gavel,
  ShieldCheck,
  DollarSign,
  Bell,
  CheckCheck,
  Package,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { notifications as notifApi, type Notification } from "@/lib/api"
import { useNotifications, invalidateNotifications } from "@/lib/hooks"

const iconMap: Record<string, { icon: React.ElementType; bg: string; color: string }> = {
  message:  { icon: MessageSquare, bg: "bg-ocean/10", color: "text-ocean" },
  purchase: { icon: MessageSquare, bg: "bg-ocean/10", color: "text-ocean" },
  deal:     { icon: Handshake,     bg: "bg-navy/10",  color: "text-navy" },
  payment:  { icon: DollarSign,    bg: "bg-success/10", color: "text-success" },
  auction:  { icon: Gavel,         bg: "bg-danger/10", color: "text-danger" },
  kyc:      { icon: ShieldCheck,   bg: "bg-success/10", color: "text-success" },
  document: { icon: ShieldCheck,   bg: "bg-success/10", color: "text-success" },
  listing:  { icon: Package,       bg: "bg-ocean/10", color: "text-ocean" },
  account:  { icon: ShieldCheck,   bg: "bg-gray-100", color: "text-text-secondary" },
  system:   { icon: Bell,          bg: "bg-gray-100", color: "text-text-secondary" },
  invoice:  { icon: DollarSign,    bg: "bg-success/10", color: "text-success" },
}

const tabs = ["All", "Unread", "Deals", "Auctions", "Messages"]

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

function resourceHref(category: string, resourceId: string | null): string | undefined {
  if (!resourceId) return undefined
  switch (category) {
    case "deal":    return `/deals/${resourceId}`
    case "payment": return `/deals/${resourceId}`
    case "auction": return `/auctions/${resourceId}`
    case "kyc":     return "/kyc"
    case "purchase":return `/purchase-requests/${resourceId}`
    default:        return undefined
  }
}

function NotifSkeleton() {
  return (
    <div className="flex gap-4 px-5 py-4 animate-pulse">
      <div className="w-10 h-10 rounded-full bg-gray-200 shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-4 bg-gray-200 rounded w-2/3" />
        <div className="h-3 bg-gray-200 rounded w-full" />
        <div className="h-3 bg-gray-200 rounded w-1/4" />
      </div>
    </div>
  )
}

export default function NotificationsPage() {
  const [activeTab, setActiveTab] = useState("All")
  const { data, isLoading, mutate } = useNotifications({ page_size: 50 })

  const markAllRead = async () => {
    try {
      await notifApi.markAllRead()
      invalidateNotifications()
    } catch { /* silent */ }
  }

  const markRead = async (id: string) => {
    try {
      await notifApi.markRead(id)
      invalidateNotifications()
    } catch { /* silent */ }
  }

  const items = data?.items ?? []
  const unreadCount = data?.unread_count ?? 0

  const filtered = items.filter((n) => {
    if (activeTab === "All") return true
    if (activeTab === "Unread") return !n.is_read
    if (activeTab === "Deals") return n.category === "deal" || n.category === "payment"
    if (activeTab === "Auctions") return n.category === "auction"
    if (activeTab === "Messages") return n.category === "purchase" || n.category === "message"
    return true
  })

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-text-primary">Notifications</h1>
          {unreadCount > 0 && (
            <Badge className="bg-ocean text-white text-xs">{unreadCount} new</Badge>
          )}
        </div>
        {unreadCount > 0 && (
          <Button variant="ghost" size="sm" onClick={markAllRead} className="text-ocean hover:text-ocean-dark text-sm">
            <CheckCheck className="w-4 h-4 mr-1.5" /> Mark all read
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
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
            {tab === "Unread" && unreadCount > 0 && (
              <span className="ml-2 px-1.5 py-0.5 rounded text-xs font-medium bg-ocean/10 text-ocean">
                {unreadCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Error handled silently by SWR */}

      {/* Notification list */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden divide-y divide-border">
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => <NotifSkeleton key={i} />)
          : filtered.length === 0
          ? (
            <div className="p-12 text-center">
              <Bell className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-text-secondary">No notifications here</p>
            </div>
          )
          : filtered.map((notif) => {
            const typeInfo = iconMap[notif.category] ?? iconMap["system"]
            const Icon = typeInfo.icon
            const href = resourceHref(notif.category, notif.resource_id)
            return (
              <div
                key={notif.id}
                onClick={() => !notif.is_read && markRead(notif.id)}
                className={cn(
                  "flex gap-4 px-5 py-4 cursor-pointer hover:bg-gray-50 transition-colors",
                  !notif.is_read ? "bg-ocean/5 hover:bg-ocean/10" : ""
                )}
              >
                <div className={cn("w-10 h-10 rounded-full flex items-center justify-center shrink-0 mt-0.5", typeInfo.bg)}>
                  <Icon className={cn("w-5 h-5", typeInfo.color)} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className={cn("text-sm", !notif.is_read ? "font-semibold text-text-primary" : "font-medium text-text-primary")}>
                      {notif.title}
                    </p>
                    {!notif.is_read && (
                      <span className="w-2 h-2 rounded-full bg-ocean shrink-0 mt-1.5" />
                    )}
                  </div>
                  <p className="text-sm text-text-secondary mt-0.5 line-clamp-2">{notif.body}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-xs text-text-secondary">{formatRelativeTime(notif.created_at)}</span>
                    {href && (
                      <a
                        href={href}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-ocean hover:text-ocean-dark font-medium transition-colors"
                      >
                        View →
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
      </div>
    </div>
  )
}
