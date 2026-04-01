-- ============================================================
-- Migration 012: Product snapshots
--
-- Captures the full product state every time a seller submits
-- or resubmits. This record is IMMUTABLE — admin edits to the
-- live marketplace.products row never touch this table.
-- ============================================================

-- ── 1. Snapshot table ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS marketplace.product_snapshots (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id        UUID        NOT NULL REFERENCES marketplace.products(id),
    seller_id         UUID        NOT NULL,
    cycle_number      INTEGER     NOT NULL DEFAULT 1,
    snapshot_reason   TEXT        NOT NULL,   -- 'submitted' | 'resubmitted'

    -- ── Core product fields at time of submission ──────────────────────────
    title             TEXT        NOT NULL,
    description       TEXT,
    category_id       UUID,
    availability_type TEXT        NOT NULL,
    condition         TEXT        NOT NULL,
    asking_price      NUMERIC(18,2) NOT NULL,
    currency          TEXT        NOT NULL,
    location_country  TEXT        NOT NULL,
    location_port     TEXT,
    location_details  TEXT,

    -- ── Images: stored as [{id, storage_path, is_primary, display_order}]
    --    storage_path is used to re-generate signed URLs on demand;
    --    signed_url values are NOT stored (they expire).
    images            JSONB       NOT NULL DEFAULT '[]',

    -- ── Technical specifications at time of submission ─────────────────────
    attribute_values  JSONB       NOT NULL DEFAULT '[]',

    snapped_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for quick lookup by product
CREATE INDEX IF NOT EXISTS idx_product_snapshots_product_id
    ON marketplace.product_snapshots (product_id, cycle_number);

-- ── 2. Immutability trigger ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION marketplace.prevent_snapshot_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'product_snapshots are immutable — original seller submissions cannot be altered.';
END;
$$;

DROP TRIGGER IF EXISTS trg_immutable_product_snapshots ON marketplace.product_snapshots;
CREATE TRIGGER trg_immutable_product_snapshots
    BEFORE UPDATE OR DELETE ON marketplace.product_snapshots
    FOR EACH ROW EXECUTE FUNCTION marketplace.prevent_snapshot_mutation();

-- ── 3. Ensure is_visible + admin_edited_at exist (012 safety net) ────────────
--    These were added manually in development; this makes migrations idempotent.

ALTER TABLE marketplace.products
    ADD COLUMN IF NOT EXISTS is_visible     BOOLEAN     NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS admin_edited_at TIMESTAMPTZ;
