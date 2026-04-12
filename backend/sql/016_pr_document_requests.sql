-- ═══════════════════════════════════════════════════════════════════════════
-- Harbours360 — Migration 012: PR Document Requests
-- Run in Supabase SQL Editor (or psql).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Add 'docs_requested' to the purchase_requests status machine
ALTER TABLE marketplace.purchase_requests
    DROP CONSTRAINT IF EXISTS purchase_requests_status_check;

ALTER TABLE marketplace.purchase_requests
    ADD CONSTRAINT purchase_requests_status_check
    CHECK (status IN (
        'submitted',        -- buyer just submitted
        'agent_assigned',   -- admin assigned a buyer agent
        'docs_requested',   -- agent has requested PR-specific documents from buyer
        'under_review',     -- agent is actively reviewing
        'approved',         -- admin approved, ready to convert
        'rejected',         -- admin rejected
        'converted',        -- converted to a deal in finance.deals
        'cancelled'         -- buyer cancelled or admin cancelled
    ));

-- 2. Fix buyer_agent_reports recommendation constraint to match service values
ALTER TABLE marketplace.buyer_agent_reports
    DROP CONSTRAINT IF EXISTS buyer_agent_reports_recommendation_check;

ALTER TABLE marketplace.buyer_agent_reports
    ADD CONSTRAINT buyer_agent_reports_recommendation_check
    CHECK (recommendation IN ('approve', 'reject', 'requires_resubmission'));

-- 3. Create marketplace.pr_document_requests table
CREATE TABLE IF NOT EXISTS marketplace.pr_document_requests (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id    UUID        NOT NULL REFERENCES marketplace.purchase_requests(id) ON DELETE CASCADE,
    agent_id      UUID        NOT NULL REFERENCES public.profiles(id),
    document_name TEXT        NOT NULL,
    reason        TEXT,
    priority      TEXT        NOT NULL DEFAULT 'required'
                              CHECK (priority IN ('required', 'recommended')),
    status        TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'uploaded', 'waived')),
    waive_reason  TEXT,
    storage_path  TEXT,
    file_name     TEXT,
    fulfilled_at  TIMESTAMPTZ,
    waived_at     TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast per-request lookups
CREATE INDEX IF NOT EXISTS idx_pr_doc_requests_request_id
    ON marketplace.pr_document_requests (request_id);
