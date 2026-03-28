"use client"

import { useEffect, useRef, useState } from "react"
import { Ship, Sailboat, Package, Settings, Wrench, Anchor, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"

const categories = [
  { name: "Offshore Vessels", icon: Ship, count: 48 },
  { name: "Tugboats & Barges", icon: Sailboat, count: 35 },
  { name: "Cargo Ships", icon: Package, count: 27 },
  { name: "Marine Engines", icon: Settings, count: 63 },
  { name: "Industrial Equipment", icon: Wrench, count: 41 },
  { name: "Port & Terminal", icon: Anchor, count: 19 },
]

export function AssetCategories() {
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
      { threshold: 0.2 }
    )

    if (ref.current) {
      observer.observe(ref.current)
    }

    return () => observer.disconnect()
  }, [])

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
          <Button 
            variant="outline" 
            className="border-border text-text-primary hover:bg-white hover:border-ocean transition-all hover:-translate-y-0.5 self-start sm:self-auto"
          >
            View All Categories
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>

        {/* Category Cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories.map((category, index) => (
            <div
              key={index}
              className={`bg-white rounded-xl border border-border p-6 flex items-center gap-4 transition-all duration-300 hover:border-ocean hover:-translate-y-[3px] cursor-pointer group ${
                isVisible ? `animate-fade-up delay-${Math.min(index + 1, 6)}` : "opacity-0"
              }`}
              style={{ boxShadow: 'none' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = '0 12px 32px rgba(15, 42, 68, 0.08)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              {/* Icon Container */}
              <div 
                className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{
                  background: 'linear-gradient(135deg, rgba(15, 42, 68, 0.03) 0%, rgba(14, 165, 233, 0.06) 100%)'
                }}
              >
                <category.icon className="w-6 h-6 text-ocean" />
              </div>

              {/* Text */}
              <div className="flex-1 min-w-0">
                <h3 className="text-navy font-bold text-base mb-0.5" style={{ letterSpacing: '-0.01em' }}>
                  {category.name}
                </h3>
                <p className="text-text-secondary text-sm">
                  {category.count} listings
                </p>
              </div>

              {/* Chevron */}
              <ChevronRight className="w-5 h-5 text-text-secondary/40 flex-shrink-0 group-hover:text-ocean transition-colors" />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
