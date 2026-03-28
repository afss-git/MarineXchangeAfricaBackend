"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Anchor,
  User,
  ShieldCheck,
  Store,
  ArrowRight,
  X,
  FileCheck,
  BadgeCheck,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const storageKey = (userId: string) => `mx_onboarding_v1_${userId}`;

interface Step {
  gradientFrom: string;
  gradientTo: string;
  iconBg: string;
  Icon: React.ElementType;
  title: (name?: string) => string;
  subtitle: string;
  body: string;
  cta: string;
  ctaHref: string | null;
  skip: string | null;
  showKycFlow?: boolean;
}

const STEPS: Step[] = [
  {
    gradientFrom: "from-[#0891b2]/20",
    gradientTo:   "to-[#0e1f3b]/10",
    iconBg:       "bg-ocean",
    Icon:         Anchor,
    title:        (name) => name ? `Welcome, ${name.split(" ")[0]}!` : "Welcome to MarineXchange",
    subtitle:     "Africa's B2B maritime marketplace",
    body:         "You now have access to thousands of verified maritime and industrial assets across Africa. Let's walk you through getting started — it only takes a few minutes.",
    cta:          "Let's Begin",
    ctaHref:      null,
    skip:         null,
  },
  {
    gradientFrom: "from-[#0e1f3b]/15",
    gradientTo:   "to-[#0891b2]/5",
    iconBg:       "bg-navy",
    Icon:         User,
    title:        () => "Complete Your Profile",
    subtitle:     "Build trust with sellers",
    body:         "Add your company name, phone number, and country. A complete profile increases seller response rates and is required before your KYC application can be submitted.",
    cta:          "Go to Profile",
    ctaHref:      "/profile",
    skip:         "I'll do this later",
  },
  {
    gradientFrom: "from-[#16a34a]/10",
    gradientTo:   "to-[#0891b2]/5",
    iconBg:       "bg-success",
    Icon:         ShieldCheck,
    title:        () => "Verify Your Identity (KYC)",
    subtitle:     "Required to trade on the platform",
    body:         "Upload your documents — passport, business registration, proof of address. Our compliance team reviews within 1–2 business days. KYC unlocks purchase requests, auction bidding, and deal-making.",
    cta:          "Start KYC Now",
    ctaHref:      "/kyc/submit",
    skip:         "I'll do this later",
    showKycFlow:  true,
  },
  {
    gradientFrom: "from-[#0891b2]/15",
    gradientTo:   "to-[#0e1f3b]/5",
    iconBg:       "bg-ocean",
    Icon:         Store,
    title:        () => "You're All Set to Explore",
    subtitle:     "Thousands of verified assets await",
    body:         "Browse maritime vessels, industrial equipment, spare parts, and more. Once your KYC is approved, you can submit purchase requests and bid in live auctions.",
    cta:          "Browse Marketplace",
    ctaHref:      "/marketplace",
    skip:         null,
  },
];

interface OnboardingModalProps {
  userId: string;
  userName?: string | null;
}

