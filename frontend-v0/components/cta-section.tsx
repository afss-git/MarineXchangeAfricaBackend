"use client"

import { useEffect, useRef, useState } from "react"
import { Anchor } from "lucide-react"
import { Button } from "@/components/ui/button"

export function CTASection() {
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
    <section 
      ref={ref} 
      className="relative py-24 overflow-hidden"
      style={{ background: 'linear-gradient(165deg, #0F2A44 0%, #091B2E 100%)' }}
    >
      {/* Radial Glow */}
      <div 
        className="absolute bottom-0 left-1/2 w-[1000px] h-[500px]"
        style={{
          background: 'radial-gradient(ellipse at center bottom, rgba(14, 165, 233, 0.06) 0%, transparent 70%)',
          transform: 'translateX(-50%)'
        }}
      />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-[680px] mx-auto text-center">
          {/* Icon */}
          <div className={`mb-8 ${isVisible ? "animate-fade-up" : "opacity-0"}`}>
            <Anchor className="w-10 h-10 text-white mx-auto" />
          </div>

          {/* Heading */}
          <h2 
            className={`text-white font-extrabold mb-4 ${isVisible ? "animate-fade-up delay-1" : "opacity-0"}`}
            style={{ fontSize: 'clamp(28px, 4vw, 42px)', letterSpacing: '-0.03em' }}
          >
            Ready to Trade?
          </h2>

          {/* Subtext */}
          <p className={`text-white/55 text-base sm:text-lg mb-10 max-w-lg mx-auto ${isVisible ? "animate-fade-up delay-2" : "opacity-0"}`}>
            {"Join 500+ companies already transacting on Africa's most trusted maritime marketplace."}
          </p>

          {/* Buttons */}
          <div className={`flex flex-wrap justify-center gap-4 ${isVisible ? "animate-fade-up delay-3" : "opacity-0"}`}>
            <Button 
              size="lg" 
              className="bg-ocean hover:bg-ocean-dark text-white px-8 py-6 text-base font-semibold transition-all hover:-translate-y-0.5"
            >
              Create Buyer Account
            </Button>
            <Button 
              size="lg" 
              variant="outline"
              className="border-white/30 text-white bg-transparent hover:bg-white/10 px-8 py-6 text-base font-semibold transition-all hover:-translate-y-0.5"
            >
              Register as Seller
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
