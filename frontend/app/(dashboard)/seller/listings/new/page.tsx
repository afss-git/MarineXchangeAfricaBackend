"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  ChevronRight, Upload, ShieldCheck, Check, X, Save, Eye,
  ImageIcon, FileText, Loader2, AlertCircle, CalendarDays, MapPin, Phone,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { seller } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useMarketplaceCategories } from "@/lib/hooks"

// ── Constants ─────────────────────────────────────────────────────────────────

// key = unique Select value, api = value sent to backend
const CONDITIONS = [
  { label: "New",              key: "new",        api: "new"         },
  { label: "Used — Excellent", key: "used_ex",    api: "used"        },
  { label: "Used — Good",      key: "used_good",  api: "used"        },
  { label: "Used — Fair",      key: "used_fair",  api: "used"        },
  { label: "Refurbished",      key: "refurb",     api: "refurbished" },
]

const COUNTRIES = [
  "Nigeria", "Ghana", "Kenya", "South Africa", "Tanzania",
  "Egypt", "Senegal", "Cameroon", "Mozambique", "Angola", "Other",
]

const CURRENCIES = ["USD", "EUR", "GBP", "NGN", "GHS", "KES", "ZAR"]

const PRICE_TYPES = ["Fixed Price", "Price Range", "Price on Request"] as const
type PriceType = typeof PRICE_TYPES[number]

// Availability is always "for_sale" on this platform
const AVAILABILITY_TYPE = "for_sale"

const IMAGE_MAX_COUNT = 10
const IMAGE_MAX_MB    = 5
const DOC_MAX_MB      = 20

// ── Types ─────────────────────────────────────────────────────────────────────

interface ImageEntry {
  file: File
  preview: string
  uploading: boolean
  error: string | null
}

interface DocEntry {
  file: File
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function NewListingPage() {
  const router = useRouter()
  const { user } = useAuth()
  const { data: categoriesRaw = [] } = useMarketplaceCategories()

  // Flatten nested categories into a flat list with parent context
  const categories = categoriesRaw.flatMap((cat) => [
    { id: cat.id, name: cat.name },
    ...(cat.subcategories ?? []).map((sub) => ({ id: sub.id, name: `${cat.name} › ${sub.name}` })),
  ])

  // ── Basic Info ──────────────────────────────────────────────────────────────
  const [title,      setTitle]      = useState("")
  const [categoryId, setCategoryId] = useState("")
  const [condition,  setCondition]  = useState("")
  const [shortDesc,  setShortDesc]  = useState("")
  const [fullDesc,   setFullDesc]   = useState("")

  // ── Pricing ─────────────────────────────────────────────────────────────────
  const [priceType,   setPriceType]   = useState<PriceType>("Fixed Price")
  const [fixedPrice,  setFixedPrice]  = useState("")
  const [minPrice,    setMinPrice]    = useState("")
  const [maxPrice,    setMaxPrice]    = useState("")
  const [currency,    setCurrency]    = useState("USD")
  const [negotiable,  setNegotiable]  = useState(false)

  // ── Location ─────────────────────────────────────────────────────────────────
  const [country,       setCountry]       = useState("")
  const [state,         setState]         = useState("")
  const [city,          setCity]          = useState("")
  const [streetAddress, setStreetAddress] = useState("")

  // ── Contact ──────────────────────────────────────────────────────────────────
  const [contactName,  setContactName]  = useState("")
  const [contactPhone, setContactPhone] = useState("")
  const [contactEmail, setContactEmail] = useState("")

  // Pre-fill contact from user profile once loaded
  useEffect(() => {
    if (user) {
      if (!contactName)  setContactName(user.full_name ?? "")
      if (!contactEmail) setContactEmail(user.email ?? "")
      if (!contactPhone) setContactPhone(user.phone ?? "")
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // ── Availability ─────────────────────────────────────────────────────────────
  // availability_type is always "for_sale" — no state needed
  const [availableFrom,     setAvailableFrom]      = useState("")
  const [inspectionAvail,   setInspectionAvail]    = useState(false)
  const [inspectionNotes,   setInspectionNotes]    = useState("")
  const [deliveryAvail,     setDeliveryAvail]      = useState(false)
  const [deliveryNotes,     setDeliveryNotes]      = useState("")

  // ── Images ───────────────────────────────────────────────────────────────────
  const [images,        setImages]     = useState<ImageEntry[]>([])
  const [dragOverImg,   setDragOverImg] = useState(false)
  const imgInputRef = useRef<HTMLInputElement>(null)

  // ── Documents ────────────────────────────────────────────────────────────────
  const [docs,       setDocs]       = useState<DocEntry[]>([])
  const [dragOverDoc, setDragOverDoc] = useState(false)
  const docInputRef = useRef<HTMLInputElement>(null)

  // ── Submission ───────────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => { images.forEach((img) => URL.revokeObjectURL(img.preview)) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Image handlers ────────────────────────────────────────────────────────
  const addImages = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files)
    const valid = arr.filter((f) => {
      if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) return false
      if (f.size > IMAGE_MAX_MB * 1024 * 1024) return false
      return true
    })
    setImages((prev) => {
      const combined = [
        ...prev,
        ...valid.map((file) => ({ file, preview: URL.createObjectURL(file), uploading: false, error: null })),
      ].slice(0, IMAGE_MAX_COUNT)
      return combined
    })
  }, [])

