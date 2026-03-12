-- ═══════════════════════════════════════════════════════════════════════════
-- MarineXchange Africa — Initial Database Schema
-- Run this in Supabase SQL Editor (or via psql)
--
-- Execution order matters — run top to bottom.
-- Extensions, schemas, tables, constraints, triggers, RLS, indexes.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── Extensions ───────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ── Schemas ───────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS marketplace;
CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS notifications;


-- ═══════════════════════════════════════════════════════════════════════════
-- PUBLIC SCHEMA
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Profiles (extends auth.users) ────────────────────────────────────────────

CREATE TABLE public.profiles (
    id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name       TEXT NOT NULL,
    company_name    TEXT,
    company_reg_no  TEXT,
    phone           TEXT,
    country         TEXT NOT NULL,

    -- Multi-role array — users may hold buyer + seller simultaneously
    roles           TEXT[] NOT NULL DEFAULT '{}',

    -- KYC: 'not_applicable' for non-buyers, 'pending' → 'verified' | 'rejected' for buyers
    kyc_status      TEXT NOT NULL DEFAULT 'pending' CHECK (kyc_status IN (
                        'pending', 'documents_submitted', 'under_review',
                        'verified', 'rejected', 'not_applicable'
                    )),

    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- All roles must be valid system roles
    CONSTRAINT valid_roles CHECK (
        roles <@ ARRAY[
            'buyer','seller','verification_agent',
            'buyer_agent','admin','finance_admin'
        ]::TEXT[]
    ),

    -- At least one role must be assigned
    CONSTRAINT at_least_one_role CHECK (array_length(roles, 1) >= 1)
);

COMMENT ON TABLE public.profiles IS
    'Extends Supabase auth.users. Multi-role support via TEXT[].';
COMMENT ON COLUMN public.profiles.roles IS
    'Array of roles. A user can hold buyer+seller simultaneously.';
COMMENT ON COLUMN public.profiles.kyc_status IS
    'KYC only applies to buyers. non_applicable for sellers, agents, admins.';


-- ── Exchange rates ────────────────────────────────────────────────────────────

CREATE TABLE public.exchange_rates (
    id              BIGSERIAL PRIMARY KEY,
    from_currency   TEXT NOT NULL,
    to_currency     TEXT NOT NULL DEFAULT 'USD',
    rate            NUMERIC(18, 8) NOT NULL CHECK (rate > 0),
    rate_date       DATE NOT NULL,
    source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'api')),
    set_by          UUID REFERENCES public.profiles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (from_currency, to_currency, rate_date)
);

COMMENT ON TABLE public.exchange_rates IS
    'Daily exchange rates. Finance Admin updates these. Stale rates (>3 days) block transactions.';


-- ═══════════════════════════════════════════════════════════════════════════
-- MARKETPLACE SCHEMA
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Products ──────────────────────────────────────────────────────────────────

CREATE TABLE marketplace.products (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id           UUID NOT NULL REFERENCES public.profiles(id),

    -- Core details
    title               TEXT NOT NULL,
    description         TEXT,
    category            TEXT NOT NULL CHECK (category IN (
                            'vessel', 'heavy_equipment', 'marine_machinery',
                            'industrial_asset', 'offshore_equipment', 'other'
                        )),
    subcategory         TEXT,
    condition           TEXT NOT NULL CHECK (condition IN ('new', 'used', 'refurbished')),
    year_manufactured   INTEGER CHECK (year_manufactured > 1900 AND year_manufactured <= EXTRACT(YEAR FROM NOW()) + 1),
    manufacturer        TEXT,
    model_number        TEXT,

    -- Pricing — original currency + USD conversion snapshot
    asking_price        NUMERIC(18, 2) NOT NULL CHECK (asking_price > 0),
    currency            TEXT NOT NULL DEFAULT 'USD',
    asking_price_usd    NUMERIC(18, 2),
    exchange_rate_used  NUMERIC(18, 8),
    exchange_rate_date  DATE,

    -- Location
    location_country    TEXT NOT NULL,
    location_port       TEXT,
    location_details    TEXT,

    -- State machine (transitions enforced by trigger below)
    status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                            'draft',
                            'pending_verification',
                            'under_verification',
                            'verification_failed',
                            'pending_reverification',
                            'pending_approval',
                            'rejected',
                            'permanently_rejected',
                            'active',
                            'under_offer',
                            'in_auction',
                            'sold',
                            'delisted'
                        )),

    is_auction          BOOLEAN NOT NULL DEFAULT FALSE,
    verification_cycle  INTEGER NOT NULL DEFAULT 0,

    -- Soft delete (hard delete is never used on financial platform assets)
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE marketplace.products IS 'Asset listings. Status transitions are enforced by DB trigger.';


