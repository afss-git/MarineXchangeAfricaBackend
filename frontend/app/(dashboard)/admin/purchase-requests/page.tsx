"use client"

import { useState, useEffect, useCallback } from "react"
import {
  FileText, CheckCircle2, XCircle, RefreshCw, Search,
  AlertCircle, Loader2, ChevronDown, ChevronUp, UserCheck,
  Handshake, Package, DollarSign, MessageSquare, ShieldAlert,
  ZoomIn, X, ChevronLeft, ChevronRight, MapPin, Phone, Globe, Building2,
} from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  prAdmin,
  admin,
  marketplace,
  PurchaseRequestAdminDetail,
  AdminUserItem,
  ProductDetail,
  ProductImage,
  ApiRequestError,
} from "@/lib/api"
import { useAdminPurchaseRequests } from "@/lib/hooks"

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

function fmtPrice(amount: string | number | null, currency = "USD") {
  if (amount == null) return "—"
  const num = typeof amount === "string" ? parseFloat(amount) : amount
  if (isNaN(num)) return "—"
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 0 }).format(num)
}

function pctDiff(offered: string | null, asking: string | null): number | null {
  if (!offered || !asking) return null
  const o = parseFloat(offered), a = parseFloat(asking)
  if (isNaN(o) || isNaN(a) || a === 0) return null
  return ((o - a) / a) * 100
}

function ErrorBar({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 p-3 bg-danger/10 border border-danger/20 rounded-lg text-danger text-sm">
      <AlertCircle className="w-4 h-4 shrink-0" />{msg}
    </div>
  )
}

// ── Status / KYC config ────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; className: string }> = {
  submitted:      { label: "Submitted",      className: "bg-warning/10 text-warning border-warning/20" },
  agent_assigned: { label: "Agent Assigned", className: "bg-ocean/10 text-ocean border-ocean/20" },
  under_review:   { label: "Under Review",   className: "bg-ocean/10 text-ocean border-ocean/20" },
  accepted:       { label: "Accepted",       className: "bg-success/10 text-success border-success/20" },
  rejected:       { label: "Rejected",       className: "bg-danger/10 text-danger border-danger/20" },
  deal_created:   { label: "Deal Created",   className: "bg-navy/10 text-navy border-navy/20" },
  cancelled:      { label: "Cancelled",      className: "bg-gray-100 text-gray-500 border-gray-200" },
}

const KYC_CFG: Record<string, { label: string; className: string }> = {
  approved:    { label: "KYC Verified",   className: "bg-success/10 text-success border-success/20" },
  pending:     { label: "KYC Pending",    className: "bg-warning/10 text-warning border-warning/20" },
  rejected:    { label: "KYC Rejected",   className: "bg-danger/10 text-danger border-danger/20" },
  not_started: { label: "KYC Not Started",className: "bg-gray-100 text-gray-500 border-gray-200" },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? { label: status, className: "bg-gray-100 text-gray-600 border-gray-200" }
  return <Badge className={cn("text-xs border capitalize", cfg.className)}>{cfg.label}</Badge>
}

// ── Image Lightbox ─────────────────────────────────────────────────────────────

