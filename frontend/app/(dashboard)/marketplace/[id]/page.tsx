"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import {
  ShieldCheck,
  Lock,
  FileCheck,
  ChevronLeft,
  ChevronRight,
  FileText,
  Package,
  AlertCircle,
  CheckCircle2,
  X,
  ZoomIn,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
  marketplace as marketplaceApi,
  purchaseRequests as prApi,
  type ProductDetail,
  ApiRequestError,
} from "@/lib/api"

function countryFlag(country: string): string {
  const flags: Record<string, string> = {
    nigeria: "🇳🇬", "south africa": "🇿🇦", ghana: "🇬🇭", kenya: "🇰🇪",
    egypt: "🇪🇬", morocco: "🇲🇦", tanzania: "🇹🇿", angola: "🇦🇴",
    mozambique: "🇲🇿", senegal: "🇸🇳",
  }
  return flags[country.toLowerCase()] ?? "🌍"
}

function PageSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-32" />
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        <div className="lg:col-span-3 space-y-4">
          <div className="h-96 bg-gray-200 rounded-xl" />
          <div className="h-8 bg-gray-200 rounded w-3/4" />
          <div className="h-4 bg-gray-200 rounded w-full" />
          <div className="h-4 bg-gray-200 rounded w-2/3" />
        </div>
        <div className="lg:col-span-2">
          <div className="h-80 bg-gray-200 rounded-xl" />
        </div>
      </div>
    </div>
  )
}

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [product, setProduct] = useState<ProductDetail | null>(null)
  const [selectedImage, setSelectedImage] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Lightbox state
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)

  // Purchase request modal state
  const [showPR, setShowPR] = useState(false)
  const [offerPrice, setOfferPrice] = useState("")
  const [purchaseType, setPurchaseType] = useState("full_payment")
  const [message, setMessage] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [prSuccess, setPrSuccess] = useState(false)
  const [prError, setPrError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    marketplaceApi.getProduct(id)
      .then((data) => {
        setProduct(data)
        setOfferPrice(data.asking_price)
      })
      .catch((e) => setError(e?.message ?? "Failed to load listing."))
      .finally(() => setIsLoading(false))
  }, [id])

  // Keyboard nav for lightbox
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!lightboxOpen) return
    if (e.key === "Escape") { setLightboxOpen(false); return }
    if (!product) return
    const total = [...product.images].length
    if (e.key === "ArrowRight") setLightboxIndex((i) => (i + 1) % total)
    if (e.key === "ArrowLeft")  setLightboxIndex((i) => (i - 1 + total) % total)
  }, [lightboxOpen, product])

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [handleKeyDown])

  const submitPR = async () => {
    if (!product || !offerPrice) return
    setSubmitting(true)
    setPrError(null)
    try {
      await prApi.create({
        product_id: product.id,
        purchase_type: purchaseType,
        offered_price: parseFloat(offerPrice.replace(/,/g, "")),
        offered_currency: product.currency,
        message: message || undefined,
      })
      setPrSuccess(true)
      setShowPR(false)
    } catch (e) {
      if (e instanceof ApiRequestError) {
        if (e.status === 401) {
          // Session expired — redirect to login
          router.push("/login?reason=session_expired")
          return
        }
        if (e.status === 403) {
          setPrError("You don't have permission to submit a purchase request. Please contact support.")
          return
        }
        setPrError(e.message)
      } else {
        setPrError("Failed to submit request. Please try again.")
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading) return <PageSkeleton />

  if (error) {
    return (
      <div className="flex items-center gap-3 p-4 bg-danger/10 border border-danger/20 rounded-xl text-danger max-w-2xl">
        <AlertCircle className="w-5 h-5 shrink-0" />
        <span className="text-sm">{error}</span>
        <Link href="/marketplace">
          <Button variant="outline" size="sm" className="ml-auto border-danger/30 text-danger">Back</Button>
        </Link>
      </div>
    )
  }

  if (!product) return null

  const sortedImages = [...product.images].sort((a, b) => a.display_order - b.display_order)
  const sellerInitials = (product.seller_company ?? "??").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()

  return (
    <div className="space-y-8">
      <Link
        href="/marketplace"
        className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-ocean transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to Marketplace
      </Link>

      {/* Success banner */}
      {prSuccess && (
        <div className="flex items-center gap-3 p-4 bg-success/10 border border-success/20 rounded-xl text-success">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span className="text-sm font-medium">Purchase request submitted! The seller will respond shortly.</span>
          <Link href="/purchase-requests" className="ml-auto text-xs underline">View requests</Link>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* Left Column */}
        <div className="lg:col-span-3 space-y-6">
          {/* Image Gallery */}
          <div className="space-y-3">
            {/* Main viewer — dynamic height based on aspect ratio, click to lightbox */}
            <div
              className={cn(
                "relative w-full bg-gray-50 rounded-xl overflow-hidden border border-border group",
                sortedImages.length > 0 ? "cursor-zoom-in" : ""
              )}
              style={{ minHeight: "240px" }}
              onClick={() => {
                if (sortedImages.length > 0) {
                  setLightboxIndex(selectedImage)
                  setLightboxOpen(true)
                }
              }}
            >
              {sortedImages.length > 0 && sortedImages[selectedImage]
                ? <>
                    <img
                      src={sortedImages[selectedImage].signed_url}
                      alt={product.title}
                      className="w-full max-h-[480px] object-contain"
                      style={{ display: "block" }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="bg-black/40 rounded-full p-2.5">
                        <ZoomIn className="w-5 h-5 text-white" />
                      </div>
                    </div>
                  </>
                : <div className="flex items-center justify-center h-60">
                    <Package className="w-16 h-16 text-gray-300" />
                  </div>
              }
            </div>

            {/* Thumbnails */}
            {sortedImages.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {sortedImages.map((img, i) => (
                  <button
                    key={img.id}
                    onClick={() => setSelectedImage(i)}
                    className={cn(
                      "shrink-0 w-20 h-20 rounded-lg overflow-hidden border-2 transition-colors bg-gray-100",
                      selectedImage === i ? "border-ocean" : "border-transparent hover:border-gray-300"
                    )}
                  >
                    <img src={img.signed_url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Title & Tags */}
          <div className="space-y-3">
            <div className="flex items-start gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-text-primary">{product.title}</h1>
              {product.status === "active" && (
                <Badge className="bg-success/10 text-success border border-success/20 hover:bg-success/10">
                  <ShieldCheck className="w-3 h-3 mr-1" /> Verified Listing
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {product.category_name && <Badge variant="secondary">{product.category_name}</Badge>}
              <Badge variant="secondary">
                {countryFlag(product.location_country)} {product.location_country}
              </Badge>
              <Badge variant="secondary" className="capitalize">{product.condition}</Badge>
              <Badge variant="secondary" className="capitalize">{product.availability_type.replace(/_/g, " ")}</Badge>
            </div>
          </div>

          {/* Description */}
          {product.description && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-text-primary">Description</h2>
              <p className="text-text-secondary text-sm leading-relaxed whitespace-pre-line">
                {product.description}
              </p>
            </div>
          )}

          {/* Specifications */}
          {product.attribute_values.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-text-primary">Specifications</h2>
              <div className="grid grid-cols-2 gap-3">
                {product.attribute_values.map((attr) => (
                  <div key={attr.attribute_id} className="flex justify-between py-2.5 px-3 bg-gray-50 rounded-lg">
                    <span className="text-sm text-text-secondary">{attr.attribute_name}</span>
                    <span className="text-sm font-medium text-text-primary">
                      {attr.value_text ?? attr.value_numeric ?? (attr.value_boolean != null ? (attr.value_boolean ? "Yes" : "No") : attr.value_date) ?? "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Documents */}
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">Documents Available</h2>
            <div className="space-y-2">
              {["Technical Specifications", "Survey Report", "Class Certificate"].map((doc) => (
                <div key={doc} className="flex items-center justify-between py-3 px-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-text-secondary" />
                    <span className="text-sm text-text-primary">{doc}</span>
                  </div>
                  <Button variant="outline" size="sm" disabled className="text-text-secondary">
                    Available after acceptance
                  </Button>
                </div>
              ))}
              <p className="text-xs text-text-secondary">
                Documents are available after your purchase request is accepted.
              </p>
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="lg:col-span-2">
          <div className="bg-white border border-border rounded-xl p-6 shadow-sm lg:sticky lg:top-24 space-y-5">
            {/* Price */}
            <div>
              <p className="text-2xl font-bold text-navy">
                ${Number(product.asking_price).toLocaleString()} {product.currency}
              </p>
              <p className="text-sm text-text-secondary mt-1 capitalize">
                {product.availability_type.replace(/_/g, " ")}
              </p>
            </div>

            {/* Seller Info */}
            <div className="flex items-start gap-3 py-4 border-t border-b border-border">
              <Avatar className="w-12 h-12">
                <AvatarFallback className="bg-ocean/10 text-ocean font-semibold">
                  {sellerInitials}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-text-primary">{product.seller_company ?? "Private Seller"}</p>
                <div className="flex items-center gap-1 text-sm text-success mt-0.5">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>KYC Verified Seller</span>
                </div>
                <p className="text-sm text-text-secondary mt-1">
                  {countryFlag(product.location_country)} {product.location_country}
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-2">
              {prSuccess
                ? (
                  <Button className="w-full h-12 bg-success/10 text-success border border-success/20 cursor-default" disabled>
                    <CheckCircle2 className="w-4 h-4 mr-2" /> Request Submitted
                  </Button>
                )
                : (
                  <Button
                    className="w-full h-12 bg-ocean hover:bg-ocean-dark text-white font-semibold"
                    onClick={() => setShowPR(true)}
                    disabled={product.status !== "active"}
                  >
                    Send Purchase Request
                  </Button>
                )
              }
              {product.status !== "active" && (
                <p className="text-xs text-text-secondary text-center">This listing is not currently active</p>
              )}
            </div>

            {/* Security Assurance */}
            <div className="bg-navy/5 border border-navy/10 rounded-lg p-4 space-y-3">
              {[
                { icon: ShieldCheck, text: "Escrow-protected transaction" },
                { icon: Lock, text: "KYC-verified seller" },
                { icon: FileCheck, text: "Audited deal trail" },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-2 text-sm">
                  <Icon className="w-4 h-4 text-ocean shrink-0" />
                  <span className="text-text-primary">{text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Lightbox Modal */}
      {lightboxOpen && sortedImages.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          onClick={() => setLightboxOpen(false)}
        >
          {/* Close */}
          <button
            className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
            onClick={() => setLightboxOpen(false)}
          >
            <X className="w-6 h-6" />
          </button>

          {/* Counter */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white/70 text-sm tabular-nums">
            {lightboxIndex + 1} / {sortedImages.length}
          </div>

          {/* Prev */}
          {sortedImages.length > 1 && (
            <button
              className="absolute left-3 md:left-6 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
              onClick={(e) => { e.stopPropagation(); setLightboxIndex((i) => (i - 1 + sortedImages.length) % sortedImages.length) }}
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}

          {/* Image */}
          <div
            className="max-w-[90vw] max-h-[85vh] flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={sortedImages[lightboxIndex].signed_url}
              alt={product.title}
              className="max-w-full max-h-[85vh] object-contain rounded-lg select-none"
              draggable={false}
            />
          </div>

          {/* Next */}
          {sortedImages.length > 1 && (
            <button
              className="absolute right-3 md:right-6 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
              onClick={(e) => { e.stopPropagation(); setLightboxIndex((i) => (i + 1) % sortedImages.length) }}
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          )}

          {/* Thumbnail strip */}
          {sortedImages.length > 1 && (
            <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2 px-4 overflow-x-auto">
              {sortedImages.map((img, i) => (
                <button
                  key={img.id}
                  onClick={(e) => { e.stopPropagation(); setLightboxIndex(i) }}
                  className={cn(
                    "shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 transition-colors",
                    lightboxIndex === i ? "border-ocean" : "border-white/20 hover:border-white/50"
                  )}
                >
                  <img src={img.signed_url} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Purchase Request Modal */}
      {showPR && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md space-y-5 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-text-primary">Send Purchase Request</h2>
              <button onClick={() => setShowPR(false)} className="text-text-secondary hover:text-text-primary">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-sm font-medium text-text-primary line-clamp-1">{product.title}</p>
              <p className="text-sm text-text-secondary mt-0.5">
                Listed at ${Number(product.asking_price).toLocaleString()} {product.currency}
              </p>
            </div>

            {prError && (
              <div className="flex items-center gap-2 p-3 bg-danger/10 border border-danger/20 rounded-lg text-danger text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {prError}
              </div>
            )}

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Purchase Type</Label>
                <Select value={purchaseType} onValueChange={setPurchaseType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full_payment">Full Payment</SelectItem>
                    <SelectItem value="financing">Financing</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Your Offer ({product.currency})</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary text-sm">$</span>
                  <Input
                    type="number"
                    className="pl-7"
                    value={offerPrice}
                    onChange={(e) => setOfferPrice(e.target.value)}
                    placeholder={product.asking_price}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Message to Seller <span className="text-text-secondary text-xs">(optional)</span></Label>
                <Textarea
                  rows={3}
                  placeholder="Introduce yourself and explain your interest..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={2000}
                  className="resize-none text-sm"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setShowPR(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button
                className="flex-1 bg-ocean hover:bg-ocean-dark text-white"
                onClick={submitPR}
                disabled={submitting || !offerPrice}
              >
                {submitting ? "Submitting..." : "Submit Request"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
