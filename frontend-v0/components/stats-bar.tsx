"use client"

import { useEffect, useRef, useState } from "react"

const stats = [
  { value: "$250M+", label: "Assets Listed" },
  { value: "500+", label: "Verified Companies" },
  { value: "15+", label: "Countries Active" },
  { value: "98.5%", label: "Transaction Success" },
]

export function StatsBar() {
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
    <section ref={ref} className="bg-white border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {stats.map((stat, index) => (
            <div
              key={index}
              className={`py-10 px-6 text-center ${
                index !== stats.length - 1 ? "lg:border-r border-border" : ""
              } ${index === 0 || index === 2 ? "border-r border-border lg:border-r" : ""} ${
                index < 2 ? "border-b border-border lg:border-b-0" : ""
              } ${isVisible ? `animate-fade-up delay-${index + 1}` : "opacity-0"}`}
            >
              <div 
                className="text-navy font-extrabold mb-1"
                style={{ fontSize: 'clamp(28px, 3vw, 36px)' }}
              >
                {stat.value}
              </div>
              <div className="text-text-secondary text-[13px] font-medium">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