-- Product images
CREATE TABLE marketplace.product_images (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID NOT NULL REFERENCES marketplace.products(id) ON DELETE CASCADE,
    storage_path    TEXT NOT NULL,
    original_name   TEXT,
    file_size_bytes INTEGER,
    mime_type       TEXT CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
    is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
    display_order   INTEGER NOT NULL DEFAULT 0,
    uploaded_by     UUID NOT NULL REFERENCES public.profiles(id),
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT max_images_per_product CHECK (
        -- Enforced at application layer, this is a backstop
        display_order <= 20
    )
);


-- Product status history (append-only)
CREATE TABLE marketplace.product_status_history (
    id          BIGSERIAL PRIMARY KEY,
    product_id  UUID NOT NULL REFERENCES marketplace.products(id),
    old_status  TEXT,
    new_status  TEXT NOT NULL,
    changed_by  UUID NOT NULL REFERENCES public.profiles(id),
    reason      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── Verification ──────────────────────────────────────────────────────────────

CREATE TABLE marketplace.verification_assignments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID NOT NULL REFERENCES marketplace.products(id),
    agent_id        UUID NOT NULL REFERENCES public.profiles(id),
    assigned_by     UUID NOT NULL REFERENCES public.profiles(id),
    cycle_number    INTEGER NOT NULL DEFAULT 1,
    status          TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN (
                        'assigned', 'contacted', 'inspection_scheduled',
                        'inspection_done', 'report_submitted', 'completed'
                    )),
    scheduled_date  DATE,
    contact_notes   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One assignment per cycle (allows multiple cycles across resubmissions)
    UNIQUE (product_id, cycle_number)
);


-- Verification reports (immutable once submitted)
CREATE TABLE marketplace.verification_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id   UUID NOT NULL UNIQUE REFERENCES marketplace.verification_assignments(id),
    agent_id        UUID NOT NULL REFERENCES public.profiles(id),
    outcome         TEXT NOT NULL CHECK (outcome IN (
                        'verified', 'failed', 'requires_clarification'
                    )),
    findings        TEXT NOT NULL,
    asset_condition TEXT,
    issues_found    TEXT,
    recommendations TEXT,
    submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- NO updated_at — reports cannot be modified after submission
);


-- Evidence files attached to verification reports
CREATE TABLE marketplace.verification_evidence (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id       UUID NOT NULL REFERENCES marketplace.verification_reports(id),
    file_type       TEXT NOT NULL CHECK (file_type IN ('image', 'document', 'video')),
    storage_path    TEXT NOT NULL,
    description     TEXT,
    uploaded_by     UUID NOT NULL REFERENCES public.profiles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── KYC ───────────────────────────────────────────────────────────────────────

CREATE TABLE marketplace.kyc_submissions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_id        UUID NOT NULL REFERENCES public.profiles(id),
    status          TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN (
                        'submitted', 'under_review', 'verified', 'rejected'
                    )),
    cycle_number    INTEGER NOT NULL DEFAULT 1,
    submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE marketplace.kyc_documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id   UUID NOT NULL REFERENCES marketplace.kyc_submissions(id),
    document_type   TEXT NOT NULL CHECK (document_type IN (
                        'national_id', 'passport', 'company_registration',
                        'tax_certificate', 'address_proof', 'bank_statement', 'other'
                    )),
    storage_path    TEXT NOT NULL,
    -- Retention metadata for 5-year rule
    account_closed_at   TIMESTAMPTZ,
    scheduled_deletion  TIMESTAMPTZ,
    deleted_at          TIMESTAMPTZ,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE marketplace.kyc_assignments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id   UUID NOT NULL REFERENCES marketplace.kyc_submissions(id),
    agent_id        UUID NOT NULL REFERENCES public.profiles(id),
    assigned_by     UUID NOT NULL REFERENCES public.profiles(id),
    status          TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN (
                        'assigned', 'contacted', 'verification_done', 'completed'
                    )),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (submission_id)
);

CREATE TABLE marketplace.kyc_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id   UUID NOT NULL UNIQUE REFERENCES marketplace.kyc_assignments(id),
    agent_id        UUID NOT NULL REFERENCES public.profiles(id),
    outcome         TEXT NOT NULL CHECK (outcome IN ('verified', 'failed', 'requires_clarification')),
    findings        TEXT NOT NULL,
    submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── Purchase Requests ─────────────────────────────────────────────────────────

