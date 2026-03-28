/**
 * Central SWR hooks for MarineXchange Africa.
 *
 * Pattern:
 *  - isLoading  = true only on the FIRST fetch (no cached data yet)
 *  - isValidating = true whenever a background revalidation is running
 *
 * On revisit the hook returns cached data instantly — no spinner, no flash.
 * Background polling silently updates the UI when new data arrives.
 */

import useSWR, { mutate as globalMutate } from "swr"
import {
  marketplace,
  purchaseRequests,
  deals,
  kyc,
  notifications,
  auctions,
  auctionBids,
  sellerDashboard,
  seller,
  admin,
  adminDeals,
  auctionAdmin,
  marketplaceAdmin,
  kycAdmin,
  prAdmin,
  prAgent,
  kycAgent,
  verificationAgent,
  reports,
  exchangeRates,
  dealAdmin,
  financeAdmin,
  adminSellers,
} from "./api"

// ── Poll intervals ────────────────────────────────────────────────────────────

const FAST = 15_000  // live auctions, notifications unread count
const STD  = 30_000  // most list pages
const SLOW = 60_000  // categories, exchange rates, reports

// ── Marketplace ───────────────────────────────────────────────────────────────

export function useMarketplace(params?: Parameters<typeof marketplace.browse>[0]) {
  return useSWR(["marketplace", params], () => marketplace.browse(params), {
    refreshInterval: STD,
  })
}

export function useMarketplaceCategories() {
  return useSWR("marketplace-categories", () => marketplace.getCategories(), {
    refreshInterval: SLOW,
  })
}

export function useMarketplaceProduct(id: string | null) {
  return useSWR(id ? ["marketplace-product", id] : null, () => marketplace.getProduct(id!), {
    refreshInterval: STD,
  })
}

export function invalidateMarketplace() {
  return globalMutate((k: unknown) => Array.isArray(k) && k[0] === "marketplace", undefined, { revalidate: true })
}

// ── Purchase Requests ─────────────────────────────────────────────────────────

export function usePurchaseRequests(params?: Parameters<typeof purchaseRequests.list>[0]) {
  return useSWR(
    params !== undefined ? ["purchase-requests", params] : null,
    () => purchaseRequests.list(params!),
    { refreshInterval: STD }
  )
}

export function invalidatePurchaseRequests() {
  return globalMutate((k: unknown) => Array.isArray(k) && k[0] === "purchase-requests", undefined, { revalidate: true })
}

// ── Deals ─────────────────────────────────────────────────────────────────────

export function useDeals(params?: Parameters<typeof deals.list>[0]) {
  return useSWR(
    params !== undefined ? ["deals", params] : null,
    () => deals.list(params!),
    { refreshInterval: STD }
  )
}

export function useMySales(params?: Parameters<typeof deals.listMySales>[0]) {
  return useSWR(
    params !== undefined ? ["deals-sales", params] : null,
    () => deals.listMySales(params!),
    { refreshInterval: STD }
  )
}

export function useDealPortal(token: string | null) {
  return useSWR(token ? ["deal-portal", token] : null, () => deals.get(token!), {
    refreshInterval: STD,
  })
}

export function invalidateDeals() {
  return globalMutate(
    (k: unknown) => Array.isArray(k) && (k[0] === "deals" || k[0] === "deals-sales"),
    undefined,
    { revalidate: true }
  )
}

// ── KYC (buyer/seller) ───────────────────────────────────────────────────────

export function useKycStatus(enabled = true) {
  return useSWR(enabled ? "kyc-status" : null, () => kyc.getStatus(), { refreshInterval: STD })
}

export function useKycDocuments() {
  return useSWR("kyc-documents", () => kyc.listDocuments(), { refreshInterval: STD })
}

export function invalidateKyc() {
  return globalMutate((k: unknown) => typeof k === "string" && k.startsWith("kyc"), undefined, {
    revalidate: true,
  })
}

// ── Auctions (public) ─────────────────────────────────────────────────────────

