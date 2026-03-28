"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { MapPin, Tag, ArrowRight, Ship, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { marketplace, type ProductListItem } from "@/lib/api"

function formatPrice(price: string, currency: string) {
  const num = parseFloat(price)
  if (isNaN(num)) return `${currency} ${price}`
  if (num >= 1_000_000) return `${currency} ${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${currency} ${(num / 1_000).toFixed(0)}K`
  return `${currency} ${num.toLocaleString()}`
}

function conditionLabel(condition: string) {
  return condition?.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) ?? "—"
}

function availabilityLabel(type: string) {
  if (type === "for_sale") return "For Sale"
  if (type === "for_lease") return "For Lease"
  if (type === "for_auction") return "Auction"
  return type?.replace(/_/g, " ") ?? "—"
}

function ProductCard({ item, index, visible }: { item: ProductListItem; index: number; visible: boolean }) {
  return (
    <Link
      href="/login"
      className={`group bg-white rounded-2xl border border-border overflow-hidden transition-all duration-300 hover:border-ocean hover:-translate-y-1 block ${
        visible ? `animate-fade-up delay-${Math.min(index + 1, 6)}` : "opacity-0"
      }`}
      style={{ boxShadow: "none" }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "0 12px 32px rgba(15, 42, 68, 0.08)"
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "none"
      }}
    >
      {/* Image */}
      <div className="relative h-44 bg-surface overflow-hidden">
        {item.primary_image_url ? (
          <img
            src={item.primary_image_url}
            alt={item.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-navy/5 to-ocean/10">
            <Ship className="w-12 h-12 text-ocean/30" />
          </div>
        )}
        {/* Availability badge */}
        <span className="absolute top-3 left-3 text-[11px] font-semibold px-2 py-1 rounded-full bg-white/90 text-navy">
          {availabilityLabel(item.availability_type)}
        </span>
      </div>

      {/* Body */}
      <div className="p-4">
        <h3
          className="text-navy font-bold text-base mb-1 line-clamp-1 group-hover:text-ocean transition-colors"
          style={{ letterSpacing: "-0.01em" }}
        >
          {item.title}
        </h3>

        <div className="flex items-center gap-1.5 text-text-secondary text-xs mb-3">
          <MapPin className="w-3 h-3 shrink-0" />
          <span>{item.location_country}{item.location_port ? `, ${item.location_port}` : ""}</span>
          {item.category_name && (
            <>
              <span className="text-border mx-0.5">·</span>
              <Tag className="w-3 h-3 shrink-0" />
              <span>{item.category_name}</span>
            </>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-navy font-extrabold text-lg leading-none" style={{ letterSpacing: "-0.02em" }}>
              {formatPrice(item.asking_price, item.currency)}
            </p>
            <p className="text-text-secondary text-xs mt-0.5">{conditionLabel(item.condition)}</p>
          </div>
          <span className="text-xs text-ocean font-semibold opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
            View Details <ArrowRight className="w-3 h-3" />
          </span>
        </div>
      </div>
    </Link>
  )
}

// Skeleton card shown while loading
function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl border border-border overflow-hidden animate-pulse">
      <div className="h-44 bg-surface" />
      <div className="p-4 space-y-3">
        <div className="h-4 bg-surface rounded w-3/4" />
        <div className="h-3 bg-surface rounded w-1/2" />
        <div className="h-5 bg-surface rounded w-1/3" />
      </div>
    </div>
  )
}

export function FeaturedListings() {
  const [products, setProducts] = useState<ProductListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isVisible, setIsVisible] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.1 }
    )
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    marketplace
      .browse({ page: 1, page_size: 6 })
      .then((res) => setProducts(res.items ?? []))
      .catch(() => setProducts([]))
      .finally(() => setIsLoading(false))
  }, [])

  // Don't render the section at all if API returned nothing and we're done loading
  if (!isLoading && products.length === 0) return null

  return (
    <section id="catalog" ref={ref} className="bg-white py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div
          className={`flex flex-col sm:flex-row sm:items-end sm:justify-between mb-12 gap-6 ${
            isVisible ? "animate-fade-up" : "opacity-0"
          }`}
        >
          <div>
            <span className="text-ocean text-xs font-semibold tracking-[0.15em] uppercase mb-4 block">
              LIVE LISTINGS
            </span>
            <h2
              className="text-navy font-extrabold mb-3"
              style={{ fontSize: "clamp(28px, 4vw, 40px)", letterSpacing: "-0.03em" }}
            >
              Featured Assets
            </h2>
            <p className="text-text-secondary text-base max-w-lg">
              Verified, active listings available right now. Sign in to contact sellers or submit an offer.
            </p>
          </div>
          <Link href="/login">
            <Button
              variant="outline"
              className="border-border text-text-primary hover:bg-white hover:border-ocean transition-all hover:-translate-y-0.5 self-start sm:self-auto"
            >
              View All Listings
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </Link>
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {products.map((item, index) => (
              <ProductCard key={item.id} item={item} index={index} visible={isVisible} />
            ))}
          </div>
        )}

        {/* CTA row */}
        {!isLoading && products.length > 0 && (
          <div className={`mt-12 text-center ${isVisible ? "animate-fade-up" : "opacity-0"}`}>
            <p className="text-text-secondary text-sm mb-4">
              Showing {products.length} of many active listings. Log in to see the full marketplace.
            </p>
            <Link href="/signup/buyer">
              <Button className="bg-ocean hover:bg-ocean-dark text-white px-8 py-5 text-sm font-semibold transition-all hover:-translate-y-0.5">
                Create Free Account to Browse All
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>
        )}
      </div>
    </section>
  )
}
