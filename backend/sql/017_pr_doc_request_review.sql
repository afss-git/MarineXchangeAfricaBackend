-- Migration 017: PR document request agent review (approve/reject)
-- Run in Supabase SQL Editor

-- 1. Extend status to include approved and rejected
ALTER TABLE marketplace.pr_document_requests
    DROP CONSTRAINT IF EXISTS pr_document_requests_status_check;

ALTER TABLE marketplace.pr_document_requests
    ADD CONSTRAINT pr_document_requests_status_check
    CHECK (status IN ('pending', 'uploaded', 'approved', 'rejected', 'waived'));

-- 2. Add review_notes and reviewed_at columns
ALTER TABLE marketplace.pr_document_requests
    ADD COLUMN IF NOT EXISTS review_notes TEXT,
    ADD COLUMN IF NOT EXISTS reviewed_at  TIMESTAMPTZ;