CREATE TABLE marketplace.purchase_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID NOT NULL REFERENCES marketplace.products(id),
    buyer_id        UUID NOT NULL REFERENCES public.profiles(id),
    purchase_type   TEXT NOT NULL CHECK (purchase_type IN ('full_payment', 'financing')),
    offered_price   NUMERIC(18, 2),
    offered_currency TEXT DEFAULT 'USD',
    message         TEXT,
    status          TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN (
                        'submitted', 'under_review', 'agent_assigned',
                        'active_negotiation', 'financing_requested',
                        'full_payment_agreed', 'payment_pending',
                        'completed', 'cancelled', 'rejected'
                    )),
    cancelled_reason TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE marketplace.buyer_agent_assignments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      UUID NOT NULL UNIQUE REFERENCES marketplace.purchase_requests(id),
    agent_id        UUID NOT NULL REFERENCES public.profiles(id),
    assigned_by     UUID NOT NULL REFERENCES public.profiles(id),
    status          TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN (
                        'assigned', 'contacted', 'inspection_arranged',
                        'negotiation_active', 'completed'
                    )),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── Auctions ──────────────────────────────────────────────────────────────────

CREATE TABLE marketplace.auctions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID NOT NULL UNIQUE REFERENCES marketplace.products(id),
    start_time      TIMESTAMPTZ NOT NULL,
    end_time        TIMESTAMPTZ NOT NULL CHECK (end_time > start_time),
    reserve_price   NUMERIC(18, 2),              -- NEVER returned to non-admin
    reserve_met     BOOLEAN,                      -- Safe to return publicly
    starting_bid    NUMERIC(18, 2) NOT NULL CHECK (starting_bid > 0),
    bid_increment   NUMERIC(18, 2) NOT NULL DEFAULT 1000 CHECK (bid_increment > 0),
    currency        TEXT NOT NULL DEFAULT 'USD',
    status          TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN (
                        'scheduled', 'active', 'closed',
                        'winner_declared', 'failed', 'cancelled'
                    )),
    winner_id       UUID REFERENCES public.profiles(id),
    winning_bid_id  UUID,
    declared_by     UUID REFERENCES public.profiles(id),
    declared_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bids — APPEND ONLY, no updates, no deletes
CREATE TABLE marketplace.auction_bids (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id      UUID NOT NULL REFERENCES marketplace.auctions(id),
    bidder_id       UUID NOT NULL REFERENCES public.profiles(id),
    amount          NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
    currency        TEXT NOT NULL DEFAULT 'USD',
    amount_usd      NUMERIC(18, 2),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ═══════════════════════════════════════════════════════════════════════════
-- FINANCE SCHEMA
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Financing Requests ────────────────────────────────────────────────────────

CREATE TABLE finance.financing_requests (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_request_id         UUID NOT NULL UNIQUE REFERENCES marketplace.purchase_requests(id),
    buyer_id                    UUID NOT NULL REFERENCES public.profiles(id),
    product_id                  UUID NOT NULL REFERENCES marketplace.products(id),

    -- Product price snapshot at time of request
    product_price               NUMERIC(18, 2) NOT NULL CHECK (product_price > 0),
    product_currency            TEXT NOT NULL,
    product_price_usd           NUMERIC(18, 2) NOT NULL,

    -- Financing structure (fixed at 80/20)
    downpayment_percent         NUMERIC(5, 2) NOT NULL DEFAULT 80.00
                                    CHECK (downpayment_percent = 80.00),
    downpayment_amount          NUMERIC(18, 2) NOT NULL,
    financed_amount             NUMERIC(18, 2) NOT NULL,
    requested_duration_months   INTEGER NOT NULL CHECK (requested_duration_months BETWEEN 1 AND 120),

    -- Stage 1: Admin business approval
    admin_status                TEXT NOT NULL DEFAULT 'pending'
                                    CHECK (admin_status IN ('pending', 'approved', 'rejected')),
    admin_reviewed_by           UUID REFERENCES public.profiles(id),
    admin_reviewed_at           TIMESTAMPTZ,
    admin_notes                 TEXT,

    -- Stage 2: Finance Admin approval + term configuration
    finance_status              TEXT NOT NULL DEFAULT 'pending'
                                    CHECK (finance_status IN ('pending', 'approved', 'rejected')),
    finance_reviewed_by         UUID REFERENCES public.profiles(id),
    finance_reviewed_at         TIMESTAMPTZ,
    finance_notes               TEXT,

    -- Terms configured by Finance Admin
    facilitation_rate           NUMERIC(6, 4)
                                    CHECK (facilitation_rate IS NULL OR
                                           facilitation_rate BETWEEN 0.02 AND 0.15),
    facilitation_amount         NUMERIC(18, 2),
    total_repayable             NUMERIC(18, 2),
    approved_duration_months    INTEGER CHECK (approved_duration_months BETWEEN 1 AND 120),
    monthly_installment         NUMERIC(18, 2),

    -- Derived overall status
    status                      TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN (
                                    'submitted',
                                    'under_admin_review',
                                    'admin_approved',
                                    'admin_rejected',
                                    'under_finance_review',
                                    'finance_approved',
                                    'finance_rejected',
                                    'agreement_created',
                                    'expired'
                                )),

    -- Auto-expiry (7 days without admin response)
    expires_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN finance.financing_requests.facilitation_rate IS
    'DB-enforced: must be between 0.02 (2%) and 0.15 (15%). Set by Finance Admin per deal.';


-- Supporting documents for financing requests
CREATE TABLE finance.financing_request_documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      UUID NOT NULL REFERENCES finance.financing_requests(id),
    document_type   TEXT NOT NULL CHECK (document_type IN (
                        'bank_statement', 'company_financials',
                        'collateral_proof', 'board_resolution', 'other'
                    )),
    storage_path    TEXT NOT NULL,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── Transactions (APPEND ONLY) ────────────────────────────────────────────────

CREATE TABLE finance.transactions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id              UUID NOT NULL REFERENCES marketplace.products(id),
    purchase_request_id     UUID NOT NULL REFERENCES marketplace.purchase_requests(id),
    buyer_id                UUID NOT NULL REFERENCES public.profiles(id),
    seller_id               UUID NOT NULL REFERENCES public.profiles(id),
    financing_request_id    UUID REFERENCES finance.financing_requests(id),

    -- Multi-currency
    total_amount            NUMERIC(18, 2) NOT NULL CHECK (total_amount > 0),
    currency                TEXT NOT NULL,
    total_amount_usd        NUMERIC(18, 2) NOT NULL,
    exchange_rate           NUMERIC(18, 8) NOT NULL,
    exchange_rate_date      DATE NOT NULL,

    transaction_type        TEXT NOT NULL CHECK (transaction_type IN (
                                'full_payment', 'financing_downpayment'
                            )),
    status                  TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                                'pending', 'downpayment_recorded',
                                'downpayment_verified', 'completed', 'disputed'
                            )),

    -- Hash chain for tamper detection
    record_hash             TEXT NOT NULL,
    prev_record_hash        TEXT,

    -- Dual control fields
    recorded_by             UUID NOT NULL REFERENCES public.profiles(id),
    verified_by             UUID REFERENCES public.profiles(id),
    verified_at             TIMESTAMPTZ,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- NO updated_at — records are immutable
);


