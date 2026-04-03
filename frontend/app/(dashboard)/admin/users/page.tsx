"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  Search,
  Filter,
  ShieldCheck,
  MoreVertical,
  UserCheck,
  UserX,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  UserPlus,
  X,
  Loader2,
  Copy,
  Check,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { admin as adminApi, authAdmin, type AdminUserItem, ApiRequestError } from "@/lib/api"
import { useAdminUsers } from "@/lib/hooks"

const kycStyle: Record<string, string> = {
  approved: "bg-success/10 text-success border-success/20",
  pending: "bg-warning/10 text-warning border-warning/20",
  rejected: "bg-danger/10 text-danger border-danger/20",
  not_submitted: "bg-gray-100 text-text-secondary border-gray-200",
  in_review: "bg-ocean/10 text-ocean border-ocean/20",
}

const tabs = [
  { label: "All Users",      role: undefined,             is_active: undefined },
  { label: "Buyers",         role: "buyer",               is_active: undefined },
  { label: "Sellers",        role: "seller",              is_active: undefined },
  { label: "KYC Agents",     role: "buyer_agent",         is_active: undefined },
  { label: "Verif. Agents",  role: "verification_agent",  is_active: undefined },
  { label: "Admins",         role: "admin",               is_active: undefined },
  { label: "Inactive",       role: undefined,             is_active: false },
]

function RowSkeleton() {
  return (
    <tr className="border-b border-border animate-pulse">
      <td className="px-4 py-3.5"><div className="w-4 h-4 bg-gray-200 rounded" /></td>
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gray-200 shrink-0" />
          <div className="space-y-1.5">
            <div className="h-3 bg-gray-200 rounded w-32" />
            <div className="h-2.5 bg-gray-200 rounded w-44" />
          </div>
        </div>
      </td>
      <td className="px-4 py-3.5 hidden md:table-cell"><div className="h-5 bg-gray-200 rounded w-16" /></td>
      <td className="px-4 py-3.5 hidden sm:table-cell"><div className="h-5 bg-gray-200 rounded w-20" /></td>
      <td className="px-4 py-3.5 hidden lg:table-cell"><div className="h-3 bg-gray-200 rounded w-24" /></td>
      <td className="px-4 py-3.5 hidden xl:table-cell"><div className="h-3 bg-gray-200 rounded w-20" /></td>
      <td className="px-4 py-3.5 text-right"><div className="h-7 w-7 bg-gray-200 rounded ml-auto" /></td>
    </tr>
  )
}

// ── Create Staff Modal ─────────────────────────────────────────────────────────

type StaffType = "agent" | "admin"

const AGENT_ROLES = [
  { value: "verification_agent", label: "Verification Agent" },
  { value: "buyer_agent",        label: "KYC Agent" },
]
const ADMIN_ROLES = [
  { value: "admin",         label: "Admin" },
  { value: "finance_admin", label: "Finance Admin" },
]

interface CreateStaffModalProps {
  onClose: () => void
  onCreated: (msg: string) => void
}

