-- ═══════════════════════════════════════════════════════════════════════════
-- MarineXchange Africa — Phase 5: Deals, Payments & Financing
-- Run AFTER 001_initial_schema.sql and 002_kyc_schema.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- Deal reference sequence: MXD-2026-00001
CREATE SEQUENCE IF NOT EXISTS finance.deal_ref_seq START 1;

-- 1. finance.payment_accounts — MarineXchange bank accounts (admin-managed)
CREATE TABLE finance.payment_accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_name       TEXT NOT NULL,
    account_name    TEXT NOT NULL DEFAULT 'MarineXchange Africa Ltd',
    account_number  TEXT NOT NULL,
    sort_code       TEXT,
    swift_code      TEXT,
    iban            TEXT,
    routing_number  TEXT,
    currency        TEXT NOT NULL DEFAULT 'USD',
    country         TEXT NOT NULL DEFAULT 'NG',
    additional_info TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      UUID REFERENCES public.profiles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. finance.rate_schedules — reusable rate templates for financing deals
CREATE TABLE finance.rate_schedules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    description     TEXT,
    asset_class     TEXT,
    -- JSONB rate map: {"3": 0.035, "6": 0.039, "12": 0.045, "24": 0.052, "36": 0.059, "48": 0.065}
    -- Keys are duration_months as strings, values are MONTHLY rates (not annual)
    monthly_rates   JSONB NOT NULL,
    arrangement_fee NUMERIC(18,2) NOT NULL DEFAULT 0,
    min_down_payment_percent NUMERIC(5,2) NOT NULL DEFAULT 20.00,
    max_down_payment_percent NUMERIC(5,2) NOT NULL DEFAULT 80.00,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      UUID REFERENCES public.profiles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. finance.buyer_credit_profile — financing eligibility + credit limits per buyer
CREATE TABLE finance.buyer_credit_profile (
    buyer_id                UUID PRIMARY KEY REFERENCES public.profiles(id),
    is_financing_eligible   BOOLEAN NOT NULL DEFAULT FALSE,
    credit_limit_usd        NUMERIC(18,2),
    max_single_deal_usd     NUMERIC(18,2),
    collateral_notes        TEXT,
    risk_rating             TEXT CHECK (risk_rating IN ('low', 'medium', 'high')),
    notes                   TEXT,
    set_by                  UUID REFERENCES public.profiles(id),
    set_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. finance.deals — central deal entity (admin-created)
CREATE TABLE finance.deals (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_ref                TEXT NOT NULL UNIQUE,   -- MXD-2026-00001

    -- Parties
    product_id              UUID NOT NULL REFERENCES marketplace.products(id),
    buyer_id                UUID NOT NULL REFERENCES public.profiles(id),
    seller_id               UUID NOT NULL REFERENCES public.profiles(id),
    purchase_request_id     UUID REFERENCES marketplace.purchase_requests(id),

    -- Deal type
    deal_type               TEXT NOT NULL CHECK (deal_type IN ('full_payment', 'financing')),

    -- Agreed price (admin sets)
    total_price             NUMERIC(18,2) NOT NULL CHECK (total_price > 0),
    currency                TEXT NOT NULL DEFAULT 'USD',

    -- Full payment config
    payment_account_id      UUID REFERENCES finance.payment_accounts(id),
    payment_deadline        TIMESTAMPTZ,
    payment_instructions    TEXT,

    -- Financing config (admin sets)
    initial_payment_percent NUMERIC(5,2) CHECK (
                                initial_payment_percent IS NULL OR
                                initial_payment_percent BETWEEN 10.00 AND 90.00
                            ),
    initial_payment_amount  NUMERIC(18,2) CHECK (initial_payment_amount IS NULL OR initial_payment_amount > 0),
    financed_amount         NUMERIC(18,2) CHECK (financed_amount IS NULL OR financed_amount > 0),
    monthly_finance_rate    NUMERIC(8,6) CHECK (
                                monthly_finance_rate IS NULL OR
                                monthly_finance_rate BETWEEN 0.001 AND 0.10
                            ),
    duration_months         INTEGER CHECK (duration_months IS NULL OR duration_months BETWEEN 1 AND 120),
    arrangement_fee         NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (arrangement_fee >= 0),
    rate_schedule_id        UUID REFERENCES finance.rate_schedules(id),

    -- Computed financing summary (set when deal is configured, for display)
    total_finance_charge    NUMERIC(18,2),   -- total interest over life of deal
    total_amount_payable    NUMERIC(18,2),   -- financed + charges + fees
    first_monthly_payment   NUMERIC(18,2),   -- first installment amount

    -- Buyer acceptance via OTP
    acceptance_otp_hash     TEXT,            -- SHA-256 hex of OTP
    acceptance_otp_expires  TIMESTAMPTZ,
    accepted_at             TIMESTAMPTZ,
    acceptance_ip           TEXT,

    -- Secure deal portal link for buyer
    portal_token            TEXT UNIQUE,
    portal_token_expires_at TIMESTAMPTZ,
    portal_first_accessed   TIMESTAMPTZ,

    -- Dual approval (for high-value deals)
    requires_second_approval BOOLEAN NOT NULL DEFAULT FALSE,
    second_approved_by       UUID REFERENCES public.profiles(id),
    second_approved_at       TIMESTAMPTZ,
    second_approval_notes    TEXT,

    -- Admin notes
    admin_notes             TEXT,
    cancellation_reason     TEXT,

    -- Status machine
    status                  TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                                'draft',                     -- admin configuring terms
                                'pending_approval',          -- awaiting second admin sign-off
                                'offer_sent',                -- offer email+SMS sent to buyer
                                'accepted',                  -- buyer confirmed via OTP
                                'payment_pending',           -- awaiting buyer payment
                                'payment_recorded',          -- admin logged offline payment
                                'payment_verified',          -- finance admin confirmed receipt
                                'active',                    -- financing: agreement live, installments running
                                'completed',                 -- deal fully closed
                                'cancelled',
                                'disputed',
                                'defaulted'                  -- financing: buyer stopped paying
                            )),

    created_by              UUID NOT NULL REFERENCES public.profiles(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN finance.deals.monthly_finance_rate IS
    'Monthly finance rate (e.g. 0.02 = 2% per month). Applied on reducing balance.';
COMMENT ON COLUMN finance.deals.arrangement_fee IS
    'One-time arrangement fee charged with initial/full payment.';

-- 5. finance.deal_payments — offline payment records (admin-entered)
CREATE TABLE finance.deal_payments (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id                 UUID NOT NULL REFERENCES finance.deals(id),

    payment_type            TEXT NOT NULL CHECK (payment_type IN (
                                'full_payment',       -- full payment path
                                'initial_payment',    -- financing: down payment
                                'installment'         -- financing: monthly installment
                            )),
    installment_number      INTEGER,         -- only for payment_type = 'installment'

    amount                  NUMERIC(18,2) NOT NULL CHECK (amount > 0),
    currency                TEXT NOT NULL DEFAULT 'USD',

    payment_date            DATE NOT NULL,
    bank_name               TEXT,
    bank_reference          TEXT,
    payment_proof_path      TEXT,   -- Supabase Storage path
    notes                   TEXT,

    -- Dual control: admin records, finance admin verifies
    recorded_by             UUID NOT NULL REFERENCES public.profiles(id),
    recorded_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_by             UUID REFERENCES public.profiles(id),
    verified_at             TIMESTAMPTZ,
    verification_status     TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN (
                                'pending', 'verified', 'disputed'
                            )),
    verification_notes      TEXT,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- No updated_at — append-only
);

