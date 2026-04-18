import Link from "next/link"
import { ArrowLeft } from "lucide-react"

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-navy transition-colors mb-10">
          <ArrowLeft className="w-4 h-4" /> Back to Home
        </Link>

        <div className="mb-10">
          <span className="text-ocean text-xs font-semibold tracking-[0.15em] uppercase mb-3 block">Legal</span>
          <h1 className="text-navy font-extrabold mb-3" style={{ fontSize: "clamp(28px, 4vw, 40px)", letterSpacing: "-0.03em" }}>
            Terms of Service
          </h1>
          <p className="text-text-secondary text-sm">Last updated: January 2025</p>
        </div>

        <div className="prose prose-sm max-w-none text-text-secondary space-y-8">
          <section>
            <h2 className="text-navy font-bold text-lg mb-3">1. Platform Use</h2>
            <p className="leading-relaxed">
              Harbours360 is a B2B marketplace for maritime and industrial asset transactions. Access is restricted to registered businesses and professionals. By using the platform you confirm that you have the legal authority to act on behalf of your organisation.
            </p>
          </section>

          <section>
            <h2 className="text-navy font-bold text-lg mb-3">2. KYC Verification</h2>
            <p className="leading-relaxed">
              All users must complete identity and business verification (KYC) before transacting. Providing false or misleading information during KYC will result in immediate account suspension and may be reported to relevant authorities.
            </p>
          </section>

          <section>
            <h2 className="text-navy font-bold text-lg mb-3">3. Listings & Accuracy</h2>
            <p className="leading-relaxed">
              Sellers are responsible for the accuracy of all listing information, including asset condition, ownership status, and pricing. Harbours360 verifies listings on a best-efforts basis but does not guarantee the accuracy of user-submitted content.
            </p>
          </section>

          <section>
            <h2 className="text-navy font-bold text-lg mb-3">4. Transactions & Escrow</h2>
            <p className="leading-relaxed">
              Transactions conducted through the platform are subject to escrow terms agreed at the time of deal creation. Funds held in escrow are released only when agreed delivery conditions are satisfied. Disputes are handled in accordance with our dispute resolution process.
            </p>
          </section>

          <section>
            <h2 className="text-navy font-bold text-lg mb-3">5. Fees</h2>
            <p className="leading-relaxed">
              Platform fees and transaction commissions are disclosed in your account dashboard. Fees are non-refundable on successfully closed transactions. Harbours360 reserves the right to update fee schedules with 30 days notice.
            </p>
          </section>

          <section>
            <h2 className="text-navy font-bold text-lg mb-3">6. Prohibited Activities</h2>
            <p className="leading-relaxed">
              Users may not use the platform for money laundering, fraud, sanctions evasion, or any activity that violates applicable law. Harbours360 monitors transactions and will report suspicious activity to relevant authorities.
            </p>
          </section>

          <section>
            <h2 className="text-navy font-bold text-lg mb-3">7. Limitation of Liability</h2>
            <p className="leading-relaxed">
              Harbours360 acts as a marketplace intermediary and is not a party to transactions between buyers and sellers. Our liability is limited to the fees paid to us in connection with the relevant transaction.
            </p>
          </section>

          <section>
            <h2 className="text-navy font-bold text-lg mb-3">8. Governing Law</h2>
            <p className="leading-relaxed">
              These terms are governed by applicable law in the jurisdiction of incorporation of Harbours360. Disputes not resolved through our internal process may be submitted to binding arbitration.
            </p>
          </section>

          <section>
            <h2 className="text-navy font-bold text-lg mb-3">9. Contact</h2>
            <p className="leading-relaxed">
              For terms-related enquiries, contact{" "}
              <a href="mailto:cobwebb784@gmail.com" className="text-ocean hover:underline">cobwebb784@gmail.com</a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
