"use client"

import { useEffect, useRef, useState } from "react"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"

const faqs = [
  {
    q: "Who can use Harbours360?",
    a: "Harbours360 is a B2B platform for companies and professionals in the maritime and industrial sectors. Buyers, sellers, fleet operators, shipbrokers, offshore contractors, and procurement teams across Africa are welcome. Individual registration is available but all high-value transactions require business verification.",
  },
  {
    q: "How are sellers and their listings verified?",
    a: "All sellers complete a KYC (Know Your Customer) process before they can list assets. This includes business registration documents, proof of ownership or authority to sell, and identity verification. Once submitted, our verification agents review and confirm the details — only then does a listing go live as 'Verified'.",
  },
  {
    q: "What types of assets can be listed on the platform?",
    a: "We support a wide range of maritime and industrial assets: offshore supply vessels, tugboats, cargo barges, tankers, cranes and heavy lift equipment, marine engines and propulsion systems, port and terminal equipment, industrial generators, and more. If you're unsure whether your asset qualifies, contact us before listing.",
  },
  {
    q: "Can I browse listings without creating an account?",
    a: "Yes. The public marketplace is fully browsable without an account — you can view listing titles, prices, conditions, and locations. To contact a seller, submit a purchase request, place an auction bid, or view full seller details, you will need to register and complete KYC.",
  },
  {
    q: "How does the escrow payment system work?",
    a: "Once a deal is agreed, funds from the buyer are held in a managed escrow account. The payment is released to the seller in milestones tied to agreed delivery conditions — for example, after inspection, after documentation transfer, and after physical handover. Neither party can access the funds unilaterally, protecting both sides of the transaction.",
  },
  {
    q: "Which countries and currencies are supported?",
    a: "We are currently active in 15+ African markets including Nigeria, Ghana, Kenya, South Africa, Egypt, Tanzania, Côte d'Ivoire, Senegal, Angola, Cameroon, Mozambique, and more. Listings can be priced in USD, EUR, GBP, or local currencies. All transactions are subject to applicable local regulations.",
  },
  {
    q: "How long does the KYC process take?",
    a: "Most KYC submissions are reviewed within 1–3 business days. Complex submissions or those requiring additional documentation may take longer. You will receive email notifications at each stage of the review. Once approved, your KYC status is valid for 12 months before requiring renewal.",
  },
  {
    q: "What are the fees for listing or buying?",
    a: "Listing fees and transaction commissions depend on asset type and deal structure. Basic listings are free to submit. A platform fee applies on successfully closed deals. Auction listings may carry a separate setup fee. Detailed fee schedules are available in your account dashboard after registration.",
  },
  {
    q: "How do auctions work on Harbours360?",
    a: "Sellers can submit an asset for auction with a reserve price and auction duration. Registered, KYC-verified buyers can place bids in real time. The highest bid above the reserve price wins. At auction close, the winning bidder and seller are connected to proceed with deal documentation and payment through the platform.",
  },
  {
    q: "What happens if a dispute arises during a transaction?",
    a: "Every transaction generates a complete audit trail — bids, messages, documents, payments, and status changes are all logged. In the event of a dispute, our deal management team reviews the trail and mediates. Escrow funds remain protected until the dispute is resolved. Unresolved disputes may be escalated to applicable arbitration or legal processes.",
  },
]

export function FaqSection() {
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) { setVisible(true); observer.disconnect() }
      },
      { threshold: 0.1 }
    )
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  return (
    <section id="faq" ref={ref} className="bg-surface py-16 sm:py-24 border-t border-border">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Header */}
        <div className={`text-center mb-10 sm:mb-14 ${visible ? "animate-fade-up" : "opacity-0"}`}>
          <span className="text-ocean text-xs font-semibold tracking-[0.15em] uppercase mb-4 block">
            FAQ
          </span>
          <h2
            className="text-navy font-extrabold mb-4"
            style={{ fontSize: "clamp(26px, 3.5vw, 38px)", letterSpacing: "-0.03em" }}
          >
            Frequently Asked Questions
          </h2>
          <p className="text-text-secondary text-base max-w-xl mx-auto">
            Everything you need to know before your first transaction on Harbours<span className="text-ocean font-semibold">360</span>.
          </p>
        </div>

        {/* Accordion */}
        <div className={`${visible ? "animate-fade-up delay-2" : "opacity-0"}`}>
          <Accordion type="single" collapsible className="space-y-3">
            {faqs.map((faq, index) => (
              <AccordionItem
                key={index}
                value={`faq-${index}`}
                className="bg-white border border-border rounded-xl px-6 data-[state=open]:border-ocean/30 transition-colors"
              >
                <AccordionTrigger className="text-navy font-semibold text-sm text-left py-5 hover:no-underline hover:text-ocean transition-colors data-[state=open]:text-ocean">
                  {faq.q}
                </AccordionTrigger>
                <AccordionContent className="text-text-secondary text-sm leading-relaxed pb-5">
                  {faq.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>

        {/* Footer note */}
        <p className={`text-center text-sm text-text-secondary mt-10 ${visible ? "animate-fade-up delay-3" : "opacity-0"}`}>
          Still have questions?{" "}
          <a href="#enquiry" className="text-ocean font-semibold hover:underline">
            Send us an enquiry
          </a>{" "}
          and we&apos;ll get back to you within one business day.
        </p>
      </div>
    </section>
  )
}
