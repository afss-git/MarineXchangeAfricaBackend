"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowLeft, User, ShieldCheck, Handshake, Package, UserCheck,
  Activity, Mail, Phone, MapPin, Building2, Calendar, AlertCircle,
  Loader2, RefreshCw, ExternalLink, UserX, UserCheck2,
  ChevronDown, ChevronUp, ImageIcon, FileText, CheckCircle2,
  Clock, Tag, Wrench, FileCheck,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { adminSellers, admin, marketplaceAdmin, verificationAgent, type AdminSellerDetail, type AdminProductDetail, type VerificationAssignmentDetail, type VerificationEvidenceFile, type ProductActivityItem } from "@/lib/api"

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
  verification_assignment_id: string | null; description: string | null
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

// ── Listing detail panel (expandable) ────────────────────────────────────────

const ASSIGN_STATUS_STEPS = [
  { key: "assigned",             label: "Assigned" },
  { key: "contacted",            label: "In Progress" },
  { key: "inspection_scheduled", label: "Scheduled" },
  { key: "inspection_done",      label: "Inspection Done" },
  { key: "report_submitted",     label: "Report Submitted" },
  { key: "completed",            label: "Completed" },
]

function SectionHeader({ icon: Icon, title, count }: { icon: React.ElementType; title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-4 h-4 text-text-secondary shrink-0" />
      <p className="text-xs font-bold text-text-secondary uppercase tracking-wider">
        {title}{count != null ? ` (${count})` : ""}
      </p>
    </div>
  )
}

