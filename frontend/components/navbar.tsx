"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Anchor, ArrowRight, Menu, X } from "lucide-react"
import { Button } from "@/components/ui/button"

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10)
    }
    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled
          ? "bg-white/95 backdrop-blur-md border-b border-border shadow-sm"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <div className="relative w-8 h-8 flex items-center justify-center">
              <Anchor className={`w-5 h-5 transition-colors duration-300 ${isScrolled ? "text-navy" : "text-white"}`} />
              <ArrowRight className="w-3 h-3 text-ocean absolute -right-0.5 -top-0.5" />
            </div>
            <div className="flex flex-col">
              <div className="flex items-baseline tracking-tight">
                <span className={`font-extrabold text-lg transition-colors duration-300 ${isScrolled ? "text-navy" : "text-white"}`}>Harbours</span>
                <span className="text-ocean font-extrabold text-lg">360</span>
              </div>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-4">
            <a
              href="#catalog"
              className={`transition-colors duration-300 text-sm font-medium ${isScrolled ? "text-text-secondary hover:text-navy" : "text-white/80 hover:text-white"}`}
            >
              Browse Catalog
            </a>
            <a
              href="#how-it-works"
              className={`transition-colors duration-300 text-sm font-medium ${isScrolled ? "text-text-secondary hover:text-navy" : "text-white/80 hover:text-white"}`}
            >
              How It Works
            </a>
            <Link href="/login">
              <Button
                variant="outline"
                className={`transition-all duration-300 hover:-translate-y-0.5 ${
                  isScrolled
                    ? "border-border text-text-primary hover:bg-surface"
                    : "border-white/30 text-white bg-transparent hover:bg-white/10"
                }`}
              >
                Log In
              </Button>
            </Link>
            <Link href="/signup/buyer">
              <Button className="bg-ocean hover:bg-ocean-dark text-white transition-all hover:-translate-y-0.5">
                Get Started
              </Button>
            </Link>
          </div>

          {/* Mobile Menu Button */}
          <button
            className={`md:hidden p-2 transition-colors duration-300 ${isScrolled ? "text-navy" : "text-white"}`}
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Toggle menu"
          >
            {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Menu */}
        {isMobileMenuOpen && (
          <div className={`md:hidden py-4 border-t ${isScrolled ? "border-border" : "border-white/20"}`}>
            <div className="flex flex-col gap-4">
              <a
                href="#catalog"
                onClick={() => setIsMobileMenuOpen(false)}
                className={`transition-colors text-sm font-medium px-2 ${isScrolled ? "text-text-secondary hover:text-navy" : "text-white/80 hover:text-white"}`}
              >
                Browse Catalog
              </a>
              <a
                href="#how-it-works"
                onClick={() => setIsMobileMenuOpen(false)}
                className={`transition-colors text-sm font-medium px-2 ${isScrolled ? "text-text-secondary hover:text-navy" : "text-white/80 hover:text-white"}`}
              >
                How It Works
              </a>
              <Link href="/login" onClick={() => setIsMobileMenuOpen(false)}>
                <Button
                  variant="outline"
                  className={`w-full ${isScrolled ? "border-border text-text-primary hover:bg-surface" : "border-white/30 text-white bg-transparent hover:bg-white/10"}`}
                >
                  Log In
                </Button>
              </Link>
              <Link href="/signup/buyer" onClick={() => setIsMobileMenuOpen(false)}>
                <Button className="bg-ocean hover:bg-ocean-dark text-white w-full">
                  Get Started
                </Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </nav>
  )
}