-- ── Payment Records (APPEND ONLY) ─────────────────────────────────────────────

CREATE TABLE finance.payment_records (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id      UUID NOT NULL REFERENCES finance.transactions(id),

    amount              NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
    currency            TEXT NOT NULL,
    amount_usd          NUMERIC(18, 2) NOT NULL,
    exchange_rate       NUMERIC(18, 8) NOT NULL,

    payment_date        DATE NOT NULL,
    payment_method      TEXT NOT NULL DEFAULT 'bank_transfer' CHECK (payment_method IN (
                            'bank_transfer', 'wire_transfer', 'other'
                        )),
    bank_reference      TEXT,
    bank_name           TEXT,
    payment_proof_path  TEXT,
    notes               TEXT,

    -- Dual control
    requires_verification   BOOLEAN NOT NULL DEFAULT FALSE,
    recorded_by             UUID NOT NULL REFERENCES public.profiles(id),
    verified_by             UUID REFERENCES public.profiles(id),
    verified_at             TIMESTAMPTZ,
    verification_status     TEXT NOT NULL DEFAULT 'recorded' CHECK (verification_status IN (
                                'recorded', 'verified', 'disputed'
                            )),

    -- Hash chain
    record_hash             TEXT NOT NULL,
    prev_record_hash        TEXT,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- NO updated_at
);


-- ── Financing Agreements ──────────────────────────────────────────────────────

CREATE TABLE finance.financing_agreements (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    financing_request_id    UUID NOT NULL UNIQUE REFERENCES finance.financing_requests(id),
    transaction_id          UUID NOT NULL UNIQUE REFERENCES finance.transactions(id),
    buyer_id                UUID NOT NULL REFERENCES public.profiles(id),

    financed_amount         NUMERIC(18, 2) NOT NULL,
    facilitation_rate       NUMERIC(6, 4) NOT NULL
                                CHECK (facilitation_rate BETWEEN 0.02 AND 0.15),
    facilitation_amount     NUMERIC(18, 2) NOT NULL,
    total_repayable         NUMERIC(18, 2) NOT NULL,
    duration_months         INTEGER NOT NULL,
    monthly_installment     NUMERIC(18, 2) NOT NULL,
    currency                TEXT NOT NULL,

    status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
                                'active', 'completed', 'defaulted', 'disputed'
                            )),

    -- Secure portal access token
    portal_token            TEXT UNIQUE,
    portal_token_created_at TIMESTAMPTZ,
    portal_first_accessed   TIMESTAMPTZ,

    created_by              UUID NOT NULL REFERENCES public.profiles(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── Repayment Schedule ────────────────────────────────────────────────────────

CREATE TABLE finance.installment_schedule (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agreement_id        UUID NOT NULL REFERENCES finance.financing_agreements(id),
    installment_number  INTEGER NOT NULL,
    due_date            DATE NOT NULL,
    amount_due          NUMERIC(18, 2) NOT NULL,
    grace_period_end    DATE NOT NULL,  -- due_date + 5 days
    status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                            'pending', 'partial', 'paid', 'overdue', 'waived'
                        )),
    payment_record_id   UUID REFERENCES finance.payment_records(id),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (agreement_id, installment_number)
);


