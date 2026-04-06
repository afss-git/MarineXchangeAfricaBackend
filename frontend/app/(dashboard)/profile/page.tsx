"use client"

import { useState, useEffect, useRef } from "react"
import {
  User,
  Lock,
  Bell,
  ShieldCheck,
  Phone,
  Camera,
  Save,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { auth, profile as profileApi, authBuyer, ApiRequestError } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { PageTour } from "@/components/tour/tour-engine"
import { PROFILE_TOUR } from "@/components/tour/tour-definitions"

const tabs = ["Personal Info", "Password", "Notifications", "Security"]

const COUNTRIES = ["Nigeria", "Ghana", "Kenya", "South Africa", "Tanzania", "Egypt", "Senegal", "Cameroon", "Angola", "Other"]

export default function ProfilePage() {
  const { user: authUser } = useAuth()
  const [activeTab, setActiveTab] = useState("Personal Info")
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  // User data
  const [email, setEmail] = useState("")
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [roles, setRoles] = useState<string[]>([])
  const [kycStatus, setKycStatus] = useState("")
  const [phoneVerified, setPhoneVerified] = useState(false)
  const [memberSince, setMemberSince] = useState("")

  // Profile fields
  const [fullName, setFullName] = useState("")
  const [phone, setPhone] = useState("")
  const [country, setCountry] = useState("")
  const [company, setCompany] = useState("")
  const [regNo, setRegNo] = useState("")

  // Profile save state
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Password fields
  const [currentPw, setCurrentPw] = useState("")
  const [newPw, setNewPw] = useState("")
  const [confirmPw, setConfirmPw] = useState("")
  const [pwSaving, setPwSaving] = useState(false)
  const [pwSuccess, setPwSuccess] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)

  // Avatar upload
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)

  // Upgrade to seller
  const [upgrading, setUpgrading] = useState(false)
  const [upgradeSuccess, setUpgradeSuccess] = useState(false)
  const [upgradeError, setUpgradeError] = useState<string | null>(null)

  // Notification prefs (local only — no backend endpoint yet)
  const [notifs, setNotifs] = useState({
    newEnquiry: true,
    dealUpdate: true,
    auctionBid: true,
    kycUpdate: true,
    marketing: false,
    weeklyDigest: true,
  })

  useEffect(() => {
    auth.getMe().then((user) => {
      setEmail(user.email)
      setFullName(user.full_name ?? "")
      setPhone(user.phone ?? "")
      setCountry(user.country ?? "")
      setCompany(user.company_name ?? "")
      setRegNo(user.company_reg_no ?? "")
      setAvatarUrl(user.avatar_url)
      setRoles(user.roles ?? [])
      setKycStatus(user.kyc_status)
      setPhoneVerified(user.phone_verified ?? false)
      setMemberSince(new Date(user.created_at).toLocaleDateString("en-GB", { month: "long", year: "numeric" }))
    }).catch(() => {/* silent — user may not be loaded yet */})
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setSaveSuccess(false)
    setSaveError(null)
    try {
      await profileApi.update({
        full_name: fullName,
        phone: phone || undefined,
        country: country || undefined,
        company_name: company || undefined,
        company_reg_no: regNo || undefined,
      })
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (e) {
      setSaveError(e instanceof ApiRequestError ? e.message : "Failed to save changes.")
    } finally {
      setSaving(false)
    }
  }

  const handleChangePassword = async () => {
    if (!currentPw || !newPw) return
    if (newPw !== confirmPw) {
      setPwError("New passwords do not match.")
      return
    }
    if (newPw.length < 8) {
      setPwError("Password must be at least 8 characters.")
      return
    }
    setPwSaving(true)
    setPwSuccess(false)
    setPwError(null)
    try {
      await profileApi.changePassword({ current_password: currentPw, new_password: newPw })
      setPwSuccess(true)
      setCurrentPw("")
      setNewPw("")
      setConfirmPw("")
      setTimeout(() => setPwSuccess(false), 3000)
    } catch (e) {
      setPwError(e instanceof ApiRequestError ? e.message : "Failed to change password.")
    } finally {
      setPwSaving(false)
    }
  }

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const updated = await profileApi.uploadAvatar(fd)
      setAvatarUrl(updated.avatar_url)
    } catch { /* silent */ } finally {
      setAvatarUploading(false)
    }
  }

  const handleUpgradeToSeller = async () => {
    setUpgrading(true)
    setUpgradeError(null)
    try {
      await authBuyer.addSellerRole()
      setRoles((prev) => [...prev, "seller"])
      setUpgradeSuccess(true)
    } catch (e) {
      setUpgradeError(e instanceof ApiRequestError ? e.message : "Upgrade failed.")
    } finally {
      setUpgrading(false)
    }
  }

  const isBuyerOnly = roles.includes("buyer") && !roles.includes("seller") && !roles.includes("buyer_seller")

  const initials = fullName
    ? fullName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()
    : email.slice(0, 2).toUpperCase()

  return (
    <div className="space-y-5 max-w-3xl">
      {authUser?.id && (
        <PageTour pageKey="profile" userId={String(authUser.id)} steps={PROFILE_TOUR} />
      )}

      {/* Profile header */}
      <div data-tour="profile-header" className="bg-white rounded-xl border border-border p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="relative w-fit">
            <Avatar className="w-20 h-20">
              {avatarUrl && <AvatarImage src={avatarUrl} alt={fullName} />}
              <AvatarFallback className="bg-ocean/10 text-ocean text-2xl font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <button
              onClick={() => avatarInputRef.current?.click()}
              disabled={avatarUploading}
              className="absolute bottom-0 right-0 w-7 h-7 bg-ocean rounded-full flex items-center justify-center shadow-md hover:bg-ocean-dark transition-colors disabled:opacity-50"
            >
              <Camera className="w-3.5 h-3.5 text-white" />
            </button>
            <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-text-primary">{fullName || email}</h2>
            <p className="text-text-secondary text-sm">{email}</p>
            <div className="flex flex-wrap gap-2 mt-2">
              {roles.map((role) => (
                <Badge key={role} className="bg-ocean/10 text-ocean border border-ocean/20 text-xs capitalize">
                  {role.replace(/_/g, " ")}
                </Badge>
              ))}
              {phoneVerified ? (
                <Badge className="bg-success/10 text-success border border-success/20 text-xs flex items-center gap-1">
                  <Phone className="w-3 h-3" /> Phone Verified
                </Badge>
              ) : (
                <Badge className="bg-amber-50 text-amber-600 border border-amber-200 text-xs flex items-center gap-1">
                  <Phone className="w-3 h-3" /> Phone Unverified
                </Badge>
              )}
              {kycStatus === "approved" && (
                <Badge className="bg-success/10 text-success border border-success/20 text-xs flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" /> KYC Verified
                </Badge>
              )}
            </div>
          </div>
          {memberSince && (
            <div className="text-right text-sm text-text-secondary">
              <p>Member since</p>
              <p className="font-medium text-text-primary">{memberSince}</p>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div data-tour="profile-tabs" className="flex gap-1 border-b border-border overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px shrink-0",
              activeTab === tab
                ? "border-ocean text-ocean"
                : "border-transparent text-text-secondary hover:text-text-primary"
            )}
          >
            {tab === "Personal Info" && <User className="w-4 h-4" />}
            {tab === "Password" && <Lock className="w-4 h-4" />}
            {tab === "Notifications" && <Bell className="w-4 h-4" />}
            {tab === "Security" && <ShieldCheck className="w-4 h-4" />}
            {tab}
          </button>
        ))}
      </div>

      {/* Personal Info */}
      {activeTab === "Personal Info" && (
        <div className="bg-white rounded-xl border border-border p-6 shadow-sm space-y-5">
          <div data-tour="profile-form" className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email Address</Label>
              <Input value={email} disabled className="bg-gray-50 text-text-secondary" />
              <p className="text-xs text-text-secondary">Contact support to change your email</p>
            </div>
            <div className="space-y-2">
              <Label>Phone Number</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Country</Label>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger><SelectValue placeholder="Select country" /></SelectTrigger>
                <SelectContent>
                  {COUNTRIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Company Name</Label>
              <Input value={company} onChange={(e) => setCompany(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Company Registration No.</Label>
              <Input value={regNo} onChange={(e) => setRegNo(e.target.value)} />
            </div>
          </div>
          {saveError && (
            <div className="flex items-center gap-2 p-3 bg-danger/10 border border-danger/20 rounded-lg text-danger text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" /> {saveError}
            </div>
          )}

          {/* Upgrade to Seller */}
          {isBuyerOnly && !upgradeSuccess && (
            <div data-tour="profile-upgrade-seller" className="p-4 rounded-xl border border-ocean/30 bg-ocean/5 space-y-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-ocean" />
                <p className="text-sm font-semibold text-text-primary">Sell on MarineXchange</p>
              </div>
              <p className="text-xs text-text-secondary">
                Add a Seller role to your account to list fishing vessels, equipment, and marine products on the platform.
              </p>
              {upgradeError && (
                <div className="flex items-center gap-2 text-danger text-xs">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {upgradeError}
                </div>
              )}
              <Button
                size="sm"
                onClick={handleUpgradeToSeller}
                disabled={upgrading}
                className="bg-ocean hover:bg-ocean/90 text-white"
              >
                {upgrading && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                {upgrading ? "Upgrading…" : "Upgrade to Seller"}
              </Button>
            </div>
          )}
          {upgradeSuccess && (
            <div className="flex items-center gap-2 p-3 bg-success/10 border border-success/20 rounded-lg text-success text-sm">
              <CheckCircle2 className="w-4 h-4 shrink-0" /> You now have a Seller account. Refresh to see updated navigation.
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-border">
            {saveSuccess && (
              <span className="text-sm text-success flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> Changes saved
              </span>
            )}
            <Button data-tour="profile-save-btn" onClick={handleSave} disabled={saving} className="bg-ocean hover:bg-ocean-dark text-white ml-auto">
              <Save className="w-4 h-4 mr-2" /> {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      )}

      {/* Password */}
      {activeTab === "Password" && (
        <div className="bg-white rounded-xl border border-border p-6 shadow-sm space-y-5">
          <p className="text-sm text-text-secondary">
            Password must be at least 8 characters.
          </p>
          {pwSuccess && (
            <div className="flex items-center gap-2 p-3 bg-success/10 border border-success/20 rounded-lg text-success text-sm">
              <CheckCircle2 className="w-4 h-4 shrink-0" /> Password changed successfully.
            </div>
          )}
          {pwError && (
            <div className="flex items-center gap-2 p-3 bg-danger/10 border border-danger/20 rounded-lg text-danger text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" /> {pwError}
            </div>
          )}
          {[
            { label: "Current Password", value: currentPw, setter: setCurrentPw, show: showCurrent, toggle: () => setShowCurrent(!showCurrent) },
            { label: "New Password",      value: newPw,     setter: setNewPw,     show: showNew,     toggle: () => setShowNew(!showNew) },
            { label: "Confirm New Password", value: confirmPw, setter: setConfirmPw, show: showConfirm, toggle: () => setShowConfirm(!showConfirm) },
          ].map((field) => (
            <div key={field.label} className="space-y-2">
              <Label>{field.label}</Label>
              <div className="relative">
                <Input
                  type={field.show ? "text" : "password"}
                  className="pr-10"
                  value={field.value}
                  onChange={(e) => { field.setter(e.target.value); setPwError(null) }}
                />
                <button
                  type="button"
                  onClick={field.toggle}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors"
                >
                  {field.show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          ))}
          <Button
            className="bg-ocean hover:bg-ocean-dark text-white"
            onClick={handleChangePassword}
            disabled={pwSaving || !currentPw || !newPw || !confirmPw}
          >
            <Lock className="w-4 h-4 mr-2" /> {pwSaving ? "Updating..." : "Update Password"}
          </Button>
        </div>
      )}

      {/* Notifications */}
      {activeTab === "Notifications" && (
        <div className="bg-white rounded-xl border border-border p-6 shadow-sm space-y-6">
          {[
            { key: "newEnquiry", label: "New Enquiry on My Listings", desc: "When a buyer sends a purchase request" },
            { key: "dealUpdate", label: "Deal Status Updates", desc: "Milestone changes, document uploads, escrow events" },
            { key: "auctionBid", label: "Auction Bid Activity", desc: "When you're outbid or an auction is ending" },
            { key: "kycUpdate", label: "KYC & Verification Updates", desc: "Status changes to your verification" },
            { key: "weeklyDigest", label: "Weekly Marketplace Digest", desc: "Summary of new listings in your categories" },
            { key: "marketing", label: "Marketing & Promotions", desc: "Platform news, feature updates" },
          ].map((item) => (
            <div key={item.key} className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-text-primary">{item.label}</p>
                <p className="text-xs text-text-secondary mt-0.5">{item.desc}</p>
              </div>
              <Switch
                checked={notifs[item.key as keyof typeof notifs]}
                onCheckedChange={(v) => setNotifs((n) => ({ ...n, [item.key]: v }))}
              />
            </div>
          ))}
          <div className="pt-4 border-t border-border">
            <p className="text-xs text-text-secondary">Notification preferences are saved locally.</p>
          </div>
        </div>
      )}

      {/* Security */}
      {activeTab === "Security" && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-border p-6 shadow-sm space-y-4">
            <h3 className="text-base font-semibold text-text-primary">Active Sessions</h3>
            <p className="text-sm text-text-secondary">Session management is handled through account security settings.</p>
          </div>
          <div className="bg-white rounded-xl border border-border p-6 shadow-sm space-y-4">
            <h3 className="text-base font-semibold text-text-primary">Account Actions</h3>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-text-primary">Deactivate Account</p>
                <p className="text-xs text-text-secondary">Temporarily disable your account</p>
              </div>
              <Button variant="outline" size="sm" className="text-warning border-warning/30 hover:bg-warning/5">
                Deactivate
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
