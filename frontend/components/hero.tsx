"use client"

import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowRight, Search, X, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { marketplace, type CategoryResponse } from "@/lib/api"

interface Suggestion {
  type: "category" | "listing"
  id: string
  label: string
  sub?: string
  href: string
}

export function Hero() {
  const router = useRouter()
  const [visible, setVisible] = useState(false)
  const [query, setQuery] = useState("")
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loadingSugg, setLoadingSugg] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [categories, setCategories] = useState<CategoryResponse[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { setVisible(true) }, [])

  useEffect(() => {
    marketplace.getCategories()
      .then(cats => setCategories(cats.slice(0, 6)))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim()) { setSuggestions([]); setShowDropdown(false); return }
    setLoadingSugg(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const q = query.trim().toLowerCase()
        const catSuggs: Suggestion[] = categories
          .filter(c => c.name.toLowerCase().includes(q))
          .slice(0, 3)
          .map(c => ({ type: "category", id: c.id, label: c.name, sub: "Browse category", href: `/listings?category_id=${c.id}` }))
        const res = await marketplace.browse({ page: 1, page_size: 5, q: query.trim() })
        const listSuggs: Suggestion[] = (res.items ?? []).map(item => ({
          type: "listing", id: item.id, label: item.title,
          sub: `${item.currency} ${parseFloat(item.asking_price) >= 1_000_000
            ? (parseFloat(item.asking_price) / 1_000_000).toFixed(1) + "M"
            : parseFloat(item.asking_price) >= 1_000
            ? (parseFloat(item.asking_price) / 1_000).toFixed(0) + "K"
            : parseFloat(item.asking_price).toLocaleString()} · ${item.location_country}`,
          href: `/listings/${item.id}`,
        }))
        setSuggestions([...catSuggs, ...listSuggs])
        setShowDropdown(true)
        setActiveIndex(-1)
      } catch { setSuggestions([]) }
      finally { setLoadingSugg(false) }
    }, 320)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, categories])

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.contains(e.target as Node)
      ) setShowDropdown(false)
    }
    document.addEventListener("mousedown", handle)
    return () => document.removeEventListener("mousedown", handle)
  }, [])

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault()
    router.push(query.trim() ? `/listings?q=${encodeURIComponent(query.trim())}` : "/listings")
    setShowDropdown(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!showDropdown || !suggestions.length) return
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, suggestions.length - 1)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, -1)) }
    else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault(); router.push(suggestions[activeIndex].href); setShowDropdown(false); setQuery("")
    } else if (e.key === "Escape") setShowDropdown(false)
  }

  return (
    <section
      className="relative min-h-screen pt-16 overflow-hidden flex items-center"
      style={{ background: "linear-gradient(165deg, #0F2A44 0%, #091B2E 100%)" }}
    >
      <div className="absolute inset-0 grid-pattern" />
      <div
        className="absolute top-0 right-0 w-175 h-175 rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle at center, rgba(14,165,233,0.09) 0%, transparent 70%)", transform: "translate(25%, -25%)" }}
      />
      <div
        className="absolute bottom-0 left-0 w-125 h-125 rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle at center, rgba(14,165,233,0.05) 0%, transparent 70%)", transform: "translate(-30%, 30%)" }}
      />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20 lg:py-28 w-full">

        {/* Badge */}
        <div
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-5 sm:mb-7 ${visible ? "animate-fade-up" : "opacity-0"}`}
          style={{ backgroundColor: "rgba(14,165,233,0.1)", border: "1px solid rgba(14,165,233,0.22)" }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-ocean animate-pulse-dot shrink-0" />
          <span className="text-ocean text-xs font-semibold tracking-wide">Live in 15+ African markets</span>
        </div>

        {/* Headline */}
        <h1
          className={`text-white font-extrabold leading-[1.08] mb-4 sm:mb-5 ${visible ? "animate-fade-up delay-1" : "opacity-0"}`}
          style={{ fontSize: "clamp(30px, 5.5vw, 62px)", letterSpacing: "-0.03em" }}
        >
          Africa&apos;s Premier Marketplace for Maritime &amp; Industrial Assets
        </h1>

        {/* Subheading */}
        <p className={`text-white/55 text-sm sm:text-base lg:text-lg max-w-130 mb-7 sm:mb-10 leading-relaxed ${visible ? "animate-fade-up delay-2" : "opacity-0"}`}>
          Buy and sell verified vessels, offshore equipment, and industrial machinery. Trusted by companies across Africa.
        </p>

        {/* Search bar */}
        <div className={`relative w-full max-w-2xl mb-5 sm:mb-7 ${visible ? "animate-fade-up delay-3" : "opacity-0"}`}>
          <form onSubmit={handleSubmit}>
            <div
              className="flex items-center rounded-2xl overflow-hidden"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", backdropFilter: "blur(12px)" }}
            >
              <Search className="w-4 h-4 sm:w-5 sm:h-5 text-white/40 ml-3 sm:ml-4 shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onFocus={() => query.trim() && suggestions.length > 0 && setShowDropdown(true)}
                onKeyDown={handleKeyDown}
                placeholder="Search vessels, equipment…"
                className="flex-1 bg-transparent text-white placeholder-white/35 text-sm px-2.5 sm:px-3 py-3.5 sm:py-4 focus:outline-none min-w-0"
                autoComplete="off"
              />
              {query && (
                <button type="button" onClick={() => { setQuery(""); setSuggestions([]); setShowDropdown(false); inputRef.current?.focus() }}
                  className="p-1.5 rounded-lg text-white/40 hover:text-white/70 transition-colors shrink-0">
                  <X className="w-4 h-4" />
                </button>
              )}
              {loadingSugg && <Loader2 className="w-4 h-4 text-white/40 animate-spin mr-2 shrink-0" />}
              <button type="submit"
                className="m-1.5 px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl bg-ocean hover:bg-ocean-dark text-white text-xs sm:text-sm font-semibold transition-colors shrink-0 whitespace-nowrap">
                Search
              </button>
            </div>
          </form>

          {/* Suggestions dropdown */}
          {showDropdown && suggestions.length > 0 && (
            <div ref={dropdownRef}
              className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl border border-border shadow-xl z-50 overflow-hidden animate-slide-down">
              {suggestions.map((s, i) => (
                <Link key={s.id + s.type} href={s.href}
                  onClick={() => { setShowDropdown(false); setQuery("") }}
                  className={`flex items-center gap-3 px-4 py-3 hover:bg-surface transition-colors ${i === activeIndex ? "bg-surface" : ""} ${i < suggestions.length - 1 ? "border-b border-border" : ""}`}>
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${s.type === "category" ? "bg-ocean/10 text-ocean" : "bg-navy/6 text-navy"}`}>
                    <Search className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-text-primary text-sm font-semibold truncate">{s.label}</p>
                    {s.sub && <p className="text-text-secondary text-xs truncate">{s.sub}</p>}
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 hidden sm:block ${s.type === "category" ? "bg-ocean/10 text-ocean" : "bg-navy/6 text-navy"}`}>
                    {s.type === "category" ? "Category" : "Listing"}
                  </span>
                </Link>
              ))}
              <Link href={`/listings?q=${encodeURIComponent(query.trim())}`}
                onClick={() => { setShowDropdown(false); setQuery("") }}
                className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-surface text-ocean text-xs font-semibold hover:bg-border/40 transition-colors">
                See all results for &quot;{query.trim()}&quot; <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          )}
        </div>

        {/* Category chips — horizontal scroll on mobile */}
        {categories.length > 0 && (
          <div className={`mb-8 sm:mb-12 ${visible ? "animate-fade-up delay-4" : "opacity-0"}`}>
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide" style={{ WebkitOverflowScrolling: "touch" }}>
              <span className="text-white/35 text-xs font-medium shrink-0 mr-1">Browse:</span>
              {categories.map(cat => (
                <Link key={cat.id} href={`/listings?category_id=${cat.id}`}
                  className="px-3 py-1.5 rounded-full text-xs font-semibold text-white/70 hover:text-white transition-all shrink-0"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
                  {cat.name}
                </Link>
              ))}
              <Link href="/listings"
                className="px-3 py-1.5 rounded-full text-xs font-semibold text-ocean shrink-0"
                style={{ background: "rgba(14,165,233,0.12)", border: "1px solid rgba(14,165,233,0.25)" }}>
                View All →
              </Link>
            </div>
          </div>
        )}

        {/* CTA buttons — stacked on mobile, row on sm+ */}
        <div className={`flex flex-col sm:flex-row gap-3 ${visible ? "animate-fade-up delay-5" : "opacity-0"}`}>
          <Link href="/signup/buyer" className="w-full sm:w-auto">
            <Button size="lg" className="w-full sm:w-auto bg-ocean hover:bg-ocean-dark text-white px-7 py-5 text-sm font-semibold transition-all hover:-translate-y-0.5 gap-2">
              Start as Buyer <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
          <Link href="/signup/seller" className="w-full sm:w-auto">
            <Button size="lg" variant="outline"
              className="w-full sm:w-auto border-white/25 text-white bg-transparent hover:bg-white/8 px-7 py-5 text-sm font-semibold transition-all hover:-translate-y-0.5">
              List Your Assets
            </Button>
          </Link>
        </div>
      </div>
    </section>
  )
}
