"use client"

import React, { useState, useEffect, useCallback } from "react"
import {
  Settings, CreditCard, BarChart3, Plus, Edit3, Trash2,
  CheckCircle2, XCircle, RefreshCw, AlertCircle, ChevronDown,
  ChevronUp, X, Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  paymentAccounts, rateSchedules,
  type PaymentAccountOut, type RateScheduleOut,
} from "@/lib/api"

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-2 border-b border-border last:border-0">
      <span className="text-xs text-text-secondary">{label}</span>
      <span className="text-xs font-medium text-text-primary text-right max-w-xs">{value}</span>
    </div>
  )
}

// ── Payment Account Form ──────────────────────────────────────────────────────

interface AccountFormValues {
  bank_name: string; account_name: string; account_number: string
  sort_code: string; swift_code: string; iban: string
  routing_number: string; currency: string; country: string; additional_info: string
}

const EMPTY_ACCOUNT: AccountFormValues = {
  bank_name: "", account_name: "", account_number: "",
  sort_code: "", swift_code: "", iban: "",
  routing_number: "", currency: "USD", country: "", additional_info: "",
}

function AccountForm({
  initial,
  onSave,
  onClose,
  saving,
  error,
}: {
  initial: AccountFormValues
  onSave: (vals: AccountFormValues) => void
  onClose: () => void
  saving: boolean
  error: string | null
}) {
  const [vals, setVals] = useState(initial)
  const set = (k: keyof AccountFormValues, v: string) => setVals((f) => ({ ...f, [k]: v }))

  return (
    <div className="border border-border rounded-xl bg-gray-50/60 p-5 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {([
          ["bank_name", "Bank Name", "e.g. Standard Bank"],
          ["account_name", "Account Name", "e.g. Harbours360 Ltd"],
          ["account_number", "Account Number", ""],
          ["sort_code", "Sort Code", ""],
          ["swift_code", "SWIFT / BIC", ""],
          ["iban", "IBAN", ""],
          ["routing_number", "Routing Number", ""],
          ["currency", "Currency", "USD"],
          ["country", "Country", "e.g. ZA"],
        ] as [keyof AccountFormValues, string, string][]).map(([key, label, placeholder]) => (
          <div key={key}>
            <label className="text-xs font-medium text-text-secondary block mb-1">{label}</label>
            <input
              value={vals[key]}
              onChange={(e) => set(key, e.target.value)}
              placeholder={placeholder}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
            />
          </div>
        ))}
      </div>
      <div>
        <label className="text-xs font-medium text-text-secondary block mb-1">Additional Info</label>
        <textarea
          value={vals.additional_info}
          onChange={(e) => set("additional_info", e.target.value)}
          rows={2}
          placeholder="Any extra details to show buyers…"
          className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean resize-none"
        />
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={saving || !vals.bank_name || !vals.account_name || !vals.account_number}
          className="bg-ocean hover:bg-ocean-dark text-white"
          onClick={() => onSave(vals)}
        >
          {saving ? "Saving…" : "Save Account"}
        </Button>
        <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
      </div>
    </div>
  )
}

// ── Payment Accounts Panel ────────────────────────────────────────────────────

