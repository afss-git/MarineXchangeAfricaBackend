-- Migration 011: Store admin decision reasons on the product row
-- So sellers can see exactly why corrections were requested or listing was rejected.

ALTER TABLE marketplace.products
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
    ADD COLUMN IF NOT EXISTS corrections_reason TEXT;

COMMENT ON COLUMN marketplace.products.rejection_reason IS
    'Admin-provided reason when a product is rejected.';
COMMENT ON COLUMN marketplace.products.corrections_reason IS
    'Admin-provided reason when corrections are requested (pending_reverification).';