-- ── Pending Dual-Control Approvals ────────────────────────────────────────────

CREATE TABLE finance.pending_approvals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    approval_type   TEXT NOT NULL CHECK (approval_type IN (
                        'high_value_payment', 'payment_dispute'
                    )),
    resource_id     UUID NOT NULL,
    resource_type   TEXT NOT NULL,
    requested_by    UUID NOT NULL REFERENCES public.profiles(id),
    request_data    JSONB NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending', 'approved', 'rejected'
                    )),
    reviewed_by     UUID REFERENCES public.profiles(id),
    reviewed_at     TIMESTAMPTZ,
    review_notes    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ═══════════════════════════════════════════════════════════════════════════
-- AUDIT SCHEMA
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE audit.logs (
    id              BIGSERIAL PRIMARY KEY,
    actor_id        TEXT,                           -- UUID as text (nullable for system actions)
    actor_roles     TEXT[] NOT NULL DEFAULT '{}',
    action          TEXT NOT NULL,
    resource_type   TEXT NOT NULL,
    resource_id     TEXT,
    old_state       JSONB,
    new_state       JSONB,
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE audit.logs IS 'Immutable audit trail. UPDATE/DELETE blocked by trigger.';

CREATE TABLE audit.role_changes (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES public.profiles(id),
    old_roles   TEXT[],
    new_roles   TEXT[] NOT NULL,
    changed_by  UUID NOT NULL REFERENCES public.profiles(id),
    reason      TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit.hash_chain_verifications (
    id                  BIGSERIAL PRIMARY KEY,
    table_name          TEXT NOT NULL,
    records_checked     INTEGER NOT NULL,
    is_valid            BOOLEAN NOT NULL,
    first_invalid_id    TEXT,
    run_by              TEXT,
    run_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ═══════════════════════════════════════════════════════════════════════════
-- NOTIFICATIONS SCHEMA
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE notifications.templates (
    id          TEXT PRIMARY KEY,
    subject     TEXT NOT NULL,
    body_html   TEXT NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE notifications.queue (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id     TEXT NOT NULL REFERENCES notifications.templates(id),
    recipient_id    UUID NOT NULL REFERENCES public.profiles(id),
    recipient_email TEXT NOT NULL,
    payload         JSONB NOT NULL DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending', 'processing', 'sent', 'failed', 'cancelled'
                    )),
    attempts        INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 3,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at         TIMESTAMPTZ,
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ═══════════════════════════════════════════════════════════════════════════
-- TRIGGERS
-- ═══════════════════════════════════════════════════════════════════════════

-- ── updated_at auto-maintenance ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_products_updated_at
    BEFORE UPDATE ON marketplace.products
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_verification_assignments_updated_at
    BEFORE UPDATE ON marketplace.verification_assignments
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_purchase_requests_updated_at
    BEFORE UPDATE ON marketplace.purchase_requests
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_buyer_agent_assignments_updated_at
    BEFORE UPDATE ON marketplace.buyer_agent_assignments
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_financing_requests_updated_at
    BEFORE UPDATE ON finance.financing_requests
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ── Immutability — financial records & audit logs ─────────────────────────────

CREATE OR REPLACE FUNCTION public.prevent_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'Immutable record: table=%, id=%. This record cannot be modified or deleted.',
        TG_TABLE_NAME,
        COALESCE(OLD.id::TEXT, 'unknown');
END;
$$ LANGUAGE plpgsql;

-- Finance tables
CREATE TRIGGER trg_immutable_transactions
    BEFORE UPDATE OR DELETE ON finance.transactions
    FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();

CREATE TRIGGER trg_immutable_payment_records
    BEFORE UPDATE OR DELETE ON finance.payment_records
    FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();

-- Marketplace: reports and bids are immutable
CREATE TRIGGER trg_immutable_verification_reports
    BEFORE UPDATE OR DELETE ON marketplace.verification_reports
    FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();

CREATE TRIGGER trg_immutable_auction_bids
    BEFORE UPDATE OR DELETE ON marketplace.auction_bids
    FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();

CREATE TRIGGER trg_immutable_kyc_reports
    BEFORE UPDATE OR DELETE ON marketplace.kyc_reports
    FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();

-- Audit logs
CREATE TRIGGER trg_immutable_audit_logs
    BEFORE UPDATE OR DELETE ON audit.logs
    FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();

CREATE TRIGGER trg_immutable_role_changes
    BEFORE UPDATE OR DELETE ON audit.role_changes
    FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();


-- ── Product status transition guard ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION marketplace.validate_product_status_transition()
RETURNS TRIGGER AS $$
DECLARE
    valid BOOLEAN := FALSE;
BEGIN
    IF NEW.status = OLD.status THEN
        RETURN NEW;  -- No change, allow
    END IF;

    -- Validate allowed transitions
    valid := CASE OLD.status
        WHEN 'draft' THEN
            NEW.status IN ('pending_verification')
        WHEN 'pending_verification' THEN
            NEW.status IN ('under_verification', 'permanently_rejected')
        WHEN 'under_verification' THEN
            NEW.status IN ('verification_failed', 'pending_approval')
        WHEN 'verification_failed' THEN
            NEW.status IN ('pending_reverification', 'permanently_rejected')
        WHEN 'pending_reverification' THEN
            NEW.status IN ('under_verification', 'permanently_rejected')
        WHEN 'pending_approval' THEN
            NEW.status IN ('active', 'rejected')
        WHEN 'rejected' THEN
            NEW.status IN ('pending_reverification')
        WHEN 'active' THEN
            NEW.status IN ('under_offer', 'in_auction', 'delisted')
        WHEN 'under_offer' THEN
            NEW.status IN ('active', 'sold')
        WHEN 'in_auction' THEN
            NEW.status IN ('sold', 'active')
        -- Terminal states — no transitions allowed
        WHEN 'sold' THEN FALSE
        WHEN 'delisted' THEN FALSE
        WHEN 'permanently_rejected' THEN FALSE
        ELSE FALSE
    END;

    IF NOT valid THEN
        RAISE EXCEPTION
            'Invalid product status transition: % → % (product_id: %)',
            OLD.status, NEW.status, OLD.id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_product_status_transitions
    BEFORE UPDATE OF status ON marketplace.products
    FOR EACH ROW EXECUTE FUNCTION marketplace.validate_product_status_transition();


-- ── Auto-log product status changes ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION marketplace.log_product_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status <> OLD.status THEN
        INSERT INTO marketplace.product_status_history
            (product_id, old_status, new_status, changed_by)
        VALUES (NEW.id, OLD.status, NEW.status, NEW.seller_id);
        -- Note: changed_by is set to seller_id as default.
        -- Application layer should update this with the actual actor.
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_log_product_status_change
    AFTER UPDATE OF status ON marketplace.products
    FOR EACH ROW EXECUTE FUNCTION marketplace.log_product_status_change();


-- ═══════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Profiles ──────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_profile_read" ON public.profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "admin_read_all_profiles" ON public.profiles
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
            AND ('admin' = ANY(p.roles) OR 'finance_admin' = ANY(p.roles))
        )
    );


-- ── Products ──────────────────────────────────────────────────────────────────
ALTER TABLE marketplace.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_active_products" ON marketplace.products
    FOR SELECT USING (status = 'active' AND deleted_at IS NULL);

CREATE POLICY "seller_own_products" ON marketplace.products
    FOR SELECT USING (seller_id = auth.uid());

CREATE POLICY "admin_all_products" ON marketplace.products
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
            AND ('admin' = ANY(p.roles) OR 'finance_admin' = ANY(p.roles))
        )
    );