export function useAuctions(params?: Parameters<typeof auctions.list>[0]) {
  return useSWR(["auctions", params], () => auctions.list(params), { refreshInterval: FAST })
}

export function useAuction(id: string | null) {
  return useSWR(id ? ["auction", id] : null, () => auctions.get(id!), { refreshInterval: FAST })
}

export function useMyBids(params?: Parameters<typeof auctions.getMyBids>[0]) {
  return useSWR(
    params !== undefined ? ["my-bids", params] : null,
    () => auctions.getMyBids(params!),
    { refreshInterval: FAST }
  )
}

export function useAllMyBids() {
  return useSWR("all-my-bids", () => auctionBids.getAllMyBids(), { refreshInterval: FAST })
}

export function invalidateAuctions() {
  return globalMutate(
    (k: unknown) => Array.isArray(k) && (k[0] === "auctions" || k[0] === "auction"),
    undefined,
    { revalidate: true }
  )
}

// ── Notifications ─────────────────────────────────────────────────────────────

export function useNotifications(params?: Parameters<typeof notifications.list>[0]) {
  return useSWR(["notifications", params], () => notifications.list(params), {
    refreshInterval: FAST,
  })
}

export function useUnreadCount() {
  return useSWR("notifications-unread", () => notifications.unreadCount(), {
    refreshInterval: FAST,
  })
}

export function invalidateNotifications() {
  return globalMutate(
    (k: unknown) =>
      (Array.isArray(k) && k[0] === "notifications") || k === "notifications-unread",
    undefined,
    { revalidate: true }
  )
}

// ── Seller ────────────────────────────────────────────────────────────────────

export function useSellerDashboard() {
  return useSWR("seller-dashboard", () => sellerDashboard.get(), { refreshInterval: STD })
}

