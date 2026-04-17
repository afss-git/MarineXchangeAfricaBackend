import Link from "next/link"
import { Anchor } from "lucide-react"

const platformLinks = [
  { label: "Browse Listings", href: "/listings" },
  { label: "How It Works", href: "/#how-it-works" },
  { label: "Our Services", href: "/#services" },
  { label: "Auctions", href: "/listings?availability_type=auction" },
  { label: "Get Started", href: "/signup/buyer" },
]

const companyLinks = [
  { label: "About Harbours360", href: "/#about" },
  { label: "Contact Us", href: "/#enquiry" },
  { label: "FAQ", href: "/#faq" },
  { label: "Careers", href: "mailto:cobwebb784@gmail.com?subject=Careers Enquiry — Harbours360" },
]

const legalLinks = [
  { label: "Terms of Service", href: "#terms" },
  { label: "Privacy Policy", href: "#privacy" },
  { label: "Cookie Policy", href: "#cookies" },
  { label: "Compliance", href: "#compliance" },
]

const socialLinks = [
  { label: "LinkedIn", href: "https://linkedin.com" },
  { label: "X / Twitter", href: "https://x.com" },
  { label: "Email", href: "mailto:cobwebb784@gmail.com" },
]

export function Footer() {
  return (
    <footer className="bg-navy-dark">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-10 lg:gap-8">

          {/* Brand column */}
          <div className="col-span-2 lg:col-span-1">
            <Link href="/" className="flex items-center gap-2 mb-4">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: "rgba(14,165,233,0.15)" }}
              >
                <Anchor className="w-4 h-4 text-ocean" />
              </div>
              <span className="font-extrabold text-lg tracking-tight leading-none">
                <span className="text-white">Harbours</span>
                <span className="text-ocean">360</span>
              </span>
            </Link>

            <p className="text-white/40 text-sm leading-relaxed max-w-60 mb-6">
              Africa&apos;s trusted B2B marketplace for maritime and industrial asset transactions.
            </p>

            {/* Social links */}
            <div className="flex items-center gap-2">
              {socialLinks.map(({ label, href }) => (
                <a
                  key={label}
                  href={href}
                  aria-label={label}
                  target={href.startsWith("http") ? "_blank" : undefined}
                  rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium text-white/35 hover:text-ocean hover:bg-white/6 transition-colors"
                >
                  {label}
                </a>
              ))}
            </div>

            <div className="mt-6 flex gap-2">
              <Link
                href="/login"
                className="text-xs font-semibold text-ocean border border-ocean/30 hover:border-ocean px-3 py-1.5 rounded-lg transition-colors"
              >
                Log In
              </Link>
              <Link
                href="/signup/buyer"
                className="text-xs font-semibold text-white bg-ocean hover:bg-ocean-dark px-3 py-1.5 rounded-lg transition-colors"
              >
                Register Free
              </Link>
            </div>
          </div>

          {/* Platform links */}
          <div>
            <h4 className="text-white/35 text-xs font-semibold uppercase tracking-[0.15em] mb-4">
              Platform
            </h4>
            <ul className="space-y-3">
              {platformLinks.map(link => (
                <li key={link.label}>
                  <Link href={link.href} className="text-white/55 text-sm hover:text-white transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Company links */}
          <div>
            <h4 className="text-white/35 text-xs font-semibold uppercase tracking-[0.15em] mb-4">
              Company
            </h4>
            <ul className="space-y-3">
              {companyLinks.map(link => (
                <li key={link.label}>
                  <a href={link.href} className="text-white/55 text-sm hover:text-white transition-colors">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal links */}
          <div>
            <h4 className="text-white/35 text-xs font-semibold uppercase tracking-[0.15em] mb-4">
              Legal
            </h4>
            <ul className="space-y-3">
              {legalLinks.map(link => (
                <li key={link.label}>
                  <a href={link.href} className="text-white/55 text-sm hover:text-white transition-colors">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
            <div className="mt-6 pt-6 border-t border-white/8">
              <p className="text-white/25 text-xs leading-relaxed">
                Harbours<span className="text-ocean/60">360</span> operates as a digital marketplace. All transactions are subject to applicable laws and regulations.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-white/8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-white/25 text-xs">
            © {new Date().getFullYear()} Harbours<span className="text-ocean/50">360</span>. All rights reserved.
          </p>
          <p className="text-white/20 text-xs">
            Built for Africa&apos;s maritime sector.
          </p>
        </div>
      </div>
    </footer>
  )
}