function Lightbox({ images, index, onClose, onNav }: {
  images: ProductImage[]
  index: number
  onClose: () => void
  onNav: (i: number) => void
}) {
  const total = images.length

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return }
    if (e.key === "ArrowRight") onNav((index + 1) % total)
    if (e.key === "ArrowLeft")  onNav((index - 1 + total) % total)
  }, [index, total, onClose, onNav])

  useEffect(() => {
    document.addEventListener("keydown", handleKey)
    return () => document.removeEventListener("keydown", handleKey)
  }, [handleKey])

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Close */}
      <button
        className="absolute top-4 right-4 text-white/70 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors"
        onClick={onClose}
      >
        <X className="w-6 h-6" />
      </button>

      {/* Counter */}
      {total > 1 && (
        <p className="absolute top-4 left-1/2 -translate-x-1/2 text-white/60 text-sm">
          {index + 1} / {total}
        </p>
      )}

      {/* Prev */}
      {total > 1 && (
        <button
          className="absolute left-4 text-white/70 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors"
          onClick={(e) => { e.stopPropagation(); onNav((index - 1 + total) % total) }}
        >
          <ChevronLeft className="w-7 h-7" />
        </button>
      )}

      {/* Image */}
      <img
        src={images[index].signed_url}
        alt=""
        className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
        onClick={(e) => e.stopPropagation()}
      />

      {/* Next */}
      {total > 1 && (
        <button
          className="absolute right-4 text-white/70 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors"
          onClick={(e) => { e.stopPropagation(); onNav((index + 1) % total) }}
        >
          <ChevronRight className="w-7 h-7" />
        </button>
      )}
    </div>
  )
}

// ── Detail Panel ───────────────────────────────────────────────────────────────

