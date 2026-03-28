"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import {
  ChevronLeft,
  Save,
  Upload,
  Trash2,
  Star,
  AlertCircle,
  CheckCircle2,
  Clock,
  Send,
  RefreshCw,
  ImageIcon,
  X,
  Loader2,
  ShieldCheck,
  UserCheck,
  FileSearch,
  ClipboardCheck,
  Lock,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
  seller as sellerApi,
  type ProductDetail,
  type ProductImage,
  type SellerVerificationStatus,
  ApiRequestError,
} from "@/lib/api"

// ── Constants ────────────────────────────────────────────────────────────────

const CONDITIONS = [
  "New",
  "Used — Excellent",
  "Used — Good",
  "Used — Fair",
  "Refurbished",
  "For Parts",
]

const COUNTRIES = [
  "Nigeria", "Ghana", "Kenya", "South Africa", "Tanzania",
  "Egypt", "Senegal", "Cameroon", "Mozambique", "Angola", "Other",
]

const CURRENCIES = ["USD", "EUR", "GBP", "NGN", "GHS", "KES", "ZAR"]

// ── Status config ─────────────────────────────────────────────────────────────

const statusBadge: Record<string, { style: string; label: string }> = {
  draft:    { style: "bg-gray-100 text-text-secondary border-gray-200", label: "Draft" },
  pending:  { style: "bg-warning/10 text-warning border-warning/20",    label: "Under Review" },
  active:   { style: "bg-success/10 text-success border-success/20",    label: "Active" },
  rejected: { style: "bg-danger/10 text-danger border-danger/20",       label: "Rejected" },
  sold:     { style: "bg-ocean/10 text-ocean border-ocean/20",          label: "Sold" },
  inactive: { style: "bg-gray-100 text-text-secondary border-gray-200", label: "Inactive" },
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 bg-gray-200 rounded" />
        <div className="h-5 bg-gray-200 rounded w-48" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-xl border border-border p-6 space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-3 bg-gray-200 rounded w-24" />
                <div className="h-10 bg-gray-100 rounded" />
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-border p-6 h-64" />
        </div>
      </div>
    </div>
  )
}

interface ImageCardProps {
  image: ProductImage
  onDelete: (id: string) => void
  onSetPrimary: (id: string) => void
  deleting: boolean
  settingPrimary: boolean
}

function ImageCard({ image, onDelete, onSetPrimary, deleting, settingPrimary }: ImageCardProps) {
  return (
    <div className="relative group rounded-xl overflow-hidden border border-border bg-gray-50 aspect-square">
      <img
        src={image.signed_url}
        alt={image.original_name ?? "Listing image"}
        className="w-full h-full object-cover"
      />
      {/* Primary badge */}
      {image.is_primary && (
        <div className="absolute top-2 left-2 bg-ocean text-white text-xs font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
          <Star className="w-2.5 h-2.5 fill-white" /> Primary
        </div>
      )}
      {/* Hover actions */}
      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
        {!image.is_primary && (
          <button
            onClick={() => onSetPrimary(image.id)}
            disabled={settingPrimary}
            className="p-2 bg-white/90 hover:bg-white rounded-lg text-ocean transition-colors disabled:opacity-50"
            title="Set as primary"
          >
            {settingPrimary
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Star className="w-4 h-4" />}
          </button>
        )}
        <button
          onClick={() => onDelete(image.id)}
          disabled={deleting}
          className="p-2 bg-white/90 hover:bg-white rounded-lg text-danger transition-colors disabled:opacity-50"
          title="Delete image"
        >
          {deleting
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <Trash2 className="w-4 h-4" />}
        </button>
      </div>
    </div>
  )
}

// ── Verification Timeline ─────────────────────────────────────────────────────

const VERIF_STEPS = [
  { key: "submitted",   icon: Send,           label: "Submitted for Review" },
  { key: "assigned",    icon: UserCheck,      label: "Agent Assigned" },
  { key: "in_review",   icon: FileSearch,     label: "Verification Underway" },
  { key: "reported",    icon: ClipboardCheck, label: "Report Filed" },
  { key: "decision",    icon: ShieldCheck,    label: "Admin Decision" },
]

