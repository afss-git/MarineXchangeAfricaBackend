"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowLeft, User, ShieldCheck, Handshake, Package, UserCheck,
  Activity, Mail, Phone, MapPin, Building2, Calendar, AlertCircle,
  Loader2, CheckCircle2, XCircle, Clock, RefreshCw, Ban, Eye,
  ExternalLink, UserX, UserCheck2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { adminSellers, admin, type AdminSellerDetail } from "@/lib/api"

// ── Types ──────────────────────────────────────────────────────────────────────

interface SellerProfile {
  id: string; full_name: string | null; email: string; company_name: string | null
  company_reg_no: string | null; phone: string | null; country: string | null
  roles: string[]; kyc_status: string; kyc_expires_at: string | null
  is_active: boolean; created_at: string; updated_at: string
}

interface Listing {
  id: string; title: string; status: string; asking_price: string; currency: string
  condition: string; availability_type: string; location_country: string
  location_port: string | null; category_name: string | null
  verification_agent: string | null; agent_email: string | null
  image_count: number; deal_count: number; created_at: string; updated_at: string
}

interface Deal {
  id: string; status: string; deal_type: string; total_price: string
  currency: string; created_at: string; product_title: string | null
  buyer_name: string | null; buyer_email: string | null
}

interface Agent {
  agent_name: string | null; agent_email: string | null
  assignments_count: number; last_activity: string | null
}

interface ActivityItem {
  action: string; resource_type: string; resource_id: string; created_at: string
}

interface KycRow {
  id: string; status: string; cycle_number: number; created_at: string
  rejection_reason: string | null; agent_name: string | null; assignment_status: string | null
}

