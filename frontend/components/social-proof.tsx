"use client"

import { useEffect, useRef, useState } from "react"
import { Quote } from "lucide-react"

const testimonials = [
  {
    quote:
      "We listed a 4,200 DWT cargo barge and had a qualified buyer within three weeks. The KYC process gave us confidence that we were dealing with a serious counterparty.",
    name: "Adeyemi Okafor",
    title: "Fleet Manager",
    company: "West African Bulk Carriers",
    country: "Nigeria",
    initials: "AO",
  },
  {
    quote:
      "As a buyer, the escrow arrangement was the deciding factor. Knowing funds were protected until delivery conditions were confirmed made a $1.8M transaction feel manageable.",
    name: "Kofi Mensah",
    title: "Procurement Director",
    company: "Gulf of Guinea Offshore Ltd",
    country: "Ghana",
    initials: "KM",
  },
  {
    quote:
      "The auction feature helped us achieve a sale price 12% above our reserve. The process was transparent and the documentation was handled entirely on the platform.",
    name: "Fatima Al-Rashid",
    title: "Chief Operating Officer",
    company: "Red Sea Marine Services",
    country: "Egypt",
    initials: "FA",
  },
]

const countries = [
  "Nigeria", "Ghana", "Kenya", "South Africa",
  "Egypt", "Tanzania", "Côte d'Ivoire", "Cameroon",
  "Senegal", "Angola", "Mozambique", "Ethiopia",
]

export function SocialProof() {
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
    <section ref={ref} className="bg-white py-24 border-t border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Header */}
        <div className={`text-center mb-16 ${visible ? "animate-fade-up" : "opacity-0"}`}>
          <span className="text-ocean text-xs font-semibold tracking-[0.15em] uppercase mb-4 block">
            TRUSTED ACROSS AFRICA
          </span>
          <h2
            className="text-navy font-extrabold mb-4"
            style={{ fontSize: "clamp(26px, 3.5vw, 38px)", letterSpacing: "-0.03em" }}
          >
            Companies Transacting on Harbours<span className="text-ocean">360</span>
          </h2>
          {/* Country marquee strip */}
          <div className="relative overflow-hidden mt-6 py-1">
            <div className="flex gap-3 animate-marquee whitespace-nowrap w-max">
              {[...countries, ...countries].map((country, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium text-text-secondary bg-surface border border-border"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-ocean/50 shrink-0" />
                  {country}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Testimonial cards */}
        <div className="grid md:grid-cols-3 gap-6">
          {testimonials.map((t, index) => (
            <div
              key={index}
              className={`bg-surface rounded-2xl border border-border p-7 flex flex-col gap-5 hover:border-ocean/30 transition-colors duration-200 ${
                visible ? `animate-fade-up delay-${index + 2}` : "opacity-0"
              }`}
            >
              <Quote className="w-6 h-6 text-ocean/30 shrink-0" />

              <p className="text-text-primary text-sm leading-relaxed flex-1">
                &ldquo;{t.quote}&rdquo;
              </p>

              <div className="flex items-center gap-3 pt-3 border-t border-border">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-extrabold text-white shrink-0"
                  style={{ background: "linear-gradient(135deg, #0F2A44 0%, #0EA5E9 100%)" }}
                >
                  {t.initials}
                </div>
                <div className="min-w-0">
                  <p className="text-text-primary text-sm font-bold truncate">{t.name}</p>
                  <p className="text-text-secondary text-xs truncate">{t.title} · {t.company}</p>
                </div>
                <span className="ml-auto text-[10px] font-semibold text-ocean bg-ocean/8 px-2 py-0.5 rounded-full shrink-0">
                  {t.country}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
