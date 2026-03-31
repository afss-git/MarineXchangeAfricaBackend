/**
 * API client for MarineXchange Africa backend.
 * All requests go through Next.js rewrites → http://localhost:8000/api/v1
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api/v1"

// ── Types ────────────────────────────────────────────────────────────────────

export interface UserProfile {
  id: string
  email: string
  full_name: string
  company_name: string | null
  company_reg_no: string | null
  phone: string | null
  country: string | null
  avatar_url: string | null
  roles: string[]
  kyc_status: string
  is_active: boolean
  created_at: string
}

export interface AuthTokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  user: UserProfile
}

export interface MessageResponse {
  message: string
  detail?: string
}

export interface ApiError {
  detail: string | { msg: string; loc: string[]; type: string }[]
}

// ── Marketplace types ────────────────────────────────────────────────────────

export interface ProductListItem {
  id: string
  title: string
  category_id: string | null
  category_name: string | null
  availability_type: string
  condition: string
  asking_price: string
  currency: string
  location_country: string
  location_port: string | null
  status: string
  primary_image_url: string | null
  created_at: string
  seller_id: string
  seller_company: string | null
}

export interface ProductImage {
  id: string
  storage_path: string
  signed_url: string
  original_name: string | null
  is_primary: boolean
  display_order: number
}

export interface ProductAttributeValue {
  attribute_id: string
  attribute_name: string
  attribute_slug: string
  value_text: string | null
  value_numeric: string | null
  value_boolean: boolean | null
  value_date: string | null
}

export interface ProductDetail {
  id: string
  seller_id: string
  seller_company: string | null
  title: string
  description: string | null
  category_id: string | null
  category_name: string | null
  availability_type: string
  condition: string
  asking_price: string
  currency: string
  location_country: string
  location_port: string | null
  location_details: string | null
  status: string
  verification_cycle: number
  is_auction: boolean
  images: ProductImage[]
  attribute_values: ProductAttributeValue[]
  created_at: string
  updated_at: string
  // Seller / admin only fields (present when fetched by owner, agent, or admin)
  verification_agent: string | null
  verification_assignment_id: string | null
  submitted_at: string | null
  admin_notes: string | null
  rejection_reason: string | null
  corrections_reason: string | null
}

export interface PaginatedProducts {
  items: ProductListItem[]
  total: number
  page: number
  page_size: number
  pages: number
}

export interface CategoryResponse {
  id: string
  name: string
  slug: string
  parent_id: string | null
  subcategories: CategoryResponse[]
}

// ── KYC types ────────────────────────────────────────────────────────────────

export interface KycDocument {
  id: string
  submission_id: string
  document_type_id: string
  document_type_name: string
  document_type_slug: string
  storage_path: string
  signed_url: string
  original_name: string | null
  file_size_bytes: number | null
  mime_type: string | null
  file_hash: string
  uploaded_at: string
}

export interface KycStatusResponse {
  kyc_status: string
  kyc_expires_at: string | null
  kyc_attempt_count: number
  current_submission_id: string | null
  current_submission_status: string | null
  documents: KycDocument[]
  rejection_reason: string | null
  required_document_types: { id: string; name: string; slug: string; is_required: boolean }[]
}

export interface DocumentTypeResponse {
  id: string
  name: string
  slug: string
  description: string | null
  is_required: boolean
  is_active: boolean
  display_order: number
}

// ── Purchase Request types ────────────────────────────────────────────────────

export interface PurchaseRequest {
  id: string
  product_id: string
  product_title: string | null
  buyer_id: string
  purchase_type: string
  quantity: number
  offered_price: string | null
  offered_currency: string
  message: string | null
  status: string
  admin_notes: string | null
  converted_deal_id: string | null
  cancelled_reason: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

export interface PurchaseRequestList {
  items: PurchaseRequest[]
  total: number
}

// ── Deal types ────────────────────────────────────────────────────────────────

export interface Deal {
  id: string
  reference: string
  product_id: string
  product_title: string | null
  buyer_id: string
  seller_id: string
  status: string
  current_milestone: string | null
  asking_price: string
  agreed_price: string | null
  currency: string
  escrow_status: string | null
  created_at: string
  updated_at: string
}

export interface DealList {
  items: Deal[]
  total: number
}

// ── Seller listing types ──────────────────────────────────────────────────────

export interface SellerListing extends ProductListItem {
  // same shape as ProductListItem but represents seller's own listings
  updated_at: string
}

export interface SellerListingList {
  items: SellerListing[]
  total: number
  page: number
  page_size: number
  pages: number
}

// ── Notification types ────────────────────────────────────────────────────────

export interface Notification {
  id: string
  user_id: string
  title: string
  body: string
  category: string
  resource_type: string | null
  resource_id: string | null
  is_read: boolean
  read_at: string | null
  created_at: string
}

export interface NotificationList {
  items: Notification[]
  total: number
  unread_count: number
  page: number
  page_size: number
}

export interface UnreadCountResponse {
  unread_count: number
}

// ── Error handling ───────────────────────────────────────────────────────────

export class ApiRequestError extends Error {
  status: number
  body: unknown

  constructor(status: number, body: unknown) {
    const detail = typeof body === "object" && body !== null && "detail" in body
      ? (body as ApiError).detail
      : null
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
        ? detail.map((e: unknown) => {
            if (typeof e === "object" && e !== null) {
              const err = e as Record<string, unknown>
              const field = Array.isArray(err.loc) ? (err.loc as unknown[]).slice(-1)[0] : null
              const msg   = typeof err.msg === "string" ? err.msg : JSON.stringify(err)
              return field ? `${field}: ${msg}` : msg
            }
            return String(e)
          }).join(" · ")
        : detail != null
        ? JSON.stringify(detail)
        : `Request failed (${status})`
    super(message)
    this.name = "ApiRequestError"
    this.status = status
    this.body = body
  }
}

// ── Fetch wrapper ────────────────────────────────────────────────────────────

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${API_BASE}${path}`

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  }

  // Attach token if available (client-side only)
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("access_token")
    if (token) {
      headers["Authorization"] = `Bearer ${token}`
    }
  }

  const res = await fetch(url, {
    ...options,
    headers,
  })

  // Handle no-content responses
  if (res.status === 204) return undefined as T

  const body = await res.json().catch(() => null)

  if (!res.ok) {
    throw new ApiRequestError(res.status, body)
  }

  return body as T
}

// Multipart upload helper (no Content-Type header — browser sets boundary)
async function upload<T>(path: string, formData: FormData): Promise<T> {
  const url = `${API_BASE}${path}`
  const headers: Record<string, string> = {}
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("access_token")
    if (token) headers["Authorization"] = `Bearer ${token}`
  }
  const res = await fetch(url, { method: "POST", headers, body: formData })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new ApiRequestError(res.status, body)
  return body as T
}

// ── Auth endpoints ───────────────────────────────────────────────────────────

export const auth = {
  buyerSignup: (data: {
    email: string
    password: string
    full_name: string
    phone: string
    country: string
    company_name?: string
  }) => request<MessageResponse>("/auth/buyer/signup", {
    method: "POST",
    body: JSON.stringify(data),
  }),

  sellerSignup: (data: {
    email: string
    password: string
    full_name: string
    phone: string
    country: string
    company_name: string
    company_reg_no: string
  }) => request<MessageResponse>("/auth/seller/signup", {
    method: "POST",
    body: JSON.stringify(data),
  }),

  sellerBuyerSignup: (data: {
    email: string
    password: string
    full_name: string
    phone: string
    country: string
    company_name: string
    company_reg_no: string
  }) => request<MessageResponse>("/auth/seller-buyer/signup", {
    method: "POST",
    body: JSON.stringify(data),
  }),

  buyerLogin: (data: { email: string; password: string }) =>
    request<AuthTokenResponse>("/auth/buyer/login", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  sellerLogin: (data: { email: string; password: string }) =>
    request<AuthTokenResponse>("/auth/seller/login", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Generic login — tries each portal in order, stops on success or wrong-password (401)
  login: async (data: { email: string; password: string }): Promise<AuthTokenResponse> => {
    const endpoints = [
      "/auth/buyer/login",
      "/auth/seller/login",
      "/auth/agent/login",
      "/auth/admin/login",
      "/auth/finance-admin/login",
    ]
    let wrongPortalErr: unknown  // 403 "wrong portal" — keep trying
    for (const endpoint of endpoints) {
      try {
        return await request<AuthTokenResponse>(endpoint, {
          method: "POST", body: JSON.stringify(data),
        })
      } catch (err) {
        if (err instanceof ApiRequestError) {
          // 401 = wrong password — stop immediately, don't try other portals
          if (err.status === 401) throw err
          // 403 = wrong portal or unconfirmed email — save and keep trying other portals
          if (err.status === 403) { wrongPortalErr = err; continue }
          // 5xx or other — surface immediately with a clean message
          throw new ApiRequestError("Service unavailable. Please try again in a moment.", 503)
        }
        throw err
      }
    }
    // All portals returned 403 — show a clean generic message instead of the last portal name
    if (wrongPortalErr instanceof ApiRequestError && wrongPortalErr.status === 403) {
      const msg = wrongPortalErr.message ?? ""
      // "email not confirmed" style messages should be shown as-is
      if (msg.toLowerCase().includes("verify") || msg.toLowerCase().includes("confirm")) throw wrongPortalErr
    }
    throw new ApiRequestError("Invalid email or password.", 401)
  },

  logout: async (): Promise<MessageResponse> => {
    // Try all logout endpoints — only one will succeed depending on the role
    const endpoints = [
      "/auth/buyer/logout",
      "/auth/agent/logout",
      "/auth/admin/logout",
    ]
    for (const endpoint of endpoints) {
      try {
        return await request<MessageResponse>(endpoint, { method: "POST" })
      } catch {
        // continue
      }
    }
    return { message: "Logged out" }
  },

  getMe: () => request<UserProfile>("/auth/me"),
}

// ── Marketplace endpoints ─────────────────────────────────────────────────────

export const marketplace = {
  browse: (params?: {
    page?: number
    page_size?: number
    category_id?: string
    condition?: string
    location_country?: string
    min_price?: number
    max_price?: number
    q?: string
    availability_type?: string
  }) => {
    const qs = new URLSearchParams()
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") qs.set(k, String(v))
      })
    }
    const query = qs.toString() ? `?${qs}` : ""
    return request<PaginatedProducts>(`/marketplace/catalog${query}`)
  },

  getProduct: (id: string) =>
    request<ProductDetail>(`/marketplace/catalog/${id}`),

  getCategories: () =>
    request<CategoryResponse[]>("/marketplace/categories"),
}

// ── Seller listing endpoints ──────────────────────────────────────────────────

export const seller = {
  listListings: (params?: { page?: number; page_size?: number; status?: string }) => {
    const qs = new URLSearchParams()
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") qs.set(k, String(v))
      })
    }
    const query = qs.toString() ? `?${qs}` : ""
    return request<PaginatedProducts>(`/marketplace/listings${query}`)
  },

  getListing: (id: string) =>
    request<ProductDetail>(`/marketplace/listings/${id}`),

  createListing: (data: {
    title: string
    category_id: string
    description?: string
    availability_type: string
    condition: string
    location_country: string
    location_port?: string
    asking_price: number
    currency?: string
    contact: { contact_name: string; email: string; phone?: string | null }
  }) => request<ProductDetail>("/marketplace/listings", {
    method: "POST",
    body: JSON.stringify(data),
  }),

  updateListing: (id: string, data: Partial<{
    title: string
    description: string
    asking_price: number
    condition: string
    availability_type: string
    location_country: string
    location_port: string
    category_id: string
  }>) => request<ProductDetail>(`/marketplace/listings/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  }),

  deleteListing: (id: string) =>
    request<MessageResponse>(`/marketplace/listings/${id}`, { method: "DELETE" }),

  submitListing: (id: string) =>
    request<{ message: string; product_id: string; new_status: string }>(
      `/marketplace/listings/${id}/submit`, { method: "POST" }
    ),

  uploadImage: (listingId: string, formData: FormData) =>
    upload<ProductImage>(`/marketplace/listings/${listingId}/images`, formData),

  deleteImage: (listingId: string, imageId: string) =>
    request<MessageResponse>(
      `/marketplace/listings/${listingId}/images/${imageId}`,
      { method: "DELETE" }
    ),

  setPrimaryImage: (listingId: string, imageId: string) =>
    request<MessageResponse>(
      `/marketplace/listings/${listingId}/images/${imageId}/primary`,
      { method: "PATCH" }
    ),

  resubmitListing: (id: string) =>
    request<{ message: string; product_id: string; new_status: string }>(
      `/marketplace/listings/${id}/resubmit`, { method: "POST" }
    ),

  getVerificationStatus: (listingId: string) =>
    request<SellerVerificationStatus | null>(`/marketplace/listings/${listingId}/verification`),

  getTimeline: (listingId: string) =>
    request<ProductTimelineEvent[]>(`/marketplace/listings/${listingId}/timeline`),

  uploadDocument: (listingId: string, formData: FormData) =>
    upload<ProductDocument>(`/marketplace/listings/${listingId}/documents`, formData),

  deleteDocument: (listingId: string, docId: string) =>
    request<MessageResponse>(`/marketplace/listings/${listingId}/documents/${docId}`, { method: "DELETE" }),
}

// ── Seller dashboard types ────────────────────────────────────────────────────

export interface SellerDashboardStats {
  listings: {
    total_listings: number
    active_listings: number
    listings_with_activity: number
    sold_listings: number
    draft_listings: number
    pending_review: number
    active_listings_value: string
    sold_listings_value: string
  }
  deals: {
    total_deals: number
    active_deals: number
    completed_deals: number
    problem_deals: number
    cancelled_deals: number
    total_revenue: string
    revenue_this_month: string
    revenue_last_month: string
  }
  purchase_requests: {
    total_requests: number
    open_requests: number
    approved_requests: number
    converted_requests: number
    closed_requests: number
  }
  auctions: {
    total_auctions: number
    live_auctions: number
    scheduled_auctions: number
    closed_auctions: number
    cancelled_auctions: number
    total_bids_received: number
  }
  recent_deals: {
    id: string
    deal_ref: string
    status: string
    total_price: string
    currency: string
    buyer_name: string | null
    product_title: string | null
    created_at: string
  }[]
}

// ── Seller dashboard endpoint ─────────────────────────────────────────────────

export const sellerDashboard = {
  get: () => request<SellerDashboardStats>("/seller/dashboard"),
}

// ── KYC endpoints ─────────────────────────────────────────────────────────────

export const kyc = {
  getStatus: () =>
    request<KycStatusResponse>("/kyc/me"),

  listDocuments: () =>
    request<KycDocument[]>("/kyc/me/documents"),

  uploadDocument: (formData: FormData) =>
    upload<KycDocument>("/kyc/me/documents", formData),

  deleteDocument: (documentId: string) =>
    request<MessageResponse>(`/kyc/me/documents/${documentId}`, { method: "DELETE" }),

  submit: () =>
    request<MessageResponse>("/kyc/me/submit", { method: "POST" }),

  resubmit: () =>
    request<MessageResponse>("/kyc/me/resubmit", { method: "POST" }),

  getDocumentTypes: () =>
    request<DocumentTypeResponse[]>("/kyc/document-types"),
}

// ── Purchase Request endpoints ────────────────────────────────────────────────

export const purchaseRequests = {
  list: (params?: { page?: number; page_size?: number; status?: string }) => {
    const qs = new URLSearchParams()
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") qs.set(k, String(v))
      })
    }
    const query = qs.toString() ? `?${qs}` : ""
    return request<PurchaseRequestList>(`/purchase-requests/my${query}`)
  },

  get: (id: string) =>
    request<PurchaseRequest>(`/purchase-requests/${id}`),

  create: (data: {
    product_id: string
    purchase_type: string
    offered_price: number
    offered_currency?: string
    message?: string
    quantity?: number
  }) => request<PurchaseRequest>("/purchase-requests/", {
    method: "POST",
    body: JSON.stringify(data),
  }),

  cancel: (id: string) =>
    request<MessageResponse>(`/purchase-requests/${id}`, { method: "DELETE" }),
}

// ── Deal endpoints ─────────────────────────────────────────────────────────────

export const deals = {
  list: (params?: { page?: number; page_size?: number; status?: string }) => {
    const qs = new URLSearchParams()
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") qs.set(k, String(v))
      })
    }
    const query = qs.toString() ? `?${qs}` : ""
    return request<DealList>(`/deals/my${query}`)
  },

  listMySales: (params?: { page?: number; page_size?: number; status?: string }) => {
    const qs = new URLSearchParams()
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") qs.set(k, String(v))
      })
    }
    const query = qs.toString() ? `?${qs}` : ""
    return request<DealList>(`/deals/my-sales${query}`)
  },

  get: (token: string) =>
    request<Deal>(`/deals/portal/${token}`),
}

// ── Notification endpoints ────────────────────────────────────────────────────

export const notifications = {
  list: (params?: { page?: number; page_size?: number; unread_only?: boolean }) => {
    const qs = new URLSearchParams()
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null) qs.set(k, String(v))
      })
    }
    const query = qs.toString() ? `?${qs}` : ""
    return request<NotificationList>(`/notifications/${query}`)
  },

  unreadCount: () =>
    request<UnreadCountResponse>("/notifications/unread-count"),

  markRead: (id: string) =>
    request<MessageResponse>(`/notifications/${id}/read`, { method: "PATCH" }),

  markAllRead: () =>
    request<MessageResponse>("/notifications/read-all", { method: "POST" }),
}

// ── Auction types ─────────────────────────────────────────────────────────────

export interface PublicBidItem {
  id: string
  bidder_company: string | null
  amount: string
  currency: string
  is_winning_bid: boolean
  bid_time: string
}

export interface PublicAuctionDetail {
  id: string
  product_id: string
  product_title: string | null
  title: string
  description: string | null
  currency: string
  starting_bid: string
  min_bid_increment_usd: string
  min_bid_increment_pct: string
  min_next_bid: string
  current_highest_bid: string | null
  reserve_status: string
  status: string
  start_time: string
  end_time: string
  original_end_time: string
  auto_extend_minutes: number
  max_extensions: number
  extensions_count: number
  time_remaining_seconds: number
  bid_count: number
  recent_bids: PublicBidItem[]
  created_at: string
}

export interface PublicAuctionListItem {
  id: string
  product_id: string
  product_title: string | null
  title: string
  status: string
  currency: string
  starting_bid: string
  current_highest_bid: string | null
  reserve_status: string
  min_next_bid: string
  bid_count: number
  end_time: string
  time_remaining_seconds: number
  extensions_count: number
}

export interface PublicAuctionList {
  items: PublicAuctionListItem[]
  total: number
}

export interface PlaceBidResponse {
  bid_id: string
  auction_id: string
  amount: string
  currency: string
  is_winning_bid: boolean
  bid_time: string
  new_end_time: string
  extended: boolean
  extensions_count: number
  min_next_bid: string
  reserve_status: string
}

export interface MyBidItem {
  id: string
  auction_id: string
  auction_title: string | null
  amount: string
  currency: string
  is_winning_bid: boolean
  bid_time: string
}

export interface MyBidList {
  items: MyBidItem[]
  total: number
}

// ── Deal detail types ─────────────────────────────────────────────────────────

export interface ScheduleInstallment {
  installment_number: number
  due_date: string
  amount_due: string
  opening_balance: string
  finance_charge: string
  principal_amount: string
  closing_balance: string
}

export interface DealPortal {
  deal_ref: string
  deal_type: string
  status: string
  product_title: string
  product_description: string | null
  total_price: string
  currency: string
  arrangement_fee: string
  payment_account: {
    bank_name: string
    account_name: string
    account_number: string
    sort_code: string | null
    swift_code: string | null
    currency: string
    country: string
  } | null
  payment_deadline: string | null
  payment_instructions: string | null
  total_amount_payable: string | null
  initial_payment_amount: string | null
  financed_amount: string | null
  monthly_finance_rate_display: string | null
  duration_months: number | null
  total_finance_charge: string | null
  first_monthly_payment: string | null
  schedule_preview: ScheduleInstallment[] | null
  accepted_at: string | null
  portal_token_expires_at: string | null
}

export interface DealSchedule {
  items: ScheduleInstallment[]
  total: number
}

// ── Payment types ─────────────────────────────────────────────────────────────

export interface ScheduleItemOut {
  id: string
  schedule_id: string
  deal_id: string
  installment_number: number
  label: string
  amount: string
  currency: string
  due_date: string
  status: string   // pending | verified | overdue | waived
  verified_by: string | null
  verified_at: string | null
  waived_by: string | null
  waived_at: string | null
  waiver_reason: string | null
  created_at: string
  updated_at: string
}

export interface PaymentScheduleOut {
  id: string
  deal_id: string
  mode: string   // auto | manual
  total_items: number
  currency: string
  is_complete: boolean
  completed_at: string | null
  created_by: string
  created_at: string
  items: ScheduleItemOut[]
}

export interface EvidenceOut {
  id: string
  payment_record_id: string
  file_name: string
  file_path: string
  file_size_bytes: number | null
  mime_type: string
  uploaded_at: string
}

export interface PaymentRecordOut {
  id: string
  schedule_item_id: string
  deal_id: string
  submitted_by: string
  amount_paid: string
  currency: string
  payment_method: string
  payment_date: string
  bank_name: string | null
  bank_reference: string | null
  notes: string | null
  status: string   // pending_review | verified | rejected
  reviewed_by: string | null
  reviewed_at: string | null
  rejection_reason: string | null
  submitted_at: string
  evidence: EvidenceOut[]
}

export interface DealPaymentSummary {
  schedule_id: string | null
  total_items: number
  verified_count: number
  pending_count: number
  overdue_count: number
  waived_count: number
  is_complete: boolean
  total_amount: string
  verified_amount: string
  outstanding_amount: string
}

export interface AdminDealDetail {
  id: string
  reference: string
  product_id: string
  product_title: string | null
  buyer_id: string
  buyer_name: string | null
  buyer_email: string | null
  seller_id: string
  seller_name: string | null
  deal_type: string
  status: string
  current_milestone: string | null
  asking_price: string
  agreed_price: string | null
  currency: string
  arrangement_fee: string | null
  escrow_status: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

// ── Payments — Buyer ──────────────────────────────────────────────────────────

export const payments = {
  buyer: {
    getSchedule: (dealId: string) =>
      request<PaymentScheduleOut>(`/payments/buyer/deals/${dealId}/schedule`),

    listRecords: (dealId: string) =>
      request<PaymentRecordOut[]>(`/payments/buyer/deals/${dealId}/payments`),

    submitPayment: (dealId: string, itemId: string, data: {
      amount_paid: number
      currency: string
      payment_method: string
      payment_date: string
      bank_name?: string
      bank_reference?: string
      notes?: string
    }) => request<PaymentRecordOut>(
      `/payments/buyer/deals/${dealId}/items/${itemId}/pay`,
      { method: "POST", body: JSON.stringify(data) }
    ),

    uploadEvidence: (recordId: string, dealId: string, formData: FormData) =>
      upload<EvidenceOut>(
        `/payments/buyer/records/${recordId}/evidence?deal_id=${dealId}`,
        formData
      ),

    getSummary: (dealId: string) =>
      request<DealPaymentSummary>(`/payments/buyer/deals/${dealId}/summary`),
  },

  // ── Payments — Admin ────────────────────────────────────────────────────────

  admin: {
    createSchedule: (dealId: string, data: {
      mode: "auto" | "manual"
      installments: number | { label: string; amount: number; due_date: string }[]
      currency?: string
    }) => request<PaymentScheduleOut>(
      `/payments/admin/deals/${dealId}/schedule`,
      { method: "POST", body: JSON.stringify(data) }
    ),

    getSchedule: (dealId: string) =>
      request<PaymentScheduleOut>(`/payments/admin/deals/${dealId}/schedule`),

    deleteSchedule: (dealId: string) =>
      request<MessageResponse>(`/payments/admin/deals/${dealId}/schedule`, { method: "DELETE" }),

    listRecords: (dealId: string) =>
      request<PaymentRecordOut[]>(`/payments/admin/deals/${dealId}/payments`),

    verifyPayment: (recordId: string, notes?: string) =>
      request<PaymentRecordOut>(`/payments/admin/payments/${recordId}/verify`, {
        method: "POST",
        body: JSON.stringify({ notes: notes ?? null }),
      }),

    rejectPayment: (recordId: string, rejection_reason: string) =>
      request<PaymentRecordOut>(`/payments/admin/payments/${recordId}/reject`, {
        method: "POST",
        body: JSON.stringify({ rejection_reason }),
      }),

    waiveItem: (itemId: string, waiver_reason: string) =>
      request<ScheduleItemOut>(`/payments/admin/schedule-items/${itemId}/waive`, {
        method: "POST",
        body: JSON.stringify({ waiver_reason }),
      }),

    getSummary: (dealId: string) =>
      request<DealPaymentSummary>(`/payments/admin/deals/${dealId}/summary`),
  },
}

// ── Admin deals ───────────────────────────────────────────────────────────────

export const adminDeals = {
  list: (params?: { page?: number; page_size?: number; status?: string }) => {
    const qs = new URLSearchParams()
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") qs.set(k, String(v))
      })
    }
    const query = qs.toString() ? `?${qs}` : ""
    return request<AdminDealDetail[]>(`/deals${query}`)
  },

  get: (id: string) =>
    request<AdminDealDetail>(`/deals/${id}`),

  cancel: (id: string, reason: string) =>
    request<AdminDealDetail>(`/deals/${id}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
}

// ── Auctions endpoints ────────────────────────────────────────────────────────

export const auctions = {
  list: (params?: {
    page?: number
    page_size?: number
    status?: string
  }) => {
    const qs = new URLSearchParams()
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") qs.set(k, String(v))
      })
    }
    const query = qs.toString() ? `?${qs}` : ""
    return request<PublicAuctionList>(`/auctions/${query}`)
  },

  get: (id: string) =>
    request<PublicAuctionDetail>(`/auctions/${id}`),

  placeBid: (auctionId: string, amount: number) =>
    request<PlaceBidResponse>(`/auctions/${auctionId}/bids`, {
      method: "POST",
      body: JSON.stringify({ amount }),
    }),

  getMyBids: (params?: { page?: number; page_size?: number }) => {
    const qs = new URLSearchParams()
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined) qs.set(k, String(v))
      })
    }
    const query = qs.toString() ? `?${qs}` : ""
    return request<MyBidList>(`/auctions/bids/my${query}`)
  },
}

// ── Admin auction types ───────────────────────────────────────────────────────

export interface AdminBidItem {
  id: string
  bidder_id: string
  bidder_company: string | null
  amount: string
  currency: string
  is_winning_bid: boolean
  bid_time: string
}

export interface AdminAuctionDetail {
  id: string
  product_id: string
  product_title: string | null
  created_by: string
  title: string
  description: string | null
  starting_bid: string
  reserve_price: string | null
  currency: string
  min_bid_increment_usd: string
  start_time: string
  end_time: string
  original_end_time: string
  auto_extend_minutes: number
  max_extensions: number
  extensions_count: number
  current_highest_bid: string | null
  current_winner_id: string | null
  winner_company: string | null
  winner_approved_by: string | null
  winner_approved_at: string | null
  winner_rejection_reason: string | null
  converted_deal_id: string | null
  status: string
  admin_notes: string | null
  bid_count: number
  bids: AdminBidItem[]
  created_at: string
  updated_at: string
}

export interface AdminAuctionListItem {
  id: string
  product_id: string
  product_title: string | null
  title: string
  status: string
  currency: string
  starting_bid: string
  current_highest_bid: string | null
  bid_count: number
  start_time: string
  end_time: string
  extensions_count: number
  created_at: string
}

export interface AdminAuctionList {
  items: AdminAuctionListItem[]
  total: number
}

export interface AuctionConvertResponse {
  deal_id: string
  deal_ref: string
  deal_status: string
  auction_id: string
  message: string
}

// ── Admin auction endpoints ───────────────────────────────────────────────────

type AuctionBody = {
  product_id?: string; title?: string; description?: string
  starting_bid?: number; reserve_price?: number; currency?: string
  min_bid_increment_usd?: number; start_time?: string; end_time?: string
  auto_extend_minutes?: number; max_extensions?: number; admin_notes?: string
}

export const auctionAdmin = {
  list: (params?: { page?: number; page_size?: number; status?: string }) => {
    const qs = new URLSearchParams()
    if (params) Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v))
    })
    const query = qs.toString() ? `?${qs}` : ""
    return request<AdminAuctionList>(`/auctions/admin${query}`)
  },

  get: (id: string) =>
    request<AdminAuctionDetail>(`/auctions/admin/${id}`),

  create: (data: Required<Pick<AuctionBody, "product_id" | "title" | "starting_bid" | "start_time" | "end_time">> & AuctionBody) =>
    request<AdminAuctionDetail>("/auctions/admin", { method: "POST", body: JSON.stringify(data) }),

  update: (id: string, data: AuctionBody) =>
    request<AdminAuctionDetail>(`/auctions/admin/${id}`, { method: "PUT", body: JSON.stringify(data) }),

  schedule: (id: string) =>
    request<AdminAuctionDetail>(`/auctions/admin/${id}/schedule`, { method: "POST" }),

  cancel: (id: string, reason?: string) =>
    request<AdminAuctionDetail>(`/auctions/admin/${id}/cancel`, {
      method: "POST", body: JSON.stringify({ reason: reason ?? null }),
    }),

  approveWinner: (id: string, admin_notes?: string) =>
    request<AdminAuctionDetail>(`/auctions/admin/${id}/approve-winner`, {
      method: "POST", body: JSON.stringify({ admin_notes: admin_notes ?? null }),
    }),

  rejectWinner: (id: string, reason: string) =>
    request<AdminAuctionDetail>(`/auctions/admin/${id}/reject-winner`, {
      method: "POST", body: JSON.stringify({ reason }),
    }),

  convertToDeal: (id: string, deal_type: "full_payment" | "financing", admin_notes?: string) =>
    request<AuctionConvertResponse>(`/auctions/admin/${id}/convert`, {
      method: "POST", body: JSON.stringify({ deal_type, admin_notes: admin_notes ?? null }),
    }),
}

// ── Deal detail endpoints ─────────────────────────────────────────────────────

export const dealDetail = {
  getPortal: (token: string) =>
    request<DealPortal>(`/deals/portal/${token}`),

  getSchedule: (dealId: string) =>
    request<DealSchedule>(`/deals/${dealId}/schedule`),

  requestOtp: (token: string) =>
    request<{ message: string; otp_expires_in_seconds: number }>(
      `/deals/portal/${token}/request-otp`, { method: "POST" }
    ),

  accept: (token: string, otp: string) =>
    request<MessageResponse>(`/deals/portal/${token}/accept`, {
      method: "POST",
      body: JSON.stringify({ otp }),
    }),
}

// ── Profile endpoints ─────────────────────────────────────────────────────────

export const profile = {
  update: (data: {
    full_name?: string
    phone?: string
    country?: string
    company_name?: string
    company_reg_no?: string
  }) => request<UserProfile>("/auth/me/profile", {
    method: "PATCH",
    body: JSON.stringify(data),
  }),

  changePassword: (data: {
    current_password: string
    new_password: string
  }) => request<MessageResponse>("/auth/me/password", {
    method: "PATCH",
    body: JSON.stringify(data),
  }),

  uploadAvatar: (formData: FormData) =>
    upload<UserProfile>("/auth/me/avatar", formData),
}

// ── Admin types ───────────────────────────────────────────────────────────────

export interface AdminDashboardStats {
  users: {
    total_users: number
    active_buyers: number
    active_sellers: number
    active_agents: number
    deactivated_users: number
  }
  deals: {
    active_deals: number
    active_deals_value: string
    completed_deals: number
    revenue_this_month: string
    disputed_deals: number
    new_deals_this_month: number
  }
  kyc: {
    pending_kyc: number
    approved_kyc: number
    rejected_kyc: number
  }
  purchase_requests: {
    open_requests: number
    approved_requests: number
    new_requests_this_month: number
  }
  auctions: {
    live_auctions: number
    scheduled_auctions: number
    pending_approval_auctions: number
  }
  documents: {
    total_documents: number
    draft_invoices: number
    issued_invoices: number
  }
  recent_activity: {
    action: string
    resource_type: string | null
    resource_id: string | null
    actor_id: string | null
    actor_name: string | null
    created_at: string | null
  }[]
}

export interface AdminUserItem {
  id: string
  full_name: string | null
  company_name: string | null
  company_reg_no: string | null
  phone: string | null
  country: string | null
  roles: string[]
  kyc_status: string
  avatar_url: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  email: string
  // extended fields from getUser
  deals_as_buyer?: number
  deals_as_seller?: number
  purchase_requests?: number
}

export interface AdminUserList {
  items: AdminUserItem[]
  total: number
  page: number
  page_size: number
}

// ── Admin endpoints ───────────────────────────────────────────────────────────

export const admin = {
  getDashboard: () =>
    request<AdminDashboardStats>("/admin/dashboard"),

  listUsers: (params?: {
    page?: number
    page_size?: number
    role?: string
    kyc_status?: string
    is_active?: boolean
    search?: string
  }) => {
    const qs = new URLSearchParams()
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") qs.set(k, String(v))
      })
    }
    const query = qs.toString() ? `?${qs}` : ""
    return request<AdminUserList>(`/admin/users${query}`)
  },

  getUser: (id: string) =>
    request<AdminUserItem>(`/admin/users/${id}`),

  setRoles: (id: string, roles: string[]) =>
    request<{ user_id: string; roles: string[]; message: string }>(
      `/admin/users/${id}/roles`,
      { method: "PATCH", body: JSON.stringify({ roles }) }
    ),

  deactivate: (id: string, reason: string) =>
    request<{ user_id: string; is_active: boolean; message: string }>(
      `/admin/users/${id}/deactivate`,
      { method: "POST", body: JSON.stringify({ reason }) }
    ),

  reactivate: (id: string) =>
    request<{ user_id: string; is_active: boolean; message: string }>(
      `/admin/users/${id}/reactivate`,
      { method: "POST" }
    ),
}

// ── Phase 4 — Deal management types ──────────────────────────────────────────

export interface PaymentAccountOut {
  id: string
  bank_name: string
  account_name: string
  account_number: string
  sort_code: string | null
  swift_code: string | null
  iban: string | null
  routing_number: string | null
  currency: string
  country: string
  additional_info: string | null
  is_active: boolean
  created_by: string | null
  created_at: string
}

export interface RateScheduleOut {
  id: string
  name: string
  description: string | null
  asset_class: string | null
  monthly_rates: Record<string, number>
  arrangement_fee: string
  min_down_payment_percent: string
  max_down_payment_percent: string
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface BuyerCreditProfile {
  buyer_id: string
  is_financing_eligible: boolean
  credit_limit_usd: string | null
  max_single_deal_usd: string | null
  collateral_notes: string | null
  risk_rating: "low" | "medium" | "high" | null
  notes: string | null
  set_by: string | null
  set_at: string
  updated_at: string
}

export interface DealResponse {
  id: string
  deal_ref: string
  product_id: string
  buyer_id: string
  seller_id: string
  purchase_request_id: string | null
  deal_type: string           // full_payment | financing
  total_price: string
  currency: string
  payment_account_id: string | null
  payment_deadline: string | null
  payment_instructions: string | null
  initial_payment_percent: string | null
  initial_payment_amount: string | null
  financed_amount: string | null
  monthly_finance_rate: string | null
  duration_months: number | null
  arrangement_fee: string
  rate_schedule_id: string | null
  total_finance_charge: string | null
  total_amount_payable: string | null
  first_monthly_payment: string | null
  accepted_at: string | null
  acceptance_ip: string | null
  portal_token: string | null
  portal_token_expires_at: string | null
  portal_first_accessed: string | null
  requires_second_approval: boolean
  second_approved_by: string | null
  second_approved_at: string | null
  second_approval_notes: string | null
  admin_notes: string | null
  cancellation_reason: string | null
  status: string
  created_by: string
  created_at: string
  updated_at: string
  // enriched
  buyer_name: string | null
  buyer_email: string | null
  buyer_phone: string | null
  seller_name: string | null
  product_title: string | null
  payment_account: PaymentAccountOut | null
  initial_payment_due: string | null
}

export interface DealListResponse {
  id: string
  deal_ref: string
  deal_type: string
  status: string
  total_price: string
  currency: string
  buyer_name: string | null
  buyer_email: string | null
  seller_name: string | null
  product_title: string | null
  created_at: string
  updated_at: string
}

export interface DealPaymentRecord {
  id: string
  deal_id: string
  payment_type: string
  installment_number: number | null
  amount: string
  currency: string
  payment_date: string
  bank_name: string | null
  bank_reference: string | null
  payment_proof_path: string | null
  notes: string | null
  recorded_by: string
  recorded_at: string
  verified_by: string | null
  verified_at: string | null
  verification_status: string   // pending | verified | disputed
  verification_notes: string | null
  created_at: string
  recorded_by_name: string | null
  verified_by_name: string | null
}

export interface InstallmentOut {
  id: string
  deal_id: string
  installment_number: number
  due_date: string
  grace_period_end: string
  opening_balance: string
  principal_amount: string
  finance_charge: string
  amount_due: string
  closing_balance: string
  status: string
  payment_id: string | null
  paid_amount: string | null
  paid_at: string | null
  waived_by: string | null
  waived_at: string | null
  waiver_reason: string | null
  updated_at: string
}

export interface InstallmentSchedule {
  deal_ref: string
  deal_type: string
  status: string
  buyer_name: string | null
  product_title: string | null
  financed_amount: string | null
  monthly_finance_rate: string | null
  duration_months: number | null
  total_finance_charge: string | null
  total_amount_payable: string | null
  installments: InstallmentOut[]
}

// ── Phase 4 API modules ───────────────────────────────────────────────────────

// Full admin deal control (replaces partial adminDeals used in Phase 2/3)
export const dealAdmin = {
  list: (params?: {
    page?: number; page_size?: number; status?: string
    buyer_id?: string; deal_type?: string
  }) => {
    const qs = new URLSearchParams()
    if (params) Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v))
    })
    const query = qs.toString() ? `?${qs}` : ""
    return request<DealListResponse[]>(`/deals${query}`)
  },

  get: (id: string) => request<DealResponse>(`/deals/${id}`),

  create: (data: {
    product_id: string; buyer_id: string; deal_type: string
    total_price: number; currency?: string
    purchase_request_id?: string; admin_notes?: string
    // full_payment
    payment_account_id?: string; payment_deadline?: string; payment_instructions?: string
    // financing
    initial_payment_percent?: number; duration_months?: number
    monthly_finance_rate?: number; arrangement_fee?: number; rate_schedule_id?: string
  }) => request<DealResponse>("/deals", { method: "POST", body: JSON.stringify(data) }),

  update: (id: string, data: {
    total_price?: number; currency?: string; admin_notes?: string
    payment_account_id?: string; payment_deadline?: string; payment_instructions?: string
    initial_payment_percent?: number; duration_months?: number
    monthly_finance_rate?: number; arrangement_fee?: number; rate_schedule_id?: string
  }) => request<DealResponse>(`/deals/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  cancel: (id: string, reason: string) =>
    request<DealResponse>(`/deals/${id}/cancel`, {
      method: "POST", body: JSON.stringify({ reason }),
    }),

  sendOffer: (id: string) =>
    request<DealResponse>(`/deals/${id}/send-offer`, { method: "POST", body: JSON.stringify({}) }),

  secondApprove: (id: string, notes?: string) =>
    request<DealResponse>(`/deals/${id}/second-approve`, {
      method: "POST", body: JSON.stringify({ notes: notes ?? null }),
    }),

  recordPayment: (id: string, formData: FormData) =>
    upload<DealPaymentRecord>(`/deals/${id}/record-payment`, formData),

  sendReminder: (id: string, data: {
    message_type: "payment_reminder" | "overdue_warning" | "installment_due" | "installment_overdue"
    custom_message?: string
  }) => request<MessageResponse>(`/deals/${id}/send-reminder`, {
    method: "POST", body: JSON.stringify(data),
  }),

  getSchedule: (id: string) => request<InstallmentSchedule>(`/deals/${id}/schedule`),

  markDefaulted: (id: string, reason: string) =>
    request<DealResponse>(`/deals/${id}/mark-defaulted`, {
      method: "POST", body: JSON.stringify({ reason }),
    }),

  verifyPayment: (dealId: string, paymentId: string, data: {
    verification_status: "verified" | "disputed"; verification_notes?: string
  }) => request<DealPaymentRecord>(`/deals/${dealId}/payments/${paymentId}/verify`, {
    method: "POST", body: JSON.stringify(data),
  }),

  waiveInstallment: (dealId: string, installmentNumber: number, reason: string) =>
    request<InstallmentOut>(`/deals/${dealId}/installments/${installmentNumber}/waive`, {
      method: "POST", body: JSON.stringify({ reason }),
    }),
}

// Payment accounts config
export const paymentAccounts = {
  list: (includeInactive = false) =>
    request<PaymentAccountOut[]>(`/deals/payment-accounts?include_inactive=${includeInactive}`),

  create: (data: {
    bank_name: string; account_name?: string; account_number: string
    sort_code?: string; swift_code?: string; iban?: string
    routing_number?: string; currency?: string; country?: string; additional_info?: string
  }) => request<PaymentAccountOut>("/deals/payment-accounts", {
    method: "POST", body: JSON.stringify(data),
  }),

  update: (id: string, data: {
    bank_name?: string; account_name?: string; account_number?: string
    sort_code?: string; swift_code?: string; iban?: string
    routing_number?: string; currency?: string; country?: string
    additional_info?: string; is_active?: boolean
  }) => request<PaymentAccountOut>(`/deals/payment-accounts/${id}`, {
    method: "PATCH", body: JSON.stringify(data),
  }),

  deactivate: (id: string) =>
    request<PaymentAccountOut>(`/deals/payment-accounts/${id}`, { method: "DELETE" }),
}

// Rate schedules config
export const rateSchedules = {
  list: (includeInactive = false) =>
    request<RateScheduleOut[]>(`/deals/rate-schedules?include_inactive=${includeInactive}`),

  create: (data: {
    name: string; description?: string; asset_class?: string
    monthly_rates: Record<string, number>; arrangement_fee?: number
    min_down_payment_percent?: number; max_down_payment_percent?: number
  }) => request<RateScheduleOut>("/deals/rate-schedules", {
    method: "POST", body: JSON.stringify(data),
  }),

  update: (id: string, data: {
    name?: string; description?: string; asset_class?: string
    monthly_rates?: Record<string, number>; arrangement_fee?: number
    min_down_payment_percent?: number; max_down_payment_percent?: number; is_active?: boolean
  }) => request<RateScheduleOut>(`/deals/rate-schedules/${id}`, {
    method: "PATCH", body: JSON.stringify(data),
  }),
}

// Buyer credit profiles
export const creditProfiles = {
  get: (buyerId: string) =>
    request<BuyerCreditProfile>(`/deals/buyers/${buyerId}/credit-profile`),

  set: (buyerId: string, data: {
    is_financing_eligible: boolean; credit_limit_usd?: number
    max_single_deal_usd?: number; collateral_notes?: string
    risk_rating?: "low" | "medium" | "high"; notes?: string
  }) => request<BuyerCreditProfile>(`/deals/buyers/${buyerId}/credit-profile`, {
    method: "PUT", body: JSON.stringify(data),
  }),
}

// Finance admin (pending payments global queue)
export const financeAdmin = {
  listPendingPayments: () =>
    request<DealPaymentRecord[]>("/deals/payments"),
}

// ── Document types ────────────────────────────────────────────────────────────

export type DocumentType =
  | "contract" | "inspection_report" | "receipt" | "invoice"
  | "identification" | "bank_statement" | "title_deed"
  | "survey_report" | "correspondence" | "other"

export interface DocumentOut {
  id: string
  deal_id: string
  document_type: string
  description: string | null
  file_name: string
  file_size_bytes: number | null
  mime_type: string
  checksum_sha256: string | null
  is_visible_to_buyer: boolean
  is_visible_to_seller: boolean
  is_deleted: boolean
  uploaded_by: string
  uploaded_at: string
  updated_at: string
  acknowledged_at: string | null
  acknowledgements_count: number
}

export interface DocumentDownloadResponse {
  document_id: string
  file_name: string
  signed_url: string
  expires_in_seconds: number
}

export interface AcknowledgementOut {
  id: string
  document_id: string
  deal_id: string
  acknowledged_by: string
  acknowledged_at: string
  ip_address: string | null
}

export type InvoiceType = "proforma" | "installment" | "final"

export interface InvoiceOut {
  id: string
  deal_id: string
  invoice_ref: string
  invoice_type: string
  schedule_item_id: string | null
  amount: string
  currency: string
  due_date: string | null
  issued_at: string | null
  status: string   // draft | issued | void
  void_reason: string | null
  voided_by: string | null
  voided_at: string | null
  has_pdf: boolean
  notes: string | null
  generated_by: string
  created_at: string
  updated_at: string
}

export interface InvoiceDownloadResponse {
  invoice_id: string
  invoice_ref: string
  signed_url: string
  expires_in_seconds: number
}

// ── Documents endpoints ───────────────────────────────────────────────────────

export const documents = {
  // Shared (buyer / seller / admin)
  listDocuments: (dealId: string) =>
    request<DocumentOut[]>(`/documents/deals/${dealId}/documents`),

  downloadDocument: (docId: string) =>
    request<DocumentDownloadResponse>(`/documents/documents/${docId}/download`),

  acknowledgeDocument: (docId: string) =>
    request<AcknowledgementOut>(`/documents/documents/${docId}/acknowledge`, {
      method: "POST",
    }),

  listInvoices: (dealId: string) =>
    request<InvoiceOut[]>(`/documents/deals/${dealId}/invoices`),

  downloadInvoice: (invoiceId: string) =>
    request<InvoiceDownloadResponse>(`/documents/invoices/${invoiceId}/download`),

  // Admin
  admin: {
    uploadDocument: (dealId: string, formData: FormData) =>
      upload<DocumentOut>(`/documents/admin/deals/${dealId}/documents`, formData),

    updateDocument: (docId: string, data: {
      description?: string | null
      is_visible_to_buyer?: boolean
      is_visible_to_seller?: boolean
    }) => request<DocumentOut>(`/documents/admin/documents/${docId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

    deleteDocument: (docId: string, deletion_reason: string) =>
      request<MessageResponse>(`/documents/admin/documents/${docId}`, {
        method: "DELETE",
        body: JSON.stringify({ deletion_reason }),
      }),

    generateInvoice: (dealId: string, data: {
      invoice_type: InvoiceType
      schedule_item_id?: string
      due_date?: string
      notes?: string
    }) => request<InvoiceOut>(`/documents/admin/deals/${dealId}/invoices`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

    issueInvoice: (invoiceId: string) =>
      request<InvoiceOut>(`/documents/admin/invoices/${invoiceId}/issue`, {
        method: "POST",
      }),

    voidInvoice: (invoiceId: string, void_reason: string) =>
      request<InvoiceOut>(`/documents/admin/invoices/${invoiceId}/void`, {
        method: "POST",
        body: JSON.stringify({ void_reason }),
      }),
  },
}

// ── Reports types ─────────────────────────────────────────────────────────────

export interface ListingStats {
  total: number; live: number; pending_verification: number
  pending_approval: number; rejected: number; delisted: number
}

export interface DealStats {
  total: number; draft: number; offer_sent: number; accepted: number
  active: number; completed: number; cancelled: number; defaulted: number
  awaiting_second_approval: number
}

export interface KycOverviewStats {
  total_buyers: number; active_kyc: number; expired_kyc: number
  pending_review: number; expiring_soon: number
}

export interface PaymentAlerts {
  pending_verification: number; disputed: number
}

export interface OverviewDashboard {
  listings: ListingStats
  deals: DealStats
  kyc: KycOverviewStats
  payment_alerts: PaymentAlerts
  generated_at: string
}

export interface PaymentSummary {
  total_payments: number; total_verified: number; total_pending: number; total_disputed: number
  amount_verified: string; amount_pending: string; amount_disputed: string
}

export interface DealTypeSummary {
  deal_type: string; count: number; total_value: string; total_collected: string
}

export interface LateInstallmentItem {
  deal_id: string; deal_ref: string; buyer_name: string
  installment_number: number; due_date: string
  total_due: string; days_overdue: number
}

export interface DefaultedDealItem {
  deal_id: string; deal_ref: string; buyer_name: string
  total_price: string; amount_collected: string; outstanding: string
}

export interface FinancialReport {
  period_from: string; period_to: string
  payment_summary: PaymentSummary
  by_deal_type: DealTypeSummary[]
  late_installments: LateInstallmentItem[]
  defaulted_deals: DefaultedDealItem[]
  generated_at: string
}

export interface DealPipelineItem {
  deal_id: string; deal_ref: string; product_title: string
  buyer_name: string; seller_name: string; deal_type: string
  total_price: string; currency: string; status: string
  days_in_status: number; requires_second_approval: boolean
  second_approved: boolean; created_at: string
}

export interface DealPipelineReport {
  period_from: string; period_to: string; total: number
  by_status: Record<string, number>
  deals: DealPipelineItem[]
  generated_at: string
}

export interface KycComplianceItem {
  submission_id: string; buyer_id: string; buyer_name: string; buyer_email: string
  status: string; submitted_at: string | null; decided_at: string | null
  expires_at: string | null; days_until_expiry: number | null
  rejection_reason: string | null; is_pep: boolean; sanctions_match: boolean
}

export interface KycComplianceReport {
  period_from: string; period_to: string; total: number
  by_status: Record<string, number>
  expiring_within_30_days: number
  submissions: KycComplianceItem[]
  generated_at: string
}

export interface CategoryStat {
  category: string; total: number; active: number; pending: number
}

export interface MarketplaceListingItem {
  product_id: string; title: string; category: string; seller_name: string
  status: string; price: string; currency: string
  days_in_status: number; assigned_agent: string | null; created_at: string
}

export interface MarketplaceHealthReport {
  period_from: string; period_to: string; total_listings: number
  by_status: Record<string, number>
  by_category: CategoryStat[]
  stuck_listings: MarketplaceListingItem[]
  generated_at: string
}

export interface AgentPerformanceItem {
  agent_id: string; agent_name: string; agent_email: string
  kyc_assigned: number; kyc_reviewed: number; kyc_approved: number; kyc_rejected: number
  listings_assigned: number; listings_verified: number; listings_rejected: number
  avg_kyc_review_hours: number | null; avg_listing_review_hours: number | null
}

export interface AgentWorkloadReport {
  period_from: string; period_to: string
  agents: AgentPerformanceItem[]
  generated_at: string
}

// ── Reports endpoints ─────────────────────────────────────────────────────────

function buildDateQuery(from: string, to: string) {
  return `?from_date=${from}&to_date=${to}`
}

function exportCsv(url: string) {
  window.open(url, "_blank", "noopener")
}

export const reports = {
  overview: () =>
    request<OverviewDashboard>("/reports/overview"),

  financial: (from: string, to: string) =>
    request<FinancialReport>(`/reports/financial${buildDateQuery(from, to)}`),

  exportLateInstallments: (from: string, to: string) =>
    exportCsv(`/reports/financial/late-installments/export${buildDateQuery(from, to)}`),

  exportDefaultedDeals: (from: string, to: string) =>
    exportCsv(`/reports/financial/defaulted-deals/export${buildDateQuery(from, to)}`),

  pipeline: (from: string, to: string) =>
    request<DealPipelineReport>(`/reports/pipeline${buildDateQuery(from, to)}`),

  exportPipeline: (from: string, to: string) =>
    exportCsv(`/reports/pipeline/export${buildDateQuery(from, to)}`),

  kyc: (from: string, to: string) =>
    request<KycComplianceReport>(`/reports/kyc${buildDateQuery(from, to)}`),

  exportKyc: (from: string, to: string) =>
    exportCsv(`/reports/kyc/export${buildDateQuery(from, to)}`),

  marketplace: (from: string, to: string) =>
    request<MarketplaceHealthReport>(`/reports/marketplace${buildDateQuery(from, to)}`),

  exportMarketplace: (from: string, to: string) =>
    exportCsv(`/reports/marketplace/stuck/export${buildDateQuery(from, to)}`),

  agents: (from: string, to: string) =>
    request<AgentWorkloadReport>(`/reports/agents${buildDateQuery(from, to)}`),

  exportAgents: (from: string, to: string) =>
    exportCsv(`/reports/agents/export${buildDateQuery(from, to)}`),
}

// ── KYC admin types ───────────────────────────────────────────────────────────

export interface DocumentTypeResponse {
  id: string; name: string; slug: string; description: string | null
  is_required: boolean; is_active: boolean; display_order: number; created_at: string
}

export interface KycDocumentResponse {
  id: string; submission_id: string; document_type_id: string
  document_type_name: string; document_type_slug: string
  storage_path: string; signed_url: string
  original_name: string | null; file_size_bytes: number | null
  mime_type: string | null; file_hash: string; uploaded_at: string
}

export interface KycReviewResponse {
  id: string; submission_id: string; reviewer_id: string
  reviewer_name: string | null; reviewer_role: string
  assessment: string; risk_score: string; is_pep: boolean
  sanctions_match: boolean; recommendation: string; created_at: string
}

export interface KycAssignmentResponse {
  id: string; submission_id: string; agent_id: string
  agent_name: string | null; assigned_by_name: string | null
  status: string; created_at: string; updated_at: string
}

export interface KycSubmissionListItem {
  id: string; buyer_id: string; buyer_name: string | null
  buyer_company: string | null; cycle_number: number; status: string
  submitted_at: string | null; risk_score: string | null
  assigned_agent: string | null; document_count: number; created_at: string
}

export interface KycSubmissionResponse {
  id: string; buyer_id: string; buyer_name: string | null
  buyer_company: string | null; buyer_email: string | null
  cycle_number: number; status: string
  locked_at: string | null; submitted_at: string | null
  decided_at: string | null; expires_at: string | null
  rejection_reason: string | null
  documents: KycDocumentResponse[]
  reviews: KycReviewResponse[]
  assignment: KycAssignmentResponse | null
  created_at: string; updated_at: string
}

export interface PaginatedKycSubmissions {
  items: KycSubmissionListItem[]
  total: number; page: number; page_size: number; pages: number
}

// ── KYC admin endpoints ───────────────────────────────────────────────────────

export const kycAdmin = {
  listSubmissions: (params?: { kyc_status?: string; page?: number; page_size?: number }) => {
    const qs = new URLSearchParams()
    if (params) Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v))
    })
    const query = qs.toString() ? `?${qs}` : ""
    return request<PaginatedKycSubmissions>(`/kyc/admin/submissions${query}`)
  },

  getSubmission: (id: string) =>
    request<KycSubmissionResponse>(`/kyc/admin/submissions/${id}`),

  assignAgent: (submissionId: string, agentId: string) =>
    request<KycAssignmentResponse>(`/kyc/admin/submissions/${submissionId}/assign-agent`, {
      method: "POST", body: JSON.stringify({ agent_id: agentId }),
    }),

  decide: (submissionId: string, data: {
    decision: "approve" | "reject" | "requires_resubmission"
    assessment: string; risk_score: "low" | "medium" | "high"
    is_pep?: boolean; sanctions_match?: boolean; reason?: string
  }) => request<MessageResponse>(`/kyc/admin/submissions/${submissionId}/decide`, {
    method: "POST", body: JSON.stringify(data),
  }),

  listDocumentTypes: (includeInactive = true) =>
    request<DocumentTypeResponse[]>(`/kyc/admin/document-types?include_inactive=${includeInactive}`),

  createDocumentType: (data: {
    name: string; slug: string; description?: string
    is_required?: boolean; display_order?: number
  }) => request<DocumentTypeResponse>("/kyc/admin/document-types", {
    method: "POST", body: JSON.stringify(data),
  }),

  updateDocumentType: (id: string, data: {
    name?: string; description?: string | null
    is_required?: boolean; is_active?: boolean; display_order?: number
  }) => request<DocumentTypeResponse>(`/kyc/admin/document-types/${id}`, {
    method: "PATCH", body: JSON.stringify(data),
  }),
}

// ── Phase 9 additions ─────────────────────────────────────────────────────────
// All missing API modules discovered in full endpoint audit.

// ── Auth — extended ───────────────────────────────────────────────────────────

export const authAdmin = {
  login: (data: { email: string; password: string }) =>
    request<AuthTokenResponse>("/auth/admin/login", {
      method: "POST", body: JSON.stringify(data),
    }),

  financeAdminLogin: (data: { email: string; password: string }) =>
    request<AuthTokenResponse>("/auth/finance-admin/login", {
      method: "POST", body: JSON.stringify(data),
    }),

  logout: () =>
    request<MessageResponse>("/auth/admin/logout", { method: "POST" }),

  createAgent: (data: {
    email: string; password: string; full_name: string
    role: "verification_agent" | "buyer_agent"
    phone?: string; company_name?: string; country?: string
  }) => request<UserProfile>("/auth/internal/create-agent", {
    method: "POST", body: JSON.stringify(data),
  }),

  createAdmin: (data: {
    email: string; password: string; full_name: string
    role: "admin" | "finance_admin"
    phone?: string; country?: string
  }) => request<UserProfile>("/auth/internal/create-admin", {
    method: "POST", body: JSON.stringify(data),
  }),
}

export const authAgent = {
  login: (data: { email: string; password: string }) =>
    request<AuthTokenResponse>("/auth/agent/login", {
      method: "POST", body: JSON.stringify(data),
    }),

  logout: () =>
    request<MessageResponse>("/auth/agent/logout", { method: "POST" }),
}

export const authBuyer = {
  addSellerRole: () =>
    request<MessageResponse>("/auth/buyer/add-seller-role", { method: "POST" }),
}

// ── Marketplace Admin types ───────────────────────────────────────────────────

export interface AdminProductListItem {
  id: string; title: string; status: string
  seller_id: string; seller_company: string | null; seller_email: string | null
  category_name: string | null; asking_price: string; currency: string
  location_country: string; condition: string; availability_type: string
  primary_image_url: string | null; verification_agent: string | null
  submitted_at: string | null; created_at: string; updated_at: string
}

export interface ProductDocument {
  id: string; storage_path: string; original_name: string | null
  file_size_bytes: number | null; mime_type: string | null
  description: string | null; signed_url: string; uploaded_at: string | null
}

export interface AdminProductDetail extends AdminProductListItem {
  description: string | null; location_port: string | null
  location_details: string | null; is_auction: boolean
  seller_phone: string | null; seller_country: string | null
  verification_cycle: number
  images: ProductImage[]; attribute_values: ProductAttributeValue[]
  documents: ProductDocument[]
  contact: { contact_name: string | null; phone: string | null; email: string | null } | null
  admin_notes: string | null; rejection_reason: string | null; corrections_reason: string | null
  verification_assignment_id: string | null
  is_visible: boolean
  admin_edited_at: string | null
}

export interface ProductActivityItem {
  action: string; actor_name: string | null
  resource_type: string
  old_state: Record<string, unknown> | null
  new_state: Record<string, unknown> | null
  created_at: string | null
}

export interface AdminProductDecision {
  decision: "approve" | "reject" | "request_corrections"
  reason?: string; admin_notes?: string
}

export interface PaginatedAdminProducts {
  items: AdminProductListItem[]
  total: number; page: number; page_size: number; pages: number
}

// ── Marketplace Admin module ──────────────────────────────────────────────────

export const marketplaceAdmin = {
  list: (params?: {
    page?: number; page_size?: number; status?: string; seller_id?: string
  }) => {
    const qs = new URLSearchParams()
    if (params) Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v))
    })
    const query = qs.toString() ? `?${qs}` : ""
    return request<PaginatedAdminProducts>(`/marketplace/admin/products${query}`)
  },

  get: (id: string) =>
    request<AdminProductDetail>(`/marketplace/admin/products/${id}`),

  getActivity: (id: string) =>
    request<ProductActivityItem[]>(`/marketplace/admin/products/${id}/activity`),

  update: (id: string, data: {
    title?: string; description?: string | null; asking_price?: number
    currency?: string; condition?: string; availability_type?: string
    location_country?: string; location_port?: string | null
    location_details?: string | null; admin_notes?: string | null
  }) => request<AdminProductDetail>(`/marketplace/admin/products/${id}`, {
    method: "PUT", body: JSON.stringify(data),
  }),

  assignAgent: (id: string, agentId: string, fullHistoryAccess = false) =>
    request<MessageResponse>(`/marketplace/admin/products/${id}/assign-agent`, {
      method: "POST", body: JSON.stringify({ agent_id: agentId, full_history_access: fullHistoryAccess }),
    }),

  decide: (id: string, data: AdminProductDecision) =>
    request<MessageResponse>(`/marketplace/admin/products/${id}/decide`, {
      method: "POST", body: JSON.stringify(data),
    }),

  delist: (id: string, reason?: string) =>
    request<MessageResponse>(`/marketplace/admin/products/${id}/delist`, {
      method: "POST", body: JSON.stringify({ reason: reason ?? null }),
    }),

  pendingApproval: (params?: { page?: number; page_size?: number }) => {
    const qs = new URLSearchParams()
    if (params) Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) qs.set(k, String(v))
    })
    const query = qs.toString() ? `?${qs}` : ""
    return request<PaginatedAdminProducts>(`/marketplace/admin/products/pending-approval${query}`)
  },

  pendingVerification: (params?: { page?: number; page_size?: number }) => {
    const qs = new URLSearchParams()
    if (params) Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) qs.set(k, String(v))
    })
    const query = qs.toString() ? `?${qs}` : ""
    return request<PaginatedAdminProducts>(`/marketplace/admin/products/pending-verification${query}`)
  },

  getTimeline: (productId: string) =>
    request<ProductTimelineEvent[]>(`/marketplace/admin/products/${productId}/timeline`),

  toggleVisibility: (productId: string, isVisible: boolean) =>
    request<{ is_visible: boolean; product_id: string }>(
      `/marketplace/admin/products/${productId}/visibility`,
      { method: "PATCH", body: JSON.stringify({ is_visible: isVisible }) },
    ),
}

// ── Seller verification status (visible to listing owner) ─────────────────────

export interface SellerVerificationStatus {
  id: string
  status: string           // assigned | contacted | inspection_scheduled | inspection_done | report_submitted | completed
  agent_name: string | null
  assigned_at: string
  scheduled_date: string | null
  report_submitted: boolean
  updated_at: string
}

export interface ProductTimelineEvent {
  event_type: "status_change" | "agent_assigned" | "report_submitted"
  new_status: string | null
  label: string
  detail: string | null
  reason: string | null
  actor: string
  timestamp: string
}

// ── Marketplace Verification Agent types ──────────────────────────────────────

export interface VerificationAssignmentItem {
  id: string; product_id: string; product_title: string
  agent_id: string; status: string
  assigned_at: string; updated_at: string
  product_status: string; seller_company: string | null
  full_history_access: boolean
}

export interface VerificationReportOut {
  id: string; assignment_id: string
  condition_confirmed: string | null; price_assessment: string | null
  documentation_complete: boolean; notes: string
  recommendation: "approve" | "reject" | "request_corrections"
  created_at: string
}

export interface VerificationEvidenceFile {
  id: string; file_type: "image" | "document"; storage_path: string
  description: string | null; signed_url: string; created_at: string | null
}

export interface VerificationAssignmentDetail extends VerificationAssignmentItem {
  asking_price: string | null; currency: string | null
  condition: string | null; location_country: string | null
  location_port: string | null; category_name: string | null
  availability_type: string | null; description: string | null
  scheduled_date: string | null; contact_notes: string | null
  seller_company: string | null; seller_name: string | null
  seller_phone: string | null; seller_email: string | null
  assigned_by_name: string | null
  images: { id: string; signed_url: string; is_primary: boolean }[]
  attribute_values: { attribute_id: string; attribute_name: string; value_text: string | null; value_numeric: number | null; value_boolean: boolean | null }[]
  report: VerificationReportOut | null
  report_submitted: boolean
  evidence_files: VerificationEvidenceFile[]
  previous_cycles: PreviousCycleRecord[]
}

export interface PreviousCycleRecord {
  id: string; cycle_number: number; status: string; assigned_at: string
  agent_name: string | null; agent_email: string | null
  outcome: string | null; findings: string | null
  asset_condition: string | null; recommendations: string | null
  submitted_at: string | null
}

export interface AttributeDefinition {
  id: string; name: string; slug: string
  data_type: "text" | "numeric" | "boolean" | "date"
  unit: string | null; is_active: boolean; display_order: number
}

export interface ProductSpecs {
  [key: string]: string | number | boolean | null
}

// ── Marketplace Verification Agent module ─────────────────────────────────────

export const verificationAgent = {
  listAssignments: (params?: { page?: number; page_size?: number; status?: string }) => {
    const qs = new URLSearchParams()
    if (params) Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v))
    })
    const query = qs.toString() ? `?${qs}` : ""
    return request<{ items: VerificationAssignmentItem[]; total: number; page: number; pages: number }>(
      `/marketplace/verification/assignments${query}`
    )
  },

  getAssignment: (id: string) =>
    request<VerificationAssignmentDetail>(`/marketplace/verification/assignments/${id}`),

  updateAssignment: (id: string, status: string) =>
    request<VerificationAssignmentItem>(`/marketplace/verification/assignments/${id}`, {
      method: "PATCH", body: JSON.stringify({ status }),
    }),

  uploadEvidenceFile: (assignmentId: string, file: File) => {
    const fd = new FormData()
    fd.append("file", file)
    return upload<{ storage_path: string; signed_url: string; file_type: string }>(
      `/marketplace/verification/assignments/${assignmentId}/evidence`,
      fd,
    )
  },

  submitReport: (id: string, data: {
    condition_confirmed: string; price_assessment: string
    documentation_complete: boolean; notes: string
    recommendation: "approve" | "reject" | "request_corrections"
    evidence_files?: { storage_path: string; file_type: string; description: string }[]
  }) => request<VerificationReportOut>(`/marketplace/verification/assignments/${id}/report`, {
    method: "POST", body: JSON.stringify(data),
  }),

  getTimeline: (assignmentId: string) =>
    request<ProductTimelineEvent[]>(`/marketplace/verification/assignments/${assignmentId}/timeline`),

  updateSpecs: (productId: string, specs: ProductSpecs) =>
    request<MessageResponse>(`/marketplace/verification/products/${productId}/specs`, {
      method: "PUT", body: JSON.stringify(specs),
    }),

  listAttributes: () =>
    request<AttributeDefinition[]>("/marketplace/attributes"),

  createAttribute: (data: {
    name: string; slug: string; data_type: "text" | "numeric" | "boolean" | "date"
    unit?: string; display_order?: number
  }) => request<AttributeDefinition>("/marketplace/attributes", {
    method: "POST", body: JSON.stringify(data),
  }),
}

// ── KYC Agent types ───────────────────────────────────────────────────────────

export interface KycAgentReviewRequest {
  assessment: string
  risk_score: "low" | "medium" | "high"
  is_pep: boolean
  sanctions_match: boolean
  recommendation: "recommend_approve" | "recommend_reject" | "requires_resubmission"
  notes?: string
}

// ── KYC Agent module ──────────────────────────────────────────────────────────

export const kycAgent = {
  getQueue: (params?: { page?: number; page_size?: number }) => {
    const qs = new URLSearchParams()
    if (params) Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) qs.set(k, String(v))
    })
    const query = qs.toString() ? `?${qs}` : ""
    return request<PaginatedKycSubmissions>(`/kyc/agent/queue${query}`)
  },

  getSubmission: (id: string) =>
    request<KycSubmissionResponse>(`/kyc/agent/submissions/${id}`),

  updateAssignment: (id: string, status: "in_review" | "completed") =>
    request<KycAssignmentResponse>(`/kyc/agent/submissions/${id}/assignment`, {
      method: "PATCH", body: JSON.stringify({ status }),
    }),

  submitReview: (id: string, data: KycAgentReviewRequest) =>
    request<KycReviewResponse>(`/kyc/agent/submissions/${id}/review`, {
      method: "POST", body: JSON.stringify(data),
    }),
}

// ── Purchase Requests Admin types ─────────────────────────────────────────────

export interface PurchaseRequestAdminItem {
  id: string; buyer_id: string; buyer_name: string | null
  buyer_company: string | null; product_id: string | null
  product_title: string | null; status: string
  request_type: string; budget_min: number | null; budget_max: number | null
  currency: string; description: string; assigned_agent: string | null
  created_at: string; updated_at: string
}

export interface PurchaseRequestAdminDetail extends PurchaseRequestAdminItem {
  buyer_email: string | null; buyer_phone: string | null
  preferred_delivery_date: string | null; additional_requirements: string | null
  rejection_reason: string | null; agent_report: AgentReportDetail | null
  deal_id: string | null
}

export interface AgentReportDetail {
  id: string; agent_id: string; agent_name: string | null
  financial_capacity_usd: number; risk_rating: "low" | "medium" | "high"
  recommendation: "recommend_approve" | "recommend_reject"
  verification_notes: string; submitted_at: string
}

export interface PaginatedPurchaseRequestsAdmin {
  items: PurchaseRequestAdminItem[]
  total: number; page: number; page_size: number; pages: number
}

// ── Purchase Requests Admin module ────────────────────────────────────────────

export const prAdmin = {
  list: (params?: { page?: number; page_size?: number; status?: string; buyer_id?: string }) => {
    const qs = new URLSearchParams()
    if (params) Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v))
    })
    const query = qs.toString() ? `?${qs}` : ""
    return request<PaginatedPurchaseRequestsAdmin>(`/purchase-requests/admin${query}`)
  },

  get: (id: string) =>
    request<PurchaseRequestAdminDetail>(`/purchase-requests/admin/${id}`),

  assignAgent: (id: string, agentId: string) =>
    request<MessageResponse>(`/purchase-requests/admin/${id}/assign-agent`, {
      method: "POST", body: JSON.stringify({ agent_id: agentId }),
    }),

  approve: (id: string, notes?: string) =>
    request<MessageResponse>(`/purchase-requests/admin/${id}/approve`, {
      method: "POST", body: JSON.stringify({ notes: notes ?? null }),
    }),

  reject: (id: string, reason: string) =>
    request<MessageResponse>(`/purchase-requests/admin/${id}/reject`, {
      method: "POST", body: JSON.stringify({ reason }),
    }),

  convert: (id: string, data: {
    total_price: number; currency: string; deal_type: "full_payment" | "financing"
    payment_account_id?: string; admin_notes?: string
    duration_months?: number; initial_payment_percent?: number
    rate_schedule_id?: string
  }) => request<MessageResponse>(`/purchase-requests/admin/${id}/convert`, {
    method: "POST", body: JSON.stringify(data),
  }),
}

// ── Purchase Requests Agent types ─────────────────────────────────────────────

export interface AgentAssignedPRItem {
  id: string; buyer_name: string | null; buyer_company: string | null
  product_title: string | null; status: string; request_type: string
  budget_min: number | null; budget_max: number | null; currency: string
  assignment_status: string; assigned_at: string
}

export interface AgentAssignedPRDetail extends AgentAssignedPRItem {
  description: string; additional_requirements: string | null
  preferred_delivery_date: string | null
  buyer_email: string | null; buyer_phone: string | null
  my_report: AgentReportDetail | null
}

// ── Purchase Requests Agent module ────────────────────────────────────────────

export const prAgent = {
  listAssigned: () =>
    request<AgentAssignedPRItem[]>("/purchase-requests/agent/assigned"),

  get: (id: string) =>
    request<AgentAssignedPRDetail>(`/purchase-requests/agent/${id}`),

  submitReport: (id: string, data: {
    financial_capacity_usd: number
    risk_rating: "low" | "medium" | "high"
    recommendation: "recommend_approve" | "recommend_reject"
    verification_notes: string
  }) => request<AgentReportDetail>(`/purchase-requests/agent/${id}/report`, {
    method: "POST", body: JSON.stringify(data),
  }),
}

// ── Auction bid history additions ─────────────────────────────────────────────

export interface PublicBidItem {
  id: string; auction_id: string; amount: string; currency: string
  bidder_company: string | null; placed_at: string; is_winning: boolean
}

export interface MyAuctionBid {
  id: string; auction_id: string; auction_title: string
  amount: string; currency: string; placed_at: string
  is_winning: boolean; auction_status: string
}

export const auctionBids = {
  getHistory: (auctionId: string) =>
    request<PublicBidItem[]>(`/auctions/${auctionId}/bids`),

  getMyBidsOnAuction: (auctionId: string) =>
    request<MyAuctionBid[]>(`/auctions/${auctionId}/bids/my`),

  getAllMyBids: () =>
    request<MyAuctionBid[]>("/auctions/bids/my"),
}

// ── Exchange Rates types ──────────────────────────────────────────────────────

export interface ExchangeRate {
  id: string; from_currency: string; to_currency: string
  rate: string; source: string | null; updated_by: string | null
  updated_at: string; created_at: string
}

export interface ExchangeRateConvertResult {
  from_currency: string; to_currency: string
  amount: number; converted_amount: number; rate: string
}

// ── Exchange Rates module ─────────────────────────────────────────────────────

export const exchangeRates = {
  list: () =>
    request<{ items: ExchangeRate[]; total: number }>("/exchange-rates").then((r) => r.items),

  get: (from: string, to: string) =>
    request<ExchangeRate>(`/exchange-rates/${from}/${to}`),

  convert: (from: string, to: string, amount: number) => {
    const qs = new URLSearchParams({ from_currency: from, to_currency: to, amount: String(amount) })
    return request<ExchangeRateConvertResult>(`/exchange-rates/convert?${qs}`)
  },

  upsert: (data: {
    from_currency: string; to_currency: string
    rate: number; source?: string
  }) => request<ExchangeRate>("/exchange-rates", {
    method: "POST", body: JSON.stringify(data),
  }),
}

// sellerDashboard already exported above (line ~575)

// ── Admin Buyer / Seller detail endpoints ─────────────────────────────────────

export const adminBuyers = {
  list: (params?: { search?: string; kyc_status?: string; is_active?: boolean; page?: number; page_size?: number }) => {
    const qs = new URLSearchParams()
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") qs.set(k, String(v)) })
    const q = qs.toString() ? `?${qs}` : ""
    return request<{ items: AdminUserItem[]; total: number; page: number; page_size: number; pages: number }>(`/admin/buyers${q}`)
  },
  getDetail: (id: string) => request<AdminBuyerDetail>(`/admin/buyers/${id}`),
}

export const adminSellers = {
  list: (params?: { search?: string; kyc_status?: string; is_active?: boolean; page?: number; page_size?: number }) => {
    const qs = new URLSearchParams()
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") qs.set(k, String(v)) })
    const q = qs.toString() ? `?${qs}` : ""
    return request<{ items: AdminUserItem[]; total: number; page: number; page_size: number; pages: number }>(`/admin/sellers${q}`)
  },
  getDetail: (id: string) => request<AdminSellerDetail>(`/admin/sellers/${id}`),
}

export interface AdminBuyerDetail {
  profile: {
    id: string; full_name: string | null; email: string; company_name: string | null
    company_reg_no: string | null; phone: string | null; country: string | null
    roles: string[]; kyc_status: string; kyc_expires_at: string | null
    kyc_attempt_count: number; is_active: boolean; created_at: string; updated_at: string
  }
  kyc: {
    id: string; status: string; cycle_number: number; created_at: string
    rejection_reason: string | null; agent_name: string | null; agent_email: string | null
    assignment_status: string | null; reviewed_at: string | null; doc_count: number
  }[]
  deals: {
    id: string; status: string; deal_type: string; total_price: string; currency: string
    created_at: string; product_title: string | null; seller_name: string | null; seller_email: string | null
  }[]
  purchase_requests: {
    id: string; status: string; request_type: string; budget_min: number | null; budget_max: number | null
    currency: string; description: string; created_at: string; product_title: string | null; agent_name: string | null
  }[]
  activity: { action: string; resource_type: string; resource_id: string; created_at: string }[]
}

export interface AdminSellerDetail {
  profile: {
    id: string; full_name: string | null; email: string; company_name: string | null
    company_reg_no: string | null; phone: string | null; country: string | null
    roles: string[]; kyc_status: string; kyc_expires_at: string | null
    is_active: boolean; created_at: string; updated_at: string
  }
  kyc: {
    id: string; status: string; cycle_number: number; created_at: string
    rejection_reason: string | null; agent_name: string | null; assignment_status: string | null
  }[]
  listings: {
    id: string; title: string; status: string; asking_price: string; currency: string
    condition: string; availability_type: string; location_country: string; location_port: string | null
    category_name: string | null; verification_agent: string | null; agent_email: string | null
    verification_assignment_id: string | null; description: string | null
    image_count: number; deal_count: number; created_at: string; updated_at: string
  }[]
  deals: {
    id: string; status: string; deal_type: string; total_price: string; currency: string
    created_at: string; product_title: string | null; buyer_name: string | null; buyer_email: string | null
  }[]
  agents: {
    agent_name: string | null; agent_email: string | null
    assignments_count: number; last_activity: string | null
  }[]
  activity: { action: string; resource_type: string; resource_id: string; created_at: string }[]
}
