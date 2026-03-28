"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Ship, Sailboat, Package, Settings, Wrench, Anchor, ChevronRight, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { marketplace, type CategoryResponse } from "@/lib/api"

// Fallback icon map by keyword
const categoryIconMap: Record<string, React.ElementType> = {
  vessel: Ship,
  ship: Ship,
  offshore: Ship,
  tug: Sailboat,
  barge: Sailboat,
  cargo: Package,
  engine: Settings,
  equipment: Wrench,
  industrial: Wrench,
  port: Anchor,
  terminal: Anchor,
}

function getCategoryIcon(name: string): React.ElementType {
  const lower = name.toLowerCase()
  for (const [key, Icon] of Object.entries(categoryIconMap)) {
    if (lower.includes(key)) return Icon
  }
  return Package
}

// Static fallback if API returns nothing
const staticCategories = [
  { id: "", name: "Offshore Vessels", count: null },
  { id: "", name: "Tugboats & Barges", count: null },
  { id: "", name: "Cargo Ships", count: null },
  { id: "", name: "Marine Engines", count: null },
  { id: "", name: "Industrial Equipment", count: null },
  { id: "", name: "Port & Terminal", count: null },
]

export function AssetCategories() {
  const [isVisible, setIsVisible] = useState(false)
  const [categories, setCategories] = useState<CategoryResponse[]>([])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.2 }
    )
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    marketplace
      .getCategories()
      .then((cats) => setCategories(cats.slice(0, 6)))
      .catch(() => {/* use static fallback */})
  }, [])

  const displayItems = categories.length > 0
    ? categories.map((c) => ({ id: c.id, name: c.name }))
    : staticCategories.map((c) => ({ id: c.id, name: c.name }))

  return (
    <section ref={ref} className="bg-surface py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className={`flex flex-col sm:flex-row sm:items-end sm:justify-between mb-12 gap-6 ${isVisible ? "animate-fade-up" : "opacity-0"}`}>
          <div>
            <span className="text-ocean text-xs font-semibold tracking-[0.15em] uppercase mb-4 block">
              MARKETPLACE
            </span>
            <h2
              className="text-navy font-extrabold mb-3"
              style={{ fontSize: 'clamp(28px, 4vw, 40px)', letterSpacing: '-0.03em' }}
            >
              What You Can Trade
            </h2>
            <p className="text-text-secondary text-base max-w-lg">
              From offshore vessels to industrial equipment, find the assets your business needs.
            </p>
          </div>
          <a href="#catalog">
            <Button
              variant="outline"
              className="border-border text-text-primary hover:bg-white hover:border-ocean transition-all hover:-translate-y-0.5 self-start sm:self-auto"
            >
              Browse Live Listings
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </a>
        </div>

        {/* Category Cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayItems.map((category, index) => {
            const Icon = getCategoryIcon(category.name)
            const href = category.id
              ? `/login?hint=Browse ${encodeURIComponent(category.name)}`
              : "/login"
            return (
              <Link
                key={category.id || index}
                href={href}
                className={`bg-white rounded-xl border border-border p-6 flex items-center gap-4 transition-all duration-300 hover:border-ocean hover:-translate-y-[3px] cursor-pointer group ${
                  isVisible ? `animate-fade-up delay-${Math.min(index + 1, 6)}` : "opacity-0"
                }`}
                style={{ boxShadow: "none" }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.boxShadow = "0 12px 32px rgba(15, 42, 68, 0.08)"
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.boxShadow = "none"
                }}
              >
                {/* Icon Container */}
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{
                    background: 'linear-gradient(135deg, rgba(15, 42, 68, 0.03) 0%, rgba(14, 165, 233, 0.06) 100%)'
                  }}
                >
                  <Icon className="w-6 h-6 text-ocean" />
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <h3 className="text-navy font-bold text-base mb-0.5 group-hover:text-ocean transition-colors" style={{ letterSpacing: '-0.01em' }}>
                    {category.name}
                  </h3>
                  <p className="text-text-secondary text-sm">Browse listings</p>
                </div>

                {/* Chevron */}
                <ChevronRight className="w-5 h-5 text-text-secondary/40 flex-shrink-0 group-hover:text-ocean transition-colors" />
              </Link>
            )
          })}
        </div>
      </div>
    </section>
  )
}
