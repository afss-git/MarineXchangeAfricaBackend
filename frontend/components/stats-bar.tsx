"use client"

import { useEffect, useRef, useState } from "react"

const stats = [
  { value: 250, suffix: "M+", prefix: "$", label: "Assets Listed" },
  { value: 500, suffix: "+", prefix: "", label: "Verified Companies" },
  { value: 15, suffix: "+", prefix: "", label: "Countries Active" },
  { value: 98.5, suffix: "%", prefix: "", label: "Transaction Success", decimals: 1 },
]

function useCounter(target: number, decimals = 0, active: boolean) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!active) return
    const duration = 1600
    const steps = 50
    const interval = duration / steps
    const increment = target / steps
    let current = 0
    const timer = setInterval(() => {
      current += increment
      if (current >= target) {
        setCount(target)
        clearInterval(timer)
      } else {
        setCount(parseFloat(current.toFixed(decimals)))
      }
    }, interval)
    return () => clearInterval(timer)
  }, [active, target, decimals])

  return count
}

function StatItem({
  stat,
  visible,
  index,
}: {
  stat: (typeof stats)[0]
  visible: boolean
  index: number
}) {
  const count = useCounter(stat.value, stat.decimals ?? 0, visible)
  const isLast = index === stats.length - 1

  return (
    <div
      className={`py-10 px-6 text-center ${
        !isLast ? "lg:border-r border-border" : ""
      } ${index === 0 || index === 2 ? "border-r border-border lg:border-r" : ""} ${
        index < 2 ? "border-b border-border lg:border-b-0" : ""
      } ${visible ? `animate-fade-up delay-${index + 1}` : "opacity-0"}`}
    >
      <div
        className="text-navy font-extrabold mb-1 tabular-nums"
        style={{ fontSize: "clamp(28px, 3vw, 36px)" }}
      >
        {stat.prefix}
        {stat.decimals ? count.toFixed(stat.decimals) : Math.round(count).toLocaleString()}
        {stat.suffix}
      </div>
      <div className="text-text-secondary text-[13px] font-medium">{stat.label}</div>
    </div>
  )
}

export function StatsBar() {
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.2 }
    )
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  return (
    <section ref={ref} className="bg-white border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {stats.map((stat, index) => (
            <StatItem key={index} stat={stat} visible={visible} index={index} />
          ))}
        </div>
      </div>
    </section>
  )
}
