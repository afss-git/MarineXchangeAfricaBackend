"use client"

import Image from "next/image"
import { CheckCircle } from "lucide-react"

interface AuthLeftPanelProps {
  heading: string
  description: string
  benefits: string[]
}

export function AuthLeftPanel({ heading, description, benefits }: AuthLeftPanelProps) {
  return (
    <div className="relative hidden lg:flex lg:w-1/2 flex-col justify-center px-12 xl:px-20 bg-navy overflow-hidden">
      {/* Grid Pattern Overlay */}
      <div className="absolute inset-0 grid-pattern" />

      {/* Radial Glow */}
      <div
        className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full"
        style={{
          background: 'radial-gradient(circle at center, rgba(14, 165, 233, 0.08) 0%, transparent 70%)',
          transform: 'translate(30%, -30%)'
        }}
      />

      <div className="relative z-10 max-w-md">
        {/* Logo */}
        <div className="flex items-center gap-2 mb-12">
          <div className="w-10 h-10 rounded-lg overflow-hidden flex items-center justify-center bg-white/15">
            <Image src="/logo.jpeg" alt="Harbours360" width={40} height={40} className="w-full h-full object-contain" />
          </div>
          <div className="flex flex-col">
            <span className="text-xl font-bold tracking-tight">
              <span className="text-white">Harbours</span>
              <span className="text-ocean">360</span>
            </span>
          </div>
        </div>

        {/* Heading */}
        <h1 className="text-white text-3xl xl:text-4xl font-bold leading-tight mb-4 text-balance">
          {heading}
        </h1>

        {/* Description */}
        <p className="text-white/70 text-base leading-relaxed mb-10">
          {description}
        </p>

        {/* Benefits List */}
        <ul className="space-y-4">
          {benefits.map((benefit, index) => (
            <li key={index} className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-ocean shrink-0 mt-0.5" />
              <span className="text-white/80 text-sm">{benefit}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
