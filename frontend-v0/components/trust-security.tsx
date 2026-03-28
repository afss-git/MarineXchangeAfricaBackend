"use client"

import { useEffect, useRef, useState } from "react"
import { UserCheck, Lock, FileText } from "lucide-react"

const features = [
  {
    icon: UserCheck,
    title: "KYC Verified",
    description: "Every buyer and seller is identity-verified before they can transact. Multi-layered compliance checks for regulated markets."
  },
  {
    icon: Lock,
    title: "Escrow-Protected",
    description: "Managed payment milestones protect both parties. Funds are released only when delivery conditions are met."
  },
  {
    icon: FileText,
    title: "Full Audit Trail",
    description: "Every action is logged — from listing to handover. Complete transaction transparency for compliance and dispute resolution."
  }
]

export function TrustSecurity() {
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
    <section ref={ref} className="bg-white py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className={`text-center mb-16 ${isVisible ? "animate-fade-up" : "opacity-0"}`}>
          <span className="text-ocean text-xs font-semibold tracking-[0.15em] uppercase mb-4 block">
            SECURITY
          </span>
          <h2 
            className="text-navy font-extrabold mb-4"
            style={{ fontSize: 'clamp(28px, 4vw, 40px)', letterSpacing: '-0.03em' }}
          >
            <span className="text-balance">Enterprise-Grade Trust Infrastructure</span>
          </h2>
          <p className="text-text-secondary text-base max-w-xl mx-auto">
            Built for high-value transactions with security and compliance at every step.
          </p>
        </div>

        {/* Feature Cards */}
        <div className="grid md:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <div
              key={index}
              className={`bg-surface rounded-2xl border border-border p-8 text-center ${
                isVisible ? `animate-fade-up delay-${index + 2}` : "opacity-0"
              }`}
            >
              {/* Icon Container */}
              <div className="w-[52px] h-[52px] rounded-xl bg-navy/4 flex items-center justify-center mx-auto mb-6">
                <feature.icon className="w-6 h-6 text-navy" />
              </div>

              {/* Title */}
              <h3 className="text-navy font-bold text-lg mb-3" style={{ letterSpacing: '-0.02em' }}>
                {feature.title}
              </h3>

              {/* Description */}
              <p className="text-text-secondary text-sm leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