interface SellerDetail {
  profile: SellerProfile
  kyc: KycRow[]
  listings: Listing[]
  deals: Deal[]
  agents: Agent[]
  activity: ActivityItem[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

function fmtDateTime(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

function fmtMoney(amount: string | number, currency: string) {
  return `${parseFloat(String(amount)).toLocaleString()} ${currency}`
}

// ── Status configs ─────────────────────────────────────────────────────────────

const LISTING_CFG: Record<string, { label: string; className: string }> = {
  draft:                { label: "Draft",              className: "bg-gray-100 text-gray-600 border-gray-200" },
  submitted:            { label: "Submitted",          className: "bg-warning/10 text-warning border-warning/20" },
  pending_verification: { label: "Pending Verify",     className: "bg-ocean/10 text-ocean border-ocean/20" },
  under_verification:   { label: "Verifying",          className: "bg-ocean/10 text-ocean border-ocean/20" },
  pending_reverification:{ label: "Needs Revision",    className: "bg-orange-50 text-orange-600 border-orange-200" },
  pending_approval:     { label: "Pending Approval",   className: "bg-warning/10 text-warning border-warning/20" },
  approved:             { label: "Approved",           className: "bg-success/10 text-success border-success/20" },
  active:               { label: "Active",             className: "bg-success/10 text-success border-success/20" },
  rejected:             { label: "Rejected",           className: "bg-danger/10 text-danger border-danger/20" },
  delisted:             { label: "Delisted",           className: "bg-gray-100 text-gray-500 border-gray-200" },
}

const DEAL_CFG: Record<string, { label: string; className: string }> = {
  pending_admin_approval: { label: "Pending Approval", className: "bg-warning/10 text-warning border-warning/20" },
  active:       { label: "Active",       className: "bg-success/10 text-success border-success/20" },
  completed:    { label: "Completed",    className: "bg-success/10 text-success border-success/20" },
  cancelled:    { label: "Cancelled",    className: "bg-gray-100 text-gray-500 border-gray-200" },
  disputed:     { label: "Disputed",     className: "bg-danger/10 text-danger border-danger/20" },
}

const KYC_CFG: Record<string, { label: string; className: string }> = {
  not_started:  { label: "Not Started",  className: "bg-gray-100 text-gray-500 border-gray-200" },
  approved:     { label: "Approved",     className: "bg-success/10 text-success border-success/20" },
  rejected:     { label: "Rejected",     className: "bg-danger/10 text-danger border-danger/20" },
  submitted:    { label: "Submitted",    className: "bg-ocean/10 text-ocean border-ocean/20" },
  under_review: { label: "Under Review", className: "bg-ocean/10 text-ocean border-ocean/20" },
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl border border-border px-5 py-4">
      <p className="text-xs text-text-secondary mb-1">{label}</p>
      <p className={cn("text-2xl font-bold", color ?? "text-text-primary")}>{value}</p>
      {sub && <p className="text-xs text-text-secondary mt-0.5">{sub}</p>}
    </div>
  )
}

// ── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab({ data }: { data: SellerDetail }) {
  const { profile, listings, deals, agents } = data
  const activeListings = listings.filter(l => l.status === "active").length
  const pendingListings = listings.filter(l => ["pending_verification","pending_approval","under_verification","pending_reverification"].includes(l.status)).length
  const kycCfg = KYC_CFG[profile.kyc_status] ?? KYC_CFG.not_started

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Total Listings" value={listings.length} />
        <StatCard label="Active Listings" value={activeListings} color="text-success" />
        <StatCard label="In Pipeline" value={pendingListings} color="text-warning" />
        <StatCard label="Total Deals" value={deals.length} />
      </div>

      {/* Profile card */}
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold text-text-primary">Company & Profile</h3>
          <Badge className={cn("text-xs border", kycCfg.className)}>{kycCfg.label}</Badge>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-border">
          <div className="p-6 space-y-4">
            {[
              { icon: Building2, label: "Company",        value: profile.company_name || "—" },
              { icon: FileTextIcon, label: "Reg. Number", value: profile.company_reg_no || "—" },
              { icon: User,      label: "Contact Name",   value: profile.full_name || "—" },
              { icon: Mail,      label: "Email",          value: profile.email },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-text-secondary" />
                </div>
                <div>
                  <p className="text-xs text-text-secondary">{label}</p>
                  <p className="text-sm font-medium text-text-primary">{value}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="p-6 space-y-4">
            {[
              { icon: Phone,      label: "Phone",          value: profile.phone || "—" },
              { icon: MapPin,     label: "Country",        value: profile.country || "—" },
              { icon: Calendar,   label: "Joined",         value: fmtDate(profile.created_at) },
              { icon: ShieldCheck,label: "KYC Expires",    value: fmtDate(profile.kyc_expires_at) },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-text-secondary" />
                </div>
                <div>
                  <p className="text-xs text-text-secondary">{label}</p>
                  <p className="text-sm font-medium text-text-primary">{value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="px-6 py-4 border-t border-border bg-gray-50/50">
          <p className="text-xs text-text-secondary mb-2">Roles</p>
          <div className="flex gap-2 flex-wrap">
            {profile.roles.map(r => (
              <span key={r} className="text-xs bg-ocean/10 text-ocean border border-ocean/20 px-2.5 py-1 rounded-full font-medium capitalize">
                {r.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Agents summary */}
      {agents.length > 0 && (
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h3 className="font-semibold text-text-primary">Verification Agents ({agents.length})</h3>
          </div>
          <div className="divide-y divide-border">
            {agents.map((a, i) => (
              <div key={i} className="px-6 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-ocean/10 flex items-center justify-center">
                    <UserCheck className="w-4 h-4 text-ocean" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-text-primary">{a.agent_name || "—"}</p>
                    <p className="text-xs text-text-secondary">{a.agent_email}</p>
                  </div>
                </div>
                <div className="text-right text-xs text-text-secondary">
                  <p className="font-semibold text-text-primary">{a.assignments_count} assignment{a.assignments_count !== 1 ? "s" : ""}</p>
                  <p>Last: {fmtDate(a.last_activity)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Listings tab ──────────────────────────────────────────────────────────────

function ListingsTab({ listings }: { listings: Listing[] }) {
  const [statusFilter, setStatusFilter] = useState("")

  const filtered = statusFilter ? listings.filter(l => l.status === statusFilter) : listings

  const statusGroups = [...new Set(listings.map(l => l.status))]

  if (listings.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-border p-12 text-center">
        <Package className="w-10 h-10 text-gray-200 mx-auto mb-3" />
        <p className="text-text-secondary">No listings yet</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Quick status filter */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setStatusFilter("")}
          className={cn("text-xs px-3 py-1.5 rounded-full border font-medium transition-colors",
            statusFilter === "" ? "bg-navy text-white border-navy" : "bg-white text-text-secondary border-border hover:border-gray-300"
          )}
        >
          All ({listings.length})
        </button>
        {statusGroups.map(s => {
          const cfg = LISTING_CFG[s]
          const count = listings.filter(l => l.status === s).length
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn("text-xs px-3 py-1.5 rounded-full border font-medium transition-colors",
                statusFilter === s ? "bg-navy text-white border-navy" : "bg-white text-text-secondary border-border hover:border-gray-300"
              )}
            >
              {cfg?.label ?? s} ({count})
            </button>
          )
        })}
      </div>

      <div className="space-y-2">
        {filtered.map((l) => {
          const cfg = LISTING_CFG[l.status] ?? { label: l.status, className: "bg-gray-100 text-gray-500 border-gray-200" }
          return (
            <div key={l.id} className="bg-white rounded-xl border border-border px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="text-sm font-semibold text-text-primary">{l.title}</p>
                    <Badge className={cn("text-xs border", cfg.className)}>{cfg.label}</Badge>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-text-secondary flex-wrap">
                    <span>{l.category_name || "Uncategorized"}</span>
                    <span>·</span>
                    <span className="font-medium text-text-primary">{fmtMoney(l.asking_price, l.currency)}</span>
                    <span>·</span>
                    <span>{l.condition} · {l.availability_type.replace(/_/g, " ")}</span>
                    <span>·</span>
                    <span>{l.location_country}{l.location_port ? `, ${l.location_port}` : ""}</span>
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-xs flex-wrap">
                    {l.verification_agent && (
                      <span className="flex items-center gap-1 text-ocean">
                        <UserCheck className="w-3 h-3" />{l.verification_agent}
                      </span>
                    )}
                    <span className="text-text-secondary">{l.image_count} image{l.image_count !== 1 ? "s" : ""}</span>
                    {l.deal_count > 0 && <span className="text-success">{l.deal_count} deal{l.deal_count !== 1 ? "s" : ""}</span>}
                    <span className="text-text-secondary">Listed {fmtDate(l.created_at)}</span>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Deals tab ─────────────────────────────────────────────────────────────────

function DealsTab({ deals }: { deals: Deal[] }) {
  const router = useRouter()

  if (deals.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-border p-12 text-center">
        <Handshake className="w-10 h-10 text-gray-200 mx-auto mb-3" />
        <p className="text-text-secondary">No deals yet</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-gray-50/50">
            <th className="text-left px-5 py-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">Product</th>
            <th className="text-left px-5 py-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">Buyer</th>
            <th className="text-left px-5 py-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">Amount</th>
            <th className="text-left px-5 py-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">Type</th>
            <th className="text-left px-5 py-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">Status</th>
            <th className="text-left px-5 py-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">Date</th>
            <th className="w-12" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {deals.map((d) => {
            const cfg = DEAL_CFG[d.status] ?? { label: d.status, className: "bg-gray-100 text-gray-500 border-gray-200" }
            return (
              <tr
                key={d.id}
                className="hover:bg-gray-50/50 transition-colors cursor-pointer"
                onClick={() => router.push(`/admin/deals/${d.id}`)}
              >
                <td className="px-5 py-3.5 font-medium text-text-primary">{d.product_title || "—"}</td>
                <td className="px-5 py-3.5">
                  <p>{d.buyer_name || "—"}</p>
                  {d.buyer_email && <p className="text-xs text-text-secondary">{d.buyer_email}</p>}
                </td>
                <td className="px-5 py-3.5 font-medium">{fmtMoney(d.total_price, d.currency)}</td>
                <td className="px-5 py-3.5 capitalize text-text-secondary">{d.deal_type.replace(/_/g, " ")}</td>
                <td className="px-5 py-3.5">
                  <Badge className={cn("text-xs border", cfg.className)}>{cfg.label}</Badge>
                </td>
                <td className="px-5 py-3.5 text-text-secondary">{fmtDate(d.created_at)}</td>
                <td className="px-5 py-3.5">
                  <ExternalLink className="w-3.5 h-3.5 text-text-secondary" />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Agents tab ────────────────────────────────────────────────────────────────

function AgentsTab({ agents }: { agents: Agent[] }) {
  if (agents.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-border p-12 text-center">
        <UserCheck className="w-10 h-10 text-gray-200 mx-auto mb-3" />
        <p className="text-text-secondary">No agents have been assigned to this seller's products yet</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-gray-50/50">
        <p className="text-xs text-text-secondary">{agents.length} verification agent{agents.length !== 1 ? "s" : ""} have worked on this seller's listings</p>
      </div>
      <div className="divide-y divide-border">
        {agents.map((a, i) => (
          <div key={i} className="px-5 py-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-ocean/10 flex items-center justify-center shrink-0">
              <UserCheck className="w-5 h-5 text-ocean" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text-primary">{a.agent_name || "—"}</p>
              <p className="text-xs text-text-secondary">{a.agent_email}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-semibold text-text-primary">{a.assignments_count} assignment{a.assignments_count !== 1 ? "s" : ""}</p>
              <p className="text-xs text-text-secondary">Last active {fmtDate(a.last_activity)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Activity tab ──────────────────────────────────────────────────────────────

function ActivityTab({ activity }: { activity: ActivityItem[] }) {
  if (activity.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-border p-12 text-center">
        <Activity className="w-10 h-10 text-gray-200 mx-auto mb-3" />
        <p className="text-text-secondary">No recent activity</p>
      </div>
    )
  }
  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      <div className="divide-y divide-border">
        {activity.map((a, i) => (
          <div key={i} className="px-5 py-3 flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-ocean shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-text-primary font-medium">{a.action.replace(/_/g, " ")}</p>
              <p className="text-xs text-text-secondary capitalize">{a.resource_type} · {a.resource_id?.slice(0, 8)}…</p>
            </div>
            <p className="text-xs text-text-secondary shrink-0">{fmtDateTime(a.created_at)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Inline FileText icon (avoids naming conflict) ─────────────────────────────

function FileTextIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const TABS = [
  { key: "overview",  label: "Overview",   icon: Building2 },
  { key: "listings",  label: "Listings",   icon: Package },
  { key: "deals",     label: "Deals",      icon: Handshake },
  { key: "agents",    label: "Agents",     icon: UserCheck },
  { key: "activity",  label: "Activity",   icon: Activity },
]

export default function SellerDetailPage() {
  const params = useParams()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState("overview")
  const [data, setData] = useState<AdminSellerDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const sellerId = params.id as string

  async function load() {
    setLoading(true); setError(null)
    try {
      setData(await adminSellers.getDetail(sellerId))
    } catch (e: any) {
      setError(e.message ?? "Failed to load seller")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [sellerId])

  async function toggleActive() {
    if (!data) return
    const isActive = data.profile.is_active
    const confirmed = window.confirm(
      isActive
        ? `Deactivate ${data.profile.company_name || data.profile.full_name || data.profile.email}? They will lose access immediately.`
        : `Reactivate ${data.profile.company_name || data.profile.full_name || data.profile.email}?`
    )
    if (!confirmed) return
    setActionLoading(true); setActionError(null)
    try {
      if (isActive) {
        await admin.deactivate(sellerId, "Deactivated by admin")
      } else {
        await admin.reactivate(sellerId)
      }
      await load()
    } catch (e: any) {
      setActionError(e.message ?? "Action failed")
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-24 gap-2 text-text-secondary">
      <Loader2 className="w-5 h-5 animate-spin" /> Loading seller profile…
    </div>
  )

  if (error) return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-1.5"><ArrowLeft className="w-4 h-4" /> Back</Button>
      <div className="flex items-center gap-2 p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger text-sm">
        <AlertCircle className="w-4 h-4 shrink-0" />{error}
      </div>
    </div>
  )

  if (!data) return null
  const { profile } = data

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-1.5 mt-0.5 shrink-0">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="w-12 h-12 rounded-full bg-navy/10 flex items-center justify-center shrink-0">
              <span className="text-navy font-bold text-lg">
                {(profile.company_name || profile.full_name || profile.email || "?")[0].toUpperCase()}
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-text-primary">{profile.company_name || profile.full_name || "Unnamed Seller"}</h1>
                {!profile.is_active && <Badge className="bg-gray-100 text-gray-500 border-gray-200 border text-xs">Inactive</Badge>}
              </div>
              <p className="text-sm text-text-secondary">{profile.email} {profile.country ? `· ${profile.country}` : ""}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
            <RefreshCw className="w-4 h-4" /> Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={toggleActive}
            disabled={actionLoading}
            className={cn("gap-1.5", profile.is_active ? "text-danger border-danger/30 hover:bg-danger/5" : "text-success border-success/30 hover:bg-success/5")}
          >
            {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : profile.is_active ? <UserX className="w-4 h-4" /> : <UserCheck2 className="w-4 h-4" />}
            {profile.is_active ? "Deactivate" : "Activate"}
          </Button>
        </div>
      </div>

      {actionError && (
        <div className="flex items-center gap-2 p-3 bg-danger/10 border border-danger/20 rounded-xl text-danger text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />{actionError}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const count =
            tab.key === "listings" ? data.listings.length :
            tab.key === "deals"    ? data.deals.length :
            tab.key === "agents"   ? data.agents.length : null
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors shrink-0",
                activeTab === tab.key ? "border-ocean text-ocean" : "border-transparent text-text-secondary hover:text-text-primary"
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
              {count != null && count > 0 && (
                <span className="ml-1 text-xs bg-ocean/10 text-ocean rounded-full px-1.5">{count}</span>
              )}
            </button>
          )
        })}
      </div>

      {activeTab === "overview"  && <OverviewTab data={data} />}
      {activeTab === "listings"  && <ListingsTab listings={data.listings} />}
      {activeTab === "deals"     && <DealsTab deals={data.deals} />}
      {activeTab === "agents"    && <AgentsTab agents={data.agents} />}
      {activeTab === "activity"  && <ActivityTab activity={data.activity} />}
    </div>
  )
}