-- ── Finance: Buyers see only their own data ───────────────────────────────────
ALTER TABLE finance.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.payment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.financing_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.financing_agreements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "buyer_own_transactions" ON finance.transactions
    FOR SELECT USING (buyer_id = auth.uid());

CREATE POLICY "buyer_own_financing_requests" ON finance.financing_requests
    FOR SELECT USING (buyer_id = auth.uid());

CREATE POLICY "buyer_own_agreements" ON finance.financing_agreements
    FOR SELECT USING (buyer_id = auth.uid());

CREATE POLICY "finance_admin_all_transactions" ON finance.transactions
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND 'finance_admin' = ANY(p.roles)
        )
    );

CREATE POLICY "admin_read_financing_requests" ON finance.financing_requests
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
            AND ('admin' = ANY(p.roles) OR 'finance_admin' = ANY(p.roles))
        )
    );


-- ── Verification: Agents see only assigned ────────────────────────────────────
ALTER TABLE marketplace.verification_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_own_verification_assignments" ON marketplace.verification_assignments
    FOR SELECT USING (agent_id = auth.uid());

CREATE POLICY "admin_all_verification_assignments" ON marketplace.verification_assignments
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND 'admin' = ANY(p.roles)
        )
    );


-- ── KYC ───────────────────────────────────────────────────────────────────────
ALTER TABLE marketplace.kyc_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "buyer_own_kyc" ON marketplace.kyc_submissions
    FOR SELECT USING (buyer_id = auth.uid());

