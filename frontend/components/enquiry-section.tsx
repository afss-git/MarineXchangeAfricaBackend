"use client"

import { useEffect, useRef, useState } from "react"
import { Send, CheckCircle } from "lucide-react"
import { Button } from "@/components/ui/button"

const ENQUIRY_EMAIL = "cobwebb784@gmail.com"

const enquiryTypes = [
  "Select enquiry type",
  "I want to buy an asset",
  "I want to list / sell an asset",
  "Auction enquiry",
  "Partnership or integration",
  "KYC or compliance question",
  "Payment or escrow question",
  "Media or press",
  "General question",
  "Other",
]

const africanCountries = [
  "Select country",
  "Nigeria", "Ghana", "Kenya", "South Africa", "Egypt", "Tanzania",
  "Côte d'Ivoire", "Cameroon", "Senegal", "Angola", "Mozambique",
  "Ethiopia", "Uganda", "Rwanda", "Zambia", "Zimbabwe", "Botswana",
  "Namibia", "Madagascar", "Mauritius",
  "Other African country", "Outside Africa",
]

interface FormState {
  name: string
  company: string
  email: string
  phone: string
  country: string
  type: string
  message: string
}

const EMPTY: FormState = {
  name: "", company: "", email: "", phone: "",
  country: "", type: "", message: "",
}

