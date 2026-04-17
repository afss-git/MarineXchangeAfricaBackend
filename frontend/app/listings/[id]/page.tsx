"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft, MapPin, Tag, Ship, Loader2, Lock, Images,
  ChevronRight, Anchor, AlertCircle, ExternalLink,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { marketplace, type ProductDetail } from "@/lib/api"

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPrice(price: string, currency: string) {
  const num = parseFloat(price)
  if (isNaN(num)) return `${currency} ${price}`
  if (num >= 1_000_000) return `${currency} ${(num / 1_000_000).toFixed(2)}M`
  if (num >= 1_000) return `${currency} ${(num / 1_000).toFixed(0)}K`
  return `${currency} ${num.toLocaleString()}`
}

function availabilityLabel(type: string) {
  const map: Record<string, string> = {
    for_sale: "For Sale", hire: "For Hire", lease: "For Lease",
    bareboat_charter: "Bareboat Charter", time_charter: "Time Charter",
  }
  return map[type] ?? type?.replace(/_/g, " ") ?? "—"
}

function conditionLabel(c: string) {
  return c?.replace(/_/g, " ").replace(/\b\w/g, x => x.toUpperCase()) ?? "—"
}

// ── Gate overlay — shown over blurred extra photos ────────────────────────────

function GateOverlay({ label, href }: { label: string; href: string }) {
  return (
    <Link href={href}
      className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-navy/60 backdrop-blur-sm z-10 rounded-xl transition-all hover:bg-navy/70 group">
      <div className="w-10 h-10 rounded-full bg-white/10 border border-white/20 flex items-center justify-center group-hover:bg-white/20 transition-colors">
        <Lock className="w-5 h-5 text-white" />
      </div>
      <p className="text-white text-sm font-semibold">{label}</p>
      <p className="text-white/70 text-xs">Create free account</p>
    </Link>
  )
}

// ── Attribute grid ─────────────────────────────────────────────────────────────

