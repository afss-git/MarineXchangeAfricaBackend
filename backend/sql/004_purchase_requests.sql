-- ═══════════════════════════════════════════════════════════════════════════
-- MarineXchange Africa — Phase 7: Purchase Request Flow
-- Run AFTER 003_deals_payments.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Add missing columns to marketplace.purchase_requests
ALTER TABLE marketplace.purchase_requests
    ADD COLUMN IF NOT EXISTS quantity              INTEGER      NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS converted_deal_id     UUID         REFERENCES finance.deals(id),
    ADD COLUMN IF NOT EXISTS admin_notes           TEXT,
    ADD COLUMN IF NOT EXISTS admin_bypass_reason   TEXT,
    ADD COLUMN IF NOT EXISTS reviewed_by           UUID         REFERENCES public.profiles(id),
    ADD COLUMN IF NOT EXISTS reviewed_at           TIMESTAMPTZ;

-- 2. Replace status constraint with clean 7-status machine
ALTER TABLE marketplace.purchase_requests
    DROP CONSTRAINT IF EXISTS purchase_requests_status_check;

ALTER TABLE marketplace.purchase_requests
    ADD CONSTRAINT purchase_requests_status_check
    CHECK (status IN (
        'submitted',       -- buyer just submitted
        'agent_assigned',  -- admin assigned a buyer agent
        'under_review',    -- agent is actively reviewing
        'approved',        -- admin approved, ready to convert
        'rejected',        -- admin rejected
        'converted',       -- converted to a deal in finance.deals
        'cancelled'        -- buyer cancelled or admin cancelled
    ));

-- 3. Add status constraint to marketplace.buyer_agent_assignments
ALTER TABLE marketplace.buyer_agent_assignments
    DROP CONSTRAINT IF EXISTS buyer_agent_assignments_status_check;

ALTER TABLE marketplace.buyer_agent_assignments
    ADD CONSTRAINT buyer_agent_assignments_status_check
    CHECK (status IN (
        'assigned',          -- agent just received the case
        'in_review',         -- agent is actively working
        'report_submitted'   -- agent has submitted their report
    ));

-- 4. Create marketplace.buyer_agent_reports — immutable per-request report
CREATE TABLE IF NOT EXISTS marketplace.buyer_agent_reports (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id              UUID        NOT NULL REFERENCES marketplace.purchase_requests(id),
    agent_id                UUID        NOT NULL REFERENCES public.profiles(id),
    financial_capacity_usd  NUMERIC(18,2) NOT NULL,
    risk_rating             TEXT        NOT NULL CHECK (risk_rating IN ('low', 'medium', 'high')),
    recommendation          TEXT        NOT NULL CHECK (recommendation IN ('recommend_approve', 'recommend_reject')),
    verification_notes      TEXT        NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Only one report per request per agent
    UNIQUE (request_id, agent_id)
);

-- 5. Partial unique index: one active request per buyer per listing
--    (rejected / converted / cancelled requests don't block new submissions)
CREATE UNIQUE INDEX IF NOT EXISTS uidx_one_active_pr_per_buyer_listing
    ON marketplace.purchase_requests (buyer_id, product_id)
    WHERE status NOT IN ('rejected', 'converted', 'cancelled');
