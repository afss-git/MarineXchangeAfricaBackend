import Link from "next/link"
import { ArrowLeft } from "lucide-react"

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-navy transition-colors mb-10">
          <ArrowLeft className="w-4 h-4" /> Back to Home
        </Link>

        <div className="mb-10">
          <span className="text-ocean text-xs font-semibold tracking-[0.15em] uppercase mb-3 block">Legal</span>
          <h1 className="text-navy font-extrabold mb-3" style={{ fontSize: "clamp(28px, 4vw, 40px)", letterSpacing: "-0.03em" }}>
            Privacy Policy
          </h1>
          <p className="text-text-secondary text-sm">Last updated: January 2025</p>
        </div>

        <div className="prose prose-sm max-w-none text-text-secondary space-y-8">
          <section>
            <h2 className="text-navy font-bold text-lg mb-3">1. Information We Collect</h2>
            <p className="leading-relaxed">
              Harbours360 collects information you provide directly, including your name, company details, email address, phone number, and identity verification documents submitted during KYC. We also collect usage data, transaction records, and communications made through the platform.
            </p>
          </section>

          <section>
            <h2 className="text-navy font-bold text-lg mb-3">2. How We Use Your Information</h2>
            <p className="leading-relaxed">
              We use your information to operate the marketplace, verify identities, process transactions, send notifications, comply with legal obligations, and improve the platform. We do not sell your personal data to third parties.
            </p>
          </section>

          <section>
            <h2 className="text-navy font-bold text-lg mb-3">3. KYC & Compliance Data</h2>
            <p className="leading-relaxed">
              Identity verification data is processed in compliance with applicable anti-money laundering (AML) and know-your-customer (KYC) regulations in the jurisdictions we operate in. This data is retained for the period required by law.
            </p>
          </section>

          <section>
            <h2 className="text-navy font-bold text-lg mb-3">4. Data Sharing</h2>
            <p className="leading-relaxed">
              We may share your information with counterparties on agreed transactions, payment processors, identity verification providers, and regulatory authorities when required. All third-party providers are contractually bound to protect your data.
            </p>
          </section>

          <section>
            <h2 className="text-navy font-bold text-lg mb-3">5. Data Security</h2>
            <p className="leading-relaxed">
              We implement industry-standard security measures including encryption at rest and in transit, access controls, and audit logging. All transactions generate a complete, immutable audit trail.
            </p>
          </section>

          <section>
            <h2 className="text-navy font-bold text-lg mb-3">6. Your Rights</h2>
            <p className="leading-relaxed">
              You have the right to access, correct, or request deletion of your personal data, subject to legal retention obligations. To exercise these rights, contact us at{" "}
              <a href="mailto:cobwebb784@gmail.com" className="text-ocean hover:underline">cobwebb784@gmail.com</a>.
            </p>
          </section>

          <section>
            <h2 className="text-navy font-bold text-lg mb-3">7. Contact</h2>
            <p className="leading-relaxed">
              For privacy-related enquiries, contact us at{" "}
              <a href="mailto:cobwebb784@gmail.com" className="text-ocean hover:underline">cobwebb784@gmail.com</a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