CREATE POLICY "admin_all_kyc" ON marketplace.kyc_submissions
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND 'admin' = ANY(p.roles)
        )
    );


-- ── Auctions (reserve price never exposed via RLS — handled at API layer) ──────
ALTER TABLE marketplace.auctions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_active_auctions" ON marketplace.auctions
    FOR SELECT USING (status IN ('active', 'closed', 'winner_declared'));

CREATE POLICY "admin_all_auctions" ON marketplace.auctions
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND 'admin' = ANY(p.roles)
        )
    );


-- ── Audit logs: Admin read-only ────────────────────────────────────────────────
ALTER TABLE audit.logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_read_audit_logs" ON audit.logs
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
            AND ('admin' = ANY(p.roles) OR 'finance_admin' = ANY(p.roles))
        )
    );


-- ═══════════════════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════════════════

-- Products
CREATE INDEX idx_products_status_active
    ON marketplace.products(status)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_products_seller_id
    ON marketplace.products(seller_id);

CREATE INDEX idx_products_category_status
    ON marketplace.products(category, status)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_products_is_auction
    ON marketplace.products(is_auction, status)
    WHERE is_auction = TRUE;

-- Transactions
CREATE INDEX idx_transactions_buyer_id
    ON finance.transactions(buyer_id);

CREATE INDEX idx_transactions_product_id
    ON finance.transactions(product_id);

-- Financing requests
CREATE INDEX idx_financing_requests_buyer_id
    ON finance.financing_requests(buyer_id);

CREATE INDEX idx_financing_requests_status
    ON finance.financing_requests(status);

CREATE INDEX idx_financing_requests_expires_at
    ON finance.financing_requests(expires_at)
    WHERE status NOT IN ('expired', 'admin_rejected', 'finance_rejected', 'agreement_created');

-- Audit logs
CREATE INDEX idx_audit_logs_actor_id
    ON audit.logs(actor_id, created_at DESC);

CREATE INDEX idx_audit_logs_resource
    ON audit.logs(resource_type, resource_id, created_at DESC);

CREATE INDEX idx_audit_logs_action
    ON audit.logs(action, created_at DESC);

-- Notifications
CREATE INDEX idx_notifications_queue_pending
    ON notifications.queue(status, next_attempt_at)
    WHERE status IN ('pending', 'failed');

-- Installments due
CREATE INDEX idx_installment_due_dates
    ON finance.installment_schedule(due_date, status)
    WHERE status IN ('pending', 'partial');

-- Exchange rates
CREATE INDEX idx_exchange_rates_lookup
    ON public.exchange_rates(from_currency, to_currency, rate_date DESC);


-- ═══════════════════════════════════════════════════════════════════════════
-- SUPABASE AUTH HOOK — Custom JWT Claims
-- Run this in Supabase Dashboard > Authentication > Hooks
-- Injects user roles into the JWT so frontend can read role without DB call
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    claims JSONB;
    user_roles TEXT[];
    user_kyc TEXT;
BEGIN
    SELECT roles, kyc_status
    INTO user_roles, user_kyc
    FROM public.profiles
    WHERE id = (event->>'user_id')::UUID;

    claims := event->'claims';

    IF user_roles IS NOT NULL THEN
        claims := jsonb_set(claims, '{user_roles}', to_jsonb(user_roles));
        claims := jsonb_set(claims, '{kyc_status}', to_jsonb(user_kyc));
    END IF;

    RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

-- Grant execute permission to the supabase_auth_admin role
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM PUBLIC;


-- ═══════════════════════════════════════════════════════════════════════════
-- SEED: Notification Templates
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO notifications.templates (id, subject, body_html, description) VALUES

('verification_agent_assigned',
 'New Verification Assignment — {{ product_title }}',
 '<p>Dear {{ agent_name }},</p><p>You have been assigned to verify <strong>{{ product_title }}</strong>. Please log in to view the assignment details.</p><a href="{{ dashboard_url }}">Open Dashboard</a>',
 'Sent to verification agent when assigned to a product'),

('verification_completed_pass',
 'Your Product Has Been Verified',
 '<p>Dear {{ seller_name }},</p><p>Your listing <strong>{{ product_title }}</strong> has been successfully verified and is now pending admin approval.</p>',
 'Sent to seller when verification passes'),

('verification_failed',
 'Verification Issue — Action Required for {{ product_title }}',
 '<p>Dear {{ seller_name }},</p><p>The verification of <strong>{{ product_title }}</strong> has identified the following issues:</p><p>{{ issues_found }}</p><p>Please update your listing and resubmit for verification.</p><a href="{{ product_url }}">Update Listing</a>',
 'Sent to seller when verification fails'),

