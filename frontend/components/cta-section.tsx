"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"

const highlights = [
  "KYC-verified counterparties",
  "Escrow-protected payments",
  "Full audit trail on every deal",
  "15+ active African markets",
]

export function CTASection() {
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) { setVisible(true); observer.disconnect() }
      },
      { threshold: 0.2 }
    )
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  return (
    <section
      ref={ref}
      className="relative py-16 sm:py-24 overflow-hidden"
      style={{ background: "linear-gradient(165deg, #0F2A44 0%, #091B2E 100%)" }}
    >
      {/* Grid pattern */}
      <div className="absolute inset-0 grid-pattern opacity-60" />

      {/* Glow */}
      <div
        className="absolute bottom-0 left-1/2 w-full h-72 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at center bottom, rgba(14,165,233,0.08) 0%, transparent 70%)",
          transform: "translateX(-50%)",
        }}
      />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-[1fr_auto] gap-12 items-center">

          {/* Left */}
          <div>
            <div className={`${visible ? "animate-fade-up" : "opacity-0"}`}>
              <span
                className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold text-ocean mb-6"
                style={{ backgroundColor: "rgba(14,165,233,0.1)", border: "1px solid rgba(14,165,233,0.22)" }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-ocean animate-pulse-dot" />
                Open for business
              </span>

              <h2
                className="text-white font-extrabold leading-[1.1] mb-5"
                style={{ fontSize: "clamp(28px, 4vw, 48px)", letterSpacing: "-0.035em" }}
              >
                Your Next Major Maritime Deal <br className="hidden sm:block" />
                <span className="text-ocean">Starts Here</span>
              </h2>

              <p className="text-white/50 text-base max-w-lg leading-relaxed mb-8">
                Join 500+ companies already transacting on Africa&apos;s most trusted maritime and industrial marketplace.
              </p>

              {/* Highlight list */}
              <ul className="space-y-2.5 mb-10">
                {highlights.map((item, i) => (
                  <li key={i} className="flex items-center gap-2.5 text-white/70 text-sm">
                    <span className="w-4 h-4 rounded-full bg-ocean/20 border border-ocean/30 flex items-center justify-center shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-ocean" />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className={`flex flex-col sm:flex-row gap-3 ${visible ? "animate-fade-up delay-2" : "opacity-0"}`}>
              <Link href="/signup/buyer" className="w-full sm:w-auto">
                <Button
                  size="lg"
                  className="w-full sm:w-auto bg-ocean hover:bg-ocean-dark text-white px-7 font-semibold transition-all hover:-translate-y-0.5 gap-2"
                >
                  Create Buyer Account
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
              <Link href="/signup/seller" className="w-full sm:w-auto">
                <Button
                  size="lg"
                  variant="outline"
                  className="w-full sm:w-auto border-white/25 text-white bg-transparent hover:bg-white/8 px-7 font-semibold transition-all hover:-translate-y-0.5"
                >
                  Register as Seller
                </Button>
              </Link>
            </div>
          </div>

          {/* Right — stat callout */}
          <div className={`hidden lg:flex flex-col gap-4 min-w-56 ${visible ? "animate-fade-up delay-3" : "opacity-0"}`}>
            {[
              { value: "$250M+", label: "Total asset value on platform" },
              { value: "98.5%", label: "Transaction success rate" },
              { value: "< 3 days", label: "Average KYC turnaround" },
            ].map((item, i) => (
              <div
                key={i}
                className="rounded-2xl px-6 py-5"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <p className="text-white font-extrabold text-2xl mb-0.5" style={{ letterSpacing: "-0.03em" }}>
                  {item.value}
                </p>
                <p className="text-white/45 text-xs">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
