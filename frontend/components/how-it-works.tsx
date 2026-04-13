"use client"

import { useEffect, useRef, useState } from "react"
import { Search, Handshake, ShieldCheck } from "lucide-react"

const steps = [
  {
    number: 1,
    icon: Search,
    title: "Browse & Discover",
    description: "Search verified maritime listings by category, price range, and location across Africa."
  },
  {
    number: 2,
    icon: Handshake,
    title: "Connect & Negotiate",
    description: "Submit purchase requests, receive counter-offers, or participate in live auction events."
  },
  {
    number: 3,
    icon: ShieldCheck,
    title: "Transact Securely",
    description: "Managed payment schedules, digital document signing, and end-to-end deal tracking."
  }
]

export function HowItWorks() {
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
    <section id="how-it-works" ref={ref} className="bg-white py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className={`text-center mb-16 ${isVisible ? "animate-fade-up" : "opacity-0"}`}>
          <span className="text-ocean text-xs font-semibold tracking-[0.15em] uppercase mb-4 block">
            THE PROCESS
          </span>
          <h2 
            className="text-navy font-extrabold mb-4"
            style={{ fontSize: 'clamp(28px, 4vw, 40px)', letterSpacing: '-0.03em' }}
          >
            <span className="text-balance">How Harbours360 Works</span>
          </h2>
          <p className="text-text-secondary text-base max-w-xl mx-auto">
            A streamlined process to buy or sell high-value maritime and industrial assets.
          </p>
        </div>

        {/* Cards */}
        <div className="grid md:grid-cols-3 gap-6">
          {steps.map((step, index) => (
            <div
              key={index}
              className={`bg-white rounded-2xl border border-border p-8 transition-all duration-300 hover:border-ocean hover:-translate-y-1 group ${
                isVisible ? `animate-fade-up delay-${index + 2}` : "opacity-0"
              }`}
              style={{
                boxShadow: 'none',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = '0 8px 32px rgba(14, 165, 233, 0.08)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              {/* Step Number */}
              <div className="w-9 h-9 rounded-lg bg-ocean/8 flex items-center justify-center mb-6">
                <span className="text-ocean font-extrabold text-sm">{step.number}</span>
              </div>

              {/* Icon */}
              <step.icon className="w-10 h-10 text-ocean mb-5" />

              {/* Title */}
              <h3 className="text-navy font-bold text-lg mb-3" style={{ letterSpacing: '-0.02em' }}>
                {step.title}
              </h3>

              {/* Description */}
              <p className="text-text-secondary text-sm leading-relaxed">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