function SpecGrid({ specs }: { specs: ProductDetail["attribute_values"] }) {
  if (!specs.length) return null
  // Show max 6 specs publicly
  const visible = specs.slice(0, 6)
  const hidden  = specs.length - visible.length
  return (
    <div>
      <h3 className="text-sm font-bold text-navy uppercase tracking-wider mb-3">Specifications</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {visible.map(a => (
          <div key={a.attribute_id} className="bg-white border border-border rounded-xl px-3 py-2.5">
            <p className="text-[11px] text-text-secondary">{a.attribute_name}</p>
            <p className="text-sm font-semibold text-text-primary">
              {a.value_text
                ?? (a.value_numeric != null ? String(a.value_numeric) : null)
                ?? (a.value_boolean != null ? (a.value_boolean ? "Yes" : "No") : "—")}
            </p>
          </div>
        ))}
      </div>
      {hidden > 0 && (
        <Link href="/signup/buyer"
          className="mt-2 flex items-center gap-1.5 text-xs text-ocean font-semibold hover:underline">
          <Lock className="w-3 h-3" /> +{hidden} more specifications — sign up to view
        </Link>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PublicListingPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [product, setProduct] = useState<ProductDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr]         = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)

  useEffect(() => {
    marketplace.getProduct(id)
      .then(setProduct)
      .catch(() => setErr("This listing could not be found or is no longer available."))
      .finally(() => setLoading(false))
  }, [id])

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-surface flex flex-col">
      <PublicNav />
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-ocean animate-spin" />
      </div>
    </div>
  )

  // ── Error ──────────────────────────────────────────────────────────────────
  if (err || !product) return (
    <div className="min-h-screen bg-surface flex flex-col">
      <PublicNav />
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-gray-400" />
          </div>
          <h2 className="text-xl font-bold text-navy mb-2">Listing Not Found</h2>
          <p className="text-text-secondary mb-6">{err ?? "This listing is no longer available."}</p>
          <Link href="/#catalog">
            <Button className="bg-ocean text-white hover:bg-ocean-dark">Browse All Listings</Button>
          </Link>
        </div>
      </div>
    </div>
  )

  // ── Prepare images: first 3 visible, rest gated ───────────────────────────
  const allImages   = product.images ?? []
  const firstThree  = allImages.slice(0, 3)
  const hiddenCount = allImages.length - firstThree.length
  const primaryImg  = allImages.find(i => i.is_primary) ?? allImages[0] ?? null

  // ── Location: country only (never port/street) ────────────────────────────
  const locationDisplay = product.location_country ?? "—"

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <PublicNav />

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ backdropFilter: "blur(10px)", backgroundColor: "rgba(0,0,0,0.82)" }}
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox} alt=""
            className="max-w-[92vw] max-h-[88vh] object-contain rounded-2xl shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-5 right-5 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
          >✕</button>
        </div>
      )}

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">

        {/* Back */}
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-ocean mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to listings
        </button>

        <div className="grid lg:grid-cols-[1fr_360px] gap-8 items-start">

          {/* ── LEFT COLUMN ────────────────────────────────────────────── */}
          <div className="space-y-6">

            {/* Photo gallery — max 3 public */}
            <div className="space-y-3">
              {/* Primary image */}
              <div className="relative h-72 sm:h-96 rounded-2xl overflow-hidden bg-gray-100 group">
                {primaryImg ? (
                  <img
                    src={primaryImg.signed_url} alt={product.title}
                    className="w-full h-full object-cover cursor-zoom-in"
                    onClick={() => setLightbox(primaryImg.signed_url)}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-navy/5 to-ocean/10">
                    <Ship className="w-16 h-16 text-ocean/20" />
                  </div>
                )}
                {/* Availability badge */}
                <span className="absolute top-4 left-4 text-xs font-semibold px-3 py-1.5 rounded-full bg-white/95 text-navy shadow-sm">
                  {availabilityLabel(product.availability_type)}
                </span>
              </div>

              {/* Thumbnail row: photos 2 & 3 + gated slot */}
              {allImages.length > 1 && (
                <div className="grid grid-cols-3 gap-3">
                  {firstThree.slice(1).map((img) => (
                    <button
                      key={img.id}
                      onClick={() => setLightbox(img.signed_url)}
                      className="relative h-24 rounded-xl overflow-hidden bg-gray-100 group hover:ring-2 hover:ring-ocean/40 transition-all"
                    >
                      <img src={img.signed_url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    </button>
                  ))}

                  {/* Gated slot: if there are hidden images, show a blur/lock */}
                  {hiddenCount > 0 && (
                    <div className="relative h-24 rounded-xl overflow-hidden bg-gray-100">
                      {/* Show the 4th image blurred behind the gate */}
                      {allImages[3] && (
                        <img
                          src={allImages[3].signed_url} alt=""
                          className="w-full h-full object-cover blur-sm scale-110"
                        />
                      )}
                      <Link href="/signup/buyer"
                        className="absolute inset-0 flex flex-col items-center justify-center bg-navy/55 backdrop-blur-[2px] rounded-xl z-10 hover:bg-navy/65 transition-colors group">
                        <Images className="w-5 h-5 text-white mb-0.5" />
                        <span className="text-white text-xs font-bold">+{hiddenCount} more</span>
                      </Link>
                    </div>
                  )}

                  {/* If only 2 total images and no hidden, fill with CTA */}
                  {allImages.length === 2 && (
                    <Link href="/signup/buyer"
                      className="h-24 rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 hover:border-ocean hover:bg-ocean/5 transition-all">
                      <Lock className="w-4 h-4 text-text-secondary" />
                      <span className="text-xs text-text-secondary font-medium">Sign up to explore</span>
                    </Link>
                  )}
                </div>
              )}

              {/* View all images CTA */}
              {hiddenCount > 0 && (
                <Link href="/signup/buyer"
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-border bg-white hover:border-ocean hover:bg-ocean/5 text-sm font-semibold text-text-primary hover:text-ocean transition-all">
                  <Images className="w-4 h-4" />
                  View all {allImages.length} photos — sign up free
                  <ChevronRight className="w-4 h-4" />
                </Link>
              )}
            </div>

            {/* Description */}
            {product.description && (
              <div className="bg-white rounded-2xl border border-border p-6">
                <h3 className="text-sm font-bold text-navy uppercase tracking-wider mb-3">About This Asset</h3>
                <p className="text-text-primary text-sm leading-relaxed line-clamp-4 whitespace-pre-line">
                  {product.description}
                </p>
                <Link href="/signup/buyer"
                  className="mt-3 flex items-center gap-1.5 text-xs text-ocean font-semibold hover:underline">
                  <Lock className="w-3 h-3" /> Read full description — sign up free
                </Link>
              </div>
            )}

            {/* Specifications */}
            {product.attribute_values.length > 0 && (
              <div className="bg-white rounded-2xl border border-border p-6">
                <SpecGrid specs={product.attribute_values} />
              </div>
            )}
          </div>

          {/* ── RIGHT COLUMN — pricing + CTA card ──────────────────────── */}
          <div className="space-y-4 lg:sticky lg:top-24">

            {/* Price card */}
            <div className="bg-white rounded-2xl border border-border p-6 shadow-sm">
              <p className="text-3xl font-extrabold text-navy leading-none mb-1" style={{ letterSpacing: "-0.03em" }}>
                {formatPrice(product.asking_price, product.currency)}
              </p>
              <p className="text-text-secondary text-xs mb-5">{conditionLabel(product.condition)}</p>

              <div className="space-y-2.5 mb-6">
                <Detail icon={<Tag className="w-3.5 h-3.5" />} label="Category" value={product.category_name ?? "Marine Asset"} />
                <Detail icon={<MapPin className="w-3.5 h-3.5" />} label="Location" value={locationDisplay} />
                <Detail icon={<Ship className="w-3.5 h-3.5" />} label="Condition" value={conditionLabel(product.condition)} />
              </div>

              {/* Primary CTA */}
              <Link href="/signup/buyer" className="block">
                <Button className="w-full bg-ocean hover:bg-ocean-dark text-white font-bold py-3 text-sm gap-2 rounded-xl">
                  Sign Up to View Full Details
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </Link>
              <p className="text-center text-xs text-text-secondary mt-2">Free account · No credit card required</p>
            </div>

            {/* Contact seller card — gated */}
            <div className="bg-white rounded-2xl border border-border p-6 relative overflow-hidden">
              <h3 className="text-sm font-bold text-navy mb-3">Seller Information</h3>
              {/* Blurred fake rows */}
              <div className="space-y-3 select-none" aria-hidden="true">
                {["Company Name", "Contact Person", "Phone", "Email"].map(label => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-xs text-text-secondary">{label}</span>
                    <span className="text-sm font-semibold text-text-primary blur-sm">████████</span>
                  </div>
                ))}
              </div>
              {/* Gate overlay */}
              <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] flex flex-col items-center justify-center gap-3 rounded-2xl">
                <div className="w-10 h-10 rounded-full bg-ocean/10 flex items-center justify-center">
                  <Lock className="w-5 h-5 text-ocean" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-bold text-navy">Seller details are private</p>
                  <p className="text-xs text-text-secondary mt-0.5">Create a free account to contact this seller</p>
                </div>
                <Link href="/signup/buyer">
                  <Button size="sm" className="bg-ocean text-white hover:bg-ocean-dark gap-1.5 text-xs rounded-lg">
                    Sign Up Free <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </Link>
              </div>
            </div>

            {/* Already have an account */}
            <p className="text-center text-xs text-text-secondary">
              Already have an account?{" "}
              <Link href="/login" className="text-ocean font-semibold hover:underline">Log in</Link>
            </p>
          </div>
        </div>
      </main>

      <PublicFooter />
    </div>
  )
}

