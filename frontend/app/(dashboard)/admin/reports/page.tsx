"use client"

import React, { useState, useCallback } from "react"
import {
  BarChart3, TrendingUp, ShieldCheck, Store, Users, Download,
  RefreshCw, AlertCircle, Loader2, CheckCircle2, AlertTriangle,
  DollarSign, FileText, Clock, Handshake, Gavel,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  reports,
  type OverviewDashboard,
  type FinancialReport,
  type DealPipelineReport,
  type KycComplianceReport,
  type MarketplaceHealthReport,
  type AgentWorkloadReport,
} from "@/lib/api"
import { useReportsOverview } from "@/lib/hooks"

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

function fmtMoney(val: string, prefix = "USD") {
  const n = parseFloat(val)
  if (isNaN(n)) return val
  return `${prefix} ${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function nDaysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function StatCard({
  label, value, sub, color = "text-text-primary", icon: Icon, iconBg = "bg-gray-100",
}: {
  label: string; value: React.ReactNode; sub?: string
  color?: string; icon: React.ElementType; iconBg?: string
}) {
  return (
    <div className="bg-white rounded-xl border border-border p-4 flex items-start gap-3">
      <div className={cn("p-2 rounded-lg shrink-0", iconBg)}>
        <Icon className={cn("w-5 h-5", color)} />
      </div>
      <div className="min-w-0">
        <p className={cn("text-2xl font-bold", color)}>{value}</p>
        <p className="text-xs text-text-secondary mt-0.5">{label}</p>
        {sub && <p className="text-xs text-text-secondary">{sub}</p>}
      </div>
    </div>
  )
}

function SectionHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="font-semibold text-text-primary">{title}</h3>
      {children}
    </div>
  )
}

function EmptyState({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="py-10 text-center">
      <Icon className="w-10 h-10 text-gray-200 mx-auto mb-2" />
      <p className="text-sm text-text-secondary">{label}</p>
    </div>
  )
}

function ErrorBar({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-3 p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger text-sm">
      <AlertCircle className="w-4 h-4 shrink-0" />
      <span>{message}</span>
      <Button variant="outline" size="sm" onClick={onRetry} className="ml-auto border-danger/30 text-danger">Retry</Button>
    </div>
  )
}

function DateRangeRow({
  from, to, onFrom, onTo, onRun, loading, children,
}: {
  from: string; to: string
  onFrom: (v: string) => void; onTo: (v: string) => void
  onRun: () => void; loading: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-5 p-4 bg-gray-50 rounded-xl border border-border">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-text-secondary">From</label>
        <input type="date" value={from} onChange={(e) => onFrom(e.target.value)}
          className="px-2.5 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean bg-white" />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-text-secondary">To</label>
        <input type="date" value={to} onChange={(e) => onTo(e.target.value)}
          className="px-2.5 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean bg-white" />
      </div>
      <Button size="sm" onClick={onRun} disabled={loading || !from || !to}
        className="bg-ocean hover:bg-ocean-dark text-white gap-1.5">
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        {loading ? "Loading…" : "Run Report"}
      </Button>
      <div className="flex gap-1 ml-auto">
        {[{ label: "7d", n: 7 }, { label: "30d", n: 30 }, { label: "90d", n: 90 }].map(({ label, n }) => (
          <button key={label} onClick={() => { onFrom(nDaysAgo(n)); onTo(today()) }}
            className="px-2 py-1 text-xs rounded-lg border border-border text-text-secondary hover:text-ocean hover:border-ocean/40 transition-colors">
            {label}
          </button>
        ))}
      </div>
      {children}
    </div>
  )
}

// ── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab() {
  const { data, isLoading: loading, error: swrError, mutate } = useReportsOverview()
  const error = swrError?.message ?? null

  if (loading && !data) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-ocean" /></div>
  if (error) return <ErrorBar message={error} onRetry={() => mutate()} />
  if (!data) return null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-secondary">Generated {fmtDate(data.generated_at)}</p>
        <Button variant="outline" size="sm" onClick={() => mutate()} className="gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" />Refresh
        </Button>
      </div>

      {/* Listings */}
      <div>
        <h3 className="font-semibold text-text-primary mb-3">Marketplace Listings</h3>
        <div className="grid grid-cols-3 gap-3 lg:grid-cols-6">
          {[
            { label: "Total", value: data.listings.total, color: "text-text-primary", iconBg: "bg-gray-100", icon: Store },
            { label: "Live", value: data.listings.live, color: "text-success", iconBg: "bg-success/10", icon: CheckCircle2 },
            { label: "Pending Verify", value: data.listings.pending_verification, color: "text-warning", iconBg: "bg-warning/10", icon: Clock },
            { label: "Pending Approval", value: data.listings.pending_approval, color: "text-ocean", iconBg: "bg-ocean/10", icon: Clock },
            { label: "Rejected", value: data.listings.rejected, color: "text-danger", iconBg: "bg-danger/10", icon: AlertTriangle },
            { label: "Delisted", value: data.listings.delisted, color: "text-text-secondary", iconBg: "bg-gray-100", icon: AlertTriangle },
          ].map(({ label, value, color, iconBg, icon }) => (
            <StatCard key={label} label={label} value={value} color={color} iconBg={iconBg} icon={icon} />
          ))}
        </div>
      </div>

      {/* Deals */}
      <div>
        <h3 className="font-semibold text-text-primary mb-3">Deals</h3>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "Total", value: data.deals.total, color: "text-text-primary", iconBg: "bg-gray-100", icon: Handshake },
            { label: "Active", value: data.deals.active, color: "text-success", iconBg: "bg-success/10", icon: CheckCircle2 },
            { label: "Defaulted", value: data.deals.defaulted, color: "text-danger", iconBg: "bg-danger/10", icon: AlertTriangle },
            { label: "Awaiting 2nd Approval", value: data.deals.awaiting_second_approval, color: "text-warning", iconBg: "bg-warning/10", icon: Clock },
          ].map(({ label, value, color, iconBg, icon }) => (
            <StatCard key={label} label={label} value={value} color={color} iconBg={iconBg} icon={icon} />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 mt-3">
          {[
            { label: "Draft", value: data.deals.draft },
            { label: "Offer Sent", value: data.deals.offer_sent },
            { label: "Completed", value: data.deals.completed },
            { label: "Cancelled", value: data.deals.cancelled },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white rounded-xl border border-border px-4 py-3 flex items-center justify-between">
              <p className="text-xs text-text-secondary">{label}</p>
              <p className="text-lg font-bold text-text-primary">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* KYC + Payment alerts */}
      <div className="grid grid-cols-2 gap-6">
        <div>
          <h3 className="font-semibold text-text-primary mb-3">KYC</h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Total Buyers", value: data.kyc.total_buyers, color: "text-text-primary", iconBg: "bg-gray-100", icon: Users },
              { label: "Active KYC", value: data.kyc.active_kyc, color: "text-success", iconBg: "bg-success/10", icon: ShieldCheck },
              { label: "Pending Review", value: data.kyc.pending_review, color: "text-warning", iconBg: "bg-warning/10", icon: Clock },
              { label: "Expiring Soon", value: data.kyc.expiring_soon, color: "text-danger", iconBg: "bg-danger/10", icon: AlertTriangle },
            ].map(({ label, value, color, iconBg, icon }) => (
              <StatCard key={label} label={label} value={value} color={color} iconBg={iconBg} icon={icon} />
            ))}
          </div>
        </div>
        <div>
          <h3 className="font-semibold text-text-primary mb-3">Payment Alerts</h3>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Pending Verification" value={data.payment_alerts.pending_verification}
              color="text-warning" iconBg="bg-warning/10" icon={Clock} />
            <StatCard label="Disputed" value={data.payment_alerts.disputed}
              color="text-danger" iconBg="bg-danger/10" icon={AlertTriangle} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Financial tab ─────────────────────────────────────────────────────────────

function FinancialTab() {
  const [from, setFrom] = useState(nDaysAgo(30))
  const [to, setTo]     = useState(today())
  const [data, setData] = useState<FinancialReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(() => {
    if (!from || !to) return
    setLoading(true)
    setError(null)
    reports.financial(from, to)
      .then(setData)
      .catch((e) => setError(e?.message ?? "Failed to load report."))
      .finally(() => setLoading(false))
  }, [from, to])

  return (
    <div>
      <DateRangeRow from={from} to={to} onFrom={setFrom} onTo={setTo} onRun={run} loading={loading}>
        {data && (
          <div className="flex gap-2 ml-2">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs"
              onClick={() => reports.exportLateInstallments(from, to)}>
              <Download className="w-3 h-3" />Late Installments CSV
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5 text-xs"
              onClick={() => reports.exportDefaultedDeals(from, to)}>
              <Download className="w-3 h-3" />Defaulted Deals CSV
            </Button>
          </div>
        )}
      </DateRangeRow>

      {error && <ErrorBar message={error} onRetry={run} />}

      {!data && !loading && !error && (
        <EmptyState icon={DollarSign} label="Select a date range and run the report." />
      )}

      {data && (
        <div className="space-y-6">
          {/* Payment summary */}
          <div>
            <SectionHeader title="Payment Summary" />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: "Total Payments", value: data.payment_summary.total_payments, color: "text-text-primary", iconBg: "bg-gray-100", icon: DollarSign },
                { label: "Verified", value: `${data.payment_summary.total_verified} · ${fmtMoney(data.payment_summary.amount_verified)}`, color: "text-success", iconBg: "bg-success/10", icon: CheckCircle2 },
                { label: "Pending", value: `${data.payment_summary.total_pending} · ${fmtMoney(data.payment_summary.amount_pending)}`, color: "text-warning", iconBg: "bg-warning/10", icon: Clock },
                { label: "Disputed", value: `${data.payment_summary.total_disputed} · ${fmtMoney(data.payment_summary.amount_disputed)}`, color: "text-danger", iconBg: "bg-danger/10", icon: AlertTriangle },
              ].map(({ label, value, color, iconBg, icon }) => (
                <StatCard key={label} label={label} value={value} color={color} iconBg={iconBg} icon={icon} />
              ))}
            </div>
          </div>

          {/* By deal type */}
          <div>
            <SectionHeader title="By Deal Type" />
            <div className="bg-white rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-border">
                    {["Deal Type", "Count", "Total Value", "Collected"].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.by_deal_type.map((row) => (
                    <tr key={row.deal_type} className="hover:bg-gray-50/50">
                      <td className="px-4 py-3 font-medium text-text-primary capitalize">{row.deal_type.replace(/_/g, " ")}</td>
                      <td className="px-4 py-3 text-text-secondary">{row.count}</td>
                      <td className="px-4 py-3 font-semibold text-text-primary">{fmtMoney(row.total_value)}</td>
                      <td className="px-4 py-3 text-success font-semibold">{fmtMoney(row.total_collected)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Late installments */}
          {data.late_installments.length > 0 && (
            <div>
              <SectionHeader title={`Late Installments (${data.late_installments.length})`} />
              <div className="bg-white rounded-xl border border-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-border">
                      {["Deal Ref", "Buyer", "Installment #", "Due Date", "Amount Due", "Days Overdue"].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.late_installments.map((it) => (
                      <tr key={`${it.deal_id}-${it.installment_number}`} className="hover:bg-gray-50/50">
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-text-primary">{it.deal_ref}</td>
                        <td className="px-4 py-3 text-text-primary">{it.buyer_name}</td>
                        <td className="px-4 py-3 text-center">{it.installment_number}</td>
                        <td className="px-4 py-3 text-text-secondary whitespace-nowrap">{fmtDate(it.due_date)}</td>
                        <td className="px-4 py-3 font-semibold text-text-primary">{fmtMoney(it.total_due)}</td>
                        <td className="px-4 py-3">
                          <span className={cn("font-semibold", it.days_overdue > 30 ? "text-danger" : "text-warning")}>
                            {it.days_overdue}d
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Defaulted deals */}
          {data.defaulted_deals.length > 0 && (
            <div>
              <SectionHeader title={`Defaulted Deals (${data.defaulted_deals.length})`} />
              <div className="bg-white rounded-xl border border-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-border">
                      {["Deal Ref", "Buyer", "Total Price", "Collected", "Outstanding"].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.defaulted_deals.map((it) => (
                      <tr key={it.deal_id} className="hover:bg-gray-50/50">
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-text-primary">{it.deal_ref}</td>
                        <td className="px-4 py-3 text-text-primary">{it.buyer_name}</td>
                        <td className="px-4 py-3 font-semibold text-text-primary">{fmtMoney(it.total_price)}</td>
                        <td className="px-4 py-3 text-success font-semibold">{fmtMoney(it.amount_collected)}</td>
                        <td className="px-4 py-3 text-danger font-bold">{fmtMoney(it.outstanding)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Pipeline tab ──────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  active:           "bg-success/10 text-success border-success/20",
  draft:            "bg-gray-100 text-text-secondary border-gray-200",
  offer_sent:       "bg-ocean/10 text-ocean border-ocean/20",
  completed:        "bg-navy/10 text-navy border-navy/20",
  cancelled:        "bg-gray-100 text-text-secondary border-gray-200",
  defaulted:        "bg-danger/10 text-danger border-danger/20",
  pending_approval: "bg-warning/10 text-warning border-warning/20",
}

function PipelineTab() {
  const [from, setFrom] = useState(nDaysAgo(30))
  const [to, setTo]     = useState(today())
  const [data, setData] = useState<DealPipelineReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const run = useCallback(() => {
    if (!from || !to) return
    setLoading(true)
    setError(null)
    reports.pipeline(from, to)
      .then(setData)
      .catch((e) => setError(e?.message ?? "Failed."))
      .finally(() => setLoading(false))
  }, [from, to])

  return (
    <div>
      <DateRangeRow from={from} to={to} onFrom={setFrom} onTo={setTo} onRun={run} loading={loading}>
        {data && (
          <Button variant="outline" size="sm" className="gap-1.5 text-xs ml-2"
            onClick={() => reports.exportPipeline(from, to)}>
            <Download className="w-3 h-3" />Export CSV
          </Button>
        )}
      </DateRangeRow>

      {error && <ErrorBar message={error} onRetry={run} />}

      {!data && !loading && !error && (
        <EmptyState icon={Handshake} label="Select a date range and run the report." />
      )}

      {data && (
        <div className="space-y-5">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-semibold text-text-primary">{data.total} deals</span>
            {Object.entries(data.by_status).map(([status, count]) => (
              <span key={status} className={cn(
                "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize",
                STATUS_COLOR[status] ?? "bg-gray-100 text-text-secondary border-gray-200"
              )}>
                {status.replace(/_/g, " ")}: {count}
              </span>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-border">
                  {["Ref", "Product", "Buyer", "Seller", "Type", "Value", "Status", "Days", "2nd Approval"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.deals.map((d) => (
                  <tr key={d.deal_id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-mono text-xs font-semibold">{d.deal_ref}</td>
                    <td className="px-4 py-3 text-text-primary max-w-36 truncate">{d.product_title}</td>
                    <td className="px-4 py-3 text-text-secondary">{d.buyer_name}</td>
                    <td className="px-4 py-3 text-text-secondary">{d.seller_name}</td>
                    <td className="px-4 py-3 text-xs capitalize">{d.deal_type.replace(/_/g, " ")}</td>
                    <td className="px-4 py-3 font-semibold whitespace-nowrap">{d.currency} {Number(d.total_price).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize",
                        STATUS_COLOR[d.status] ?? "bg-gray-100 text-text-secondary border-gray-200")}>
                        {d.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-xs font-semibold text-text-secondary">{d.days_in_status}d</td>
                    <td className="px-4 py-3 text-center">
                      {d.requires_second_approval
                        ? d.second_approved
                          ? <CheckCircle2 className="w-4 h-4 text-success mx-auto" />
                          : <Clock className="w-4 h-4 text-warning mx-auto" />
                        : <span className="text-xs text-text-secondary">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── KYC Compliance tab ────────────────────────────────────────────────────────

const KYC_STATUS_COLOR: Record<string, string> = {
  approved:             "bg-success/10 text-success border-success/20",
  pending:              "bg-warning/10 text-warning border-warning/20",
  in_review:            "bg-ocean/10 text-ocean border-ocean/20",
  rejected:             "bg-danger/10 text-danger border-danger/20",
  requires_resubmission:"bg-gray-100 text-text-secondary border-gray-200",
  not_submitted:        "bg-gray-100 text-text-secondary border-gray-200",
}

function KycReportTab() {
  const [from, setFrom] = useState(nDaysAgo(30))
  const [to, setTo]     = useState(today())
  const [data, setData] = useState<KycComplianceReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const run = useCallback(() => {
    if (!from || !to) return
    setLoading(true)
    setError(null)
    reports.kyc(from, to)
      .then(setData)
      .catch((e) => setError(e?.message ?? "Failed."))
      .finally(() => setLoading(false))
  }, [from, to])

  return (
    <div>
      <DateRangeRow from={from} to={to} onFrom={setFrom} onTo={setTo} onRun={run} loading={loading}>
        {data && (
          <Button variant="outline" size="sm" className="gap-1.5 text-xs ml-2"
            onClick={() => reports.exportKyc(from, to)}>
            <Download className="w-3 h-3" />Export CSV
          </Button>
        )}
      </DateRangeRow>

      {error && <ErrorBar message={error} onRetry={run} />}
      {!data && !loading && !error && <EmptyState icon={ShieldCheck} label="Select a date range and run the report." />}

      {data && (
        <div className="space-y-5">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-semibold text-text-primary">{data.total} submissions</span>
            {data.expiring_within_30_days > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-warning/10 text-warning border-warning/20">
                <AlertTriangle className="w-3 h-3" />{data.expiring_within_30_days} expiring in 30 days
              </span>
            )}
            {Object.entries(data.by_status).map(([status, count]) => (
              <span key={status} className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize",
                KYC_STATUS_COLOR[status] ?? "bg-gray-100 text-text-secondary border-gray-200")}>
                {status.replace(/_/g, " ")}: {count}
              </span>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-border">
                  {["Buyer", "Email", "Status", "Submitted", "Decided", "Expires", "PEP", "Sanctions"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.submissions.map((s) => (
                  <tr key={s.submission_id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-medium text-text-primary">{s.buyer_name}</td>
                    <td className="px-4 py-3 text-xs text-text-secondary">{s.buyer_email}</td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize",
                        KYC_STATUS_COLOR[s.status] ?? "bg-gray-100 text-text-secondary border-gray-200")}>
                        {s.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-text-secondary whitespace-nowrap">{fmtDate(s.submitted_at)}</td>
                    <td className="px-4 py-3 text-xs text-text-secondary whitespace-nowrap">{fmtDate(s.decided_at)}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      {s.expires_at ? (
                        <span className={s.days_until_expiry !== null && s.days_until_expiry < 30 ? "text-warning font-semibold" : "text-text-secondary"}>
                          {fmtDate(s.expires_at)}
                          {s.days_until_expiry !== null && ` (${s.days_until_expiry}d)`}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-center">{s.is_pep ? <span className="text-danger font-bold text-xs">YES</span> : <span className="text-text-secondary text-xs">No</span>}</td>
                    <td className="px-4 py-3 text-center">{s.sanctions_match ? <span className="text-danger font-bold text-xs">YES</span> : <span className="text-text-secondary text-xs">No</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Marketplace tab ───────────────────────────────────────────────────────────

function MarketplaceTab() {
  const [from, setFrom] = useState(nDaysAgo(30))
  const [to, setTo]     = useState(today())
  const [data, setData] = useState<MarketplaceHealthReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const run = useCallback(() => {
    if (!from || !to) return
    setLoading(true)
    setError(null)
    reports.marketplace(from, to)
      .then(setData)
      .catch((e) => setError(e?.message ?? "Failed."))
      .finally(() => setLoading(false))
  }, [from, to])

  return (
    <div>
      <DateRangeRow from={from} to={to} onFrom={setFrom} onTo={setTo} onRun={run} loading={loading}>
        {data && (
          <Button variant="outline" size="sm" className="gap-1.5 text-xs ml-2"
            onClick={() => reports.exportMarketplace(from, to)}>
            <Download className="w-3 h-3" />Export Stuck CSV
          </Button>
        )}
      </DateRangeRow>

      {error && <ErrorBar message={error} onRetry={run} />}
      {!data && !loading && !error && <EmptyState icon={Store} label="Select a date range and run the report." />}

      {data && (
        <div className="space-y-5">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-semibold text-text-primary">{data.total_listings} listings</span>
            {Object.entries(data.by_status).map(([status, count]) => (
              <span key={status} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-gray-100 text-text-secondary border-gray-200 capitalize">
                {status.replace(/_/g, " ")}: {count}
              </span>
            ))}
          </div>

          {/* By category */}
          <div>
            <SectionHeader title="By Category" />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {data.by_category.map((cat) => (
                <div key={cat.category} className="bg-white rounded-xl border border-border p-3">
                  <p className="text-xs font-semibold text-text-primary capitalize">{cat.category}</p>
                  <p className="text-2xl font-bold text-text-primary mt-1">{cat.total}</p>
                  <p className="text-xs text-text-secondary">{cat.active} active · {cat.pending} pending</p>
                </div>
              ))}
            </div>
          </div>

          {/* Stuck listings */}
          {data.stuck_listings.length > 0 && (
            <div>
              <SectionHeader title={`Stuck Listings (${data.stuck_listings.length})`} />
              <div className="bg-white rounded-xl border border-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-border">
                      {["Title", "Category", "Seller", "Status", "Price", "Days in Status", "Agent"].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.stuck_listings.map((l) => (
                      <tr key={l.product_id} className="hover:bg-gray-50/50">
                        <td className="px-4 py-3 font-medium text-text-primary max-w-40 truncate">{l.title}</td>
                        <td className="px-4 py-3 text-xs text-text-secondary capitalize">{l.category}</td>
                        <td className="px-4 py-3 text-text-secondary">{l.seller_name}</td>
                        <td className="px-4 py-3 text-xs capitalize text-text-secondary">{l.status.replace(/_/g, " ")}</td>
                        <td className="px-4 py-3 font-semibold whitespace-nowrap">{l.currency} {Number(l.price).toLocaleString()}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={cn("font-semibold text-xs", l.days_in_status > 14 ? "text-danger" : "text-warning")}>
                            {l.days_in_status}d
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-text-secondary">{l.assigned_agent ?? "Unassigned"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Agents tab ────────────────────────────────────────────────────────────────

function AgentsTab() {
  const [from, setFrom] = useState(nDaysAgo(30))
  const [to, setTo]     = useState(today())
  const [data, setData] = useState<AgentWorkloadReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const run = useCallback(() => {
    if (!from || !to) return
    setLoading(true)
    setError(null)
    reports.agents(from, to)
      .then(setData)
      .catch((e) => setError(e?.message ?? "Failed."))
      .finally(() => setLoading(false))
  }, [from, to])

  return (
    <div>
      <DateRangeRow from={from} to={to} onFrom={setFrom} onTo={setTo} onRun={run} loading={loading}>
        {data && (
          <Button variant="outline" size="sm" className="gap-1.5 text-xs ml-2"
            onClick={() => reports.exportAgents(from, to)}>
            <Download className="w-3 h-3" />Export CSV
          </Button>
        )}
      </DateRangeRow>

      {error && <ErrorBar message={error} onRetry={run} />}
      {!data && !loading && !error && <EmptyState icon={Users} label="Select a date range and run the report." />}

      {data && (
        <div className="bg-white rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-border">
                {["Agent", "KYC Assigned", "KYC Reviewed", "Approved", "Rejected",
                  "Listings Assigned", "Verified", "Rejected",
                  "Avg KYC Hrs", "Avg Listing Hrs"].map((h) => (
                  <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.agents.map((a) => (
                <tr key={a.agent_id} className="hover:bg-gray-50/50">
                  <td className="px-3 py-3">
                    <p className="font-medium text-text-primary text-sm">{a.agent_name}</p>
                    <p className="text-xs text-text-secondary">{a.agent_email}</p>
                  </td>
                  <td className="px-3 py-3 text-center font-semibold">{a.kyc_assigned}</td>
                  <td className="px-3 py-3 text-center">{a.kyc_reviewed}</td>
                  <td className="px-3 py-3 text-center text-success font-semibold">{a.kyc_approved}</td>
                  <td className="px-3 py-3 text-center text-danger font-semibold">{a.kyc_rejected}</td>
                  <td className="px-3 py-3 text-center font-semibold">{a.listings_assigned}</td>
                  <td className="px-3 py-3 text-center text-success font-semibold">{a.listings_verified}</td>
                  <td className="px-3 py-3 text-center text-danger font-semibold">{a.listings_rejected}</td>
                  <td className="px-3 py-3 text-center text-xs">
                    {a.avg_kyc_review_hours !== null ? `${a.avg_kyc_review_hours.toFixed(1)}h` : "—"}
                  </td>
                  <td className="px-3 py-3 text-center text-xs">
                    {a.avg_listing_review_hours !== null ? `${a.avg_listing_review_hours.toFixed(1)}h` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type ReportTab = "overview" | "financial" | "pipeline" | "kyc" | "marketplace" | "agents"

const TABS: { key: ReportTab; label: string; icon: React.ElementType }[] = [
  { key: "overview",    label: "Overview",    icon: BarChart3 },
  { key: "financial",   label: "Financial",   icon: DollarSign },
  { key: "pipeline",    label: "Pipeline",    icon: TrendingUp },
  { key: "kyc",         label: "KYC",         icon: ShieldCheck },
  { key: "marketplace", label: "Marketplace", icon: Store },
  { key: "agents",      label: "Agents",      icon: Users },
]

export default function AdminReportsPage() {
  const [tab, setTab] = useState<ReportTab>("overview")

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-ocean/10">
          <BarChart3 className="w-5 h-5 text-ocean" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-text-primary">Reports & Analytics</h1>
          <p className="text-sm text-text-secondary">Platform-wide insights and compliance reports</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-white rounded-xl border border-border p-1 overflow-x-auto">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap",
              tab === key ? "bg-ocean text-white shadow-sm" : "text-text-secondary hover:text-text-primary hover:bg-gray-50"
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {tab === "overview"    && <OverviewTab />}
        {tab === "financial"   && <FinancialTab />}
        {tab === "pipeline"    && <PipelineTab />}
        {tab === "kyc"         && <KycReportTab />}
        {tab === "marketplace" && <MarketplaceTab />}
        {tab === "agents"      && <AgentsTab />}
      </div>
    </div>
  )
}
