"use client"

import { useState } from "react"
import {
  RefreshCw,
  Plus,
  Save,
  AlertCircle,
  CheckCircle2,
  ArrowRightLeft,
  Loader2,
  Pencil,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { exchangeRates, type ExchangeRate, type ExchangeRateConvertResult, ApiRequestError } from "@/lib/api"
import { useExchangeRates } from "@/lib/hooks"

// ── Upsert Form ───────────────────────────────────────────────────────────────

interface UpsertFormProps {
  initial?: ExchangeRate | null
  onSaved: (msg: string) => void
  onCancel?: () => void
}

function UpsertForm({ initial, onSaved, onCancel }: UpsertFormProps) {
  const [form, setForm] = useState({
    from_currency: initial?.from_currency ?? "",
    to_currency: initial?.to_currency ?? "",
    rate: initial?.rate ?? "",
    source: initial?.source ?? "",
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const set = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => { const n = { ...prev }; delete n[field]; return n })
  }

  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.from_currency.trim() || form.from_currency.trim().length < 2) e.from_currency = "e.g. USD"
    if (!form.to_currency.trim() || form.to_currency.trim().length < 2) e.to_currency = "e.g. NGN"
    if (!form.rate || isNaN(parseFloat(form.rate)) || parseFloat(form.rate) <= 0) e.rate = "Positive number required"
    return e
  }

  const handleSave = async () => {
    const e = validate()
    if (Object.keys(e).length) { setErrors(e); return }
    setSaving(true)
    setSaveError(null)
    try {
      await exchangeRates.upsert({
        from_currency: form.from_currency.trim().toUpperCase(),
        to_currency: form.to_currency.trim().toUpperCase(),
        rate: parseFloat(form.rate),
        source: form.source.trim() || undefined,
      })
      onSaved(`Rate ${form.from_currency.toUpperCase()}→${form.to_currency.toUpperCase()} saved.`)
    } catch (err) {
      setSaveError(err instanceof ApiRequestError ? err.message : "Failed to save rate.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-border p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-text-primary">
          {initial ? `Edit ${initial.from_currency}→${initial.to_currency}` : "Add / Update Rate"}
        </h3>
        {onCancel && (
          <button onClick={onCancel} className="p-1 rounded hover:bg-gray-100">
            <X className="w-4 h-4 text-text-secondary" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-text-primary">From Currency *</Label>
          <Input
            placeholder="USD"
            value={form.from_currency}
            onChange={(e) => set("from_currency", e.target.value)}
            disabled={!!initial}
            className={cn("bg-white uppercase", errors.from_currency && "border-danger", initial && "bg-gray-50")}
            maxLength={5}
          />
          {errors.from_currency && <p className="text-xs text-danger">{errors.from_currency}</p>}
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-text-primary">To Currency *</Label>
          <Input
            placeholder="NGN"
            value={form.to_currency}
            onChange={(e) => set("to_currency", e.target.value)}
            disabled={!!initial}
            className={cn("bg-white uppercase", errors.to_currency && "border-danger", initial && "bg-gray-50")}
            maxLength={5}
          />
          {errors.to_currency && <p className="text-xs text-danger">{errors.to_currency}</p>}
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-text-primary">Exchange Rate *</Label>
          <Input
            type="number"
            step="any"
            min="0"
            placeholder="e.g. 1550.00"
            value={form.rate}
            onChange={(e) => set("rate", e.target.value)}
            className={cn("bg-white", errors.rate && "border-danger")}
          />
          {errors.rate && <p className="text-xs text-danger">{errors.rate}</p>}
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-text-primary">Source <span className="text-text-secondary font-normal">(optional)</span></Label>
          <Input
            placeholder="e.g. CBN, manual"
            value={form.source}
            onChange={(e) => set("source", e.target.value)}
            className="bg-white"
          />
        </div>
      </div>

      {saveError && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {saveError}
        </div>
      )}

      <div className="flex gap-3">
        {onCancel && (
          <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
        )}
        <Button onClick={handleSave} disabled={saving} className="bg-ocean hover:bg-ocean/90 text-white">
          {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          <Save className="w-4 h-4 mr-1.5" />
          {saving ? "Saving…" : "Save Rate"}
        </Button>
      </div>
    </div>
  )
}

// ── Convert Widget ────────────────────────────────────────────────────────────

function ConvertWidget({ rates }: { rates: ExchangeRate[] }) {
  const pairs = rates.map((r) => `${r.from_currency}→${r.to_currency}`)
  const [from, setFrom] = useState(rates[0]?.from_currency ?? "USD")
  const [to, setTo] = useState(rates[0]?.to_currency ?? "NGN")
  const [amount, setAmount] = useState("")
  const [result, setResult] = useState<ExchangeRateConvertResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handleConvert = async () => {
    const amt = parseFloat(amount)
    if (!amount || isNaN(amt) || amt <= 0) { setErr("Enter a valid amount"); return }
    setLoading(true)
    setErr(null)
    setResult(null)
    try {
      const res = await exchangeRates.convert(from, to, amt)
      setResult(res)
    } catch (e) {
      setErr(e instanceof ApiRequestError ? e.message : "Conversion failed.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-border p-5 space-y-4">
      <div className="flex items-center gap-2">
        <ArrowRightLeft className="w-4 h-4 text-ocean" />
        <h3 className="font-semibold text-text-primary">Currency Converter</h3>
      </div>

      <div className="grid grid-cols-3 gap-3 items-end">
        <div className="space-y-1.5">
          <Label className="text-sm text-text-secondary">From</Label>
          <select
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-full h-9 px-3 rounded-lg border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-ocean/20"
          >
            {[...new Set(rates.map((r) => r.from_currency))].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm text-text-secondary">To</Label>
          <select
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full h-9 px-3 rounded-lg border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-ocean/20"
          >
            {[...new Set(rates.map((r) => r.to_currency))].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm text-text-secondary">Amount</Label>
          <Input
            type="number"
            min="0"
            step="any"
            placeholder="100"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setErr(null) }}
            className="bg-white"
          />
        </div>
      </div>

      {err && <p className="text-xs text-danger">{err}</p>}

      <Button onClick={handleConvert} disabled={loading} variant="outline" size="sm">
        {loading && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
        <ArrowRightLeft className="w-3.5 h-3.5 mr-1.5" /> Convert
      </Button>

      {result && (
        <div className="p-3 rounded-lg bg-success/10 border border-success/20 text-sm">
          <span className="font-semibold text-text-primary">
            {parseFloat(amount).toLocaleString()} {result.from_currency}
          </span>
          <span className="text-text-secondary mx-2">=</span>
          <span className="font-bold text-success text-base">
            {parseFloat(result.converted_amount.toString()).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {result.to_currency}
          </span>
          <span className="ml-2 text-text-secondary text-xs">(rate: {result.rate})</span>
        </div>
      )}

      <p className="text-xs text-text-secondary">Available pairs: {pairs.join(", ") || "—"}</p>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ExchangeRatesPage() {
  const { data: rates = [], isLoading, error: swrError, mutate } = useExchangeRates()
  const error = swrError?.message ?? null
  const [actionMsg, setActionMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [editingRate, setEditingRate] = useState<ExchangeRate | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)

  const flash = (type: "success" | "error", text: string) => {
    setActionMsg({ type, text })
    setTimeout(() => setActionMsg(null), 4000)
  }

  const handleSaved = (msg: string) => {
    flash("success", msg)
    setEditingRate(null)
    setShowAddForm(false)
    mutate()
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Exchange Rates</h1>
          <p className="text-sm text-text-secondary mt-0.5">Manage currency conversion rates used across the platform</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => mutate()} disabled={isLoading}>
            <RefreshCw className={cn("w-4 h-4 mr-1.5", isLoading && "animate-spin")} />
            Refresh
          </Button>
          <Button
            size="sm"
            className="bg-ocean hover:bg-ocean/90 text-white"
            onClick={() => { setShowAddForm(true); setEditingRate(null) }}
          >
            <Plus className="w-4 h-4 mr-1.5" /> Add Rate
          </Button>
        </div>
      </div>

      {/* Action feedback */}
      {actionMsg && (
        <div className={cn(
          "flex items-center gap-2 p-3 rounded-lg text-sm border",
          actionMsg.type === "success"
            ? "bg-success/10 border-success/20 text-success"
            : "bg-danger/10 border-danger/20 text-danger"
        )}>
          {actionMsg.type === "success"
            ? <CheckCircle2 className="w-4 h-4 shrink-0" />
            : <AlertCircle className="w-4 h-4 shrink-0" />}
          {actionMsg.text}
        </div>
      )}

      {/* Add form */}
      {showAddForm && !editingRate && (
        <UpsertForm
          onSaved={handleSaved}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="text-sm">{error}</span>
          <Button variant="outline" size="sm" onClick={() => mutate()} className="ml-auto border-danger/30 text-danger">Retry</Button>
        </div>
      )}

      {/* Rates grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-border p-5 space-y-3 animate-pulse">
              <div className="flex items-center justify-between">
                <div className="h-5 bg-gray-200 rounded w-24" />
                <div className="h-5 bg-gray-200 rounded w-16" />
              </div>
              <div className="h-8 bg-gray-200 rounded w-32" />
              <div className="h-3 bg-gray-200 rounded w-40" />
            </div>
          ))}
        </div>
      ) : rates.length === 0 ? (
        <div className="bg-white rounded-xl border border-border p-12 text-center">
          <ArrowRightLeft className="w-10 h-10 text-text-secondary/40 mx-auto mb-3" />
          <p className="text-text-secondary">No exchange rates configured yet.</p>
          <Button
            size="sm"
            className="mt-4 bg-ocean hover:bg-ocean/90 text-white"
            onClick={() => setShowAddForm(true)}
          >
            <Plus className="w-4 h-4 mr-1.5" /> Add First Rate
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rates.map((rate) => (
            <div key={rate.id} className="bg-white rounded-xl border border-border p-5 space-y-3 hover:shadow-sm transition-shadow">
              {editingRate?.id === rate.id ? (
                <UpsertForm
                  initial={rate}
                  onSaved={handleSaved}
                  onCancel={() => setEditingRate(null)}
                />
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-text-primary">{rate.from_currency}</span>
                      <ArrowRightLeft className="w-3.5 h-3.5 text-text-secondary" />
                      <span className="text-base font-bold text-text-primary">{rate.to_currency}</span>
                    </div>
                    <button
                      onClick={() => { setEditingRate(rate); setShowAddForm(false) }}
                      className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors shrink-0"
                      title="Edit rate"
                    >
                      <Pencil className="w-3.5 h-3.5 text-text-secondary" />
                    </button>
                  </div>

                  <div>
                    <p className="text-2xl font-bold text-ocean">
                      {parseFloat(rate.rate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                    </p>
                    <p className="text-xs text-text-secondary mt-0.5">
                      1 {rate.from_currency} = {parseFloat(rate.rate).toLocaleString()} {rate.to_currency}
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-border">
                    {rate.source && (
                      <Badge variant="secondary" className="text-xs capitalize">{rate.source}</Badge>
                    )}
                    <p className="text-xs text-text-secondary ml-auto">
                      {new Date(rate.updated_at).toLocaleDateString("en-GB", {
                        day: "numeric", month: "short", year: "numeric",
                      })}
                    </p>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Converter widget */}
      {rates.length > 0 && !isLoading && (
        <ConvertWidget rates={rates} />
      )}
    </div>
  )
}
