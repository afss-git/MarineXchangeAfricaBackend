-- Migration 010: full_history_access on verification_assignments
-- Allows admin to grant a newly-assigned agent access to all previous
-- cycle reports and evidence when reassigning a product.

ALTER TABLE marketplace.verification_assignments
    ADD COLUMN IF NOT EXISTS full_history_access BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN marketplace.verification_assignments.full_history_access IS
    'When TRUE, the assigned agent can view all previous cycle assignments, '
    'reports, and evidence for this product. When FALSE the agent only sees '
    'the current cycle (default — fresh inspection).';
