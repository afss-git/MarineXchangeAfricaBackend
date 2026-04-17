"use client"

import { useEffect, useRef, useState } from "react"
import { ShieldCheck, Gavel, FileSignature, BarChart3, UserCheck, PackageSearch } from "lucide-react"

const services = [
  {
    number: "01",
    icon: PackageSearch,
    title: "Asset Listing & Verification",
    description:
      "Every listing goes through our multi-step verification process. Sellers submit documentation; our agents confirm asset details, ownership, and condition before any listing goes live.",
  },
  {
    number: "02",
    icon: UserCheck,
    title: "KYC & Compliance Management",
    description:
      "Buyers and sellers are identity-verified before transacting. We handle regulatory compliance across 15+ African markets so you can focus on the deal.",
  },
  {
    number: "03",
    icon: ShieldCheck,
    title: "Escrow-Protected Payments",
    description:
      "Funds are held in managed escrow and released only when delivery conditions are met. Milestone-based payment schedules protect both parties throughout the transaction.",
  },
  {
    number: "04",
    icon: Gavel,
    title: "Auction Platform",
    description:
      "Run competitive, time-bound auctions for high-value assets. Transparent bidding, reserve price controls, and real-time notifications keep every participant informed.",
  },
  {
    number: "05",
    icon: FileSignature,
    title: "Deal Documentation & Signing",
    description:
      "Digital document workflows handle purchase agreements, inspection reports, and handover certificates — all with a complete audit trail for compliance and dispute resolution.",
  },
  {
    number: "06",
    icon: BarChart3,
    title: "Market Intelligence & Reports",
    description:
      "Access pricing benchmarks, transaction history, and asset availability data across African maritime markets. Make informed decisions backed by verified deal data.",
  },
]

export function ServicesSection() {
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) { setVisible(true); observer.disconnect() }
      },
      { threshold: 0.1 }
    )
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  return (
    <section id="services" ref={ref} className="bg-surface py-16 sm:py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Header */}
        <div className={`mb-10 sm:mb-16 ${visible ? "animate-fade-up" : "opacity-0"}`}>
          <span className="text-ocean text-xs font-semibold tracking-[0.15em] uppercase mb-4 block">
            WHAT WE OFFER
          </span>
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <h2
              className="text-navy font-extrabold max-w-lg"
              style={{ fontSize: "clamp(28px, 4vw, 40px)", letterSpacing: "-0.03em" }}
            >
              Built for High-Value Maritime Transactions
            </h2>
            <p className="text-text-secondary text-sm max-w-xs sm:text-right leading-relaxed">
              Every service is designed around the complexity and stakes of Africa&apos;s maritime and industrial sector.
            </p>
          </div>
        </div>

        {/* Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border rounded-2xl overflow-hidden border border-border">
          {services.map((service, index) => {
            const Icon = service.icon
            return (
              <div
                key={index}
                className={`bg-white p-6 sm:p-8 flex flex-col gap-5 group hover:bg-surface transition-colors duration-200 ${
                  visible ? `animate-fade-up delay-${Math.min(index + 1, 6)}` : "opacity-0"
                }`}
              >
                {/* Number + Icon row */}
                <div className="flex items-start justify-between">
                  <span
                    className="font-extrabold text-[13px] tabular-nums"
                    style={{ color: "rgba(14,165,233,0.5)", letterSpacing: "0.05em" }}
                  >
                    {service.number}
                  </span>
                  <div className="w-10 h-10 rounded-xl bg-navy/4 flex items-center justify-center group-hover:bg-ocean/8 transition-colors">
                    <Icon className="w-5 h-5 text-navy group-hover:text-ocean transition-colors" />
                  </div>
                </div>

                {/* Text */}
                <div>
                  <h3
                    className="text-navy font-bold text-base mb-2 group-hover:text-ocean transition-colors"
                    style={{ letterSpacing: "-0.015em" }}
                  >
                    {service.title}
                  </h3>
                  <p className="text-text-secondary text-sm leading-relaxed">
                    {service.description}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
