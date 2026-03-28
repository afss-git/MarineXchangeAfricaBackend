"use client"

import { useState, useEffect } from "react"
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
          ? "bg-white/90 backdrop-blur-md border-b border-border"
          : "bg-white/90 backdrop-blur-md"
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="relative w-8 h-8 flex items-center justify-center">
              <Anchor className="w-5 h-5 text-navy" />
              <ArrowRight className="w-3 h-3 text-ocean absolute -right-0.5 -top-0.5" />
            </div>
            <div className="flex flex-col">
              <div className="flex items-baseline tracking-tight">
                <span className="text-navy font-extrabold text-lg">Marine</span>
                <span className="text-ocean font-extrabold text-lg">Xchange</span>
              </div>
              <span className="text-[9px] text-navy font-medium tracking-[0.2em] uppercase -mt-1">
                AFRICA
              </span>
            </div>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-4">
            <a
              href="#catalog"
              className="text-text-secondary hover:text-navy transition-colors text-sm font-medium"
            >
              Browse Catalog
            </a>
            <Button
              variant="outline"
              className="border-border text-text-primary hover:bg-surface transition-all hover:-translate-y-0.5"
            >
              Log In
            </Button>
            <Button className="bg-ocean hover:bg-ocean-dark text-white transition-all hover:-translate-y-0.5">
              Get Started
            </Button>
          </div>

          {/* Mobile Menu Button */}
          <button
            className="md:hidden p-2 text-navy"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Toggle menu"
          >
            {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden py-4 border-t border-border">
            <div className="flex flex-col gap-4">
              <a
                href="#catalog"
                className="text-text-secondary hover:text-navy transition-colors text-sm font-medium px-2"
              >
                Browse Catalog
              </a>
              <Button
                variant="outline"
                className="border-border text-text-primary hover:bg-surface w-full"
              >
                Log In
              </Button>
              <Button className="bg-ocean hover:bg-ocean-dark text-white w-full">
                Get Started
              </Button>
            </div>
          </div>
        )}
      </div>
    </nav>
  )
}
