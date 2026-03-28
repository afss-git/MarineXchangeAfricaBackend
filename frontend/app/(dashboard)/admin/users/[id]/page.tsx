"use client"

import React, { useState, useEffect, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowLeft, User, ShieldCheck, Handshake, FileText,
  RefreshCw, AlertCircle, CheckCircle2, XCircle, Edit3,
  CreditCard, BarChart3, Shield, Loader2, Settings2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import {
  admin as adminApi,
  creditProfiles,
  type AdminUserItem,
  type BuyerCreditProfile,
} from "@/lib/api"

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-2.5 border-b border-border last:border-0">
      <span className="text-xs text-text-secondary">{label}</span>
      <span className="text-xs font-medium text-text-primary text-right">{value}</span>
    </div>
  )
}

const KYC_STYLE: Record<string, string> = {
  approved:      "bg-success/10 text-success border-success/20",
  pending:       "bg-warning/10 text-warning border-warning/20",
  rejected:      "bg-danger/10 text-danger border-danger/20",
  not_submitted: "bg-gray-100 text-text-secondary border-gray-200",
  in_review:     "bg-ocean/10 text-ocean border-ocean/20",
}

const RISK_STYLE: Record<string, string> = {
  low:    "bg-success/10 text-success border-success/20",
  medium: "bg-warning/10 text-warning border-warning/20",
  high:   "bg-danger/10 text-danger border-danger/20",
}

// ── Credit Profile Panel ──────────────────────────────────────────────────────

