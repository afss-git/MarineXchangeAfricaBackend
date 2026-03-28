"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Plus, Handshake, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  dealAdmin, paymentAccounts, rateSchedules,
  type PaymentAccountOut, type RateScheduleOut,
} from "@/lib/api"

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NewDealPage() {
  const router = useRouter()

  const [accounts, setAccounts] = useState<PaymentAccountOut[]>([])
  const [schedules, setSchedules] = useState<RateScheduleOut[]>([])

  // Form fields
  const [productId, setProductId] = useState("")
  const [buyerId, setBuyerId] = useState("")
  const [dealType, setDealType] = useState<"full_payment" | "financing">("full_payment")
  const [totalPrice, setTotalPrice] = useState("")
  const [currency, setCurrency] = useState("USD")
  const [purchaseRequestId, setPurchaseRequestId] = useState("")
  const [adminNotes, setAdminNotes] = useState("")

  // Full payment fields
  const [paymentAccountId, setPaymentAccountId] = useState("")
  const [paymentDeadline, setPaymentDeadline] = useState("")
  const [paymentInstructions, setPaymentInstructions] = useState("")

  // Financing fields
  const [initialPaymentPercent, setInitialPaymentPercent] = useState("30")
  const [durationMonths, setDurationMonths] = useState("12")
  const [monthlyRate, setMonthlyRate] = useState("")
  const [arrangementFee, setArrangementFee] = useState("")
  const [rateScheduleId, setRateScheduleId] = useState("")

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    paymentAccounts.list(false).then(setAccounts).catch(() => {})
    rateSchedules.list(false).then(setSchedules).catch(() => {})
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!productId.trim()) { setError("Product ID is required."); return }
    if (!buyerId.trim()) { setError("Buyer ID is required."); return }
    if (!totalPrice || isNaN(parseFloat(totalPrice))) { setError("Total price must be a valid number."); return }

    setSaving(true)
    setError(null)
    try {
      const body: Parameters<typeof dealAdmin.create>[0] = {
        product_id: productId.trim(),
        buyer_id: buyerId.trim(),
        deal_type: dealType,
        total_price: parseFloat(totalPrice),
        currency: currency || "USD",
        ...(purchaseRequestId ? { purchase_request_id: purchaseRequestId } : {}),
        ...(adminNotes ? { admin_notes: adminNotes } : {}),
      }

      if (dealType === "full_payment") {
        if (paymentAccountId) body.payment_account_id = paymentAccountId
        if (paymentDeadline) body.payment_deadline = paymentDeadline
        if (paymentInstructions) body.payment_instructions = paymentInstructions
      } else {
        if (initialPaymentPercent) body.initial_payment_percent = parseFloat(initialPaymentPercent)
        if (durationMonths) body.duration_months = parseInt(durationMonths)
        if (monthlyRate) body.monthly_finance_rate = parseFloat(monthlyRate)
        if (arrangementFee) body.arrangement_fee = parseFloat(arrangementFee)
        if (rateScheduleId) body.rate_schedule_id = rateScheduleId
      }

      const deal = await dealAdmin.create(body)
      router.push(`/admin/deals/${deal.id}`)
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "Failed to create deal.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost" size="sm"
          onClick={() => router.push("/admin/deals")}
          className="gap-1.5 text-text-secondary"
        >
          <ArrowLeft className="w-4 h-4" />
          Deals
        </Button>
        <span className="text-text-secondary">/</span>
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-ocean/10">
            <Handshake className="w-4 h-4 text-ocean" />
          </div>
          <h1 className="text-lg font-bold text-text-primary">New Deal</h1>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Core fields */}
        <div className="bg-white rounded-xl border border-border shadow-sm p-5 space-y-4">
          <h2 className="font-semibold text-text-primary">Deal Details</h2>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-medium text-text-secondary block mb-1">
                Product ID <span className="text-danger">*</span>
              </label>
              <input
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                placeholder="UUID of the marketplace listing"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean font-mono"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-text-secondary block mb-1">
                Buyer ID <span className="text-danger">*</span>
              </label>
              <input
                value={buyerId}
                onChange={(e) => setBuyerId(e.target.value)}
                placeholder="UUID of the buyer user"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean font-mono"
              />
              <p className="text-xs text-text-secondary mt-1">
                Find the buyer ID from <button type="button" className="text-ocean underline" onClick={() => router.push("/admin/users")}>Users</button>.
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">
                Total Price <span className="text-danger">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                value={totalPrice}
                onChange={(e) => setTotalPrice(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean bg-white"
              >
                {["USD", "EUR", "GBP", "ZAR", "NGN", "KES", "GHS"].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-text-secondary block mb-1">Purchase Request ID (optional)</label>
              <input
                value={purchaseRequestId}
                onChange={(e) => setPurchaseRequestId(e.target.value)}
                placeholder="Link to an existing purchase request"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean font-mono"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-text-secondary block mb-1">Admin Notes</label>
              <textarea
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                rows={2}
                placeholder="Internal notes visible only to admins…"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean resize-none"
              />
            </div>
          </div>
        </div>

        {/* Deal Type */}
        <div className="bg-white rounded-xl border border-border shadow-sm p-5 space-y-4">
          <h2 className="font-semibold text-text-primary">Deal Type</h2>
          <div className="flex gap-3">
            {(["full_payment", "financing"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setDealType(t)}
                className={cn(
                  "flex-1 py-3 rounded-xl text-sm font-medium border transition-all",
                  dealType === t
                    ? "bg-ocean text-white border-ocean shadow-sm"
                    : "bg-white text-text-secondary border-border hover:border-ocean/50"
                )}
              >
                {t === "full_payment" ? "Full Payment" : "Financing"}
              </button>
            ))}
          </div>

          {/* Full payment options */}
          {dealType === "full_payment" && (
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="col-span-2">
                <label className="text-xs font-medium text-text-secondary block mb-1">Payment Account</label>
                <select
                  value={paymentAccountId}
                  onChange={(e) => setPaymentAccountId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean bg-white"
                >
                  <option value="">— Select account —</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.bank_name} · {a.account_name} · {a.currency}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-text-secondary block mb-1">Payment Deadline</label>
                <input
                  type="date"
                  value={paymentDeadline}
                  onChange={(e) => setPaymentDeadline(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
                />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-text-secondary block mb-1">Payment Instructions</label>
                <textarea
                  value={paymentInstructions}
                  onChange={(e) => setPaymentInstructions(e.target.value)}
                  rows={2}
                  placeholder="Wire transfer details, reference numbers…"
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean resize-none"
                />
              </div>
            </div>
          )}

          {/* Financing options */}
          {dealType === "financing" && (
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="col-span-2">
                <label className="text-xs font-medium text-text-secondary block mb-1">Rate Schedule</label>
                <select
                  value={rateScheduleId}
                  onChange={(e) => {
                    setRateScheduleId(e.target.value)
                    const s = schedules.find((s) => s.id === e.target.value)
                    if (s) setArrangementFee(s.arrangement_fee)
                  }}
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean bg-white"
                >
                  <option value="">— Select rate schedule (or enter manually) —</option>
                  {schedules.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.asset_class ? ` · ${s.asset_class}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-text-secondary block mb-1">Initial Payment (%)</label>
                <input
                  type="number"
                  step="1"
                  value={initialPaymentPercent}
                  onChange={(e) => setInitialPaymentPercent(e.target.value)}
                  placeholder="30"
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-text-secondary block mb-1">Duration (months)</label>
                <input
                  type="number"
                  step="1"
                  value={durationMonths}
                  onChange={(e) => setDurationMonths(e.target.value)}
                  placeholder="12"
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-text-secondary block mb-1">Monthly Finance Rate (%)</label>
                <input
                  type="number"
                  step="0.01"
                  value={monthlyRate}
                  onChange={(e) => setMonthlyRate(e.target.value)}
                  placeholder="1.5"
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-text-secondary block mb-1">Arrangement Fee (%)</label>
                <input
                  type="number"
                  step="0.1"
                  value={arrangementFee}
                  onChange={(e) => setArrangementFee(e.target.value)}
                  placeholder="2.5"
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
                />
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <Button
            type="submit"
            disabled={saving}
            className="bg-ocean hover:bg-ocean-dark text-white gap-1.5"
          >
            <Plus className="w-4 h-4" />
            {saving ? "Creating…" : "Create Deal"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push("/admin/deals")} disabled={saving}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
