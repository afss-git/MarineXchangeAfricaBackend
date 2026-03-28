"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  FileText, Clock, CheckCircle2, XCircle, RefreshCw, Search,
  AlertCircle, Loader2, Package, ChevronDown, ChevronUp,
  UserCheck, Handshake, DollarSign, User,
} from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  prAdmin,
  paymentAccounts, rateSchedules,
  PurchaseRequestAdminItem, PurchaseRequestAdminDetail,
  PaymentAccountOut, RateScheduleOut,
} from "@/lib/api"
import { useAdminPurchaseRequests } from "@/lib/hooks"

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  })
}

function fmtCurrency(amount: number | null, currency = "USD") {
  if (!amount) return "—"
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 0 }).format(amount)
}

function ErrorBar({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger text-sm">
      <AlertCircle className="w-4 h-4 shrink-0" />{msg}
    </div>
  )
}

// ── Status config ──────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; className: string }> = {
  submitted:       { label: "Submitted",     className: "bg-warning/10 text-warning border-warning/20" },
  under_review:    { label: "Under Review",  className: "bg-ocean/10 text-ocean border-ocean/20" },
  accepted:        { label: "Accepted",      className: "bg-success/10 text-success border-success/20" },
  rejected:        { label: "Rejected",      className: "bg-danger/10 text-danger border-danger/20" },
  deal_created:    { label: "Deal Created",  className: "bg-navy/10 text-navy border-navy/20" },
  cancelled:       { label: "Cancelled",     className: "bg-gray-100 text-gray-500 border-gray-200" },
  negotiating:     { label: "Negotiating",   className: "bg-ocean/10 text-ocean border-ocean/20" },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? { label: status, className: "bg-gray-100 text-gray-600 border-gray-200" }
  return <Badge className={cn("text-xs border capitalize", cfg.className)}>{cfg.label}</Badge>
}

// ── PR detail panel ────────────────────────────────────────────────────────────