function PaymentAccountsPanel() {
  const [accounts, setAccounts] = useState<PaymentAccountOut[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [createSaving, setCreateSaving] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deactivating, setDeactivating] = useState<string | null>(null)

  const load = useCallback(() => {
    setIsLoading(true)
    setError(null)
    paymentAccounts.list(showInactive)
      .then(setAccounts)
      .catch((e) => setError(e?.message ?? "Failed to load accounts."))
      .finally(() => setIsLoading(false))
  }, [showInactive])

  useEffect(() => { load() }, [load])

  async function handleCreate(vals: AccountFormValues) {
    setCreateSaving(true)
    setCreateError(null)
    try {
      const acc = await paymentAccounts.create({
        bank_name: vals.bank_name, account_name: vals.account_name,
        account_number: vals.account_number,
        ...(vals.sort_code ? { sort_code: vals.sort_code } : {}),
        ...(vals.swift_code ? { swift_code: vals.swift_code } : {}),
        ...(vals.iban ? { iban: vals.iban } : {}),
        ...(vals.routing_number ? { routing_number: vals.routing_number } : {}),
        currency: vals.currency || "USD",
        country: vals.country,
        ...(vals.additional_info ? { additional_info: vals.additional_info } : {}),
      })
      setAccounts((prev) => [acc, ...prev])
      setShowCreate(false)
    } catch (e: unknown) {
      setCreateError((e as Error)?.message ?? "Create failed.")
    } finally {
      setCreateSaving(false)
    }
  }

  function getEditVals(acc: PaymentAccountOut): AccountFormValues {
    return {
      bank_name: acc.bank_name, account_name: acc.account_name,
      account_number: acc.account_number, sort_code: acc.sort_code ?? "",
      swift_code: acc.swift_code ?? "", iban: acc.iban ?? "",
      routing_number: acc.routing_number ?? "", currency: acc.currency,
      country: acc.country, additional_info: acc.additional_info ?? "",
    }
  }

  async function handleEdit(id: string, vals: AccountFormValues) {
    setEditSaving(true)
    setEditError(null)
    try {
      const updated = await paymentAccounts.update(id, {
        bank_name: vals.bank_name, account_name: vals.account_name,
        account_number: vals.account_number,
        sort_code: vals.sort_code || undefined, swift_code: vals.swift_code || undefined,
        iban: vals.iban || undefined, routing_number: vals.routing_number || undefined,
        currency: vals.currency, country: vals.country,
        additional_info: vals.additional_info || undefined,
      })
      setAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
      setEditId(null)
    } catch (e: unknown) {
      setEditError((e as Error)?.message ?? "Update failed.")
    } finally {
      setEditSaving(false)
    }
  }

  async function handleDeactivate(acc: PaymentAccountOut) {
    if (!confirm(`Deactivate "${acc.bank_name} · ${acc.account_name}"?`)) return
    setDeactivating(acc.id)
    try {
      const updated = await paymentAccounts.deactivate(acc.id)
      setAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
    } catch (e: unknown) {
      alert((e as Error)?.message ?? "Deactivate failed.")
    } finally {
      setDeactivating(null)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-ocean/10">
            <CreditCard className="w-4 h-4 text-ocean" />
          </div>
          <div>
            <h2 className="font-semibold text-text-primary">Payment Accounts</h2>
            <p className="text-xs text-text-secondary">Bank accounts shown to buyers when paying</p>
          </div>
        </div>
        <div className="flex gap-2">
          <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="accent-ocean rounded"
            />
            Show inactive
          </label>
          <Button variant="outline" size="sm" onClick={load} disabled={isLoading}>
            <RefreshCw className={cn("w-3.5 h-3.5", isLoading && "animate-spin")} />
          </Button>
          <Button
            size="sm"
            className="gap-1.5 bg-ocean hover:bg-ocean-dark text-white"
            onClick={() => { setShowCreate(true); setCreateError(null) }}
          >
            <Plus className="w-3.5 h-3.5" />New Account
          </Button>
        </div>
      </div>

      {showCreate && (
        <div className="border-b border-border px-5 py-4">
          <p className="text-sm font-semibold text-text-primary mb-3">New Payment Account</p>
          <AccountForm
            initial={EMPTY_ACCOUNT}
            onSave={handleCreate}
            onClose={() => setShowCreate(false)}
            saving={createSaving}
            error={createError}
          />
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 px-5 py-4 text-danger text-sm">
          <AlertCircle className="w-4 h-4" />{error}
          <Button variant="ghost" size="sm" onClick={load} className="ml-auto">Retry</Button>
        </div>
      )}

      {isLoading ? (
        <div className="p-8 text-center">
          <Loader2 className="w-6 h-6 animate-spin text-ocean mx-auto" />
        </div>
      ) : accounts.length === 0 ? (
        <div className="py-12 text-center">
          <CreditCard className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-sm text-text-secondary">No payment accounts configured.</p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {accounts.map((acc) => (
            <div key={acc.id}>
              {editId === acc.id ? (
                <div className="px-5 py-4">
                  <AccountForm
                    initial={getEditVals(acc)}
                    onSave={(vals) => handleEdit(acc.id, vals)}
                    onClose={() => setEditId(null)}
                    saving={editSaving}
                    error={editError}
                  />
                </div>
              ) : (
                <div className={cn("px-5 py-4", !acc.is_active && "opacity-60")}>
                  <button
                    onClick={() => setExpandedId((v) => (v === acc.id ? null : acc.id))}
                    className="w-full flex items-center gap-3 text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm text-text-primary">{acc.bank_name}</p>
                        <span className="text-xs text-text-secondary">·</span>
                        <p className="text-sm text-text-secondary">{acc.account_name}</p>
                        {!acc.is_active && (
                          <span className="text-xs text-danger bg-danger/10 px-1.5 py-0.5 rounded">Inactive</span>
                        )}
                      </div>
                      <p className="text-xs text-text-secondary mt-0.5">
                        {acc.account_number} · {acc.currency} · {acc.country}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        variant="ghost" size="sm"
                        onClick={(e) => { e.stopPropagation(); setEditId(acc.id) }}
                        className="h-7 px-2 text-text-secondary hover:text-text-primary"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </Button>
                      {acc.is_active && (
                        <Button
                          variant="ghost" size="sm"
                          onClick={(e) => { e.stopPropagation(); handleDeactivate(acc) }}
                          disabled={deactivating === acc.id}
                          className="h-7 px-2 text-danger hover:text-danger/80"
                        >
                          {deactivating === acc.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <XCircle className="w-3.5 h-3.5" />}
                        </Button>
                      )}
                      {expandedId === acc.id
                        ? <ChevronUp className="w-4 h-4 text-text-secondary" />
                        : <ChevronDown className="w-4 h-4 text-text-secondary" />}
                    </div>
                  </button>

                  {expandedId === acc.id && (
                    <div className="mt-3 pt-3 border-t border-border grid grid-cols-2 gap-x-8">
                      <div>
                        {[
                          ["Sort Code", acc.sort_code ?? "—"],
                          ["SWIFT / BIC", acc.swift_code ?? "—"],
                          ["IBAN", acc.iban ?? "—"],
                          ["Routing Number", acc.routing_number ?? "—"],
                        ].map(([l, v]) => <InfoRow key={l} label={l} value={v} />)}
                      </div>
                      <div>
                        {[
                          ["Currency", acc.currency],
                          ["Country", acc.country],
                          ["Created", fmtDate(acc.created_at)],
                        ].map(([l, v]) => <InfoRow key={l} label={l} value={v} />)}
                        {acc.additional_info && (
                          <div className="mt-2 bg-gray-50 rounded-lg p-2">
                            <p className="text-xs text-text-secondary">Additional Info</p>
                            <p className="text-xs text-text-primary mt-0.5">{acc.additional_info}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Rate Schedules Panel ──────────────────────────────────────────────────────

interface RateFormValues {
  name: string; description: string; asset_class: string
  arrangement_fee: string; min_down_payment_percent: string; max_down_payment_percent: string
  monthly_rates: string   // JSON string: e.g. {"6": 1.5, "12": 1.2}
}

const EMPTY_RATE: RateFormValues = {
  name: "", description: "", asset_class: "",
  arrangement_fee: "2.5", min_down_payment_percent: "20", max_down_payment_percent: "80",
  monthly_rates: '{"6": 1.5, "12": 1.2, "18": 1.0, "24": 0.9}',
}

function parseRates(json: string): Record<string, number> | null {
  try { return JSON.parse(json) } catch { return null }
}

function RateScheduleForm({
  initial,
  onSave,
  onClose,
  saving,
  error,
}: {
  initial: RateFormValues
  onSave: (vals: RateFormValues) => void
  onClose: () => void
  saving: boolean
  error: string | null
}) {
  const [vals, setVals] = useState(initial)
  const [jsonError, setJsonError] = useState<string | null>(null)
  const set = (k: keyof RateFormValues, v: string) => setVals((f) => ({ ...f, [k]: v }))

  function validate(): boolean {
    if (!parseRates(vals.monthly_rates)) {
      setJsonError("Monthly rates must be valid JSON (e.g. {\"6\": 1.5, \"12\": 1.2})")
      return false
    }
    setJsonError(null)
    return true
  }

  return (
    <div className="border border-border rounded-xl bg-gray-50/60 p-5 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-xs font-medium text-text-secondary block mb-1">Schedule Name <span className="text-danger">*</span></label>
          <input
            value={vals.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Standard Marine Finance"
            className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary block mb-1">Asset Class</label>
          <input
            value={vals.asset_class}
            onChange={(e) => set("asset_class", e.target.value)}
            placeholder="e.g. vessel, equipment"
            className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary block mb-1">Arrangement Fee (%)</label>
          <input
            type="number"
            step="0.1"
            value={vals.arrangement_fee}
            onChange={(e) => set("arrangement_fee", e.target.value)}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary block mb-1">Min Down Payment (%)</label>
          <input
            type="number"
            step="1"
            value={vals.min_down_payment_percent}
            onChange={(e) => set("min_down_payment_percent", e.target.value)}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary block mb-1">Max Down Payment (%)</label>
          <input
            type="number"
            step="1"
            value={vals.max_down_payment_percent}
            onChange={(e) => set("max_down_payment_percent", e.target.value)}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
          />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-text-secondary block mb-1">
          Monthly Rates (JSON) <span className="text-danger">*</span>
        </label>
        <textarea
          value={vals.monthly_rates}
          onChange={(e) => { set("monthly_rates", e.target.value); setJsonError(null) }}
          rows={3}
          placeholder={'{"6": 1.5, "12": 1.2, "18": 1.0}'}
          className={cn(
            "w-full px-3 py-2 text-sm font-mono border rounded-lg focus:outline-none focus:ring-2 resize-none",
            jsonError ? "border-danger focus:ring-danger/20 focus:border-danger" : "border-border focus:ring-ocean/20 focus:border-ocean"
          )}
        />
        <p className="text-xs text-text-secondary mt-1">Keys are term months, values are monthly rate percentages.</p>
        {jsonError && <p className="text-xs text-danger mt-1">{jsonError}</p>}
      </div>
      <div>
        <label className="text-xs font-medium text-text-secondary block mb-1">Description</label>
        <textarea
          value={vals.description}
          onChange={(e) => set("description", e.target.value)}
          rows={2}
          placeholder="Optional description…"
          className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean resize-none"
        />
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={saving || !vals.name}
          className="bg-ocean hover:bg-ocean-dark text-white"
          onClick={() => { if (validate()) onSave(vals) }}
        >
          {saving ? "Saving…" : "Save Schedule"}
        </Button>
        <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
      </div>
    </div>
  )
}

function RateSchedulesPanel() {
  const [schedules, setSchedules] = useState<RateScheduleOut[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [createSaving, setCreateSaving] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const load = useCallback(() => {
    setIsLoading(true)
    setError(null)
    rateSchedules.list(showInactive)
      .then(setSchedules)
      .catch((e) => setError(e?.message ?? "Failed to load schedules."))
      .finally(() => setIsLoading(false))
  }, [showInactive])

  useEffect(() => { load() }, [load])

  async function handleCreate(vals: RateFormValues) {
    setCreateSaving(true)
    setCreateError(null)
    try {
      const sched = await rateSchedules.create({
        name: vals.name,
        monthly_rates: parseRates(vals.monthly_rates)!,
        ...(vals.description ? { description: vals.description } : {}),
        ...(vals.asset_class ? { asset_class: vals.asset_class } : {}),
        arrangement_fee: parseFloat(vals.arrangement_fee) || 2.5,
        min_down_payment_percent: parseFloat(vals.min_down_payment_percent) || 20,
        max_down_payment_percent: parseFloat(vals.max_down_payment_percent) || 80,
      })
      setSchedules((prev) => [sched, ...prev])
      setShowCreate(false)
    } catch (e: unknown) {
      setCreateError((e as Error)?.message ?? "Create failed.")
    } finally {
      setCreateSaving(false)
    }
  }

  function getEditVals(s: RateScheduleOut): RateFormValues {
    return {
      name: s.name, description: s.description ?? "", asset_class: s.asset_class ?? "",
      arrangement_fee: s.arrangement_fee, min_down_payment_percent: s.min_down_payment_percent,
      max_down_payment_percent: s.max_down_payment_percent,
      monthly_rates: JSON.stringify(s.monthly_rates, null, 2),
    }
  }

  async function handleEdit(id: string, vals: RateFormValues) {
    setEditSaving(true)
    setEditError(null)
    try {
      const updated = await rateSchedules.update(id, {
        name: vals.name,
        monthly_rates: parseRates(vals.monthly_rates)!,
        description: vals.description || undefined,
        asset_class: vals.asset_class || undefined,
        arrangement_fee: parseFloat(vals.arrangement_fee),
        min_down_payment_percent: parseFloat(vals.min_down_payment_percent),
        max_down_payment_percent: parseFloat(vals.max_down_payment_percent),
      })
      setSchedules((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
      setEditId(null)
    } catch (e: unknown) {
      setEditError((e as Error)?.message ?? "Update failed.")
    } finally {
      setEditSaving(false)
    }
  }

  async function handleToggleActive(sched: RateScheduleOut) {
    try {
      const updated = await rateSchedules.update(sched.id, { is_active: !sched.is_active })
      setSchedules((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
    } catch (e: unknown) {
      alert((e as Error)?.message ?? "Update failed.")
    }
  }

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-ocean/10">
            <BarChart3 className="w-4 h-4 text-ocean" />
          </div>
          <div>
            <h2 className="font-semibold text-text-primary">Financing Rate Schedules</h2>
            <p className="text-xs text-text-secondary">Monthly rate tables used for financing deals</p>
          </div>
        </div>
        <div className="flex gap-2">
          <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="accent-ocean rounded"
            />
            Show inactive
          </label>
          <Button variant="outline" size="sm" onClick={load} disabled={isLoading}>
            <RefreshCw className={cn("w-3.5 h-3.5", isLoading && "animate-spin")} />
          </Button>
          <Button
            size="sm"
            className="gap-1.5 bg-ocean hover:bg-ocean-dark text-white"
            onClick={() => { setShowCreate(true); setCreateError(null) }}
          >
            <Plus className="w-3.5 h-3.5" />New Schedule
          </Button>
        </div>
      </div>

      {showCreate && (
        <div className="border-b border-border px-5 py-4">
          <p className="text-sm font-semibold text-text-primary mb-3">New Rate Schedule</p>
          <RateScheduleForm
            initial={EMPTY_RATE}
            onSave={handleCreate}
            onClose={() => setShowCreate(false)}
            saving={createSaving}
            error={createError}
          />
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 px-5 py-4 text-danger text-sm">
          <AlertCircle className="w-4 h-4" />{error}
          <Button variant="ghost" size="sm" onClick={load} className="ml-auto">Retry</Button>
        </div>
      )}

      {isLoading ? (
        <div className="p-8 text-center">
          <Loader2 className="w-6 h-6 animate-spin text-ocean mx-auto" />
        </div>
      ) : schedules.length === 0 ? (
        <div className="py-12 text-center">
          <BarChart3 className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-sm text-text-secondary">No rate schedules configured.</p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {schedules.map((sched) => (
            <div key={sched.id}>
              {editId === sched.id ? (
                <div className="px-5 py-4">
                  <RateScheduleForm
                    initial={getEditVals(sched)}
                    onSave={(vals) => handleEdit(sched.id, vals)}
                    onClose={() => setEditId(null)}
                    saving={editSaving}
                    error={editError}
                  />
                </div>
              ) : (
                <div className={cn("px-5 py-4", !sched.is_active && "opacity-60")}>
                  <button
                    onClick={() => setExpandedId((v) => (v === sched.id ? null : sched.id))}
                    className="w-full flex items-center gap-3 text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm text-text-primary">{sched.name}</p>
                        {sched.asset_class && (
                          <span className="text-xs bg-ocean/10 text-ocean px-1.5 py-0.5 rounded">
                            {sched.asset_class}
                          </span>
                        )}
                        {!sched.is_active && (
                          <span className="text-xs text-danger bg-danger/10 px-1.5 py-0.5 rounded">Inactive</span>
                        )}
                      </div>
                      <p className="text-xs text-text-secondary mt-0.5">
                        {Object.keys(sched.monthly_rates).length} rate tiers
                        · Arr. fee {sched.arrangement_fee}%
                        · Down {sched.min_down_payment_percent}–{sched.max_down_payment_percent}%
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToggleActive(sched) }}
                        className={cn(
                          "text-xs px-2 py-1 rounded border transition-colors",
                          sched.is_active
                            ? "border-danger/30 text-danger hover:bg-danger/5"
                            : "border-success/30 text-success hover:bg-success/5"
                        )}
                      >
                        {sched.is_active ? "Deactivate" : "Activate"}
                      </button>
                      <Button
                        variant="ghost" size="sm"
                        onClick={(e) => { e.stopPropagation(); setEditId(sched.id) }}
                        className="h-7 px-2 text-text-secondary hover:text-text-primary"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </Button>
                      {expandedId === sched.id
                        ? <ChevronUp className="w-4 h-4 text-text-secondary" />
                        : <ChevronDown className="w-4 h-4 text-text-secondary" />}
                    </div>
                  </button>

                  {expandedId === sched.id && (
                    <div className="mt-3 pt-3 border-t border-border">
                      <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">Monthly Rates</p>
                      <div className="grid grid-cols-4 gap-2">
                        {Object.entries(sched.monthly_rates)
                          .sort(([a], [b]) => Number(a) - Number(b))
                          .map(([months, rate]) => (
                            <div key={months} className="bg-gray-50 rounded-lg p-2.5 text-center">
                              <p className="text-lg font-bold text-ocean">{rate}%</p>
                              <p className="text-xs text-text-secondary">{months} months</p>
                            </div>
                          ))}
                      </div>
                      {sched.description && (
                        <div className="mt-3 bg-gray-50 rounded-lg p-3">
                          <p className="text-xs text-text-secondary">Description</p>
                          <p className="text-xs text-text-primary mt-0.5">{sched.description}</p>
                        </div>
                      )}
                      <div className="mt-3 grid grid-cols-2 gap-x-8">
                        {[
                          ["Created", fmtDate(sched.created_at)],
                          ["Updated", fmtDate(sched.updated_at)],
                        ].map(([l, v]) => <InfoRow key={l} label={l} value={v} />)}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type SettingsTab = "accounts" | "rates"

export default function AdminSettingsPage() {
  const [tab, setTab] = useState<SettingsTab>("accounts")

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-ocean/10">
          <Settings className="w-5 h-5 text-ocean" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-text-primary">Deal Settings</h1>
          <p className="text-sm text-text-secondary">Configure payment accounts and financing rate schedules</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {([
          { key: "accounts", label: "Payment Accounts", icon: CreditCard },
          { key: "rates",    label: "Rate Schedules",   icon: BarChart3 },
        ] as { key: SettingsTab; label: string; icon: React.ElementType }[]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              tab === key ? "bg-white text-ocean shadow-sm" : "text-text-secondary hover:text-text-primary"
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "accounts" && <PaymentAccountsPanel />}
      {tab === "rates"    && <RateSchedulesPanel />}
    </div>
  )
}