function stepIndex(
  productStatus: string,
  agentAssigned: boolean,
  verif: SellerVerificationStatus | null,
): number {
  if (productStatus === "active" || productStatus === "rejected") return 5
  if (verif?.report_submitted) return 4
  if (verif?.status === "in_review") return 3
  if (agentAssigned) return 2
  return 1  // submitted
}

interface VerificationTimelineProps {
  productStatus: string
  submittedAt: string | null
  agentAssigned: boolean
  verif: SellerVerificationStatus | null
  adminNotes: string | null
  rejectionReason: string | null
}

function VerificationTimeline({
  productStatus, submittedAt, agentAssigned, verif, adminNotes, rejectionReason
}: VerificationTimelineProps) {
  const current = stepIndex(productStatus, agentAssigned, verif)
  const isApproved = productStatus === "active"
  const isRejected = productStatus === "rejected"

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Lock className="w-4 h-4 text-text-secondary" />
        <h2 className="text-sm font-semibold text-text-primary">Audit & Verification</h2>
      </div>

      <div className="space-y-3">
        {VERIF_STEPS.map((step, i) => {
          const Icon = step.icon
          const isActive = (i + 1) === current
          const isDone = i + 1 < current

          let statusDot = "bg-gray-200"
          let iconColor = "text-gray-400"
          let labelColor = "text-text-secondary"
          if (isDone) { statusDot = "bg-success"; iconColor = "text-success"; labelColor = "text-text-primary" }
          if (isActive) { statusDot = "bg-ocean"; iconColor = "text-ocean"; labelColor = "text-text-primary font-semibold" }
          // Final step outcome colours
          if (i === 4 && isDone) {
            if (isApproved) { statusDot = "bg-success"; iconColor = "text-success" }
            if (isRejected) { statusDot = "bg-danger"; iconColor = "text-danger"; labelColor = "text-danger font-semibold" }
          }

          let subtext: string | null = null
          if (step.key === "submitted" && submittedAt) {
            subtext = new Date(submittedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
          }
          if (step.key === "assigned" && verif?.agent_name && (isDone || isActive)) {
            subtext = `Assigned to ${verif.agent_name}`
          }
          if (step.key === "in_review" && verif?.scheduled_date && (isDone || isActive)) {
            subtext = `Inspection: ${new Date(verif.scheduled_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
          }
          if (step.key === "reported" && verif?.report_submitted && (isDone || isActive)) {
            subtext = "Agent report submitted"
          }
          if (step.key === "decision" && isDone) {
            subtext = isApproved ? "Listing approved — now live" : "Listing rejected"
          }

          return (
            <div key={step.key} className="flex items-start gap-3">
              <div className="flex flex-col items-center shrink-0">
                <div className={cn("w-7 h-7 rounded-full flex items-center justify-center", isDone || isActive ? "bg-white border-2 " + (i === 4 && isDone && isRejected ? "border-danger" : isDone ? "border-success" : "border-ocean") : "bg-gray-50 border border-gray-200")}>
                  <Icon className={cn("w-3.5 h-3.5", iconColor)} />
                </div>
                {i < VERIF_STEPS.length - 1 && (
                  <div className={cn("w-0.5 h-5 mt-0.5", isDone ? "bg-success/40" : "bg-gray-100")} />
                )}
              </div>
              <div className="pb-1 min-w-0">
                <p className={cn("text-xs", labelColor)}>{step.label}</p>
                {subtext && <p className="text-xs text-text-secondary mt-0.5">{subtext}</p>}
                {isActive && !subtext && <p className="text-xs text-ocean/70 mt-0.5 animate-pulse">In progress…</p>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Admin notes */}
      {adminNotes && (
        <div className="pt-2 border-t border-border">
          <p className="text-xs font-medium text-text-primary mb-1">Admin Notes</p>
          <p className="text-xs text-text-secondary leading-relaxed">{adminNotes}</p>
        </div>
      )}

      {/* Rejection reason */}
      {rejectionReason && (
        <div className="pt-2 border-t border-border">
          <p className="text-xs font-medium text-danger mb-1">Rejection Reason</p>
          <p className="text-xs text-text-secondary leading-relaxed">{rejectionReason}</p>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function EditListingPage() {
  const params = useParams()
  const id = params.id as string

  const [listing, setListing]   = useState<ProductDetail | null>(null)
  const [images, setImages]     = useState<ProductImage[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Form state
  const [title, setTitle]               = useState("")
  const [description, setDescription]   = useState("")
  const [condition, setCondition]       = useState("")
  const [askingPrice, setAskingPrice]   = useState("")
  const [currency, setCurrency]         = useState("USD")
  const [locationCountry, setLocationCountry] = useState("")
  const [locationPort, setLocationPort] = useState("")

  // Action state
  const [isSaving, setIsSaving]         = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [saveMsg, setSaveMsg]           = useState<{ type: "success" | "error"; text: string } | null>(null)

  // Verification audit state
  const [verif, setVerif] = useState<SellerVerificationStatus | null>(null)

  // Image state
  const [deletingId, setDeletingId]         = useState<string | null>(null)
  const [settingPrimaryId, setSettingPrimaryId] = useState<string | null>(null)
  const [isUploading, setIsUploading]       = useState(false)
  const [uploadError, setUploadError]       = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // ── Load listing ────────────────────────────────────────────────────────────

  const loadListing = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const data = await sellerApi.getListing(id)
      setListing(data)
      setImages(data.images ?? [])
      // Pre-fill form
      setTitle(data.title)
      setDescription(data.description ?? "")
      setCondition(data.condition ?? "")
      setAskingPrice(data.asking_price)
      setCurrency(data.currency ?? "USD")
      setLocationCountry(data.location_country ?? "")
      setLocationPort(data.location_port ?? "")
    } catch (e) {
      setLoadError(e instanceof ApiRequestError ? e.message : "Failed to load listing.")
    } finally {
      setIsLoading(false)
    }
  }, [id])

  useEffect(() => { loadListing() }, [loadListing])

  // Fetch verification details once we know an agent is assigned
  useEffect(() => {
    if (!listing?.verification_assignment_id) return
    sellerApi.getVerificationStatus(id)
      .then((data) => setVerif(data))
      .catch(() => {/* silent — not critical */})
  }, [id, listing?.verification_assignment_id])

  // ── Save edits ──────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!listing) return
    setIsSaving(true)
    setSaveMsg(null)
    try {
      const updated = await sellerApi.updateListing(id, {
        title,
        description,
        condition,
        asking_price: Number(askingPrice),
        location_country: locationCountry,
        location_port: locationPort,
      })
      setListing(updated)
      setSaveMsg({ type: "success", text: "Changes saved successfully." })
    } catch (e) {
      setSaveMsg({ type: "error", text: e instanceof ApiRequestError ? e.message : "Failed to save changes." })
    } finally {
      setIsSaving(false)
      setTimeout(() => setSaveMsg(null), 4000)
    }
  }

  // ── Submit for review ────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!listing) return
    setIsSubmitting(true)
    setSaveMsg(null)
    try {
      if (listing.status === "rejected") {
        await sellerApi.resubmitListing(id)
      } else {
        await sellerApi.submitListing(id)
      }
      await loadListing()
      setSaveMsg({ type: "success", text: "Listing submitted for review." })
    } catch (e) {
      setSaveMsg({ type: "error", text: e instanceof ApiRequestError ? e.message : "Failed to submit listing." })
    } finally {
      setIsSubmitting(false)
      setTimeout(() => setSaveMsg(null), 5000)
    }
  }

  // ── Image: upload ────────────────────────────────────────────────────────────

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIsUploading(true)
    setUploadError(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const newImage = await sellerApi.uploadImage(id, fd)
      setImages((prev) => [...prev, newImage])
    } catch (err) {
      setUploadError(err instanceof ApiRequestError ? err.message : "Upload failed.")
    } finally {
      setIsUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  // ── Image: delete ────────────────────────────────────────────────────────────

  const handleDeleteImage = async (imageId: string) => {
    setDeletingId(imageId)
    try {
      await sellerApi.deleteImage(id, imageId)
      setImages((prev) => prev.filter((img) => img.id !== imageId))
    } catch (err) {
      setSaveMsg({ type: "error", text: err instanceof ApiRequestError ? err.message : "Failed to delete image." })
      setTimeout(() => setSaveMsg(null), 4000)
    } finally {
      setDeletingId(null)
    }
  }

  // ── Image: set primary ───────────────────────────────────────────────────────

  const handleSetPrimary = async (imageId: string) => {
    setSettingPrimaryId(imageId)
    try {
      await sellerApi.setPrimaryImage(id, imageId)
      setImages((prev) => prev.map((img) => ({ ...img, is_primary: img.id === imageId })))
    } catch (err) {
      setSaveMsg({ type: "error", text: err instanceof ApiRequestError ? err.message : "Failed to set primary image." })
      setTimeout(() => setSaveMsg(null), 4000)
    } finally {
      setSettingPrimaryId(null)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (isLoading) return <PageSkeleton />

  if (loadError) {
    return (
      <div className="space-y-4">
        <Link href="/seller/listings">
          <Button variant="ghost" size="sm" className="text-text-secondary">
            <ChevronLeft className="w-4 h-4 mr-1" /> Back to Listings
          </Button>
        </Link>
        <div className="flex items-center gap-3 p-5 bg-danger/10 border border-danger/20 rounded-xl text-danger">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="text-sm">{loadError}</span>
          <Button variant="outline" size="sm" onClick={loadListing} className="ml-auto border-danger/30 text-danger">
            <RefreshCw className="w-4 h-4 mr-1.5" /> Retry
          </Button>
        </div>
      </div>
    )
  }

  if (!listing) return null

  const status = listing.status
  const badge = statusBadge[status] ?? statusBadge["draft"]
  const agentAssigned = !!listing.verification_assignment_id
  // Seller can edit when: draft, rejected, OR pending but agent hasn't been assigned yet
  const canEdit = status === "draft" || status === "rejected" || (status === "pending" && !agentAssigned)
  const canSubmit = status === "draft" || status === "rejected"
  const isActive = status === "active"
  const isPending = status === "pending"
  const isPendingLocked = isPending && agentAssigned

  return (
    <div className="space-y-6">

      {/* Breadcrumb + Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Link href="/seller/listings">
            <Button variant="ghost" size="sm" className="text-text-secondary h-8 px-2">
              <ChevronLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-semibold text-text-primary line-clamp-1">
                {listing.title}
              </h1>
              <Badge className={cn("text-xs border", badge.style)}>{badge.label}</Badge>
            </div>
            <p className="text-xs text-text-secondary mt-0.5 font-mono">ID: {listing.id.slice(0, 8)}…</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {canEdit && (
            <Button
              onClick={handleSave}
              disabled={isSaving}
              className="bg-ocean hover:bg-ocean-dark text-white"
              size="sm"
            >
              {isSaving
                ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                : <Save className="w-4 h-4 mr-1.5" />}
              Save Changes
            </Button>
          )}
          {canSubmit && (
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting}
              variant="outline"
              size="sm"
              className="border-ocean/30 text-ocean hover:bg-ocean/5"
            >
              {isSubmitting
                ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                : <Send className="w-4 h-4 mr-1.5" />}
              {status === "rejected" ? "Resubmit" : "Submit for Review"}
            </Button>
          )}
        </div>
      </div>

      {/* Status banners */}
      {isActive && (
        <div className="flex items-center gap-3 p-4 bg-success/5 border border-success/20 rounded-xl">
          <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
          <div>
            <p className="text-sm font-semibold text-text-primary">Listing is live</p>
            <p className="text-xs text-text-secondary mt-0.5">
              Your listing is visible to all buyers on the marketplace.
            </p>
          </div>
        </div>
      )}

      {isPending && !agentAssigned && (
        <div className="flex items-center gap-3 p-4 bg-warning/5 border border-warning/20 rounded-xl">
          <Clock className="w-5 h-5 text-warning shrink-0" />
          <div>
            <p className="text-sm font-semibold text-text-primary">Pending review — edits still allowed</p>
            <p className="text-xs text-text-secondary mt-0.5">
              Your listing is awaiting assignment. You can still make edits until an agent begins verification.
            </p>
          </div>
        </div>
      )}

      {isPendingLocked && (
        <div className="flex items-center gap-3 p-4 bg-warning/5 border border-warning/20 rounded-xl">
          <Clock className="w-5 h-5 text-warning shrink-0" />
          <div>
            <p className="text-sm font-semibold text-text-primary">Verification in progress — editing locked</p>
            <p className="text-xs text-text-secondary mt-0.5">
              An agent has begun verifying this listing. Editing is disabled until the review is complete.
            </p>
          </div>
        </div>
      )}

      {status === "rejected" && listing.description && (
        <div className="flex items-start gap-3 p-4 bg-danger/5 border border-danger/20 rounded-xl">
          <AlertCircle className="w-5 h-5 text-danger shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-text-primary">Listing rejected</p>
            <p className="text-xs text-text-secondary mt-0.5">
              Please address the feedback below and resubmit.
            </p>
          </div>
        </div>
      )}

      {/* Save feedback */}
      {saveMsg && (
        <div className={cn(
          "flex items-center gap-2 p-3 rounded-lg text-sm border",
          saveMsg.type === "success"
            ? "bg-success/10 border-success/20 text-success"
            : "bg-danger/10 border-danger/20 text-danger"
        )}>
          {saveMsg.type === "success"
            ? <CheckCircle2 className="w-4 h-4 shrink-0" />
            : <AlertCircle className="w-4 h-4 shrink-0" />}
          {saveMsg.text}
        </div>
      )}

      {/* Main layout */}
      <div className="grid gap-6 lg:grid-cols-3">

        {/* Left: Edit form */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl border border-border shadow-sm p-6 space-y-5">
            <h2 className="text-base font-semibold text-text-primary">
            {canEdit ? "Edit Listing Details" : "Listing Details"}
          </h2>

            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="title">Title <span className="text-danger">*</span></Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={!canEdit}
                placeholder="e.g. 2019 Offshore Supply Vessel — 80m DP2"
                className="bg-gray-50/50 disabled:opacity-70"
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={!canEdit}
                rows={6}
                placeholder="Provide a detailed description of the item including specs, history, certifications..."
                className="bg-gray-50/50 resize-y disabled:opacity-70"
              />
            </div>

            {/* Condition + Price */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="condition">Condition <span className="text-danger">*</span></Label>
                <Select value={condition} onValueChange={setCondition} disabled={!canEdit}>
                  <SelectTrigger id="condition" className="bg-gray-50/50 disabled:opacity-70">
                    <SelectValue placeholder="Select condition" />
                  </SelectTrigger>
                  <SelectContent>
                    {CONDITIONS.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="price">Asking Price <span className="text-danger">*</span></Label>
                <div className="flex gap-2">
                  <Select value={currency} onValueChange={setCurrency} disabled={!canEdit}>
                    <SelectTrigger className="w-24 shrink-0 bg-gray-50/50 disabled:opacity-70">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    id="price"
                    type="number"
                    min="0"
                    step="0.01"
                    value={askingPrice}
                    onChange={(e) => setAskingPrice(e.target.value)}
                    disabled={!canEdit}
                    placeholder="0.00"
                    className="bg-gray-50/50 flex-1 disabled:opacity-70"
                  />
                </div>
              </div>
            </div>

            {/* Location */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="country">Country <span className="text-danger">*</span></Label>
                <Select value={locationCountry} onValueChange={setLocationCountry} disabled={!canEdit}>
                  <SelectTrigger id="country" className="bg-gray-50/50 disabled:opacity-70">
                    <SelectValue placeholder="Select country" />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="port">Port / Location</Label>
                <Input
                  id="port"
                  value={locationPort}
                  onChange={(e) => setLocationPort(e.target.value)}
                  disabled={!canEdit}
                  placeholder="e.g. Lagos, Apapa Terminal"
                  className="bg-gray-50/50 disabled:opacity-70"
                />
              </div>
            </div>

            {/* Category (read-only) */}
            {listing.category_name && (
              <div className="space-y-1.5">
                <Label>Category</Label>
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-border text-sm text-text-secondary">
                  {listing.category_name}
                  <span className="text-xs ml-auto opacity-60">(contact support to change)</span>
                </div>
              </div>
            )}

            {canEdit && (
              <div className="pt-2 flex justify-end">
                <Button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="bg-ocean hover:bg-ocean-dark text-white"
                >
                  {isSaving
                    ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    : <Save className="w-4 h-4 mr-1.5" />}
                  Save Changes
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Right: Images + Meta */}
        <div className="space-y-5">

          {/* Image manager */}
          <div className="bg-white rounded-xl border border-border shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text-primary">Images</h2>
              <span className="text-xs text-text-secondary">{images.length} / 10</span>
            </div>

            {images.length === 0 ? (
              <div className="border-2 border-dashed border-border rounded-xl p-8 text-center">
                <ImageIcon className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                <p className="text-sm text-text-secondary">No images yet</p>
                <p className="text-xs text-text-secondary mt-1">Add photos to attract more buyers</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2">
                {images.map((img) => (
                  <ImageCard
                    key={img.id}
                    image={img}
                    onDelete={handleDeleteImage}
                    onSetPrimary={handleSetPrimary}
                    deleting={deletingId === img.id}
                    settingPrimary={settingPrimaryId === img.id}
                  />
                ))}
              </div>
            )}

            {/* Upload error */}
            {uploadError && (
              <div className="flex items-center gap-2 p-2.5 bg-danger/10 rounded-lg text-danger text-xs border border-danger/20">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {uploadError}
                <button onClick={() => setUploadError(null)} className="ml-auto"><X className="w-3 h-3" /></button>
              </div>
            )}

            {/* Upload button — always visible; disabled for non-editable statuses */}
            {images.length < 10 && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleUpload}
                />
                <Button
                  variant="outline"
                  className="w-full border-dashed"
                  disabled={isUploading || isPendingLocked}
                  onClick={() => fileRef.current?.click()}
                >
                  {isUploading
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading…</>
                    : <><Upload className="w-4 h-4 mr-2" /> Upload Image</>}
                </Button>
              </>
            )}

            <p className="text-xs text-text-secondary/70">
              Accepted: JPG, PNG, WebP · Max 10MB · First image becomes primary
            </p>
          </div>

          {/* Listing meta */}
          <div className="bg-white rounded-xl border border-border shadow-sm p-5 space-y-3">
            <h2 className="text-sm font-semibold text-text-primary">Listing Info</h2>
            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-text-secondary">Status</span>
                <Badge className={cn("text-xs border", badge.style)}>{badge.label}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Category</span>
                <span className="text-text-primary font-medium text-right max-w-[140px] truncate">
                  {listing.category_name ?? "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Created</span>
                <span className="text-text-primary">
                  {new Date(listing.created_at).toLocaleDateString("en-GB", {
                    day: "numeric", month: "short", year: "numeric"
                  })}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Last updated</span>
                <span className="text-text-primary">
                  {new Date(listing.updated_at).toLocaleDateString("en-GB", {
                    day: "numeric", month: "short", year: "numeric"
                  })}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Availability</span>
                <span className="text-text-primary capitalize">
                  {listing.availability_type?.replace(/_/g, " ") ?? "—"}
                </span>
              </div>
            </div>
          </div>

          {/* Audit & Verification Timeline */}
          {(agentAssigned || listing.submitted_at) && (
            <VerificationTimeline
              productStatus={status}
              submittedAt={listing.submitted_at ?? null}
              agentAssigned={agentAssigned}
              verif={verif}
              adminNotes={listing.admin_notes ?? null}
              rejectionReason={listing.rejection_reason ?? null}
            />
          )}

          {/* Submit CTA */}
          {canSubmit && (
            <div className="bg-ocean/5 border border-ocean/20 rounded-xl p-4">
              <p className="text-sm font-semibold text-text-primary mb-1">
                {status === "rejected" ? "Ready to resubmit?" : "Ready to go live?"}
              </p>
              <p className="text-xs text-text-secondary mb-3">
                {status === "rejected"
                  ? "Address the feedback above and submit again for admin review."
                  : "Save your changes first, then submit for admin review. You'll be notified once approved."}
              </p>
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="w-full bg-ocean hover:bg-ocean-dark text-white"
              >
                {isSubmitting
                  ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  : <Send className="w-4 h-4 mr-1.5" />}
                {status === "rejected" ? "Resubmit for Review" : "Submit for Review"}
              </Button>
            </div>
          )}

          {/* Quick actions */}
          <div className="flex flex-col gap-2">
            <Link href="/seller/listings">
              <Button variant="outline" className="w-full justify-start" size="sm">
                <ChevronLeft className="w-4 h-4 mr-2" /> Back to All Listings
              </Button>
            </Link>
            <Link href="/seller/listings/new">
              <Button variant="outline" className="w-full justify-start text-ocean border-ocean/30 hover:bg-ocean/5" size="sm">
                Create New Listing
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
