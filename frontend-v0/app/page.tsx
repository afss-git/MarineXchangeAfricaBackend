import { Navbar } from "@/components/navbar"
import { Hero } from "@/components/hero"
import { StatsBar } from "@/components/stats-bar"
import { HowItWorks } from "@/components/how-it-works"
import { AssetCategories } from "@/components/asset-categories"
import { TrustSecurity } from "@/components/trust-security"
import { CTASection } from "@/components/cta-section"
import { Footer } from "@/components/footer"

export default function MarineXchangeLandingPage() {
  return (
    <main className="min-h-screen">
      <Navbar />
      <Hero />
      <StatsBar />
      <HowItWorks />
      <AssetCategories />
      <TrustSecurity />
      <CTASection />
      <Footer />
    </main>
  )
}
