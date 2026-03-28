import type { TourStep } from "./tour-engine";

// ─── Dashboard ────────────────────────────────────────────────────────────────

export const DASHBOARD_TOUR: TourStep[] = [
  {
    selector: "nav-marketplace",
    title: "Browse the Marketplace",
    description:
      "Tap here to explore thousands of verified maritime vessels, equipment, and spare parts from sellers across Africa.",
  },
  {
    selector: "nav-kyc",
    title: "Identity Verification (KYC)",
    description:
      "You must complete KYC before you can make purchases or bid in auctions. Tap here to start — it takes just a few minutes.",
  },
  {
    selector: "dashboard-kyc-stat",
    title: "Your KYC Status",
    description:
      "This card always shows your current verification status. 'Action needed' means there's a step to complete — tap it to go straight to your KYC page.",
  },
  {
    selector: "notifications-bell",
    title: "Stay in the Loop",
    description:
      "All updates — KYC decisions, deal progress, seller replies — appear here as notifications in real time.",
  },
  {
    selector: "profile-link",
    title: "Complete Your Profile",
    description:
      "Tap your avatar to update your company name, phone, and country. Sellers check your profile before responding — make a strong first impression.",
  },
];

// ─── KYC ──────────────────────────────────────────────────────────────────────

export const KYC_TOUR: TourStep[] = [
  {
    selector: "kyc-status-banner",
    title: "Your Current KYC Status",
    description:
      "This banner always reflects where you stand — Not Submitted, Under Review, Approved, or Rejected. Check here first whenever you come back.",
  },
  {
    selector: "kyc-progress",
    title: "Verification Progress",
    description:
      "Track each step: Account Created → Documents Submitted → Under Review → Verified & Trading. Every action you take moves you forward on this track.",
  },
  {
    selector: "kyc-action-btn",
    title: "Submit Your Documents",
    description:
      "Tap this to upload your required documents — passport or national ID, business registration certificate, and proof of address. Our team reviews within 1–2 business days.",
  },
];

// ─── Marketplace ──────────────────────────────────────────────────────────────

export const MARKETPLACE_TOUR: TourStep[] = [
  {
    selector: "marketplace-search",
    title: "Search & Filter Assets",
    description:
      "Type a keyword — 'vessel', 'crane', 'generator' — or use the filters on the left to narrow by category, condition, price range, or country.",
  },
  {
    selector: "marketplace-first-card",
    title: "Tap a Listing to View Details",
    description:
      "Each card shows the asset price, location, and condition. Tap it to see full photos, specifications, and contact the seller. KYC must be approved to submit a purchase request.",
  },
];

// ─── Auctions ─────────────────────────────────────────────────────────────────

export const AUCTIONS_TOUR: TourStep[] = [
  {
    selector: "auction-live-banner",
    title: "Live Auction Counter",
    description:
      "This tells you how many auctions are running right now. All bids are KYC-verified and escrow-protected — you must complete identity verification before you can place a bid.",
  },
  {
    selector: "auction-tabs",
    title: "Filter by Status",
    description:
      "Switch between All, Live, Ending Soon, Upcoming, and My Bids. 'Ending Soon' auctions have a countdown — the current highest bidder wins when the timer hits zero.",
  },
  {
    selector: "auction-search",
    title: "Search Auctions",
    description:
      "Type any keyword to instantly filter auction listings. Try 'vessel', 'crane', or a specific tonnage.",
  },
  {
    selector: "auction-grid",
    title: "Auction Cards",
    description:
      "Each card shows the current bid, bid count, and time remaining. Cards highlighted in red are ending soon — act fast. Tap any card to view full details and place your bid.",
  },
];

// ─── Purchase Requests ────────────────────────────────────────────────────────

export const PURCHASE_REQUESTS_TOUR: TourStep[] = [
  {
    selector: "pr-new-btn",
    title: "Start a Purchase Request",
    description:
      "Found an asset you want? Tap here to go to the marketplace, select a listing, and submit a purchase request directly to the seller with your offered price and terms.",
  },
  {
    selector: "pr-tabs",
    title: "Track Request Status",
    description:
      "Your requests move through these stages: Pending → Negotiating → Accepted → Deal Created. Filter here to focus on what needs attention right now.",
  },
  {
    selector: "pr-search",
    title: "Search Your Requests",
    description:
      "If you have many requests, use this to quickly find one by asset name.",
  },
  {
    selector: "pr-audit-footer",
    title: "Fully Audited",
    description:
      "Every purchase request is logged in the audit trail — timestamps, status changes, and all communications are permanently recorded for your protection.",
  },
];

// ─── My Deals ─────────────────────────────────────────────────────────────────

export const DEALS_TOUR: TourStep[] = [
  {
    selector: "deals-tabs",
    title: "Track Deal Progress",
    description:
      "Deals move through: In Progress → Awaiting Payment → Payment Received → Completed. Use these tabs to focus on what needs action from you.",
  },
  {
    selector: "deals-search",
    title: "Find a Deal",
    description:
      "Search by asset name to quickly locate a specific deal, especially useful once you have multiple active transactions.",
  },
  {
    selector: "deals-escrow-footer",
    title: "Escrow Protected",
    description:
      "Every deal on MarineXchange is escrow-protected. Funds are held securely until all agreed conditions are met and both parties confirm. You are never exposed.",
  },
];

// ─── Profile ──────────────────────────────────────────────────────────────────

export const PROFILE_TOUR: TourStep[] = [
  {
    selector: "profile-header",
    title: "Your Profile Card",
    description:
      "This shows your name, email, account roles, and KYC badge. Tap the camera icon on the avatar to upload a profile photo — it builds trust with sellers.",
  },
  {
    selector: "profile-tabs",
    title: "Account Settings",
    description:
      "Four sections: Personal Info (your details), Password (security), Notifications (what alerts you receive), and Security (active sessions and account actions).",
  },
  {
    selector: "profile-form",
    title: "Complete Your Details",
    description:
      "Fill in your company name, phone number, and country. Sellers review this before responding to purchase requests — a complete profile gets faster replies.",
  },
  {
    selector: "profile-save-btn",
    title: "Save Your Changes",
    description:
      "Always tap Save Changes after updating your details. Nothing is saved automatically.",
  },
  {
    selector: "profile-upgrade-seller",
    title: "Want to Sell Too?",
    description:
      "You can also list assets on MarineXchange. Tap 'Upgrade to Seller' to add seller capabilities to your account at no cost — list vessels, equipment, and parts.",
  },
];