export function OnboardingModal({ userId, userName }: OnboardingModalProps) {
  const [visible, setVisible]   = useState(false);
  const [animate, setAnimate]   = useState(false);
  const [step, setStep]         = useState(0);
  const [leaving, setLeaving]   = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!userId) return;
    const key = storageKey(userId);
    if (localStorage.getItem(key)) return;
    // Delay slightly so the dashboard renders first
    const t = setTimeout(() => {
      setVisible(true);
      requestAnimationFrame(() => setAnimate(true));
    }, 700);
    return () => clearTimeout(t);
  }, [userId]);

  const close = useCallback(() => {
    setLeaving(true);
    setTimeout(() => {
      localStorage.setItem(storageKey(userId), "done");
      setVisible(false);
      setLeaving(false);
    }, 250);
  }, [userId]);

  const handleCta = useCallback(() => {
    const current = STEPS[step];
    const isLast = step === STEPS.length - 1;

    if (isLast) {
      close();
      if (current.ctaHref) router.push(current.ctaHref);
      return;
    }

    if (current.ctaHref) {
      // Navigate and close — don't advance the stepper
      close();
      router.push(current.ctaHref);
    } else {
      // Advance to next step
      setStep((s) => s + 1);
    }
  }, [step, close, router]);

  const handleSkip = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      close();
    }
  }, [step, close]);

  if (!visible) return null;

  const current = STEPS[step];
  const isLast  = step === STEPS.length - 1;

  return (
    <div
      className={cn(
        "fixed inset-0 z-[200] flex items-center justify-center p-4 transition-opacity duration-300",
        animate && !leaving ? "opacity-100" : "opacity-0"
      )}
      aria-modal="true"
      role="dialog"
    >
      {/* Blurred backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-md"
        onClick={close}
      />

      {/* Modal card */}
      <div
        className={cn(
          "relative w-full max-w-md overflow-hidden rounded-2xl border border-white/30 bg-white/95 shadow-2xl backdrop-blur-2xl transition-all duration-300",
          animate && !leaving ? "scale-100 opacity-100 translate-y-0" : "scale-95 opacity-0 translate-y-2"
        )}
      >
        {/* Close button */}
        <button
          onClick={close}
          className="absolute right-4 top-4 z-10 rounded-full bg-white/80 p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Hero gradient section */}
        <div
          className={cn(
            "relative px-8 pb-6 pt-10 bg-gradient-to-br",
            current.gradientFrom,
            current.gradientTo
          )}
        >
          {/* Step indicator chip */}
          <div className="mb-5 flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  i === step
                    ? "w-6 bg-ocean"
                    : i < step
                    ? "w-2 bg-ocean/40"
                    : "w-2 bg-gray-200"
                )}
              />
            ))}
            <span className="ml-2 text-xs text-text-secondary font-medium">
              {step + 1} of {STEPS.length}
            </span>
          </div>

          <div
            className={cn(
              "inline-flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg",
              current.iconBg
            )}
          >
            <current.Icon className="h-7 w-7 text-white" />
          </div>

          <h2 className="mt-4 text-xl font-bold leading-snug text-text-primary">
            {current.title(userName ?? undefined)}
          </h2>
          <p className="mt-1 text-sm font-semibold text-ocean">{current.subtitle}</p>
        </div>

        {/* Body */}
        <div className="space-y-5 px-8 py-6">
          <p className="text-sm leading-relaxed text-text-secondary">{current.body}</p>

          {/* KYC mini flow visual */}
          {current.showKycFlow && (
            <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
              {[
                { Icon: FileCheck, label: "Upload Docs" },
                { Icon: User,      label: "Agent Review" },
                { Icon: BadgeCheck,label: "Approved" },
                { Icon: Store,     label: "Trade" },
              ].map(({ Icon: StepIcon, label }, i, arr) => (
                <div key={label} className="flex items-center gap-1.5">
                  <div className="flex flex-col items-center gap-1.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ocean/10">
                      <StepIcon className="h-4 w-4 text-ocean" />
                    </div>
                    <span className="whitespace-nowrap text-[10px] font-medium text-text-secondary">
                      {label}
                    </span>
                  </div>
                  {i < arr.length - 1 && (
                    <ChevronRight className="mb-4 h-3 w-3 shrink-0 text-gray-300" />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* CTA button */}
          <Button
            onClick={handleCta}
            className="h-11 w-full bg-ocean text-white hover:bg-ocean-dark"
          >
            {current.cta}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>

          {/* Skip link */}
          {current.skip ? (
            <button
              onClick={handleSkip}
              className="w-full py-1 text-center text-sm text-text-secondary transition-colors hover:text-text-primary"
            >
              {current.skip}
            </button>
          ) : (
            /* Spacer so card height stays stable when no skip link */
            <div className="h-6" />
          )}
        </div>
      </div>
    </div>
  );
}