  const removeImage = useCallback((idx: number) => {
    setImages((prev) => {
      URL.revokeObjectURL(prev[idx].preview)
      return prev.filter((_, i) => i !== idx)
    })
  }, [])

  const onImageDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOverImg(false)
    addImages(e.dataTransfer.files)
  }, [addImages])

  // ── Document handlers ─────────────────────────────────────────────────────
  const addDocs = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files).filter(
      (f) => f.type === "application/pdf" && f.size <= DOC_MAX_MB * 1024 * 1024
    )
    setDocs((prev) => [...prev, ...arr.map((file) => ({ file }))])
  }, [])

  const removeDoc = useCallback((idx: number) => {
    setDocs((prev) => prev.filter((_, i) => i !== idx))
  }, [])

  const onDocDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOverDoc(false)
    addDocs(e.dataTransfer.files)
  }, [addDocs])

  // ── Checklist ─────────────────────────────────────────────────────────────
  const checks = {
    title:       title.trim().length >= 5,
    category:    !!categoryId,
    condition:   CONDITIONS.some((c) => c.key === condition),
    description: shortDesc.trim().length >= 20,
    price:       priceType === "Price on Request" || (priceType === "Fixed Price" && !!fixedPrice) || (priceType === "Price Range" && !!minPrice && !!maxPrice),
    location:    !!country,
    image:       images.length > 0,
  }
  const allGood = Object.values(checks).every(Boolean)

  const displayPrice = () => {
    if (priceType === "Fixed Price"  && fixedPrice) return `${currency} ${Number(fixedPrice).toLocaleString()}`
    if (priceType === "Price Range"  && minPrice && maxPrice)
      return `${currency} ${Number(minPrice).toLocaleString()} – ${Number(maxPrice).toLocaleString()}`
    return "Price on Request"
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit(publish: boolean) {
    // Guard: user must be loaded and contact email present
    if (!user?.email && !contactEmail.trim()) {
      setError("Your session is loading. Please wait a moment and try again.")
      return
    }
    // Guard: required fields
    if (!checks.title || !checks.category || !checks.condition || !checks.description || !checks.price || !checks.location) {
      setError("Please complete all required fields before saving.")
      return
    }
    // Guard: at least one image required before publishing
    if (publish && !checks.image) {
      setError("Please upload at least one image before publishing.")
      return
    }
    setSubmitting(true)
    setError(null)

    try {
      const askingPrice =
        priceType === "Fixed Price"  ? Number(fixedPrice) || 0 :
        priceType === "Price Range"  ? Number(minPrice)   || 0 : 0

      // Trim location to backend's max_length=200
      const locationParts = [streetAddress, city, state].filter(Boolean)
      const locationPort  = locationParts.join(", ").slice(0, 200) || undefined

      // Extra notes appended to description
      const availNotes: string[] = []
      if (availableFrom)   availNotes.push(`Available from: ${availableFrom}`)
      if (inspectionAvail) availNotes.push(`Inspection available${inspectionNotes ? ": " + inspectionNotes : ""}`)
      if (deliveryAvail)   availNotes.push(`Delivery available${deliveryNotes ? ": " + deliveryNotes : ""}`)
      if (negotiable)      availNotes.push("Price is negotiable")

      // Trim description to backend's max_length=10,000
      const fullDescription = [shortDesc.trim(), fullDesc.trim(), ...availNotes]
        .filter(Boolean).join("\n\n").slice(0, 10_000)

      const conditionApi = CONDITIONS.find((c) => c.key === condition)?.api ?? "used"
      // Ensure contact_name meets min_length=2
      const resolvedName = (contactName.trim() || user?.full_name?.trim() || (user?.email ?? "").split("@")[0]).slice(0, 100)
      const resolvedEmail = contactEmail.trim() || user?.email || ""
      const resolvedPhone = contactPhone.trim() || null

      // Step 1 — create listing
      const listing = await seller.createListing({
        title:             title.trim(),
        category_id:       categoryId,
        description:       fullDescription || undefined,
        availability_type: AVAILABILITY_TYPE,
        condition:         conditionApi,
        location_country:  country,
        location_port:     locationPort,
        asking_price:      askingPrice,
        currency,
        contact: {
          contact_name: resolvedName,
          email:        resolvedEmail,
          phone:        resolvedPhone ?? undefined,
        },
      })

      // Step 2 — upload images
      for (let i = 0; i < images.length; i++) {
        setImages((prev) => prev.map((img, idx) => idx === i ? { ...img, uploading: true } : img))
        const fd = new FormData()
        fd.append("file", images[i].file)
        try {
          await seller.uploadImage(listing.id, fd)
          setImages((prev) => prev.map((img, idx) => idx === i ? { ...img, uploading: false } : img))
        } catch (uploadErr: unknown) {
          setImages((prev) => prev.map((img, idx) =>
            idx === i ? { ...img, uploading: false, error: (uploadErr as Error)?.message ?? "Upload failed" } : img
          ))
        }
      }

      // Step 3 — publish if requested
      if (publish) {
        await seller.submitListing(listing.id)
      }

      router.push(`/seller/listings`)
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "Something went wrong. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Breadcrumb + actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex items-center gap-1 text-sm text-text-secondary">
          <Link href="/seller" className="hover:text-ocean transition-colors">Seller</Link>
          <ChevronRight className="w-4 h-4" />
          <Link href="/seller/listings" className="hover:text-ocean transition-colors">My Listings</Link>
          <ChevronRight className="w-4 h-4" />
          <span className="text-text-primary font-medium">New Listing</span>
        </nav>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={submitting} onClick={() => handleSubmit(false)}>
            {submitting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
            Save as Draft
          </Button>
          <Button
            className="bg-ocean hover:bg-ocean-dark text-white"
            size="sm"
            disabled={!allGood || submitting}
            onClick={() => handleSubmit(true)}
          >
            {submitting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
            Publish Listing
          </Button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="text-sm">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">

        {/* ── LEFT: Form ── */}
        <div className="flex-1 space-y-6">

          {/* Basic Information */}
          <div className="bg-white rounded-xl border border-border p-6 space-y-5 shadow-sm">
            <h2 className="text-base font-semibold text-text-primary">Basic Information</h2>

            <div className="space-y-2">
              <Label htmlFor="title">Asset Title <span className="text-danger">*</span></Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Offshore Supply Vessel — 2018 Build"
                disabled={submitting}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Category <span className="text-danger">*</span></Label>
                <Select value={categoryId} onValueChange={setCategoryId} disabled={submitting}>
                  <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Condition <span className="text-danger">*</span></Label>
                <Select value={condition} onValueChange={setCondition} disabled={submitting}>
                  <SelectTrigger><SelectValue placeholder="Select condition" /></SelectTrigger>
                  <SelectContent>
                    {CONDITIONS.map((c) => (
                      <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="short-desc">Short Description <span className="text-danger">*</span></Label>
                <span className={cn("text-xs", shortDesc.length > 180 ? "text-danger" : "text-text-secondary")}>
                  {shortDesc.length}/200
                </span>
              </div>
              <Textarea
                id="short-desc"
                value={shortDesc}
                onChange={(e) => setShortDesc(e.target.value.slice(0, 200))}
                placeholder="Brief overview shown in listing cards..."
                rows={3}
                disabled={submitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="full-desc">Full Description</Label>
              <Textarea
                id="full-desc"
                value={fullDesc}
                onChange={(e) => setFullDesc(e.target.value)}
                placeholder="Detailed description, history, condition notes, included accessories, certifications..."
                rows={6}
                disabled={submitting}
              />
            </div>
          </div>

          {/* Pricing */}
          <div className="bg-white rounded-xl border border-border p-6 space-y-5 shadow-sm">
            <h2 className="text-base font-semibold text-text-primary">Pricing</h2>

            <div className="flex flex-wrap gap-2">
              {PRICE_TYPES.map((type) => (
                <button
                  key={type}
                  onClick={() => setPriceType(type)}
                  disabled={submitting}
                  className={cn(
                    "px-4 py-2 rounded-lg text-sm font-medium border transition-colors",
                    priceType === type
                      ? "bg-ocean text-white border-ocean"
                      : "bg-white text-text-secondary border-border hover:border-ocean hover:text-ocean"
                  )}
                >
                  {type}
                </button>
              ))}
            </div>

            {priceType !== "Price on Request" && (
              <div className="flex items-end gap-3 flex-wrap">
                <div className="space-y-2 w-28">
                  <Label>Currency</Label>
                  <Select value={currency} onValueChange={setCurrency} disabled={submitting}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {priceType === "Fixed Price" && (
                  <div className="space-y-2 max-w-xs flex-1">
                    <Label>Price <span className="text-danger">*</span></Label>
                    <Input
                      type="number" min="0" placeholder="0"
                      value={fixedPrice} onChange={(e) => setFixedPrice(e.target.value)}
                      disabled={submitting}
                    />
                  </div>
                )}

                {priceType === "Price Range" && (
                  <>
                    <div className="space-y-2 flex-1">
                      <Label>Min Price <span className="text-danger">*</span></Label>
                      <Input type="number" min="0" placeholder="0" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} disabled={submitting} />
                    </div>
                    <div className="space-y-2 flex-1">
                      <Label>Max Price <span className="text-danger">*</span></Label>
                      <Input type="number" min="0" placeholder="0" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} disabled={submitting} />
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <Switch checked={negotiable} onCheckedChange={setNegotiable} id="negotiable" disabled={submitting} />
              <Label htmlFor="negotiable" className="cursor-pointer font-normal">Price is negotiable</Label>
            </div>
          </div>

          {/* Location */}
          <div className="bg-white rounded-xl border border-border p-6 space-y-5 shadow-sm">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-ocean" />
              <h2 className="text-base font-semibold text-text-primary">Location</h2>
            </div>

            <div className="space-y-2">
              <Label htmlFor="street">Street Address</Label>
              <Input
                id="street"
                value={streetAddress}
                onChange={(e) => setStreetAddress(e.target.value)}
                placeholder="e.g. 6A Hinderer Street, Apapa"
                disabled={submitting}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Country <span className="text-danger">*</span></Label>
                <Select value={country} onValueChange={setCountry} disabled={submitting}>
                  <SelectTrigger><SelectValue placeholder="Select country" /></SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>State / Region</Label>
                <Input placeholder="e.g. Lagos State" value={state} onChange={(e) => setState(e.target.value)} disabled={submitting} />
              </div>
              <div className="space-y-2">
                <Label>City / Port</Label>
                <Input placeholder="e.g. Apapa, Lagos" value={city} onChange={(e) => setCity(e.target.value)} disabled={submitting} />
              </div>
            </div>
          </div>

          {/* Availability */}
          <div className="bg-white rounded-xl border border-border p-6 space-y-5 shadow-sm">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-ocean" />
              <h2 className="text-base font-semibold text-text-primary">Availability & Confirmation</h2>
            </div>

            <div className="space-y-2 max-w-xs">
              <Label htmlFor="avail-from">Available From</Label>
              <Input
                id="avail-from"
                type="date"
                value={availableFrom}
                onChange={(e) => setAvailableFrom(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                disabled={submitting}
              />
              <p className="text-xs text-text-secondary">Leave blank if available immediately</p>
            </div>

            <div className="space-y-4 pt-1 border-t border-border">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide pt-1">Additional Options</p>

              <div className="flex items-start gap-3">
                <Switch id="inspection" checked={inspectionAvail} onCheckedChange={setInspectionAvail} disabled={submitting} />
                <div className="flex-1">
                  <Label htmlFor="inspection" className="cursor-pointer">Inspection available</Label>
                  <p className="text-xs text-text-secondary mt-0.5">Buyers can physically inspect the asset before purchase</p>
                  {inspectionAvail && (
                    <Input
                      className="mt-2 text-sm"
                      placeholder="Inspection location or contact instructions..."
                      value={inspectionNotes}
                      onChange={(e) => setInspectionNotes(e.target.value)}
                      disabled={submitting}
                    />
                  )}
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Switch id="delivery" checked={deliveryAvail} onCheckedChange={setDeliveryAvail} disabled={submitting} />
                <div className="flex-1">
                  <Label htmlFor="delivery" className="cursor-pointer">Delivery / shipping available</Label>
                  <p className="text-xs text-text-secondary mt-0.5">You can arrange delivery or shipping to the buyer</p>
                  {deliveryAvail && (
                    <Input
                      className="mt-2 text-sm"
                      placeholder="Delivery terms, cost, or regions covered..."
                      value={deliveryNotes}
                      onChange={(e) => setDeliveryNotes(e.target.value)}
                      disabled={submitting}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Contact Information */}
          <div className="bg-white rounded-xl border border-border p-6 space-y-5 shadow-sm">
            <div className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-ocean" />
              <h2 className="text-base font-semibold text-text-primary">Contact Information</h2>
            </div>
            <p className="text-xs text-text-secondary -mt-3">
              Buyers will use these details to reach you about this listing.
            </p>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="contact-name">Contact Name <span className="text-danger">*</span></Label>
                <Input
                  id="contact-name"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Your full name"
                  disabled={submitting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact-phone">Phone Number <span className="text-danger">*</span></Label>
                <Input
                  id="contact-phone"
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="+234 800 000 0000"
                  disabled={submitting}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="contact-email">Contact Email <span className="text-danger">*</span></Label>
              <Input
                id="contact-email"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="your@email.com"
                disabled={submitting}
              />
            </div>
          </div>

          {/* Images */}
          <div className="bg-white rounded-xl border border-border p-6 space-y-5 shadow-sm">
            <div>
              <h2 className="text-base font-semibold text-text-primary">Listing Images <span className="text-danger">*</span></h2>
              <p className="text-xs text-text-secondary mt-0.5">JPEG, PNG, WebP — max {IMAGE_MAX_MB}MB each, up to {IMAGE_MAX_COUNT} images</p>
            </div>

            {/* Hidden file input */}
            <input
              ref={imgInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && addImages(e.target.files)}
            />

            {/* Drop zone */}
            <div
              onClick={() => imgInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOverImg(true) }}
              onDragLeave={() => setDragOverImg(false)}
              onDrop={onImageDrop}
              className={cn(
                "w-full border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors",
                dragOverImg ? "border-ocean bg-ocean/10" : "border-border hover:border-ocean hover:bg-ocean/5"
              )}
            >
              <Upload className={cn("w-8 h-8 mx-auto mb-3 transition-colors", dragOverImg ? "text-ocean" : "text-text-secondary")} />
              <p className="text-sm font-medium text-text-primary">
                {dragOverImg ? "Drop images here" : "Drag & drop images or click to browse"}
              </p>
              <p className="text-xs text-text-secondary mt-1">
                {images.length}/{IMAGE_MAX_COUNT} images added
              </p>
            </div>

            {/* Image previews */}
            {images.length > 0 && (
              <div className="grid grid-cols-4 gap-3 sm:grid-cols-5 md:grid-cols-6">
                {images.map((img, idx) => (
                  <div key={idx} className="relative group aspect-square">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.preview}
                      alt={`Image ${idx + 1}`}
                      className="w-full h-full object-cover rounded-lg border border-border"
                    />
                    {/* Uploading overlay */}
                    {img.uploading && (
                      <div className="absolute inset-0 bg-black/40 rounded-lg flex items-center justify-center">
                        <Loader2 className="w-5 h-5 text-white animate-spin" />
                      </div>
                    )}
                    {/* Error overlay */}
                    {img.error && (
                      <div className="absolute inset-0 bg-danger/60 rounded-lg flex items-center justify-center">
                        <AlertCircle className="w-4 h-4 text-white" />
                      </div>
                    )}
                    {/* Primary badge */}
                    {idx === 0 && !img.uploading && (
                      <div className="absolute bottom-1 left-1 bg-ocean text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                        MAIN
                      </div>
                    )}
                    {/* Remove button */}
                    <button
                      onClick={(e) => { e.stopPropagation(); removeImage(idx) }}
                      disabled={submitting}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-danger rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  </div>
                ))}
                {/* Add more slot */}
                {images.length < IMAGE_MAX_COUNT && (
                  <button
                    onClick={() => imgInputRef.current?.click()}
                    disabled={submitting}
                    className="aspect-square rounded-lg border-2 border-dashed border-border hover:border-ocean transition-colors flex items-center justify-center"
                  >
                    <ImageIcon className="w-5 h-5 text-text-secondary" />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Documents */}
          <div className="bg-white rounded-xl border border-border p-6 space-y-5 shadow-sm">
            <div>
              <h2 className="text-base font-semibold text-text-primary">Technical Documents</h2>
              <p className="text-xs text-text-secondary mt-0.5">PDF only — max {DOC_MAX_MB}MB each. Certificates, surveys, inspection reports.</p>
            </div>

            {/* Hidden file input */}
            <input
              ref={docInputRef}
              type="file"
              accept=".pdf,application/pdf"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && addDocs(e.target.files)}
            />

            {/* Drop zone */}
            <div
              onClick={() => docInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOverDoc(true) }}
              onDragLeave={() => setDragOverDoc(false)}
              onDrop={onDocDrop}
              className={cn(
                "w-full border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors",
                dragOverDoc ? "border-ocean bg-ocean/10" : "border-border hover:border-ocean hover:bg-ocean/5"
              )}
            >
              <Upload className={cn("w-6 h-6 mx-auto mb-2 transition-colors", dragOverDoc ? "text-ocean" : "text-text-secondary")} />
              <p className="text-sm font-medium text-text-primary">
                {dragOverDoc ? "Drop PDFs here" : "Drag & drop documents or click to browse"}
              </p>
            </div>

            {/* Document list */}
            {docs.length > 0 && (
              <div className="space-y-2">
                {docs.map((doc, idx) => (
                  <div key={idx} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-border">
                    <FileText className="w-5 h-5 text-ocean shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">{doc.file.name}</p>
                      <p className="text-xs text-text-secondary">{formatBytes(doc.file.size)}</p>
                    </div>
                    <button onClick={() => removeDoc(idx)} disabled={submitting}>
                      <X className="w-4 h-4 text-text-secondary hover:text-danger transition-colors" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <ShieldCheck className="w-4 h-4 text-ocean shrink-0" />
              <span>All uploads are scanned for security before being stored</span>
            </div>
          </div>

        </div>

        {/* ── RIGHT: Preview + Checklist ── */}
        <div className="lg:w-72 shrink-0 space-y-4">
          <div className="bg-white rounded-xl border border-border shadow-sm sticky top-24 overflow-hidden">

            {/* Preview image */}
            <div className="h-40 bg-gray-100 flex items-center justify-center overflow-hidden">
              {images[0]
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={images[0].preview} alt="Preview" className="w-full h-full object-cover" />
                : <Eye className="w-8 h-8 text-gray-300" />
              }
            </div>

            <div className="p-4 space-y-3">
              <h3 className="font-semibold text-text-primary text-sm">
                {title || <span className="text-text-secondary italic">Your listing title</span>}
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {categoryId && categories.find(c => c.id === categoryId) && (
                  <Badge variant="secondary" className="text-xs">
                    {categories.find(c => c.id === categoryId)?.name}
                  </Badge>
                )}
                {condition && (
                  <Badge variant="secondary" className="text-xs">
                    {CONDITIONS.find(c => c.key === condition)?.label ?? condition}
                  </Badge>
                )}
              </div>
              <p className="text-base font-bold text-navy">{displayPrice()}</p>
              {country && (
                <p className="text-xs text-text-secondary flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {[city, state, country].filter(Boolean).join(", ")}
                </p>
              )}

              <Button variant="outline" size="sm" className="w-full border-ocean text-ocean hover:bg-ocean/5 mt-2">
                <Eye className="w-4 h-4 mr-1.5" /> Preview as Buyer
              </Button>
            </div>

            {/* Checklist */}
            <div className="border-t border-border p-4">
              <p className="text-xs font-semibold text-text-primary mb-3 uppercase tracking-wide">Listing Checklist</p>
              <ul className="space-y-2">
                {[
                  { label: "Title (5+ chars)",          ok: checks.title },
                  { label: "Category",                   ok: checks.category },
                  { label: "Condition",                  ok: checks.condition },
                  { label: "Description (20+ chars)",    ok: checks.description },
                  { label: "Price",                      ok: checks.price },
                  { label: "Country",                    ok: checks.location },
                  { label: "At least 1 image",           ok: checks.image },
                ].map((item) => (
                  <li key={item.label} className="flex items-center gap-2 text-sm">
                    {item.ok
                      ? <Check className="w-4 h-4 text-success shrink-0" />
                      : <X    className="w-4 h-4 text-text-secondary shrink-0" />}
                    <span className={item.ok ? "text-text-primary" : "text-text-secondary"}>{item.label}</span>
                  </li>
                ))}
              </ul>

              {allGood && (
                <Button
                  className="w-full mt-4 bg-ocean hover:bg-ocean-dark text-white"
                  size="sm"
                  disabled={submitting}
                  onClick={() => handleSubmit(true)}
                >
                  {submitting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
                  Publish Listing
                </Button>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
