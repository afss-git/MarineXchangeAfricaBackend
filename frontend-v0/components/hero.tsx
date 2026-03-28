"use client"

import { useEffect, useState } from "react"
import { ArrowRight, Ship, CheckCircle } from "lucide-react"
import { Button } from "@/components/ui/button"

export function Hero() {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    setIsVisible(true)
  }, [])

  return (
    <section className="relative min-h-screen pt-16 overflow-hidden bg-gradient-to-br from-navy via-navy to-navy-dark" style={{ backgroundImage: 'linear-gradient(165deg, #0F2A44 0%, #091B2E 100%)' }}>
      {/* Grid Pattern Overlay */}
      <div className="absolute inset-0 grid-pattern" />
      
      {/* Radial Glow */}
      <div 
        className="absolute top-0 right-0 w-[800px] h-[800px] rounded-full"
        style={{
          background: 'radial-gradient(circle at center, rgba(14, 165, 233, 0.1) 0%, transparent 70%)',
          transform: 'translate(20%, -20%)'
        }}
      />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-32">
        <div className="max-w-[680px]">
          {/* Badge */}
          <div 
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-full mb-8 ${
              isVisible ? "animate-fade-up" : "opacity-0"
            }`}
            style={{
              backgroundColor: 'rgba(14, 165, 233, 0.12)',
              border: '1px solid rgba(14, 165, 233, 0.25)'
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-ocean animate-pulse-dot" />
            <span className="text-ocean text-sm font-medium">Now live in 15+ African markets</span>
          </div>

          {/* Heading */}
          <h1 
            className={`text-white font-extrabold leading-[1.1] mb-6 ${
              isVisible ? "animate-fade-up delay-1" : "opacity-0"
            }`}
            style={{ 
              fontSize: 'clamp(34px, 5vw, 56px)',
              letterSpacing: '-0.03em'
            }}
          >
            <span className="text-balance">{"Africa's Premier Marketplace for Maritime & Industrial Assets"}</span>
          </h1>

          {/* Subheading */}
          <p 
            className={`text-white/60 text-base sm:text-lg max-w-[540px] mb-10 leading-relaxed ${
              isVisible ? "animate-fade-up delay-2" : "opacity-0"
            }`}
          >
            Buy and sell vessels, offshore equipment, and industrial machinery with confidence. 
            Verified listings, secure transactions, trusted by companies across Africa.
          </p>

          {/* Buttons */}
          <div 
            className={`flex flex-wrap gap-4 mb-16 ${
              isVisible ? "animate-fade-up delay-3" : "opacity-0"
            }`}
          >
            <Button 
              size="lg" 
              className="bg-ocean hover:bg-ocean-dark text-white px-8 py-6 text-base font-semibold transition-all hover:-translate-y-0.5"
            >
              Start Buying
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
            <Button 
              size="lg" 
              variant="outline"
              className="border-white/30 text-white bg-transparent hover:bg-white/10 px-8 py-6 text-base font-semibold transition-all hover:-translate-y-0.5"
            >
              List Your Assets
            </Button>
          </div>

          {/* Preview Cards */}
          <div 
            className={`flex flex-wrap gap-4 ${
              isVisible ? "animate-fade-up delay-4" : "opacity-0"
            }`}
          >
            {[
              { name: "Offshore Supply Vessel", price: "$2.4M", icon: Ship },
              { name: "Industrial Crane", price: "$850K", icon: Ship },
              { name: "Cargo Barge", price: "$1.2M", icon: Ship },
            ].map((item, index) => (
              <div
                key={index}
                className="flex items-center gap-3 px-4 py-3 rounded-xl backdrop-blur-sm"
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.08)'
                }}
              >
                <div className="w-10 h-10 rounded-lg bg-ocean/20 flex items-center justify-center">
                  <item.icon className="w-5 h-5 text-ocean" />
                </div>
                <div className="flex flex-col">
                  <span className="text-white/80 text-sm font-medium">{item.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-white font-bold">{item.price}</span>
                    <span className="inline-flex items-center gap-1 text-ocean text-xs">
                      <CheckCircle className="w-3 h-3" />
                      Verified
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