function CreateStaffModal({ onClose, onCreated }: CreateStaffModalProps) {
  const [staffType, setStaffType] = useState<StaffType>("agent")
  const [form, setForm] = useState({
    email: "",
    full_name: "",
    role: "verification_agent",
    phone: "",
    country: "",
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const set = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => { const n = { ...prev }; delete n[field]; return n })
  }

  const switchType = (t: StaffType) => {
    setStaffType(t)
    setForm((prev) => ({
      ...prev,
      role: t === "agent" ? "verification_agent" : "admin",
    }))
    setErrors({})
    setSubmitError(null)
  }

  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.email.includes("@")) e.email = "Valid email required"
    if (!form.full_name.trim()) e.full_name = "Full name required"
    if (!form.role) e.role = "Role required"
    if (!form.phone.trim()) e.phone = "Phone required"
    if (!form.country.trim()) e.country = "Country required"
    return e
  }

  const handleSubmit = async () => {
    const e = validate()
    if (Object.keys(e).length) { setErrors(e); return }
    setSubmitting(true)
    setSubmitError(null)
    try {
      let res
      if (staffType === "agent") {
        res = await authAdmin.createAgent({
          email: form.email.trim(),
          full_name: form.full_name.trim(),
          agent_type: form.role as "verification_agent" | "buyer_agent",
          phone: form.phone.trim(),
          country: form.country.trim(),
        })
      } else {
        res = await authAdmin.createAdmin({
          email: form.email.trim(),
          full_name: form.full_name.trim(),
          role: form.role as "admin" | "finance_admin",
          phone: form.phone.trim(),
          country: form.country.trim(),
        })
      }
      onCreated(`${form.full_name.trim()} created successfully as ${form.role.replace(/_/g, " ")}.`)
      setInviteLink(res.invite_link)
    } catch (err) {
      setSubmitError(err instanceof ApiRequestError ? err.message : "Failed to create staff account.")
    } finally {
      setSubmitting(false)
    }
  }

  const copyLink = async () => {
    if (!inviteLink) return
    await navigator.clipboard.writeText(inviteLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const roleOptions = staffType === "agent" ? AGENT_ROLES : ADMIN_ROLES

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">
              {inviteLink ? "Account Created" : "Create Staff Account"}
            </h2>
            <p className="text-sm text-text-secondary mt-0.5">
              {inviteLink ? `${form.full_name.trim()} has been added to the platform` : "Add a new agent or admin to the platform"}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        {/* Success — show invite link */}
        {inviteLink && (
          <div className="p-6 space-y-5">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-success/10 border border-success/20">
              <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
              <p className="text-sm text-success font-medium">
                Account created. An invite email has been sent to <strong>{form.email.trim()}</strong>.
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-text-primary">Invite link (share manually if needed)</p>
              <p className="text-xs text-text-secondary">This link lets the staff member set their password. It expires after 24 hours.</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 px-3 py-2 rounded-lg bg-gray-50 border border-border text-xs font-mono text-text-secondary truncate select-all">
                  {inviteLink}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copyLink}
                  className="shrink-0 gap-1.5"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? "Copied!" : "Copy"}
                </Button>
              </div>
            </div>

            <Button onClick={onClose} className="w-full bg-ocean hover:bg-ocean/90 text-white">
              Done
            </Button>
          </div>
        )}

        {/* Form */}
        {!inviteLink && <div className="p-6 space-y-5">
          {/* Invite info banner */}
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-ocean/5 border border-ocean/20 text-sm text-ocean">
            <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <span>
              A secure setup link will be emailed to the staff member. They will use it to create their own password before logging in.
            </span>
          </div>

          {/* Type toggle */}
          <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 rounded-xl">
            {(["agent", "admin"] as StaffType[]).map((t) => (
              <button
                key={t}
                onClick={() => switchType(t)}
                className={cn(
                  "py-2 rounded-lg text-sm font-medium transition-all",
                  staffType === t
                    ? "bg-white text-ocean shadow-sm"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                {t === "agent" ? "Field Agent" : "Admin / Finance"}
              </button>
            ))}
          </div>

          {/* Role selector */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-text-primary">Role *</Label>
            <div className="grid grid-cols-2 gap-2">
              {roleOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => set("role", opt.value)}
                  className={cn(
                    "px-3 py-2.5 rounded-xl border text-sm font-medium transition-all text-left",
                    form.role === opt.value
                      ? "border-ocean bg-ocean/5 text-ocean"
                      : "border-border text-text-secondary hover:border-ocean/40"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {errors.role && <p className="text-xs text-danger">{errors.role}</p>}
          </div>

          {/* Full name */}
          <div className="space-y-1.5">
            <Label htmlFor="cs-name" className="text-sm font-medium text-text-primary">Full Name *</Label>
            <Input
              id="cs-name"
              placeholder="e.g. Amara Osei"
              value={form.full_name}
              onChange={(e) => set("full_name", e.target.value)}
              className={cn("bg-white", errors.full_name && "border-danger focus-visible:ring-danger/20")}
            />
            {errors.full_name && <p className="text-xs text-danger">{errors.full_name}</p>}
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <Label htmlFor="cs-email" className="text-sm font-medium text-text-primary">Email *</Label>
            <Input
              id="cs-email"
              type="email"
              placeholder="agent@marinexchange.com"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              className={cn("bg-white", errors.email && "border-danger focus-visible:ring-danger/20")}
            />
            {errors.email && <p className="text-xs text-danger">{errors.email}</p>}
          </div>

          {/* Phone */}
          <div className="space-y-1.5">
            <Label htmlFor="cs-phone" className="text-sm font-medium text-text-primary">Phone *</Label>
            <Input
              id="cs-phone"
              placeholder="+234 800 000 0000"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              className={cn("bg-white", errors.phone && "border-danger focus-visible:ring-danger/20")}
            />
            {errors.phone && <p className="text-xs text-danger">{errors.phone}</p>}
          </div>

          {/* Country */}
          <div className="space-y-1.5">
            <Label htmlFor="cs-country" className="text-sm font-medium text-text-primary">Country *</Label>
            <Input
              id="cs-country"
              placeholder="e.g. Nigeria"
              value={form.country}
              onChange={(e) => set("country", e.target.value)}
              className={cn("bg-white", errors.country && "border-danger focus-visible:ring-danger/20")}
            />
            {errors.country && <p className="text-xs text-danger">{errors.country}</p>}
          </div>

          {/* Submit error */}
          {submitError && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {submitError}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <Button variant="outline" onClick={onClose} className="flex-1" disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting} className="flex-1 bg-ocean hover:bg-ocean/90 text-white">
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {submitting ? "Creating…" : "Create Account"}
            </Button>
          </div>
        </div>}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminUsersPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState("All Users")
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string[]>([])
  const [actionMsg, setActionMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)

  const PAGE_SIZE = 20

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(t)
  }, [search])

  const tab = tabs.find((t) => t.label === activeTab) ?? tabs[0]
  const { data, isLoading, error: swrError, mutate } = useAdminUsers({
    page,
    page_size: PAGE_SIZE,
    role: tab.role,
    is_active: tab.is_active,
    search: debouncedSearch || undefined,
  })
  const items = data?.items ?? []
  const total = data?.total ?? 0
  const error = swrError?.message ?? null

  const handleDeactivate = async (user: AdminUserItem) => {
    const reason = prompt(`Reason for deactivating ${user.full_name ?? user.email}:`)
    if (!reason || reason.trim().length < 5) return
    try {
      await adminApi.deactivate(user.id, reason)
      mutate()
      setActionMsg({ type: "success", text: `${user.full_name ?? user.email} deactivated.` })
    } catch (e) {
      setActionMsg({ type: "error", text: e instanceof ApiRequestError ? e.message : "Failed to deactivate." })
    }
    setTimeout(() => setActionMsg(null), 3000)
  }

  const handleReactivate = async (user: AdminUserItem) => {
    try {
      await adminApi.reactivate(user.id)
      mutate()
      setActionMsg({ type: "success", text: `${user.full_name ?? user.email} reactivated.` })
    } catch (e) {
      setActionMsg({ type: "error", text: e instanceof ApiRequestError ? e.message : "Failed to reactivate." })
    }
    setTimeout(() => setActionMsg(null), 3000)
  }

  const handleCreated = (msg: string) => {
    setActionMsg({ type: "success", text: msg })
    setTimeout(() => setActionMsg(null), 4000)
    mutate()
  }

  const toggleSelect = (id: string) =>
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  const toggleAll = () =>
    setSelected((prev) => prev.length === items.length ? [] : items.map((u) => u.id))

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-5">
      {showCreateModal && (
        <CreateStaffModal
          onClose={() => setShowCreateModal(false)}
          onCreated={handleCreated}
        />
      )}

      {/* Top bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
          <Input
            placeholder="Search by name, email, or company..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            className="pl-9 bg-white"
          />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <Filter className="w-4 h-4 mr-1.5" /> Filter
          </Button>
          <Button
            size="sm"
            className="bg-ocean hover:bg-ocean/90 text-white"
            onClick={() => setShowCreateModal(true)}
          >
            <UserPlus className="w-4 h-4 mr-1.5" /> Create Staff
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

      {error && (
        <div className="flex items-center gap-3 p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="text-sm">{error}</span>
          <Button variant="outline" size="sm" onClick={() => mutate()} className="ml-auto border-danger/30 text-danger">Retry</Button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.label}
            onClick={() => { setActiveTab(tab.label); setPage(1) }}
            className={cn(
              "px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px shrink-0",
              activeTab === tab.label
                ? "border-ocean text-ocean"
                : "border-transparent text-text-secondary hover:text-text-primary"
            )}
          >
            {tab.label}
            {activeTab === tab.label && !isLoading && (
              <span className="ml-2 px-1.5 py-0.5 rounded text-xs font-medium bg-ocean/10 text-ocean">
                {total.toLocaleString()}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Bulk actions */}
      {selected.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-ocean/5 border border-ocean/20 rounded-lg">
          <span className="text-sm font-medium text-ocean">{selected.length} selected</span>
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" size="sm" className="text-danger border-danger/30 hover:bg-danger/5">
              <UserX className="w-4 h-4 mr-1.5" /> Deactivate Selected
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-gray-50/50">
                <th className="w-10 px-4 py-3">
                  <Checkbox
                    checked={selected.length === items.length && items.length > 0}
                    onCheckedChange={toggleAll}
                    className="border-border"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wide">User</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wide hidden md:table-cell">Roles</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wide hidden sm:table-cell">KYC</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wide hidden lg:table-cell">Country</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wide hidden xl:table-cell">Joined</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-text-secondary uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading
                ? Array.from({ length: 8 }).map((_, i) => <RowSkeleton key={i} />)
                : items.map((user) => (
                <tr
                  key={user.id}
                  className={cn("hover:bg-gray-50 transition-colors", selected.includes(user.id) ? "bg-ocean/5" : "")}
                >
                  <td className="px-4 py-3.5">
                    <Checkbox
                      checked={selected.includes(user.id)}
                      onCheckedChange={() => toggleSelect(user.id)}
                      className="border-border"
                    />
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <Avatar className="w-9 h-9 shrink-0">
                        <AvatarFallback className="bg-ocean/10 text-ocean text-xs font-semibold">
                          {(user.full_name ?? user.email).split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium text-text-primary truncate">
                            {user.full_name ?? "—"}
                          </p>
                          {!user.is_active && (
                            <span className="w-2 h-2 rounded-full bg-danger shrink-0" title="Inactive" />
                          )}
                        </div>
                        <p className="text-xs text-text-secondary truncate">{user.email}</p>
                        {user.company_name && (
                          <p className="text-xs text-text-secondary/70 truncate">{user.company_name}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 hidden md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {user.roles.map((role) => (
                        <Badge key={role} variant="secondary" className="text-xs capitalize">
                          {role.replace(/_/g, " ")}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 hidden sm:table-cell">
                    <Badge className={cn("text-xs border capitalize", kycStyle[user.kyc_status] ?? kycStyle["not_submitted"])}>
                      {user.kyc_status.replace(/_/g, " ")}
                    </Badge>
                  </td>
                  <td className="px-4 py-3.5 text-sm text-text-secondary hidden lg:table-cell">
                    {user.country ?? "—"}
                  </td>
                  <td className="px-4 py-3.5 text-sm text-text-secondary hidden xl:table-cell">
                    {new Date(user.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <MoreVertical className="w-4 h-4 text-text-secondary" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={() => router.push(`/admin/users/${user.id}`)}>
                          <UserCheck className="w-4 h-4 mr-2" /> View Profile
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <a href="/admin/kyc">
                            <ShieldCheck className="w-4 h-4 mr-2" /> Review KYC
                          </a>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {user.is_active ? (
                          <DropdownMenuItem
                            className="text-danger"
                            onClick={() => handleDeactivate(user)}
                          >
                            <UserX className="w-4 h-4 mr-2" /> Deactivate
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            className="text-success"
                            onClick={() => handleReactivate(user)}
                          >
                            <UserCheck className="w-4 h-4 mr-2" /> Reactivate
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border">
          <p className="text-sm text-text-secondary">
            {isLoading ? "Loading..." : `Showing ${((page - 1) * PAGE_SIZE) + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total.toLocaleString()} users`}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline" size="sm"
              disabled={page <= 1 || isLoading}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="w-4 h-4" /> Prev
            </Button>
            <span className="flex items-center px-3 text-sm text-text-secondary">
              {page} / {totalPages || 1}
            </span>
            <Button
              variant="outline" size="sm"
              disabled={page >= totalPages || isLoading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