function PRPanel({ item, onActioned }: {
  item: PurchaseRequestAdminItem
  onActioned: () => void
}) {
  const [detail, setDetail]   = useState<PurchaseRequestAdminDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [accounts, setAccounts] = useState<PaymentAccountOut[]>([])
  const [rates, setRates]       = useState<RateScheduleOut[]>([])

  // Assign agent
  const [agentId, setAgentId]       = useState("")
  const [assigning, setAssigning]   = useState(false)
  const [assignError, setAssignError] = useState<string | null>(null)
  const [assigned, setAssigned]     = useState(false)

  // Approve / reject
  const [approveNotes, setApproveNotes] = useState("")
  const [rejectReason, setRejectReason] = useState("")
  const [approving, setApproving]       = useState(false)
  const [rejecting, setRejecting]       = useState(false)
  const [actionError, setActionError]   = useState<string | null>(null)
  const [actioned, setActioned]         = useState<"approved" | "rejected" | null>(null)

  // Convert to deal
  const [showConvert, setShowConvert]   = useState(false)
  const [totalPrice, setTotalPrice]     = useState("")
  const [currency, setCurrency]         = useState("USD")
  const [dealType, setDealType]         = useState<"full_payment" | "financing">("full_payment")
  const [accountId, setAccountId]       = useState("")
  const [convertNotes, setConvertNotes] = useState("")
  const [durationMonths, setDurationMonths]   = useState("12")
  const [initialPercent, setInitialPercent]   = useState("30")
  const [rateScheduleId, setRateScheduleId]   = useState("")
  const [converting, setConverting]           = useState(false)
  const [convertError, setConvertError]       = useState<string | null>(null)
  const [converted, setConverted]             = useState(false)

  useEffect(() => {
    Promise.allSettled([
      prAdmin.get(item.id),
      paymentAccounts.list(false),
      rateSchedules.list(false),
    ]).then(([detailRes, acctRes, rateRes]) => {
      if (detailRes.status === "fulfilled") setDetail(detailRes.value)
      else setError("Failed to load request")
      if (acctRes.status === "fulfilled")  setAccounts(acctRes.value)
      if (rateRes.status === "fulfilled")  setRates(rateRes.value)
    }).finally(() => setLoading(false))
  }, [item.id])

  async function handleAssignAgent() {
    if (!agentId.trim()) { setAssignError("Agent ID is required."); return }
    setAssigning(true); setAssignError(null)
    try {
      await prAdmin.assignAgent(item.id, agentId.trim())
      setAssigned(true); onActioned()
    } catch (e: unknown) { setAssignError((e as Error)?.message ?? "Failed") }
    finally { setAssigning(false) }
  }

  async function handleApprove() {
    setApproving(true); setActionError(null)
    try {
      await prAdmin.approve(item.id, approveNotes.trim() || undefined)
      setActioned("approved"); onActioned()
    } catch (e: unknown) { setActionError((e as Error)?.message ?? "Failed") }
    finally { setApproving(false) }
  }

  async function handleReject() {
    if (!rejectReason.trim()) { setActionError("Rejection reason is required."); return }
    setRejecting(true); setActionError(null)
    try {
      await prAdmin.reject(item.id, rejectReason.trim())
      setActioned("rejected"); onActioned()
    } catch (e: unknown) { setActionError((e as Error)?.message ?? "Failed") }
    finally { setRejecting(false) }
  }

  async function handleConvert() {
    if (!totalPrice || isNaN(parseFloat(totalPrice))) { setConvertError("Total price is required."); return }
    setConverting(true); setConvertError(null)
    try {
      await prAdmin.convert(item.id, {
        total_price: parseFloat(totalPrice),
        currency,
        deal_type: dealType,
        ...(accountId   ? { payment_account_id: accountId }                : {}),
        ...(convertNotes ? { admin_notes: convertNotes.trim() }            : {}),
        ...(dealType === "financing" ? {
          duration_months: parseInt(durationMonths) || 12,
          initial_payment_percent: parseFloat(initialPercent) || 30,
          ...(rateScheduleId ? { rate_schedule_id: rateScheduleId } : {}),
        } : {}),
      })
      setConverted(true); onActioned()
    } catch (e: unknown) { setConvertError((e as Error)?.message ?? "Failed") }
    finally { setConverting(false) }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-10 gap-2 text-text-secondary text-sm border-t border-border">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading…
    </div>
  )
  if (error || !detail) return <div className="p-5 border-t border-border"><ErrorBar msg={error ?? "No data"} /></div>

  const canAssign  = ["submitted", "under_review"].includes(detail.status)
  const canDecide  = ["submitted", "under_review"].includes(detail.status)
  const canConvert = detail.status === "accepted" && !detail.deal_id

  return (
    <div className="border-t border-border">
      {/* Details grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 px-5 py-4 bg-gray-50/50 text-sm">
        <div>
          <p className="text-xs text-text-secondary mb-0.5">Buyer</p>
          <p className="font-medium text-text-primary">{detail.buyer_name ?? "—"}</p>
          {detail.buyer_email && <p className="text-xs text-text-secondary">{detail.buyer_email}</p>}
        </div>
        <div>
          <p className="text-xs text-text-secondary mb-0.5">Company</p>
          <p className="font-medium text-text-primary">{detail.buyer_company ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-text-secondary mb-0.5">Budget</p>
          <p className="font-medium text-text-primary">
            {fmtCurrency(detail.budget_min, detail.currency)} – {fmtCurrency(detail.budget_max, detail.currency)}
          </p>
        </div>
        <div>
          <p className="text-xs text-text-secondary mb-0.5">Request Type</p>
          <p className="font-medium text-text-primary capitalize">{detail.request_type?.replace(/_/g, " ") ?? "—"}</p>
        </div>
        {detail.preferred_delivery_date && (
          <div>
            <p className="text-xs text-text-secondary mb-0.5">Delivery Date</p>
            <p className="font-medium text-text-primary">{fmtDate(detail.preferred_delivery_date)}</p>
          </div>
        )}
        {detail.assigned_agent && (
          <div>
            <p className="text-xs text-text-secondary mb-0.5">Assigned Agent</p>
            <p className="font-medium text-text-primary">{detail.assigned_agent}</p>
          </div>
        )}
        {detail.deal_id && (
          <div>
            <p className="text-xs text-text-secondary mb-0.5">Deal Created</p>
            <Link href={`/admin/deals/${detail.deal_id}`} className="text-ocean hover:underline text-sm font-medium flex items-center gap-1">
              View Deal
            </Link>
          </div>
        )}
      </div>

      {/* Description */}
      <div className="px-5 pb-4">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-1">Description</p>
        <p className="text-sm text-text-primary whitespace-pre-line">{detail.description}</p>
        {detail.additional_requirements && (
          <div className="mt-3">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-1">Additional Requirements</p>
            <p className="text-sm text-text-primary whitespace-pre-line">{detail.additional_requirements}</p>
          </div>
        )}
      </div>

      {/* Agent report */}
      {detail.agent_report && (
        <div className="px-5 py-3 border-t border-border">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">Agent Due-Diligence Report</p>
          <div className="p-4 bg-gray-50 rounded-lg border border-border space-y-1.5 text-sm">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-medium">{detail.agent_report.agent_name ?? "Agent"}</span>
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
            <p className="text-text-secondary">Financial Capacity: <strong>{fmtCurrency(detail.agent_report.financial_capacity_usd)}</strong></p>
            <p className="text-text-secondary text-xs">{detail.agent_report.verification_notes}</p>
          </div>
        </div>
      )}

      {/* Assign Agent */}
      {canAssign && !assigned && (
        <div className="px-5 py-4 border-t border-border space-y-2">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Assign Due-Diligence Agent</p>
          <div className="flex gap-2">
            <Input
              value={agentId} onChange={(e) => setAgentId(e.target.value)}
              placeholder="Agent user ID (UUID)" className="font-mono text-sm flex-1"
            />
            <Button onClick={handleAssignAgent} disabled={assigning} size="sm" className="bg-ocean hover:bg-ocean-dark text-white gap-1.5">
              {assigning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
              Assign
            </Button>
          </div>
          {assignError && <ErrorBar msg={assignError} />}
        </div>
      )}
      {assigned && (
        <div className="px-5 py-3 border-t border-border">
          <p className="text-sm text-success flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> Agent assigned.</p>
        </div>
      )}

      {/* Approve / Reject */}
      {actioned ? (
        <div className={cn("px-5 py-4 border-t border-border", actioned === "approved" ? "bg-success/5" : "bg-danger/5")}>
          <div className={cn("flex items-center gap-2 text-sm font-medium", actioned === "approved" ? "text-success" : "text-danger")}>
            {actioned === "approved" ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            Request {actioned}.
          </div>
        </div>
      ) : canDecide ? (
        <div className="px-5 py-4 bg-gray-50/50 border-t border-border space-y-3">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Decision</p>
          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1">Approval Notes (optional)</label>
            <Textarea rows={2} value={approveNotes} onChange={(e) => setApproveNotes(e.target.value)}
              placeholder="Notes to include when approving…" className="text-sm resize-none" />
          </div>
          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1">
              Rejection Reason <span className="text-xs text-text-secondary font-normal">(required to reject)</span>
            </label>
            <Textarea rows={2} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason shown to buyer if rejected…" className="text-sm resize-none" />
          </div>
          {actionError && <ErrorBar msg={actionError} />}
          <div className="flex gap-2">
            <Button onClick={handleApprove} disabled={approving || rejecting} className="bg-success hover:bg-success/90 text-white gap-1.5">
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
      ) : null}

      {/* Convert to Deal */}
      {converted ? (
        <div className="px-5 py-4 bg-success/5 border-t border-border">
          <p className="text-sm text-success flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> Converted to deal.</p>
        </div>
      ) : canConvert ? (
        <div className="px-5 py-4 bg-gray-50/50 border-t border-border space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Convert to Deal</p>
            <button onClick={() => setShowConvert(!showConvert)} className="text-xs text-ocean hover:underline">
              {showConvert ? "Hide" : "Show form"}
            </button>
          </div>
          {showConvert && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-text-secondary block mb-1">Total Price <span className="text-danger">*</span></label>
                  <Input type="number" step="1" value={totalPrice} onChange={(e) => setTotalPrice(e.target.value)} placeholder="0" />
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
                        className={cn("px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors capitalize",
                          dealType === t ? "bg-ocean text-white border-ocean" : "bg-white text-text-secondary border-border hover:border-gray-300")}>
                        {t === "full_payment" ? "Full Payment" : "Financing"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-text-secondary block mb-1">Payment Account</label>
                  <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 bg-white">
                    <option value="">Select account…</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.bank_name} — {a.account_number}</option>)}
                  </select>
                </div>
                {dealType === "financing" && (
                  <>
                    <div>
                      <label className="text-xs font-medium text-text-secondary block mb-1">Duration (months)</label>
                      <Input type="number" value={durationMonths} onChange={(e) => setDurationMonths(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-text-secondary block mb-1">Initial Payment %</label>
                      <Input type="number" step="0.1" value={initialPercent} onChange={(e) => setInitialPercent(e.target.value)} />
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs font-medium text-text-secondary block mb-1">Rate Schedule</label>
                      <select value={rateScheduleId} onChange={(e) => setRateScheduleId(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 bg-white">
                        <option value="">Select rate schedule…</option>
                        {rates.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </div>
                  </>
                )}
                <div className="col-span-2">
                  <label className="text-xs font-medium text-text-secondary block mb-1">Admin Notes</label>
                  <Textarea rows={2} value={convertNotes} onChange={(e) => setConvertNotes(e.target.value)}
                    placeholder="Internal notes…" className="text-sm resize-none" />
                </div>
              </div>
              {convertError && <ErrorBar msg={convertError} />}
              <Button onClick={handleConvert} disabled={converting} className="bg-ocean hover:bg-ocean-dark text-white gap-1.5">
                {converting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Handshake className="w-4 h-4" />}
                {converting ? "Converting…" : "Create Deal"}
              </Button>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

const STATUS_TABS = [
  { value: "",            label: "All" },
  { value: "submitted",   label: "Submitted" },
  { value: "under_review",label: "Under Review" },
  { value: "accepted",    label: "Accepted" },
  { value: "rejected",    label: "Rejected" },
  { value: "deal_created",label: "Deal Created" },
]

export default function AdminPurchaseRequestsPage() {
  const [page, setPage]                 = useState(1)
  const [search, setSearch]             = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [expanded, setExpanded]         = useState<string | null>(null)

  const { data, isLoading: loading, error: swrError, mutate } = useAdminPurchaseRequests({
    page, page_size: 20,
    status: statusFilter || undefined,
  })
  const items = data?.items ?? []
  const total = data?.total ?? 0
  const pages = data?.pages ?? 1
  const error = swrError?.message ?? null

  const filtered = search.trim()
    ? items.filter((i) =>
        (i.buyer_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (i.buyer_company ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (i.product_title ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : items

  return (
    <div className="space-y-5">
      {/* Top bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
          <Input placeholder="Search by buyer, company or product…"
            value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 bg-white" />
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
            onClick={() => { setStatusFilter(tab.value); setExpanded(null); setPage(1) }}
            className={cn(
              "px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px shrink-0",
              statusFilter === tab.value ? "border-ocean text-ocean" : "border-transparent text-text-secondary hover:text-text-primary"
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
                <div
                  className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => setExpanded(isOpen ? null : item.id)}
                >
                  <div className="w-10 h-10 rounded-xl bg-ocean/10 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-ocean" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-text-primary">
                        {item.product_title ?? "Open Request"}
                      </p>
                      <Badge variant="secondary" className="text-xs capitalize">
                        {item.request_type?.replace(/_/g, " ") ?? "—"}
                      </Badge>
                    </div>
                    <p className="text-xs text-text-secondary truncate">
                      {item.buyer_company ?? item.buyer_name ?? "Unknown buyer"}
                      {" "}· Budget: {fmtCurrency(item.budget_min, item.currency)}–{fmtCurrency(item.budget_max, item.currency)}
                      {" "}· {fmtDate(item.created_at)}
                      {item.assigned_agent && ` · Agent: ${item.assigned_agent}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <StatusBadge status={item.status} />
                    {isOpen ? <ChevronUp className="w-4 h-4 text-text-secondary" /> : <ChevronDown className="w-4 h-4 text-text-secondary" />}
                  </div>
                </div>

                {isOpen && <PRPanel item={item} onActioned={() => mutate()} />}
              </div>
            )
          })}
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-sm text-text-secondary">Page {page} of {pages} · {total} total</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => p - 1)} disabled={page <= 1 || loading}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page >= pages || loading}>Next</Button>
          </div>
        </div>
      )}
    </div>
  )
}
