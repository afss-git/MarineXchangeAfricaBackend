import { Navbar } from "@/components/navbar"
import { Hero } from "@/components/hero"
import { StatsBar } from "@/components/stats-bar"
import { HowItWorks } from "@/components/how-it-works"
import { AssetCategories } from "@/components/asset-categories"
import { FeaturedListings } from "@/components/featured-listings"
import { ServicesSection } from "@/components/services-section"
import { TrustSecurity } from "@/components/trust-security"
import { SocialProof } from "@/components/social-proof"
import { FaqSection } from "@/components/faq-section"
import { EnquirySection } from "@/components/enquiry-section"
import { CTASection } from "@/components/cta-section"
import { Footer } from "@/components/footer"

export default function HarboursLandingPage() {
  return (
    <main className="min-h-screen">
      <Navbar />
      <Hero />
      <StatsBar />
      <HowItWorks />
      <AssetCategories />
      <FeaturedListings />
      <ServicesSection />
      <TrustSecurity />
      <SocialProof />
      <FaqSection />
      <EnquirySection />
      <CTASection />
      <Footer />
    </main>
  )
}