export function useSellerListings(params?: Parameters<typeof seller.listListings>[0]) {
  return useSWR(["seller-listings", params], () => seller.listListings(params), {
    refreshInterval: STD,
  })
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export function useAdminDashboard() {
  return useSWR("admin-dashboard", () => admin.getDashboard(), { refreshInterval: STD })
}

export function useAdminUsers(params?: Parameters<typeof admin.listUsers>[0]) {
  return useSWR(["admin-users", params], () => admin.listUsers(params), { refreshInterval: STD })
}

export function useAdminUser(id: string | null) {
  return useSWR(id ? ["admin-user", id] : null, () => admin.getUser(id!), { refreshInterval: STD })
}

export function invalidateAdminUsers() {
  return globalMutate(
    (k: unknown) => Array.isArray(k) && (k[0] === "admin-users" || k[0] === "admin-user"),
    undefined,
    { revalidate: true }
  )
}

export function useAdminSellers(params?: Parameters<typeof adminSellers.list>[0]) {
  return useSWR(["admin-sellers", params], () => adminSellers.list(params), { refreshInterval: 30000 })
}

// ── Admin KYC ─────────────────────────────────────────────────────────────────

export function useAdminKycQueue(params?: Parameters<typeof kycAdmin.listSubmissions>[0]) {
  return useSWR(["admin-kyc", params], () => kycAdmin.listSubmissions(params), {
    refreshInterval: STD,
  })
}

export function useAdminKycSubmission(id: string | null) {
  return useSWR(id ? ["admin-kyc-submission", id] : null, () => kycAdmin.getSubmission(id!), {
    refreshInterval: STD,
  })
}

export function invalidateAdminKyc() {
  return globalMutate(
    (k: unknown) => Array.isArray(k) && k[0].startsWith("admin-kyc"),
    undefined,
    { revalidate: true }
  )
}

// ── Admin Marketplace ─────────────────────────────────────────────────────────

export function useAdminListings(params?: Parameters<typeof marketplaceAdmin.list>[0]) {
  return useSWR(["admin-listings", params], () => marketplaceAdmin.list(params), {
    refreshInterval: STD,
  })
}

export function useAdminListing(id: string | null) {
  return useSWR(id ? ["admin-listing", id] : null, () => marketplaceAdmin.get(id!), {
    refreshInterval: STD,
  })
}

export function invalidateAdminListings() {
  return globalMutate(
    (k: unknown) => Array.isArray(k) && k[0].startsWith("admin-listing"),
    undefined,
    { revalidate: true }
  )
}

// ── Admin Purchase Requests ───────────────────────────────────────────────────

export function useAdminPurchaseRequests(params?: Parameters<typeof prAdmin.list>[0]) {
  return useSWR(["admin-prs", params], () => prAdmin.list(params), { refreshInterval: STD })
}

export function useAdminPurchaseRequest(id: string | null) {
  return useSWR(id ? ["admin-pr", id] : null, () => prAdmin.get(id!), { refreshInterval: STD })
}

export function invalidateAdminPRs() {
  return globalMutate(
    (k: unknown) => Array.isArray(k) && (k[0] === "admin-prs" || k[0] === "admin-pr"),
    undefined,
    { revalidate: true }
  )
}

// ── Admin Deals ───────────────────────────────────────────────────────────────

export function useAdminDeals(params?: Parameters<typeof dealAdmin.list>[0]) {
  return useSWR(["admin-deals", params], () => dealAdmin.list(params), { refreshInterval: STD })
}

export function useAdminDeal(id: string | null) {
  return useSWR(id ? ["admin-deal", id] : null, () => adminDeals.get(id!), { refreshInterval: STD })
}

export function useAdminDealDetail(id: string | null) {
  return useSWR(id ? ["admin-deal-detail", id] : null, () => dealAdmin.get(id!), {
    refreshInterval: STD,
  })
}

export function invalidateAdminDeals() {
  return globalMutate(
    (k: unknown) => Array.isArray(k) && k[0].startsWith("admin-deal"),
    undefined,
    { revalidate: true }
  )
}

// ── Admin Auctions ────────────────────────────────────────────────────────────

export function useAdminAuctions(params?: Parameters<typeof auctionAdmin.list>[0]) {
  return useSWR(["admin-auctions", params], () => auctionAdmin.list(params), {
    refreshInterval: FAST,
  })
}

export function useAdminAuction(id: string | null) {
  return useSWR(id ? ["admin-auction", id] : null, () => auctionAdmin.get(id!), {
    refreshInterval: FAST,
  })
}

export function invalidateAdminAuctions() {
  return globalMutate(
    (k: unknown) => Array.isArray(k) && k[0].startsWith("admin-auction"),
    undefined,
    { revalidate: true }
  )
}

// ── Reports ───────────────────────────────────────────────────────────────────

export function useReportsOverview() {
  return useSWR("reports-overview", () => reports.overview(), { refreshInterval: SLOW })
}

export function useReportsFinancial(from: string, to: string) {
  return useSWR(from && to ? ["reports-financial", from, to] : null, () => reports.financial(from, to), {
    refreshInterval: SLOW,
  })
}

// ── Exchange Rates ────────────────────────────────────────────────────────────

export function useExchangeRates() {
  return useSWR("exchange-rates", () => exchangeRates.list(), { refreshInterval: SLOW })
}

export function invalidateExchangeRates() {
  return globalMutate("exchange-rates", undefined, { revalidate: true })
}

// ── Finance Admin ─────────────────────────────────────────────────────────────

export function useFinanceQueue() {
  return useSWR("finance-queue", () => financeAdmin.listPendingPayments(), {
    refreshInterval: STD,
  })
}

// ── Agent ─────────────────────────────────────────────────────────────────────

export function useAgentKycQueue(params?: Parameters<typeof kycAgent.getQueue>[0]) {
  return useSWR(["agent-kyc", params], () => kycAgent.getQueue(params), {
    refreshInterval: STD,
  })
}

export function useAgentAssignments(params?: Parameters<typeof verificationAgent.listAssignments>[0]) {
  return useSWR(["agent-marketplace", params], () => verificationAgent.listAssignments(params), {
    refreshInterval: STD,
  })
}

export function useAgentPurchaseRequests() {
  return useSWR("agent-purchase-requests", () => prAgent.listAssigned(), {
    refreshInterval: STD,
  })
}