function PRPanel({ item, agents, onActioned }: {
  item: PurchaseRequestAdminDetail
  agents: AdminUserItem[]
  onActioned: (updated: PurchaseRequestAdminDetail) => void
}) {
  const [detail, setDetail]   = useState<PurchaseRequestAdminDetail>(item)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Full product data (fetched via marketplace API — same source as the marketplace page)
  const [product, setProduct]       = useState<ProductDetail | null>(null)
  const [images, setImages]         = useState<ProductImage[]>([])
  const [selectedImg, setSelectedImg] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)

  // Assign agent
  const [agentId, setAgentId]         = useState(item.agent_assignment?.agent_id ?? "")
  const [agentNotes, setAgentNotes]   = useState("")
  const [assigning, setAssigning]     = useState(false)
  const [assignError, setAssignError] = useState<string | null>(null)

  // Approve / reject
  const [approveNotes, setApproveNotes] = useState("")
  const [bypassReason, setBypassReason] = useState("")
  const [rejectNotes, setRejectNotes]   = useState("")
  const [approving, setApproving]       = useState(false)
  const [rejecting, setRejecting]       = useState(false)
  const [actionError, setActionError]   = useState<string | null>(null)

  // Convert to deal
  const [showConvert, setShowConvert]   = useState(false)
  const [agreedPrice, setAgreedPrice]   = useState(item.offered_price ?? "")
  const [currency, setCurrency]         = useState(item.offered_currency ?? "USD")
  const [dealType, setDealType]         = useState<"full_payment" | "financing">("full_payment")
  const [convertNotes, setConvertNotes] = useState("")
  const [converting, setConverting]     = useState(false)
  const [convertError, setConvertError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    // Fetch PR detail + product images in parallel
    Promise.all([
      prAdmin.get(item.id),
      item.product_id ? marketplace.getProduct(item.product_id) : Promise.resolve(null),
    ])
      .then(([d, prod]) => {
        setDetail(d)
        setAgentId(d.agent_assignment?.agent_id ?? "")
        if (prod) {
          setProduct(prod)
          const sorted = [...prod.images].sort((a, b) => a.display_order - b.display_order)
          setImages(sorted)
        }
      })
      .catch((e) => setLoadError((e as ApiRequestError)?.message ?? "Failed to load detail"))
      .finally(() => setLoading(false))
  }, [item.id, item.product_id])

  async function handleAssign() {
    if (!agentId) { setAssignError("Please select an agent."); return }
    setAssigning(true); setAssignError(null)
    try {
      const updated = await prAdmin.assignAgent(item.id, agentId, agentNotes.trim() || undefined)
      setDetail(updated); onActioned(updated)
    } catch (e) { setAssignError((e as ApiRequestError)?.message ?? "Failed to assign agent") }
    finally { setAssigning(false) }
  }

  async function handleApprove() {
    setApproving(true); setActionError(null)
    try {
      const updated = await prAdmin.approve(item.id, approveNotes.trim() || undefined, bypassReason.trim() || undefined)
      setDetail(updated); onActioned(updated)
    } catch (e) { setActionError((e as ApiRequestError)?.message ?? "Failed to approve") }
    finally { setApproving(false) }
  }

  async function handleReject() {
    if (!rejectNotes.trim()) { setActionError("Rejection reason is required."); return }
    setRejecting(true); setActionError(null)
    try {
      const updated = await prAdmin.reject(item.id, rejectNotes.trim())
      setDetail(updated); onActioned(updated)
    } catch (e) { setActionError((e as ApiRequestError)?.message ?? "Failed to reject") }
    finally { setRejecting(false) }
  }

  async function handleConvert() {
    const price = parseFloat(agreedPrice)
    if (!agreedPrice || isNaN(price) || price <= 0) { setConvertError("Enter a valid agreed price."); return }
    setConverting(true); setConvertError(null)
    try {
      await prAdmin.convert(item.id, {
        deal_type: dealType, agreed_price: price, currency,
        admin_notes: convertNotes.trim() || undefined,
      })
      const updated = await prAdmin.get(item.id)
      setDetail(updated); onActioned(updated)
    } catch (e) { setConvertError((e as ApiRequestError)?.message ?? "Failed to convert") }
    finally { setConverting(false) }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-8 gap-2 text-text-secondary text-sm border-t border-border">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading details…
    </div>
  )
  if (loadError) return <div className="p-5 border-t border-border"><ErrorBar msg={loadError} /></div>

  const canAssign  = ["submitted", "agent_assigned"].includes(detail.status)
  const canDecide  = ["submitted", "agent_assigned", "under_review"].includes(detail.status)
  const canConvert = detail.status === "accepted" && !detail.converted_deal_id
  const hasReport  = !!detail.agent_report
  // Use the full product data fetched from marketplace API (same as marketplace page)
  const askingPrice    = product?.asking_price    ?? detail.product_asking_price
  const askingCurrency = product?.currency        ?? detail.product_currency ?? "USD"
  const askingLabel    = askingPrice != null ? `$${Number(askingPrice).toLocaleString()} ${askingCurrency}` : "—"
  const diff           = pctDiff(detail.offered_price, askingPrice)

  return (
    <div className="border-t border-border divide-y divide-border">

      {/* ── Product Images + Info ──────────────────────────────────────────── */}
      <div className="px-5 py-5 space-y-4">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Product</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Image gallery */}
          <div className="space-y-2">
            {/* Main image */}
            <div
              className={cn(
                "relative w-full bg-gray-50 rounded-xl border border-border overflow-hidden group",
                images.length > 0 ? "cursor-zoom-in" : ""
              )}
              style={{ minHeight: 200 }}
              onClick={() => {
                if (images.length > 0) {
                  setLightboxIndex(selectedImg)
                  setLightboxOpen(true)
                }
              }}
            >
              {images.length > 0 ? (
                <>
                  <img
                    src={images[selectedImg]?.signed_url}
                    alt={detail.product_title ?? "Product"}
                    className="w-full max-h-64 object-contain"
                  />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="bg-black/40 rounded-full p-2.5">
                      <ZoomIn className="w-5 h-5 text-white" />
                    </div>
                  </div>
                </>
              ) : detail.product_primary_image_url ? (
                /* Fallback to the single URL from PR detail */
                <>
                  <img
                    src={detail.product_primary_image_url}
                    alt={detail.product_title ?? "Product"}
                    className="w-full max-h-64 object-contain cursor-zoom-in"
                    onClick={() => setLightboxOpen(true)}
                  />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="bg-black/40 rounded-full p-2.5">
                      <ZoomIn className="w-5 h-5 text-white" />
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-48 gap-2 text-gray-300">
                  <Package className="w-12 h-12" />
                  <p className="text-xs text-gray-400">No images</p>
                </div>
              )}
            </div>

            {/* Thumbnails */}
            {images.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {images.map((img, i) => (
                  <button
                    key={img.id}
                    onClick={() => setSelectedImg(i)}
                    className={cn(
                      "shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-colors bg-gray-100",
                      selectedImg === i ? "border-ocean" : "border-transparent hover:border-gray-300"
                    )}
                  >
                    <img src={img.signed_url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Product details */}
          <div className="space-y-3 text-sm">
            {detail.product_id ? (
              <Link
                href={`/marketplace/${detail.product_id}`}
                target="_blank"
                className="font-semibold text-base text-text-primary hover:text-ocean transition-colors leading-snug block"
              >
                {product?.title ?? detail.product_title ?? detail.product_id}
              </Link>
            ) : (
              <p className="font-semibold text-base text-text-secondary italic">No product linked</p>
            )}

            {/* Badges */}
            <div className="flex flex-wrap gap-1.5">
              {(product?.condition ?? detail.product_condition) && (
                <Badge variant="secondary" className="capitalize">
                  {(product?.condition ?? detail.product_condition)!}
                </Badge>
              )}
              {(product?.availability_type ?? detail.product_availability_type) && (
                <Badge variant="secondary" className="capitalize">
                  {(product?.availability_type ?? detail.product_availability_type)!.replace(/_/g, " ")}
                </Badge>
              )}
            </div>

            {/* Location */}
            {((product?.location_country ?? detail.product_location_country) || (product?.location_port ?? detail.product_location_port)) && (
              <p className="text-text-secondary flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 shrink-0" />
                {[product?.location_port ?? detail.product_location_port, product?.location_country ?? detail.product_location_country].filter(Boolean).join(", ")}
              </p>
            )}

            {/* Seller */}
            {(product?.seller_company ?? detail.seller_company) && (
              <p className="text-text-secondary flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 shrink-0" />
                {product?.seller_company ?? detail.seller_company}
              </p>
            )}

            {/* Price comparison — same pattern as marketplace page */}
            <div className="pt-1 space-y-1.5 border-t border-border">
              <div className="flex justify-between">
                <span className="text-text-secondary">Asking price</span>
                <span className="font-semibold text-navy text-base">{askingLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Buyer&apos;s offer</span>
                <span className={cn("font-semibold", diff === null ? "text-text-primary" : diff >= 0 ? "text-success" : "text-danger")}>
                  {fmtPrice(detail.offered_price, detail.offered_currency)}
                  {diff !== null && (
                    <span className="text-xs ml-1 font-normal">({diff >= 0 ? "+" : ""}{diff.toFixed(1)}%)</span>
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Purchase type</span>
                <span className="font-medium text-text-primary capitalize">{detail.purchase_type.replace(/_/g, " ")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Quantity</span>
                <span className="font-medium text-text-primary">{detail.quantity}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Buyer Info ─────────────────────────────────────────────────────── */}
      <div className="px-5 py-4">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-3">Buyer</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-sm">
          <div>
            <p className="text-xs text-text-secondary mb-0.5">Name</p>
            <p className="font-medium text-text-primary">{detail.buyer_name ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-text-secondary mb-0.5">Email</p>
            <p className="font-medium text-text-primary truncate">{detail.buyer_email ?? "—"}</p>
          </div>
          {detail.buyer_phone && (
            <div>
              <p className="text-xs text-text-secondary mb-0.5">Phone</p>
              <p className="font-medium text-text-primary flex items-center gap-1">
                <Phone className="w-3 h-3 text-text-secondary" />{detail.buyer_phone}
              </p>
            </div>
          )}
          {detail.buyer_company_name && (
            <div>
              <p className="text-xs text-text-secondary mb-0.5">Company</p>
              <p className="font-medium text-text-primary">{detail.buyer_company_name}</p>
            </div>
          )}
          {detail.buyer_country && (
            <div>
              <p className="text-xs text-text-secondary mb-0.5">Country</p>
              <p className="font-medium text-text-primary flex items-center gap-1">
                <Globe className="w-3 h-3 text-text-secondary" />{detail.buyer_country}
              </p>
            </div>
          )}
          <div>
            <p className="text-xs text-text-secondary mb-0.5">KYC Status</p>
            {(() => {
              const cfg = KYC_CFG[detail.buyer_kyc_status ?? ""] ?? KYC_CFG["not_started"]
              return <Badge className={cn("text-xs border", cfg.className)}>{cfg.label}</Badge>
            })()}
          </div>
          <div>
            <p className="text-xs text-text-secondary mb-0.5">Submitted</p>
            <p className="font-medium text-text-primary">{fmtDate(detail.created_at)}</p>
          </div>
          {detail.reviewed_at && (
            <div>
              <p className="text-xs text-text-secondary mb-0.5">Reviewed</p>
              <p className="font-medium text-text-primary">{fmtDate(detail.reviewed_at)}</p>
            </div>
          )}
          {detail.converted_deal_id && (
            <div>
              <p className="text-xs text-text-secondary mb-0.5">Deal</p>
              <Link href={`/admin/deals/${detail.converted_deal_id}`}
                className="text-ocean hover:underline text-sm font-medium flex items-center gap-1">
                <Handshake className="w-3.5 h-3.5" /> View Deal
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* ── Buyer Message ─────────────────────────────────────────────────── */}
      {detail.message && (
        <div className="px-5 py-4">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5" /> Buyer Message
          </p>
          <p className="text-sm text-text-primary whitespace-pre-line bg-gray-50 rounded-lg p-3 border border-border">
            {detail.message}
          </p>
        </div>
      )}

      {/* ── Admin Notes ───────────────────────────────────────────────────── */}
      {(detail.admin_notes || detail.admin_bypass_reason || detail.cancelled_reason) && (
        <div className="px-5 py-4 space-y-2">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Admin Notes</p>
          {detail.admin_notes && (
            <p className="text-sm text-text-primary bg-blue-50 border border-blue-100 rounded-lg p-3">
              {detail.admin_notes}
            </p>
          )}
          {detail.admin_bypass_reason && (
            <div className="flex items-start gap-2 text-sm text-warning bg-warning/5 border border-warning/20 rounded-lg p-3">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span><strong>Bypass reason:</strong> {detail.admin_bypass_reason}</span>
            </div>
          )}
          {detail.cancelled_reason && (
            <p className="text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg p-3">
              <strong>Cancelled:</strong> {detail.cancelled_reason}
            </p>
          )}
        </div>
      )}

      {/* ── Assigned Agent ────────────────────────────────────────────────── */}
      {detail.agent_assignment && (
        <div className="px-5 py-4">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">Assigned Agent</p>
          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-border text-sm">
            <UserCheck className="w-4 h-4 text-ocean shrink-0" />
            <div>
              <p className="font-medium text-text-primary">{detail.agent_assignment.agent_name ?? "Unknown"}</p>
              <p className="text-xs text-text-secondary capitalize">
                Status: {detail.agent_assignment.status.replace(/_/g, " ")}
                {detail.agent_assignment.notes && ` · ${detail.agent_assignment.notes}`}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Due-Diligence Report ──────────────────────────────────────────── */}
      {detail.agent_report && (
        <div className="px-5 py-4">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-3">Due-Diligence Report</p>
          <div className="p-4 bg-gray-50 rounded-xl border border-border space-y-3 text-sm">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-text-primary">{detail.agent_report.agent_name ?? "Agent"}</span>
              <Badge className={cn("text-xs border capitalize", {
                "bg-success/10 text-success border-success/20": detail.agent_report.risk_rating === "low",
                "bg-warning/10 text-warning border-warning/20": detail.agent_report.risk_rating === "medium",
                "bg-danger/10 text-danger border-danger/20":   detail.agent_report.risk_rating === "high",
              })}>
                {detail.agent_report.risk_rating} risk
              </Badge>
              <Badge className={cn("text-xs border", detail.agent_report.recommendation === "recommend_approve"
                ? "bg-success/10 text-success border-success/20"
                : "bg-danger/10 text-danger border-danger/20"
              )}>
                {detail.agent_report.recommendation === "recommend_approve" ? "Recommend Approve" : "Recommend Reject"}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-text-secondary mb-0.5">Financial Capacity</p>
                <p className="font-semibold text-text-primary">{fmtPrice(detail.agent_report.financial_capacity_usd)}</p>
              </div>
              <div>
                <p className="text-xs text-text-secondary mb-0.5">Report Date</p>
                <p className="font-medium text-text-primary">{fmtDate(detail.agent_report.created_at)}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-text-secondary mb-1">Verification Notes</p>
              <p className="text-xs text-text-primary leading-relaxed bg-white rounded-lg p-2.5 border border-border">
                {detail.agent_report.verification_notes}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Assign / Reassign Agent ────────────────────────────────────────── */}
      {canAssign && (
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
            {detail.agent_assignment ? "Reassign Agent" : "Assign Due-Diligence Agent"}
          </p>
          <div className="space-y-2">
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 bg-white"
            >
              <option value="">— Select an agent —</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.full_name ?? a.email} {a.company_name ? `(${a.company_name})` : ""}
                </option>
              ))}
            </select>
            <Input
              value={agentNotes} onChange={(e) => setAgentNotes(e.target.value)}
              placeholder="Assignment notes (optional)"
              className="text-sm"
            />
          </div>
          {assignError && <ErrorBar msg={assignError} />}
          <Button onClick={handleAssign} disabled={assigning || !agentId} size="sm"
            className="bg-ocean hover:bg-ocean-dark text-white gap-1.5">
            {assigning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
            {assigning ? "Assigning…" : detail.agent_assignment ? "Reassign Agent" : "Assign Agent"}
          </Button>
        </div>
      )}

      {/* ── Approve / Reject ──────────────────────────────────────────────── */}
      {canDecide && (
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Decision</p>
          {!hasReport && (
            <div className="flex items-start gap-2 p-3 bg-warning/5 border border-warning/20 rounded-lg text-sm text-warning">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              No agent report yet. You can still decide but should provide a bypass reason.
            </div>
          )}
          <div className="space-y-2">
            <label className="text-xs font-medium text-text-secondary block">Approval Notes (optional)</label>
            <Textarea rows={2} value={approveNotes} onChange={(e) => setApproveNotes(e.target.value)}
              placeholder="Notes for this approval…" className="text-sm resize-none" />
          </div>
          {!hasReport && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-text-secondary block">
                Bypass Reason <span className="text-xs font-normal">(required when overriding agent recommendation)</span>
              </label>
              <Textarea rows={2} value={bypassReason} onChange={(e) => setBypassReason(e.target.value)}
                placeholder="Reason for bypassing agent report…" className="text-sm resize-none" />
            </div>
          )}
          <div className="space-y-2">
            <label className="text-xs font-medium text-text-secondary block">
              Rejection Reason <span className="text-xs font-normal text-danger">(required to reject)</span>
            </label>
            <Textarea rows={2} value={rejectNotes} onChange={(e) => setRejectNotes(e.target.value)}
              placeholder="Reason shown to buyer if rejected…" className="text-sm resize-none" />
          </div>
          {actionError && <ErrorBar msg={actionError} />}
          <div className="flex gap-2">
            <Button onClick={handleApprove} disabled={approving || rejecting}
              className="bg-success hover:bg-success/90 text-white gap-1.5">
              {approving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {approving ? "Approving…" : "Approve"}
            </Button>
            <Button onClick={handleReject} disabled={approving || rejecting} variant="outline"
              className="text-danger border-danger/30 hover:bg-danger/5 gap-1.5">
              {rejecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
              {rejecting ? "Rejecting…" : "Reject"}
            </Button>
          </div>
        </div>
      )}

      {/* ── Convert to Deal ───────────────────────────────────────────────── */}
      {canConvert && (
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Convert to Deal</p>
            <button onClick={() => setShowConvert(!showConvert)} className="text-xs text-ocean hover:underline">
              {showConvert ? "Hide" : "Show form"}
            </button>
          </div>
          {showConvert && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-text-secondary block mb-1">
                    Agreed Price <span className="text-danger">*</span>
                  </label>
                  <Input type="number" step="1" value={agreedPrice}
                    onChange={(e) => setAgreedPrice(e.target.value)} placeholder="0" />
                </div>
                <div>
                  <label className="text-xs font-medium text-text-secondary block mb-1">Currency</label>
                  <select value={currency} onChange={(e) => setCurrency(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 bg-white">
                    {["USD", "EUR", "GBP", "ZAR", "NGN", "KES", "GHS"].map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-text-secondary block mb-1">Deal Type</label>
                  <div className="flex gap-2">
                    {(["full_payment", "financing"] as const).map((t) => (
                      <button key={t} onClick={() => setDealType(t)}
                        className={cn("px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors",
                          dealType === t ? "bg-ocean text-white border-ocean" : "bg-white text-text-secondary border-border hover:border-gray-300")}>
                        {t === "full_payment" ? "Full Payment" : "Financing"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-text-secondary block mb-1">Admin Notes</label>
                  <Textarea rows={2} value={convertNotes} onChange={(e) => setConvertNotes(e.target.value)}
                    placeholder="Notes for the deal…" className="text-sm resize-none" />
                </div>
              </div>
              {convertError && <ErrorBar msg={convertError} />}
              <Button onClick={handleConvert} disabled={converting}
                className="bg-ocean hover:bg-ocean-dark text-white gap-1.5">
                {converting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Handshake className="w-4 h-4" />}
                {converting ? "Creating Deal…" : "Create Deal"}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── Terminal states ────────────────────────────────────────────────── */}
      {detail.status === "rejected" && (
        <div className="px-5 py-3 bg-danger/5">
          <p className="text-sm text-danger flex items-center gap-1.5">
            <XCircle className="w-4 h-4" /> Rejected — {detail.admin_notes ?? "No reason provided"}
          </p>
        </div>
      )}
      {detail.status === "deal_created" && detail.converted_deal_id && (
        <div className="px-5 py-3 bg-success/5">
          <p className="text-sm text-success flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> Deal created.{" "}
            <Link href={`/admin/deals/${detail.converted_deal_id}`} className="underline">View deal →</Link>
          </p>
        </div>
      )}

      {/* ── Lightbox ─────────────────────────────────────────────────────── */}
      {lightboxOpen && images.length > 0 && (
        <Lightbox
          images={images}
          index={lightboxIndex}
          onClose={() => setLightboxOpen(false)}
          onNav={setLightboxIndex}
        />
      )}
      {/* Fallback lightbox for single primary image only */}
      {lightboxOpen && images.length === 0 && detail.product_primary_image_url && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setLightboxOpen(false)}
        >
          <button className="absolute top-4 right-4 text-white/70 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors">
            <X className="w-6 h-6" />
          </button>
          <img
            src={detail.product_primary_image_url}
            alt={detail.product_title ?? "Product"}
            className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

const STATUS_TABS = [
  { value: "",               label: "All" },
  { value: "submitted",      label: "Submitted" },
  { value: "agent_assigned", label: "Agent Assigned" },
  { value: "under_review",   label: "Under Review" },
  { value: "accepted",       label: "Accepted" },
  { value: "rejected",       label: "Rejected" },
  { value: "deal_created",   label: "Deal Created" },
]

export default function AdminPurchaseRequestsPage() {
  const [search, setSearch]             = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [expanded, setExpanded]         = useState<string | null>(null)
  const [agents, setAgents]             = useState<AdminUserItem[]>([])

  const { data, isLoading: loading, error: swrError, mutate } = useAdminPurchaseRequests({
    status: statusFilter || undefined,
  })
  const items: PurchaseRequestAdminDetail[] = data?.items ?? []
  const total = data?.total ?? 0
  const error = swrError?.message ?? null

  useEffect(() => {
    admin.listUsers({ role: "buyer_agent", page_size: 100 })
      .then((res) => setAgents(res.items))
      .catch(() => {/* silent */})
  }, [])

  function handleActioned(updated: PurchaseRequestAdminDetail) {
    mutate((current) => {
      if (!current) return current
      return {
        ...current,
        items: current.items.map((i) => i.id === updated.id ? updated : i),
      }
    }, { revalidate: false })
  }

  const filtered = search.trim()
    ? items.filter((i) =>
        (i.buyer_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (i.buyer_email ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (i.product_title ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (i.buyer_company_name ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : items

  return (
    <div className="space-y-5">
      {/* Top bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
          <Input
            placeholder="Search buyer, company, email or product…"
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-white"
          />
        </div>
        <div className="flex items-center gap-2">
          {total > 0 && <span className="text-sm text-text-secondary">{total} requests</span>}
          <Button variant="outline" size="sm" onClick={() => mutate()} disabled={loading} className="gap-1.5">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /> Refresh
          </Button>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {STATUS_TABS.map((tab) => (
          <button key={tab.value}
            onClick={() => { setStatusFilter(tab.value); setExpanded(null) }}
            className={cn(
              "px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px shrink-0",
              statusFilter === tab.value
                ? "border-ocean text-ocean"
                : "border-transparent text-text-secondary hover:text-text-primary"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <ErrorBar msg={error} />}

      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center py-16 gap-2 text-text-secondary text-sm">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-border p-12 text-center">
          <FileText className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-text-secondary">No purchase requests found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => {
            const isOpen = expanded === item.id
            return (
              <div key={item.id} className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
                {/* Row header */}
                <div
                  className="flex items-start gap-4 px-5 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => setExpanded(isOpen ? null : item.id)}
                >
                  {/* Thumbnail */}
                  <div className="w-12 h-12 rounded-xl border border-border bg-gray-50 shrink-0 overflow-hidden flex items-center justify-center">
                    {item.product_primary_image_url ? (
                      <img
                        src={item.product_primary_image_url}
                        alt={item.product_title ?? "Product"}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Package className="w-5 h-5 text-gray-300" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">
                      {item.product_title ?? <span className="italic text-text-secondary">No product linked</span>}
                    </p>
                    <p className="text-xs text-text-secondary mt-0.5">
                      <span className="font-medium text-text-primary">{item.buyer_name ?? "Unknown"}</span>
                      {item.buyer_company_name && <span> · {item.buyer_company_name}</span>}
                      {item.buyer_email && <span> · {item.buyer_email}</span>}
                    </p>
                    <p className="text-xs text-text-secondary mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <DollarSign className="w-3 h-3" />
                      <span className="font-medium text-text-primary">{fmtPrice(item.offered_price, item.offered_currency)}</span>
                      <span className="capitalize">{item.purchase_type.replace(/_/g, " ")}</span>
                      <span>· {fmtDate(item.created_at)}</span>
                      {item.agent_assignment && (
                        <span>· <UserCheck className="w-3 h-3 inline mr-0.5" />{item.agent_assignment.agent_name ?? "Assigned"}</span>
                      )}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={item.status} />
                    {isOpen
                      ? <ChevronUp className="w-4 h-4 text-text-secondary" />
                      : <ChevronDown className="w-4 h-4 text-text-secondary" />}
                  </div>
                </div>

                {isOpen && (
                  <PRPanel item={item} agents={agents} onActioned={handleActioned} />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