function CreditProfilePanel({ userId }: { userId: string }) {
  const [profile, setProfile] = useState<BuyerCreditProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Form state
  const [eligible, setEligible] = useState(false)
  const [creditLimit, setCreditLimit] = useState("")
  const [maxDeal, setMaxDeal] = useState("")
  const [collateral, setCollateral] = useState("")
  const [riskRating, setRiskRating] = useState<"low" | "medium" | "high" | "">("")
  const [notes, setNotes] = useState("")

  const load = useCallback(() => {
    setIsLoading(true)
    setError(null)
    creditProfiles.get(userId)
      .then((p) => {
        setProfile(p)
        setEligible(p.is_financing_eligible)
        setCreditLimit(p.credit_limit_usd ?? "")
        setMaxDeal(p.max_single_deal_usd ?? "")
        setCollateral(p.collateral_notes ?? "")
        setRiskRating((p.risk_rating ?? "") as typeof riskRating)
        setNotes(p.notes ?? "")
      })
      .catch((e) => setError(e?.message ?? "Failed to load credit profile."))
      .finally(() => setIsLoading(false))
  }, [userId])

  useEffect(() => { load() }, [load])

  function startEdit() {
    if (profile) {
      setEligible(profile.is_financing_eligible)
      setCreditLimit(profile.credit_limit_usd ?? "")
      setMaxDeal(profile.max_single_deal_usd ?? "")
      setCollateral(profile.collateral_notes ?? "")
      setRiskRating((profile.risk_rating ?? "") as typeof riskRating)
      setNotes(profile.notes ?? "")
    }
    setEditing(true)
    setSaveError(null)
    setSaveSuccess(false)
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)
    try {
      const updated = await creditProfiles.set(userId, {
        is_financing_eligible: eligible,
        ...(creditLimit ? { credit_limit_usd: parseFloat(creditLimit) } : {}),
        ...(maxDeal ? { max_single_deal_usd: parseFloat(maxDeal) } : {}),
        ...(collateral ? { collateral_notes: collateral } : {}),
        ...(riskRating ? { risk_rating: riskRating } : {}),
        ...(notes ? { notes } : {}),
      })
      setProfile(updated)
      setEditing(false)
      setSaveSuccess(true)
    } catch (e: unknown) {
      setSaveError((e as Error)?.message ?? "Save failed.")
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-ocean" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger text-sm">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span>{error}</span>
        <Button variant="ghost" size="sm" onClick={load} className="ml-auto text-danger">Retry</Button>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-ocean" />
          <h2 className="font-semibold text-text-primary">Buyer Credit Profile</h2>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={isLoading}>
            <RefreshCw className={cn("w-3.5 h-3.5", isLoading && "animate-spin")} />
          </Button>
          {!editing && (
            <Button
              size="sm"
              className="gap-1.5 bg-ocean hover:bg-ocean-dark text-white"
              onClick={startEdit}
            >
              <Edit3 className="w-3.5 h-3.5" />
              Edit Profile
            </Button>
          )}
        </div>
      </div>

      {saveSuccess && !editing && (
        <div className="flex items-center gap-2 px-5 py-3 bg-success/10 border-b border-success/20 text-success text-sm">
          <CheckCircle2 className="w-4 h-4" />
          Credit profile updated successfully.
        </div>
      )}

      {editing ? (
        <div className="p-5 space-y-4">
          {/* Financing Eligible */}
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-border">
            <div>
              <p className="font-semibold text-sm text-text-primary">Financing Eligible</p>
              <p className="text-xs text-text-secondary mt-0.5">Allow this buyer to use financing deals</p>
            </div>
            <button
              onClick={() => setEligible((v) => !v)}
              className={cn(
                "relative w-11 h-6 rounded-full transition-colors",
                eligible ? "bg-ocean" : "bg-gray-300"
              )}
            >
              <span className={cn(
                "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform",
                eligible ? "translate-x-5" : "translate-x-0"
              )} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">Credit Limit (USD)</label>
              <input
                type="number"
                value={creditLimit}
                onChange={(e) => setCreditLimit(e.target.value)}
                placeholder="e.g. 500000"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">Max Single Deal (USD)</label>
              <input
                type="number"
                value={maxDeal}
                onChange={(e) => setMaxDeal(e.target.value)}
                placeholder="e.g. 100000"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1">Risk Rating</label>
            <div className="flex gap-2">
              {(["low", "medium", "high"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRiskRating((v) => (v === r ? "" : r))}
                  className={cn(
                    "flex-1 py-2 rounded-lg text-sm font-medium border capitalize transition-colors",
                    riskRating === r
                      ? r === "low"
                        ? "bg-success text-white border-success"
                        : r === "medium"
                        ? "bg-warning text-white border-warning"
                        : "bg-danger text-white border-danger"
                      : "bg-white text-text-secondary border-border hover:border-gray-300"
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1">Collateral Notes</label>
            <textarea
              value={collateral}
              onChange={(e) => setCollateral(e.target.value)}
              rows={2}
              placeholder="Assets offered as collateral…"
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean resize-none"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1">Internal Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Any additional notes about this buyer's credit…"
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean/20 focus:border-ocean resize-none"
            />
          </div>

          {saveError && <p className="text-xs text-danger">{saveError}</p>}

          <div className="flex gap-2">
            <Button
              disabled={saving}
              className="bg-ocean hover:bg-ocean-dark text-white"
              onClick={handleSave}
            >
              {saving ? "Saving…" : "Save Profile"}
            </Button>
            <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
          </div>
        </div>
      ) : profile ? (
        <div className="p-5">
          {/* Eligibility banner */}
          <div className={cn(
            "flex items-center gap-3 p-4 rounded-xl border mb-5",
            profile.is_financing_eligible
              ? "bg-success/10 border-success/20"
              : "bg-gray-50 border-border"
          )}>
            {profile.is_financing_eligible
              ? <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
              : <XCircle className="w-5 h-5 text-text-secondary shrink-0" />}
            <div>
              <p className={cn("font-semibold text-sm", profile.is_financing_eligible ? "text-success" : "text-text-secondary")}>
                {profile.is_financing_eligible ? "Financing Eligible" : "Not Eligible for Financing"}
              </p>
              <p className="text-xs text-text-secondary mt-0.5">
                {profile.is_financing_eligible
                  ? "This buyer can use financing deal type."
                  : "Set eligibility to allow this buyer to use financing."}
              </p>
            </div>
            {profile.risk_rating && (
              <span className={cn(
                "ml-auto inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border capitalize",
                RISK_STYLE[profile.risk_rating] ?? "bg-gray-100 text-text-secondary border-gray-200"
              )}>
                {profile.risk_rating} risk
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-8">
            <div>
              <InfoRow label="Credit Limit (USD)" value={profile.credit_limit_usd
                ? `USD ${Number(profile.credit_limit_usd).toLocaleString()}`
                : "—"} />
              <InfoRow label="Max Single Deal (USD)" value={profile.max_single_deal_usd
                ? `USD ${Number(profile.max_single_deal_usd).toLocaleString()}`
                : "—"} />
              <InfoRow label="Risk Rating" value={profile.risk_rating
                ? <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border capitalize", RISK_STYLE[profile.risk_rating])}>
                    {profile.risk_rating}
                  </span>
                : "—"} />
            </div>
            <div>
              <InfoRow label="Set By" value={profile.set_by ?? "—"} />
              <InfoRow label="Set At" value={profile.set_at ? fmtDate(profile.set_at) : "—"} />
              <InfoRow label="Updated" value={profile.updated_at ? fmtDate(profile.updated_at) : "—"} />
            </div>
          </div>

          {profile.collateral_notes && (
            <div className="mt-4 bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-text-secondary mb-1">Collateral Notes</p>
              <p className="text-xs text-text-primary">{profile.collateral_notes}</p>
            </div>
          )}
          {profile.notes && (
            <div className="mt-3 bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-text-secondary mb-1">Internal Notes</p>
              <p className="text-xs text-text-primary">{profile.notes}</p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type UserTab = "overview" | "credit"

const ALL_ROLES = ["buyer", "seller", "buyer_seller", "admin", "finance_admin", "verification_agent", "buyer_agent"]

export default function AdminUserDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [user, setUser] = useState<AdminUserItem | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<UserTab>("overview")

  // Role management
  const [editingRoles, setEditingRoles] = useState(false)
  const [selectedRoles, setSelectedRoles] = useState<string[]>([])
  const [rolesSaving, setRolesSaving] = useState(false)
  const [rolesError, setRolesError] = useState<string | null>(null)

  // Deactivate/reactivate
  const [deactivating, setDeactivating] = useState(false)
  const [deactivateReason, setDeactivateReason] = useState("")
  const [showDeactivate, setShowDeactivate] = useState(false)
  const [deactivateError, setDeactivateError] = useState<string | null>(null)

  const load = useCallback(() => {
    setIsLoading(true)
    setError(null)
    adminApi.getUser(id)
      .then((u) => {
        setUser(u)
        setSelectedRoles(u.roles)
      })
      .catch((e) => setError(e?.message ?? "Failed to load user."))
      .finally(() => setIsLoading(false))
  }, [id])

  useEffect(() => { load() }, [load])

  async function handleSaveRoles() {
    setRolesSaving(true)
    setRolesError(null)
    try {
      const result = await adminApi.setRoles(id, selectedRoles)
      setUser((prev) => prev ? { ...prev, roles: result.roles } : prev)
      setEditingRoles(false)
    } catch (e: unknown) {
      setRolesError((e as Error)?.message ?? "Failed to update roles.")
    } finally {
      setRolesSaving(false)
    }
  }

  async function handleDeactivate() {
    if (!deactivateReason.trim()) { setDeactivateError("Reason is required."); return }
    setDeactivating(true)
    setDeactivateError(null)
    try {
      await adminApi.deactivate(id, deactivateReason)
      setUser((prev) => prev ? { ...prev, is_active: false } : prev)
      setShowDeactivate(false)
      setDeactivateReason("")
    } catch (e: unknown) {
      setDeactivateError((e as Error)?.message ?? "Deactivate failed.")
    } finally {
      setDeactivating(false)
    }
  }

  async function handleReactivate() {
    if (!confirm("Reactivate this user?")) return
    try {
      await adminApi.reactivate(id)
      setUser((prev) => prev ? { ...prev, is_active: true } : prev)
    } catch (e: unknown) {
      alert((e as Error)?.message ?? "Reactivate failed.")
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 bg-gray-100 rounded-xl w-48" />
        <div className="h-40 bg-gray-100 rounded-xl" />
        <div className="h-64 bg-gray-100 rounded-xl" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <AlertCircle className="w-10 h-10 text-danger" />
        <p className="text-text-secondary">{error}</p>
        <div className="flex gap-2">
          <Button onClick={load} variant="outline">Retry</Button>
          <Button onClick={() => router.back()} variant="ghost">Go Back</Button>
        </div>
      </div>
    )
  }

  if (!user) return null

  const initials = user.full_name
    ? user.full_name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
    : user.email.slice(0, 2).toUpperCase()

  const isBuyer = user.roles.some((r) => ["buyer", "buyer_seller"].includes(r))

  return (
    <div className="space-y-6">
      {/* Back + header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost" size="sm"
          onClick={() => router.push("/admin/users")}
          className="gap-1.5 text-text-secondary"
        >
          <ArrowLeft className="w-4 h-4" />
          Users
        </Button>
        <span className="text-text-secondary">/</span>
        <h1 className="text-lg font-bold text-text-primary">{user.full_name ?? user.email}</h1>
        <span className={cn(
          "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border",
          user.is_active ? "bg-success/10 text-success border-success/20" : "bg-gray-100 text-text-secondary border-gray-200"
        )}>
          {user.is_active ? "Active" : "Inactive"}
        </span>
        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
            <RefreshCw className="w-4 h-4" />Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Profile card */}
          <div className="bg-white rounded-xl border border-border shadow-sm p-5">
            <div className="flex items-start gap-4">
              <Avatar className="w-14 h-14 shrink-0">
                <AvatarFallback className="bg-ocean/10 text-ocean text-lg font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-bold text-text-primary text-lg">{user.full_name ?? "—"}</h2>
                  {user.roles.map((r) => (
                    <span key={r} className="text-xs bg-ocean/10 text-ocean px-2 py-0.5 rounded capitalize">
                      {r.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
                <p className="text-sm text-text-secondary mt-0.5">{user.email}</p>
                {user.company_name && (
                  <p className="text-xs text-text-secondary mt-0.5">{user.company_name}</p>
                )}
              </div>
              <span className={cn(
                "inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border capitalize",
                KYC_STYLE[user.kyc_status] ?? "bg-gray-100 text-text-secondary border-gray-200"
              )}>
                KYC: {user.kyc_status.replace(/_/g, " ")}
              </span>
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
            {([
              { key: "overview", label: "Overview",       icon: User },
              ...(isBuyer ? [{ key: "credit", label: "Credit Profile", icon: CreditCard }] : []),
            ] as { key: UserTab; label: string; icon: React.ElementType }[]).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
                  activeTab === key ? "bg-white text-ocean shadow-sm" : "text-text-secondary hover:text-text-primary"
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>

          {/* Overview tab */}
          {activeTab === "overview" && (
            <div className="bg-white rounded-xl border border-border shadow-sm p-5 space-y-0">
              <div className="flex items-center gap-2 mb-4">
                <User className="w-4 h-4 text-ocean" />
                <h2 className="font-semibold text-text-primary">User Details</h2>
              </div>
              <div className="grid grid-cols-2 gap-x-8">
                <div>
                  {[
                    ["Email", user.email],
                    ["Phone", user.phone ?? "—"],
                    ["Country", user.country ?? "—"],
                    ["Company", user.company_name ?? "—"],
                    ["Reg No.", user.company_reg_no ?? "—"],
                  ].map(([l, v]) => <InfoRow key={l} label={l} value={v} />)}
                </div>
                <div>
                  {[
                    ["KYC Status", <span key="kyc" className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border capitalize", KYC_STYLE[user.kyc_status] ?? "bg-gray-100 text-text-secondary border-gray-200")}>{user.kyc_status.replace(/_/g, " ")}</span>],
                    ["Joined", fmtDate(user.created_at)],
                    ["Last Updated", fmtDate(user.updated_at)],
                    ...(user.deals_as_buyer !== undefined ? [["Deals (Buyer)", String(user.deals_as_buyer)]] : []),
                    ...(user.deals_as_seller !== undefined ? [["Deals (Seller)", String(user.deals_as_seller)]] : []),
                    ...(user.purchase_requests !== undefined ? [["Purchase Requests", String(user.purchase_requests)]] : []),
                  ].map(([l, v]) => <InfoRow key={l as string} label={l as string} value={v as React.ReactNode} />)}
                </div>
              </div>
            </div>
          )}

          {/* Credit Profile tab */}
          {activeTab === "credit" && isBuyer && (
            <CreditProfilePanel userId={id} />
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Roles management */}
          <div className="bg-white rounded-xl border border-border shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-ocean" />
                <h3 className="font-semibold text-text-primary text-sm">Roles</h3>
              </div>
              {!editingRoles && (
                <Button
                  variant="ghost" size="sm"
                  className="h-7 px-2 text-text-secondary"
                  onClick={() => { setSelectedRoles(user.roles); setEditingRoles(true); setRolesError(null) }}
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>

            {editingRoles ? (
              <div className="space-y-2">
                <div className="space-y-1.5">
                  {ALL_ROLES.map((role) => (
                    <label key={role} className="flex items-center gap-2 text-sm cursor-pointer select-none py-1">
                      <input
                        type="checkbox"
                        checked={selectedRoles.includes(role)}
                        onChange={(e) => {
                          setSelectedRoles((prev) =>
                            e.target.checked ? [...prev, role] : prev.filter((r) => r !== role)
                          )
                        }}
                        className="accent-ocean rounded"
                      />
                      <span className="capitalize text-text-primary">{role.replace(/_/g, " ")}</span>
                    </label>
                  ))}
                </div>
                {rolesError && <p className="text-xs text-danger">{rolesError}</p>}
                <div className="flex gap-2 mt-2">
                  <Button size="sm" disabled={rolesSaving} className="bg-ocean hover:bg-ocean-dark text-white" onClick={handleSaveRoles}>
                    {rolesSaving ? "Saving…" : "Save"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingRoles(false)} disabled={rolesSaving}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {user.roles.length > 0
                  ? user.roles.map((r) => (
                      <span key={r} className="text-xs bg-ocean/10 text-ocean px-2 py-1 rounded-full capitalize">
                        {r.replace(/_/g, " ")}
                      </span>
                    ))
                  : <p className="text-xs text-text-secondary">No roles assigned.</p>}
              </div>
            )}
          </div>

          {/* Account status */}
          <div className="bg-white rounded-xl border border-border shadow-sm p-4">
            <div className="flex items-center gap-2 mb-3">
              <Settings2 className="w-4 h-4 text-ocean" />
              <h3 className="font-semibold text-text-primary text-sm">Account Status</h3>
            </div>

            {user.is_active ? (
              <>
                {!showDeactivate ? (
                  <Button
                    variant="outline" size="sm"
                    className="w-full gap-1.5 justify-start text-danger border-danger/30 hover:bg-danger/5"
                    onClick={() => { setShowDeactivate(true); setDeactivateError(null) }}
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Deactivate Account
                  </Button>
                ) : (
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-text-secondary block">Reason <span className="text-danger">*</span></label>
                    <textarea
                      value={deactivateReason}
                      onChange={(e) => setDeactivateReason(e.target.value)}
                      rows={2}
                      placeholder="Reason for deactivation…"
                      className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-danger/20 focus:border-danger resize-none"
                    />
                    {deactivateError && <p className="text-xs text-danger">{deactivateError}</p>}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={deactivating || !deactivateReason.trim()}
                        className="bg-danger hover:bg-danger/90 text-white"
                        onClick={handleDeactivate}
                      >
                        {deactivating ? "Deactivating…" : "Confirm"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setShowDeactivate(false)} disabled={deactivating}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-text-secondary">
                  <XCircle className="w-4 h-4 text-danger" />
                  Account is deactivated
                </div>
                <Button
                  variant="outline" size="sm"
                  className="w-full gap-1.5 justify-start text-success border-success/30 hover:bg-success/5"
                  onClick={handleReactivate}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Reactivate Account
                </Button>
              </div>
            )}
          </div>

          {/* Quick links */}
          <div className="bg-white rounded-xl border border-border shadow-sm p-4">
            <h3 className="font-semibold text-text-primary text-sm mb-3">Quick Links</h3>
            <div className="space-y-1.5">
              <Button
                variant="ghost" size="sm"
                className="w-full justify-start gap-2 text-text-secondary"
                onClick={() => router.push(`/admin/kyc?user=${id}`)}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                View KYC
              </Button>
              <Button
                variant="ghost" size="sm"
                className="w-full justify-start gap-2 text-text-secondary"
                onClick={() => router.push(`/admin/deals?search=${encodeURIComponent(user.email)}`)}
              >
                <Handshake className="w-3.5 h-3.5" />
                View Deals
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