('product_approved',
 'Your Listing is Now Live — {{ product_title }}',
 '<p>Dear {{ seller_name }},</p><p>Your listing <strong>{{ product_title }}</strong> has been approved and is now visible to buyers.</p>',
 'Sent to seller when product is approved'),

('product_rejected',
 'Listing Not Approved — {{ product_title }}',
 '<p>Dear {{ seller_name }},</p><p>Your listing <strong>{{ product_title }}</strong> was not approved. Reason: {{ reason }}</p>',
 'Sent to seller when product is rejected'),

('purchase_request_received',
 'New Purchase Request for {{ product_title }}',
 '<p>Dear {{ seller_name }},</p><p>A buyer has submitted a purchase request for your listing <strong>{{ product_title }}</strong>. Our team will be in touch.</p>',
 'Sent to seller when a purchase request is submitted'),

('buyer_agent_assigned',
 'A Purchase Coordinator Has Been Assigned',
 '<p>Dear {{ buyer_name }},</p><p>A purchase coordinator has been assigned to assist with your request for <strong>{{ product_title }}</strong>. They will contact you shortly.</p>',
 'Sent to buyer when a buyer agent is assigned'),

('kyc_documents_received',
 'KYC Documents Received',
 '<p>Dear {{ buyer_name }},</p><p>We have received your KYC documents. Our team will review them and contact you to complete the verification process.</p>',
 'Sent to buyer after submitting KYC documents'),

('kyc_agent_assigned',
 'KYC Verification Agent Assigned',
 '<p>Dear {{ buyer_name }},</p><p>A verification agent has been assigned to your KYC application. They will contact you shortly.</p>',
 'Sent to buyer when KYC agent is assigned'),

('kyc_verified',
 'KYC Verification Complete — You Can Now Transact',
 '<p>Dear {{ buyer_name }},</p><p>Your identity verification (KYC) is complete. You can now submit purchase requests and participate in auctions on MarineXchange Africa.</p>',
 'Sent to buyer when KYC is approved'),

('kyc_rejected',
 'KYC Verification — Action Required',
 '<p>Dear {{ buyer_name }},</p><p>We were unable to complete your KYC verification. Reason: {{ reason }}</p><p>Please resubmit with the required documents.</p>',
 'Sent to buyer when KYC is rejected'),

('financing_admin_approved',
 'Financing Request Under Financial Review',
 '<p>Dear {{ buyer_name }},</p><p>Your financing request for <strong>{{ product_title }}</strong> has been approved at the business level and is now under financial review. We will notify you of the outcome.</p>',
 'Sent to buyer after admin stage 1 approval'),

('financing_rejected',
 'Financing Request Outcome',
 '<p>Dear {{ buyer_name }},</p><p>We regret to inform you that your financing request for <strong>{{ product_title }}</strong> was not approved. Reason: {{ reason }}</p>',
 'Sent to buyer when financing is rejected at any stage'),

('financing_fully_approved',
 'Financing Agreement Approved — Portal Ready',
 '<p>Dear {{ buyer_name }},</p><p>Your financing agreement for <strong>{{ product_title }}</strong> has been approved. Please access your secure finance portal below.</p><a href="{{ portal_url }}">Access Finance Portal</a><p><strong>Important:</strong> This link is personal. Do not share it.</p>',
 'Sent to buyer with finance portal link'),

('payment_recorded',
 'Payment Recorded — {{ amount }} {{ currency }}',
 '<p>Dear {{ buyer_name }},</p><p>A payment of <strong>{{ amount }} {{ currency }}</strong> has been recorded on {{ payment_date }}. Reference: {{ bank_reference }}</p>',
 'Sent to buyer when a payment is recorded'),

('installment_reminder_7_days',
 'Payment Due in 7 Days — {{ amount_due }} {{ currency }}',
 '<p>Dear {{ buyer_name }},</p><p>Your installment payment of <strong>{{ amount_due }} {{ currency }}</strong> is due on {{ due_date }}.</p><a href="{{ portal_url }}">View Finance Portal</a>',
 'Sent 7 days before installment due date'),

('installment_reminder_1_day',
 'Payment Due Tomorrow — {{ amount_due }} {{ currency }}',
 '<p>Dear {{ buyer_name }},</p><p>Your installment payment of <strong>{{ amount_due }} {{ currency }}</strong> is due tomorrow ({{ due_date }}).</p>',
 'Sent 1 day before installment due date'),

('installment_overdue',
 'URGENT: Payment Overdue — {{ amount_due }} {{ currency }}',
 '<p>Dear {{ buyer_name }},</p><p>Your payment of <strong>{{ amount_due }} {{ currency }}</strong> due on {{ due_date }} is now overdue. Please contact us immediately.</p>',
 'Sent when installment is marked overdue after grace period');
