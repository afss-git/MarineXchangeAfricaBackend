"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import Image from "next/image"
import { Menu, X } from "lucide-react"
import { Button } from "@/components/ui/button"

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 10)
    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  const linkClass = isScrolled
    ? "text-text-secondary hover:text-navy"
    : "text-white/75 hover:text-white"

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled
          ? "bg-white/96 backdrop-blur-md border-b border-border shadow-sm"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center bg-white/10">
              <Image src="/logo.jpeg" alt="Harbours360" width={32} height={32} className="w-full h-full object-contain" />
            </div>
            <span className="font-extrabold text-lg tracking-tight leading-none">
              <span className={`transition-colors duration-300 ${isScrolled ? "text-navy" : "text-white"}`}>Harbours</span>
              <span className="text-ocean">360</span>
            </span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-1">
            <Link href="/listings" className={`transition-colors duration-300 text-sm font-medium px-3 py-2 rounded-lg hover:bg-black/5 ${linkClass}`}>
              Listings
            </Link>
            <a href="#how-it-works" className={`transition-colors duration-300 text-sm font-medium px-3 py-2 rounded-lg hover:bg-black/5 ${linkClass}`}>
              How It Works
            </a>
            <a href="#services" className={`transition-colors duration-300 text-sm font-medium px-3 py-2 rounded-lg hover:bg-black/5 ${linkClass}`}>
              Services
            </a>
            <a href="#faq" className={`transition-colors duration-300 text-sm font-medium px-3 py-2 rounded-lg hover:bg-black/5 ${linkClass}`}>
              FAQ
            </a>
            <a href="#enquiry" className={`transition-colors duration-300 text-sm font-medium px-3 py-2 rounded-lg hover:bg-black/5 ${linkClass}`}>
              Contact
            </a>
          </div>

          {/* Desktop auth */}
          <div className="hidden md:flex items-center gap-2">
            <Link href="/login">
              <Button
                variant="outline"
                size="sm"
                className={`transition-all duration-300 text-sm ${
                  isScrolled
                    ? "border-border text-text-primary hover:bg-surface"
                    : "border-white/25 text-white bg-transparent hover:bg-white/10"
                }`}
              >
                Log In
              </Button>
            </Link>
            <Link href="/signup/buyer">
              <Button size="sm" className="bg-ocean hover:bg-ocean-dark text-white text-sm transition-all hover:-translate-y-px">
                Get Started
              </Button>
            </Link>
          </div>

          {/* Mobile toggle */}
          <button
            className={`md:hidden p-2 rounded-lg transition-colors ${isScrolled ? "text-navy hover:bg-surface" : "text-white hover:bg-white/10"}`}
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Toggle menu"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile menu */}
        {isMobileMenuOpen && (
          <div className={`md:hidden py-4 border-t space-y-1 ${isScrolled ? "border-border" : "border-white/15"}`}>
            {[
              { label: "Listings", href: "/listings", isLink: true },
              { label: "How It Works", href: "#how-it-works", isLink: false },
              { label: "Services", href: "#services", isLink: false },
              { label: "FAQ", href: "#faq", isLink: false },
              { label: "Contact", href: "#enquiry", isLink: false },
            ].map(item => (
              item.isLink
                ? <Link key={item.label} href={item.href} onClick={() => setIsMobileMenuOpen(false)}
                    className={`block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${linkClass}`}>
                    {item.label}
                  </Link>
                : <a key={item.label} href={item.href} onClick={() => setIsMobileMenuOpen(false)}
                    className={`block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${linkClass}`}>
                    {item.label}
                  </a>
            ))}
            <div className="pt-3 flex flex-col gap-2">
              <Link href="/login" onClick={() => setIsMobileMenuOpen(false)}>
                <Button variant="outline" className={`w-full ${isScrolled ? "border-border text-text-primary" : "border-white/25 text-white bg-transparent"}`}>
                  Log In
                </Button>
              </Link>
              <Link href="/signup/buyer" onClick={() => setIsMobileMenuOpen(false)}>
                <Button className="bg-ocean hover:bg-ocean-dark text-white w-full">Get Started</Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </nav>
  )
}
