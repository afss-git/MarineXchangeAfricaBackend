import { Anchor, ArrowRight } from "lucide-react"

const platformLinks = [
  { label: "Browse Catalog", href: "#" },
  { label: "How It Works", href: "#" },
  { label: "Pricing", href: "#" },
  { label: "Auctions", href: "#" },
]

const companyLinks = [
  { label: "About", href: "#" },
  { label: "Careers", href: "#" },
  { label: "Press", href: "#" },
  { label: "Contact", href: "#" },
]

const legalLinks = [
  { label: "Terms of Service", href: "#" },
  { label: "Privacy Policy", href: "#" },
  { label: "Cookie Policy", href: "#" },
  { label: "Compliance", href: "#" },
]

const socialLinks = [
  { label: "Twitter", href: "#" },
  { label: "LinkedIn", href: "#" },
  { label: "Email", href: "#" },
]

export function Footer() {
  return (
    <footer className="bg-navy-dark">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-10 lg:gap-8">
          {/* Logo Column */}
          <div className="col-span-2 lg:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <div className="relative w-8 h-8 flex items-center justify-center">
                <Anchor className="w-5 h-5 text-white" />
                <ArrowRight className="w-3 h-3 text-ocean absolute -right-0.5 -top-0.5" />
              </div>
              <div className="flex flex-col">
                <div className="flex items-baseline tracking-tight">
                  <span className="text-white font-extrabold text-lg">Marine</span>
                  <span className="text-ocean font-extrabold text-lg">Xchange</span>
                </div>
                <span className="text-[9px] text-white/50 font-medium tracking-[0.2em] uppercase -mt-1">
                  AFRICA
                </span>
              </div>
            </div>
            <p className="text-white/40 text-sm leading-relaxed max-w-[240px]">
              {"Africa's trusted B2B marketplace for maritime and industrial asset transactions."}
            </p>
          </div>

          {/* Platform Column */}
          <div>
            <h4 className="text-white/35 text-xs font-semibold uppercase tracking-[0.15em] mb-4">
              Platform
            </h4>
            <ul className="space-y-3">
              {platformLinks.map((link, index) => (
                <li key={index}>
                  <a 
                    href={link.href}
                    className="text-white/55 text-sm hover:text-white transition-colors"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Company Column */}
          <div>
            <h4 className="text-white/35 text-xs font-semibold uppercase tracking-[0.15em] mb-4">
              Company
            </h4>
            <ul className="space-y-3">
              {companyLinks.map((link, index) => (
                <li key={index}>
                  <a 
                    href={link.href}
                    className="text-white/55 text-sm hover:text-white transition-colors"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal Column */}
          <div>
            <h4 className="text-white/35 text-xs font-semibold uppercase tracking-[0.15em] mb-4">
              Legal
            </h4>
            <ul className="space-y-3">
              {legalLinks.map((link, index) => (
                <li key={index}>
                  <a 
                    href={link.href}
                    className="text-white/55 text-sm hover:text-white transition-colors"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="border-t border-white/8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <p className="text-white/30 text-sm">
              2025 MarineXchange Africa. All rights reserved.
            </p>
            <div className="flex items-center gap-6">
              {socialLinks.map((link, index) => (
                <a
                  key={index}
                  href={link.href}
                  className="text-white/35 text-sm hover:text-ocean transition-colors"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