// ── Small inline components ───────────────────────────────────────────────────

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 text-sm">
      <span className="text-ocean">{icon}</span>
      <span className="text-text-secondary text-xs w-20 shrink-0">{label}</span>
      <span className="text-text-primary font-medium">{value}</span>
    </div>
  )
}

function PublicNav() {
  return (
    <nav className="bg-white border-b border-border sticky top-0 z-40">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-extrabold text-navy text-base">
          <Anchor className="w-5 h-5 text-ocean" />
          <span>Harbours<span className="text-ocean">360</span></span>
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/login">
            <Button variant="outline" size="sm" className="text-xs border-border">Log In</Button>
          </Link>
          <Link href="/signup/buyer">
            <Button size="sm" className="bg-ocean text-white hover:bg-ocean-dark text-xs gap-1">
              Sign Up Free <ExternalLink className="w-3 h-3" />
            </Button>
          </Link>
        </div>
      </div>
    </nav>
  )
}

function PublicFooter() {
  return (
    <footer className="border-t border-border bg-white mt-12">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-xs text-text-secondary">© {new Date().getFullYear()} Harbours<span className="text-ocean">360</span>. All rights reserved.</p>
        <div className="flex items-center gap-4 text-xs text-text-secondary">
          <Link href="/" className="hover:text-ocean">Home</Link>
          <Link href="/login" className="hover:text-ocean">Log In</Link>
          <Link href="/signup/buyer" className="hover:text-ocean font-semibold text-ocean">Sign Up Free</Link>
        </div>
      </div>
    </footer>
  )
}