function ListingDetailPanel({ listing }: { listing: Listing }) {
  const [product, setProduct]         = useState<AdminProductDetail | null>(null)
  const [assignment, setAssignment]   = useState<VerificationAssignmentDetail | null>(null)
  const [activity, setActivity]       = useState<ProductActivityItem[]>([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)
  const [showActivity, setShowActivity] = useState(false)

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const [prod, asgn, act] = await Promise.all([
          marketplaceAdmin.get(listing.id),
          listing.verification_assignment_id
            ? verificationAgent.getAssignment(listing.verification_assignment_id)
            : Promise.resolve(null),
          marketplaceAdmin.getActivity(listing.id),
        ])
        if (!mounted) return
        setProduct(prod)
        setAssignment(asgn)
        setActivity(act)
      } catch (e: unknown) {
        if (mounted) setError((e as Error)?.message ?? "Failed to load listing details")
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [listing.id, listing.verification_assignment_id])

  if (loading) return (
    <div className="flex items-center justify-center py-10 gap-2 text-text-secondary text-sm border-t border-border">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading full details…
    </div>
  )
  if (error) return (
    <div className="flex items-center gap-2 px-5 py-4 text-danger text-sm border-t border-border">
      <AlertCircle className="w-4 h-4 shrink-0" />{error}
    </div>
  )
  if (!product) return null

  const report         = assignment?.report ?? null
  const evidence: VerificationEvidenceFile[] = assignment?.evidence_files ?? []
  const evidenceImages = evidence.filter(e => e.file_type === "image")
  const evidenceDocs   = evidence.filter(e => e.file_type === "document")
  const currentStepIdx = assignment
    ? ASSIGN_STATUS_STEPS.findIndex(s => s.key === assignment.status)
    : -1

  const recBadge = report ? {
    approve:              { label: "Recommend Approve",    cls: "bg-success/10 text-success border-success/20" },
    reject:               { label: "Recommend Reject",     cls: "bg-danger/10 text-danger border-danger/20" },
    request_corrections:  { label: "Request Corrections",  cls: "bg-warning/10 text-warning border-warning/20" },
  }[report.recommendation] ?? null : null

  return (
    <div className="border-t border-border">

      {/* ── 1. PRODUCT OVERVIEW ───────────────────────────────────────────── */}
      <div className="px-5 py-5 bg-gray-50/40 border-b border-border">
        <SectionHeader icon={Package} title="Product Details" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {[
            { label: "Asking Price",      value: fmtMoney(product.asking_price, product.currency) },
            { label: "Condition",         value: product.condition ? product.condition.charAt(0).toUpperCase() + product.condition.slice(1) : "—" },
            { label: "Availability",      value: product.availability_type?.replace(/_/g, " ") ?? "—" },
            { label: "Location",          value: [product.location_country, product.location_port].filter(Boolean).join(", ") || "—" },
            { label: "Category",          value: product.category_name ?? "Uncategorized" },
            { label: "Verification Cycle",value: `Cycle ${product.verification_cycle ?? 0}` },
            { label: "Listed",            value: fmtDate(product.created_at) },
            { label: "Last Updated",      value: fmtDate(product.updated_at) },
            ...(product.location_details ? [{ label: "Location Details", value: product.location_details }] : []),
            ...(product.is_auction       ? [{ label: "Type",             value: "Auction listing" }] : []),
          ].map(({ label, value }) => (
            <div key={label} className="bg-white rounded-lg border border-border px-3 py-2.5">
              <p className="text-[11px] text-text-secondary mb-0.5">{label}</p>
              <p className="text-sm font-medium text-text-primary capitalize">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── 2. DESCRIPTION ────────────────────────────────────────────────── */}
      {product.description && (
        <div className="px-5 py-5 border-b border-border">
          <SectionHeader icon={FileText} title="Description" />
          <p className="text-sm text-text-primary leading-relaxed whitespace-pre-line">{product.description}</p>
        </div>
      )}

      {/* ── 3. PRODUCT PHOTOS ─────────────────────────────────────────────── */}
      <div className="px-5 py-5 border-b border-border">
        <SectionHeader icon={ImageIcon} title="Product Photos" count={product.images.length} />
        {product.images.length === 0 ? (
          <p className="text-sm text-text-secondary italic">No photos uploaded.</p>
        ) : (
          <div className="flex gap-3 flex-wrap">
            {product.images.map((img) => (
              <a key={img.id} href={img.signed_url} target="_blank" rel="noopener noreferrer"
                className="group relative w-32 h-32 rounded-xl border border-border overflow-hidden bg-gray-100 hover:ring-2 hover:ring-ocean/40 transition-all shrink-0">
                <img src={img.signed_url} alt="" className="w-full h-full object-cover" />
                {img.is_primary && (
                  <span className="absolute bottom-1.5 left-1.5 text-[10px] bg-ocean text-white px-1.5 py-0.5 rounded-md font-semibold">Primary</span>
                )}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <ExternalLink className="w-5 h-5 text-white drop-shadow" />
                </div>
              </a>
            ))}
          </div>
        )}
      </div>

      {/* ── 4. TECHNICAL SPECIFICATIONS ───────────────────────────────────── */}
      {product.attribute_values.length > 0 && (
        <div className="px-5 py-5 border-b border-border">
          <SectionHeader icon={Wrench} title="Technical Specifications" count={product.attribute_values.length} />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {product.attribute_values.map((attr) => (
              <div key={attr.attribute_id} className="p-2.5 bg-white rounded-lg border border-border">
                <p className="text-[11px] text-text-secondary mb-0.5">{attr.attribute_name}</p>
                <p className="text-sm font-medium text-text-primary">
                  {attr.value_text
                    ?? (attr.value_numeric != null ? String(attr.value_numeric) : null)
                    ?? (attr.value_boolean != null ? (attr.value_boolean ? "Yes" : "No") : "—")}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 5. SELLER CONTACT ─────────────────────────────────────────────── */}
      {(product.contact || product.seller_email || product.seller_phone) && (
        <div className="px-5 py-5 border-b border-border">
          <SectionHeader icon={Phone} title="Seller Contact" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {product.contact?.contact_name && (
              <div className="flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-gray-50 border border-border flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-text-secondary" />
                </div>
                <div>
                  <p className="text-[11px] text-text-secondary">Contact Name</p>
                  <p className="text-sm font-medium text-text-primary">{product.contact.contact_name}</p>
                </div>
              </div>
            )}
            {(product.contact?.phone || product.seller_phone) && (
              <div className="flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-gray-50 border border-border flex items-center justify-center shrink-0">
                  <Phone className="w-4 h-4 text-text-secondary" />
                </div>
                <div>
                  <p className="text-[11px] text-text-secondary">Phone</p>
                  <p className="text-sm font-medium text-text-primary">{product.contact?.phone ?? product.seller_phone}</p>
                </div>
              </div>
            )}
            {(product.contact?.email || product.seller_email) && (
              <div className="flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-gray-50 border border-border flex items-center justify-center shrink-0">
                  <Mail className="w-4 h-4 text-text-secondary" />
                </div>
                <div>
                  <p className="text-[11px] text-text-secondary">Email</p>
                  <p className="text-sm font-medium text-text-primary">{product.contact?.email ?? product.seller_email}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 6. VERIFICATION JOURNEY ───────────────────────────────────────── */}
      {assignment && (
        <div className="px-5 py-5 border-b border-border space-y-4">
          <SectionHeader icon={ShieldCheck} title="Verification Journey" />

          {/* Agent card */}
          <div className="bg-white rounded-xl border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-gray-50/50 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-ocean/10 flex items-center justify-center">
                  <UserCheck className="w-3.5 h-3.5 text-ocean" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-text-primary">{listing.verification_agent ?? "Agent"}</p>
                  {listing.agent_email && <p className="text-[11px] text-text-secondary">{listing.agent_email}</p>}
                </div>
              </div>
              <div className="text-right text-xs text-text-secondary">
                <p>Assigned <strong>{fmtDateTime(assignment.assigned_at)}</strong></p>
                {assignment.assigned_by_name && <p>by {assignment.assigned_by_name}</p>}
              </div>
            </div>

            {/* Status timeline */}
            <div className="px-4 py-5 overflow-x-auto">
              <div className="flex items-start min-w-max gap-0">
                {ASSIGN_STATUS_STEPS.map((step, idx) => {
                  const done    = idx <= currentStepIdx
                  const current = idx === currentStepIdx
                  return (
                    <div key={step.key} className="flex items-center">
                      <div className="flex flex-col items-center gap-1.5 w-[80px]">
                        <div className={cn(
                          "w-7 h-7 rounded-full border-2 flex items-center justify-center transition-colors",
                          done
                            ? current ? "bg-ocean border-ocean shadow-sm shadow-ocean/30"
                                      : "bg-success border-success"
                            : "bg-white border-gray-200"
                        )}>
                          {done
                            ? <CheckCircle2 className="w-4 h-4 text-white" />
                            : <div className="w-2.5 h-2.5 rounded-full bg-gray-200" />}
                        </div>
                        <p className={cn(
                          "text-[10px] text-center leading-tight font-medium",
                          done ? (current ? "text-ocean" : "text-success") : "text-gray-400"
                        )}>
                          {step.label}
                        </p>
                      </div>
                      {idx < ASSIGN_STATUS_STEPS.length - 1 && (
                        <div className={cn(
                          "h-0.5 w-8 shrink-0 -mt-5",
                          idx < currentStepIdx ? "bg-success" : "bg-gray-200"
                        )} />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Agent notes + scheduled date */}
            {(assignment.scheduled_date || assignment.contact_notes) && (
              <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-border pt-3">
                {assignment.scheduled_date && (
                  <div>
                    <p className="text-[11px] text-text-secondary mb-0.5">Scheduled Inspection Date</p>
                    <p className="text-sm font-medium text-text-primary">{fmtDate(assignment.scheduled_date)}</p>
                  </div>
                )}
                {assignment.contact_notes && (
                  <div className={cn(assignment.scheduled_date ? "" : "sm:col-span-2")}>
                    <p className="text-[11px] text-text-secondary mb-0.5">Agent Contact Notes</p>
                    <p className="text-sm text-text-primary whitespace-pre-line">{assignment.contact_notes}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── 7. VERIFICATION REPORT ──────────────────────────────────────── */}
          {report ? (
            <div className="bg-white rounded-xl border border-border overflow-hidden">
              {/* Report header — recommendation is the headline */}
              <div className={cn(
                "px-5 py-4 border-b border-border flex items-center justify-between flex-wrap gap-3",
                report.recommendation === "approve"             ? "bg-success/5" :
                report.recommendation === "reject"              ? "bg-danger/5"  :
                "bg-warning/5"
              )}>
                <div className="flex items-center gap-3">
                  <FileCheck className="w-5 h-5 text-text-secondary" />
                  <div>
                    <p className="text-sm font-bold text-text-primary">Verification Report</p>
                    <p className="text-xs text-text-secondary">Submitted {fmtDateTime(report.created_at)}</p>
                  </div>
                </div>
                {recBadge && (
                  <Badge className={cn("text-sm border font-semibold px-3 py-1", recBadge.cls)}>
                    {recBadge.label}
                  </Badge>
                )}
              </div>

              {/* Report findings */}
              <div className="px-5 py-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-3 bg-gray-50 rounded-lg border border-border">
                    <p className="text-[11px] text-text-secondary mb-1">Asset Condition (as verified)</p>
                    <p className="text-sm font-semibold text-text-primary">{report.condition_confirmed ?? "—"}</p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-lg border border-border">
                    <p className="text-[11px] text-text-secondary mb-1">Price Assessment</p>
                    <p className="text-sm font-semibold text-text-primary">{report.price_assessment ?? "—"}</p>
                  </div>
                </div>

                <div>
                  <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide mb-2">Detailed Findings</p>
                  <div className="p-4 bg-gray-50 rounded-lg border border-border">
                    <p className="text-sm text-text-primary leading-relaxed whitespace-pre-line">{report.notes}</p>
                  </div>
                </div>

                {/* ── 8. INSPECTION PHOTOS ──────────────────────────────────── */}
                {evidenceImages.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide mb-2">
                      Inspection Photos ({evidenceImages.length})
                    </p>
                    <div className="flex gap-3 flex-wrap">
                      {evidenceImages.map((ev) => (
                        <div key={ev.id} className="flex flex-col gap-1">
                          <a href={ev.signed_url} target="_blank" rel="noopener noreferrer"
                            className="group relative w-28 h-28 rounded-xl border border-border overflow-hidden bg-gray-100 hover:ring-2 hover:ring-ocean/40 transition-all">
                            <img src={ev.signed_url} alt="" className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                              <ExternalLink className="w-4 h-4 text-white drop-shadow" />
                            </div>
                          </a>
                          {ev.description && (
                            <p className="text-[10px] text-text-secondary max-w-[112px] truncate">{ev.description}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── 9. SUPPORTING DOCUMENTS ───────────────────────────────── */}
                {evidenceDocs.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide mb-2">
                      Supporting Documents ({evidenceDocs.length})
                    </p>
                    <div className="space-y-2">
                      {evidenceDocs.map((ev) => (
                        <a key={ev.id} href={ev.signed_url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-border hover:bg-white hover:border-ocean/30 hover:shadow-sm transition-all">
                          <div className="w-9 h-9 rounded-lg bg-ocean/10 flex items-center justify-center shrink-0">
                            <FileText className="w-4.5 h-4.5 text-ocean" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-ocean truncate">
                              {ev.description || ev.storage_path.split("/").pop() || "Document"}
                            </p>
                            <p className="text-xs text-text-secondary">Uploaded {fmtDate(ev.created_at)}</p>
                          </div>
                          <div className="flex items-center gap-1 text-xs text-ocean font-medium shrink-0">
                            <span>Open</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {evidenceImages.length === 0 && evidenceDocs.length === 0 && (
                  <p className="text-xs text-text-secondary italic">No evidence files were attached to this report.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 p-4 bg-gray-50 rounded-xl border border-border text-sm text-text-secondary">
              <Clock className="w-4 h-4 shrink-0" />
              No report submitted yet. Assignment is in <strong className="text-text-primary ml-1 capitalize">{assignment.status.replace(/_/g, " ")}</strong> stage.
            </div>
          )}
        </div>
      )}

      {/* ── 10. ADMIN DECISION ────────────────────────────────────────────── */}
      {(product.admin_notes || product.rejection_reason) && (
        <div className="px-5 py-5 border-b border-border space-y-3">
          <SectionHeader icon={ShieldCheck} title="Admin Decision" />
          {product.rejection_reason && (
            <div className="p-4 bg-danger/5 rounded-xl border border-danger/20">
              <p className="text-xs font-semibold text-danger uppercase tracking-wide mb-1">Rejection Reason</p>
              <p className="text-sm text-text-primary">{product.rejection_reason}</p>
            </div>
          )}
          {product.admin_notes && (
            <div className="p-4 bg-gray-50 rounded-xl border border-border">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-1">Admin Notes</p>
              <p className="text-sm text-text-primary">{product.admin_notes}</p>
            </div>
          )}
        </div>
      )}

      {/* ── 11. ACTIVITY LOG ──────────────────────────────────────────────── */}
      {activity.length > 0 && (
        <div className="px-5 py-5">
          <button
            onClick={() => setShowActivity(v => !v)}
            className="flex items-center gap-2 mb-3 w-full group"
          >
            <Activity className="w-4 h-4 text-text-secondary" />
            <p className="text-xs font-bold text-text-secondary uppercase tracking-wider flex-1 text-left">
              Activity Log ({activity.length} events)
            </p>
            {showActivity
              ? <ChevronUp className="w-4 h-4 text-text-secondary group-hover:text-text-primary" />
              : <ChevronDown className="w-4 h-4 text-text-secondary group-hover:text-text-primary" />}
          </button>

          {showActivity && (
            <div className="bg-white rounded-xl border border-border overflow-hidden">
              <div className="divide-y divide-border max-h-64 overflow-y-auto">
                {activity.map((ev, i) => (
                  <div key={i} className="flex items-start gap-3 px-4 py-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-ocean shrink-0 mt-1.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-text-primary">
                        {ev.action.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
                      </p>
                      <p className="text-[11px] text-text-secondary">
                        {ev.actor_name ? `by ${ev.actor_name}` : "system"}
                      </p>
                    </div>
                    <p className="text-[11px] text-text-secondary shrink-0">{fmtDateTime(ev.created_at)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Listings tab ──────────────────────────────────────────────────────────────

function ListingsTab({ listings }: { listings: Listing[] }) {
  const [statusFilter, setStatusFilter] = useState("")
  const [expanded, setExpanded]         = useState<string | null>(null)

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
      {/* Status filter pills */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => { setStatusFilter(""); setExpanded(null) }}
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
              onClick={() => { setStatusFilter(s); setExpanded(null) }}
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
          const cfg    = LISTING_CFG[l.status] ?? { label: l.status, className: "bg-gray-100 text-gray-500 border-gray-200" }
          const isOpen = expanded === l.id
          return (
            <div key={l.id} className="bg-white rounded-xl border border-border overflow-hidden shadow-sm">
              {/* Header row — click to expand */}
              <button
                className="w-full text-left px-5 py-4 hover:bg-gray-50/60 transition-colors"
                onClick={() => setExpanded(isOpen ? null : l.id)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-ocean/10 flex items-center justify-center shrink-0 mt-0.5">
                      <Package className="w-5 h-5 text-ocean" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <p className="text-sm font-semibold text-text-primary">{l.title}</p>
                        <Badge className={cn("text-xs border", cfg.className)}>{cfg.label}</Badge>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-text-secondary flex-wrap">
                        <Tag className="w-3 h-3" />
                        <span>{l.category_name || "Uncategorized"}</span>
                        <span>·</span>
                        <span className="font-semibold text-text-primary">{fmtMoney(l.asking_price, l.currency)}</span>
                        <span>·</span>
                        <span className="capitalize">{l.condition} · {l.availability_type.replace(/_/g, " ")}</span>
                        <span>·</span>
                        <span><MapPin className="inline w-3 h-3 mr-0.5" />{l.location_country}{l.location_port ? `, ${l.location_port}` : ""}</span>
                      </div>
                      <div className="flex items-center gap-4 mt-1.5 text-xs flex-wrap">
                        {l.verification_agent && (
                          <span className="flex items-center gap-1 text-ocean">
                            <UserCheck className="w-3 h-3" />{l.verification_agent}
                          </span>
                        )}
                        <span className="text-text-secondary flex items-center gap-1">
                          <ImageIcon className="w-3 h-3" />{l.image_count} image{l.image_count !== 1 ? "s" : ""}
                        </span>
                        {l.deal_count > 0 && (
                          <span className="text-success font-medium">{l.deal_count} deal{l.deal_count !== 1 ? "s" : ""}</span>
                        )}
                        <span className="text-text-secondary">
                          <Calendar className="inline w-3 h-3 mr-0.5" />Listed {fmtDate(l.created_at)}
                        </span>
                        {l.updated_at !== l.created_at && (
                          <span className="text-text-secondary">Updated {fmtDate(l.updated_at)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-1 mt-1">
                    <span className="text-xs text-ocean font-medium">{isOpen ? "Hide" : "Details"}</span>
                    {isOpen ? <ChevronUp className="w-4 h-4 text-ocean" /> : <ChevronDown className="w-4 h-4 text-text-secondary" />}
                  </div>
                </div>
              </button>

              {/* Expandable detail */}
              {isOpen && <ListingDetailPanel listing={l} />}
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