export function EnquirySection() {
  const [visible, setVisible] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [submitted, setSubmitted] = useState(false)
  const [errors, setErrors] = useState<Partial<FormState>>({})
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

  function validate(): boolean {
    const e: Partial<FormState> = {}
    if (!form.name.trim()) e.name = "Full name is required"
    if (!form.company.trim()) e.company = "Company name is required"
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = "Valid email is required"
    if (!form.country || form.country === "Select country") e.country = "Please select a country"
    if (!form.type || form.type === "Select enquiry type") e.type = "Please select an enquiry type"
    if (!form.message.trim() || form.message.trim().length < 20) e.message = "Message must be at least 20 characters"
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault()
    if (!validate()) return

    const subject = encodeURIComponent(`Harbours360 Enquiry: ${form.type} — ${form.name}`)
    const body = encodeURIComponent(
      `ENQUIRY TYPE: ${form.type}\n\n` +
      `Name: ${form.name}\n` +
      `Company: ${form.company}\n` +
      `Email: ${form.email}\n` +
      (form.phone ? `Phone: ${form.phone}\n` : "") +
      `Country: ${form.country}\n\n` +
      `MESSAGE:\n${form.message}`
    )

    window.location.href = `mailto:${ENQUIRY_EMAIL}?subject=${subject}&body=${body}`
    setSubmitted(true)
    setForm(EMPTY)
  }

  function set(key: keyof FormState, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: undefined }))
  }

  const inputClass =
    "w-full border border-border rounded-xl px-4 py-3 text-sm text-text-primary bg-white focus:outline-none focus:ring-2 focus:ring-ocean/25 focus:border-ocean transition-colors placeholder-text-secondary/50"
  const errorInputClass = "border-danger focus:ring-danger/20 focus:border-danger"
  const labelClass = "block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5"
  const errorClass = "text-danger text-xs mt-1"

  return (
    <section id="enquiry" ref={ref} className="bg-white py-24 border-t border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-[1fr_540px] gap-16 items-start">

          {/* Left — copy */}
          <div className={`${visible ? "animate-fade-up" : "opacity-0"}`}>
            <span className="text-ocean text-xs font-semibold tracking-[0.15em] uppercase mb-4 block">
              GET IN TOUCH
            </span>
            <h2
              className="text-navy font-extrabold mb-5"
              style={{ fontSize: "clamp(26px, 3.5vw, 40px)", letterSpacing: "-0.03em" }}
            >
              Have a Question or a Deal in Mind?
            </h2>
            <p className="text-text-secondary text-base leading-relaxed mb-8 max-w-md">
              Whether you&apos;re looking to buy a specific asset, list your fleet, or understand how the platform works — tell us what you need and we&apos;ll respond within one business day.
            </p>

            {/* Info blocks */}
            <div className="space-y-5">
              {[
                {
                  label: "Response time",
                  value: "Within 1 business day",
                },
                {
                  label: "Enquiries handled",
                  value: "Asset purchases, sales, auctions, compliance & partnerships",
                },
                {
                  label: "Coverage",
                  value: "15+ African markets · USD, EUR, GBP & local currencies",
                },
              ].map((item, i) => (
                <div key={i} className="flex gap-3">
                  <div className="w-1 rounded-full bg-ocean/30 shrink-0" />
                  <div>
                    <p className="text-xs text-text-secondary font-medium uppercase tracking-wide mb-0.5">{item.label}</p>
                    <p className="text-text-primary text-sm font-semibold">{item.value}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right — form */}
          <div className={`${visible ? "animate-fade-up delay-2" : "opacity-0"}`}>
            {submitted ? (
              <div className="bg-surface border border-border rounded-2xl p-10 flex flex-col items-center text-center gap-4">
                <div className="w-14 h-14 rounded-full bg-success/10 flex items-center justify-center">
                  <CheckCircle className="w-7 h-7 text-success" />
                </div>
                <h3 className="text-navy font-bold text-lg">Enquiry Sent</h3>
                <p className="text-text-secondary text-sm max-w-xs">
                  Your email client should have opened with your message pre-filled. We&apos;ll respond within one business day.
                </p>
                <button
                  onClick={() => setSubmitted(false)}
                  className="mt-2 text-sm text-ocean font-semibold hover:underline"
                >
                  Send another enquiry
                </button>
              </div>
            ) : (
              <form
                onSubmit={handleSubmit}
                className="bg-surface border border-border rounded-2xl p-8 space-y-5"
                noValidate
              >
                {/* Name + Company */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Full Name *</label>
                    <input
                      value={form.name}
                      onChange={e => set("name", e.target.value)}
                      placeholder="John Adeyemi"
                      className={`${inputClass} ${errors.name ? errorInputClass : ""}`}
                    />
                    {errors.name && <p className={errorClass}>{errors.name}</p>}
                  </div>
                  <div>
                    <label className={labelClass}>Company *</label>
                    <input
                      value={form.company}
                      onChange={e => set("company", e.target.value)}
                      placeholder="Your company name"
                      className={`${inputClass} ${errors.company ? errorInputClass : ""}`}
                    />
                    {errors.company && <p className={errorClass}>{errors.company}</p>}
                  </div>
                </div>

                {/* Email + Phone */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Email Address *</label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={e => set("email", e.target.value)}
                      placeholder="you@company.com"
                      className={`${inputClass} ${errors.email ? errorInputClass : ""}`}
                    />
                    {errors.email && <p className={errorClass}>{errors.email}</p>}
                  </div>
                  <div>
                    <label className={labelClass}>Phone <span className="normal-case font-normal text-text-secondary/70">(optional)</span></label>
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={e => set("phone", e.target.value)}
                      placeholder="+234 800 000 0000"
                      className={inputClass}
                    />
                  </div>
                </div>

                {/* Country + Enquiry type */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Country *</label>
                    <select
                      value={form.country}
                      onChange={e => set("country", e.target.value)}
                      className={`${inputClass} ${errors.country ? errorInputClass : ""}`}
                    >
                      {africanCountries.map(c => (
                        <option key={c} value={c === "Select country" ? "" : c} disabled={c === "Select country"}>
                          {c}
                        </option>
                      ))}
                    </select>
                    {errors.country && <p className={errorClass}>{errors.country}</p>}
                  </div>
                  <div>
                    <label className={labelClass}>Enquiry Type *</label>
                    <select
                      value={form.type}
                      onChange={e => set("type", e.target.value)}
                      className={`${inputClass} ${errors.type ? errorInputClass : ""}`}
                    >
                      {enquiryTypes.map(t => (
                        <option key={t} value={t === "Select enquiry type" ? "" : t} disabled={t === "Select enquiry type"}>
                          {t}
                        </option>
                      ))}
                    </select>
                    {errors.type && <p className={errorClass}>{errors.type}</p>}
                  </div>
                </div>

                {/* Message */}
                <div>
                  <label className={labelClass}>Message *</label>
                  <textarea
                    value={form.message}
                    onChange={e => set("message", e.target.value)}
                    placeholder="Describe what you're looking for, the asset type, approximate budget, timeline, or any questions you have…"
                    rows={5}
                    className={`${inputClass} resize-none ${errors.message ? errorInputClass : ""}`}
                  />
                  {errors.message && <p className={errorClass}>{errors.message}</p>}
                  <p className="text-xs text-text-secondary mt-1">{form.message.length} / min. 20 characters</p>
                </div>

                <Button
                  type="submit"
                  className="w-full bg-ocean hover:bg-ocean-dark text-white font-semibold py-3 rounded-xl gap-2 transition-all hover:-translate-y-px"
                >
                  Send Enquiry
                  <Send className="w-4 h-4" />
                </Button>

                <p className="text-xs text-center text-text-secondary">
                  Your enquiry opens your email client pre-filled and ready to send.
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