-- 6. finance.deal_installments — reducing balance schedule (generated on deal activation)
CREATE TABLE finance.deal_installments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id             UUID NOT NULL REFERENCES finance.deals(id),
    installment_number  INTEGER NOT NULL,

    due_date            DATE NOT NULL,
    grace_period_end    DATE NOT NULL,   -- due_date + 5 days

    opening_balance     NUMERIC(18,2) NOT NULL,
    principal_amount    NUMERIC(18,2) NOT NULL,
    finance_charge      NUMERIC(18,2) NOT NULL,
    amount_due          NUMERIC(18,2) NOT NULL,
    closing_balance     NUMERIC(18,2) NOT NULL,

    status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                            'pending', 'paid', 'partial', 'overdue', 'waived'
                        )),
    payment_id          UUID REFERENCES finance.deal_payments(id),
    paid_amount         NUMERIC(18,2),
    paid_at             TIMESTAMPTZ,
    waived_by           UUID REFERENCES public.profiles(id),
    waived_at           TIMESTAMPTZ,
    waiver_reason       TEXT,

    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (deal_id, installment_number)
);

-- Triggers
CREATE TRIGGER trg_payment_accounts_updated_at
    BEFORE UPDATE ON finance.payment_accounts
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_rate_schedules_updated_at
    BEFORE UPDATE ON finance.rate_schedules
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_buyer_credit_profile_updated_at
    BEFORE UPDATE ON finance.buyer_credit_profile
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_deals_updated_at
    BEFORE UPDATE ON finance.deals
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_deal_installments_updated_at
    BEFORE UPDATE ON finance.deal_installments
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Indexes
CREATE INDEX idx_deals_buyer_id ON finance.deals(buyer_id);
CREATE INDEX idx_deals_product_id ON finance.deals(product_id);
CREATE INDEX idx_deals_status ON finance.deals(status);
CREATE INDEX idx_deals_portal_token ON finance.deals(portal_token) WHERE portal_token IS NOT NULL;
CREATE INDEX idx_deal_payments_deal_id ON finance.deal_payments(deal_id);
CREATE INDEX idx_deal_installments_deal_id ON finance.deal_installments(deal_id);
CREATE INDEX idx_deal_installments_due_date ON finance.deal_installments(due_date) WHERE status = 'pending';

-- RLS (same pattern as existing tables — service role bypasses RLS)
ALTER TABLE finance.payment_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.rate_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.buyer_credit_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.deal_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.deal_installments ENABLE ROW LEVEL SECURITY;
