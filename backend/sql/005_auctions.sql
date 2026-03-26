-- ═══════════════════════════════════════════════════════════════════════════
-- MarineXchange Africa — Phase 8: Auction Engine
-- Run AFTER 004_purchase_requests.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. marketplace.auctions — auction configuration & state
CREATE TABLE IF NOT EXISTS marketplace.auctions (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id              UUID        NOT NULL REFERENCES marketplace.products(id),
    created_by              UUID        NOT NULL REFERENCES public.profiles(id),

    -- Display
    title                   TEXT        NOT NULL,
    description             TEXT,

    -- Bid configuration
    starting_bid            NUMERIC(18,2) NOT NULL CHECK (starting_bid > 0),
    reserve_price           NUMERIC(18,2),           -- NULL = no reserve; NEVER exposed via public API
    currency                TEXT        NOT NULL DEFAULT 'USD',
    min_bid_increment_usd   NUMERIC(18,2) NOT NULL DEFAULT 5000 CHECK (min_bid_increment_usd > 0),

    -- Timing
    start_time              TIMESTAMPTZ NOT NULL,
    end_time                TIMESTAMPTZ NOT NULL,
    original_end_time       TIMESTAMPTZ NOT NULL,    -- preserved before auto-extensions

    -- Auto-extend (last-minute bid protection)
    auto_extend_minutes     INT         NOT NULL DEFAULT 5  CHECK (auto_extend_minutes > 0),
    max_extensions          INT         NOT NULL DEFAULT 3  CHECK (max_extensions >= 0),
    extensions_count        INT         NOT NULL DEFAULT 0,

    -- Live state — denormalised for query performance
    current_highest_bid     NUMERIC(18,2),
    current_winner_id       UUID        REFERENCES public.profiles(id),

    -- Winner approval gate
    winner_approved_by      UUID        REFERENCES public.profiles(id),
    winner_approved_at      TIMESTAMPTZ,
    winner_rejection_reason TEXT,

    -- Conversion to deal
    converted_deal_id       UUID        REFERENCES finance.deals(id),

    -- Status machine
    status                  TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft',                    -- admin configuring
        'scheduled',                -- configured, waiting for start_time
        'live',                     -- bidding open
        'closing_soon',             -- auto-extend triggered
        'closed',                   -- bidding ended, winner logic run
        'winner_pending_approval',  -- admin must review and approve
        'winner_approved',          -- admin approved, ready to convert
        'winner_rejected',          -- admin rejected — can re-auction or close
        'converted',                -- DRAFT deal created in finance.deals
        'failed_no_bids',           -- closed with zero bids
        'failed_reserve_not_met',   -- highest bid < reserve price
        'cancelled'                 -- admin cancelled (draft/scheduled only)
    )),

    admin_notes             TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT auctions_end_after_start CHECK (end_time > start_time)
);

-- 2. marketplace.auction_bids — immutable bid ledger
-- Drop and recreate if schema changed (safe in dev; use ALTER in production)
DROP TABLE IF EXISTS marketplace.auction_bids CASCADE;
CREATE TABLE marketplace.auction_bids (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id  UUID        NOT NULL REFERENCES marketplace.auctions(id),
    bidder_id   UUID        NOT NULL REFERENCES public.profiles(id),
    amount      NUMERIC(18,2) NOT NULL CHECK (amount > 0),
    currency    TEXT        NOT NULL DEFAULT 'USD',
    is_winning_bid BOOLEAN  NOT NULL DEFAULT FALSE,
    bid_time    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address  TEXT
);

-- 3. Immutable bid ledger trigger
--    Deletes are always blocked.
--    Updates only allow flipping is_winning_bid — all other fields are frozen.
CREATE OR REPLACE FUNCTION marketplace.prevent_bid_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Auction bids are immutable and cannot be deleted.';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF OLD.auction_id  IS DISTINCT FROM NEW.auction_id  OR
           OLD.bidder_id   IS DISTINCT FROM NEW.bidder_id   OR
           OLD.amount      IS DISTINCT FROM NEW.amount       OR
           OLD.currency    IS DISTINCT FROM NEW.currency     OR
           OLD.bid_time    IS DISTINCT FROM NEW.bid_time     THEN
            RAISE EXCEPTION 'Auction bids are immutable. Only is_winning_bid may be updated.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auction_bids_immutable
    BEFORE UPDATE OR DELETE ON marketplace.auction_bids
    FOR EACH ROW EXECUTE FUNCTION marketplace.prevent_bid_modification();

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_auctions_status
    ON marketplace.auctions(status);

CREATE INDEX IF NOT EXISTS idx_auctions_start_time
    ON marketplace.auctions(start_time)
    WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS idx_auctions_end_time
    ON marketplace.auctions(end_time)
    WHERE status IN ('live', 'closing_soon');

CREATE INDEX IF NOT EXISTS idx_auction_bids_auction_id
    ON marketplace.auction_bids(auction_id, bid_time DESC);

CREATE INDEX IF NOT EXISTS idx_auction_bids_bidder_id
    ON marketplace.auction_bids(bidder_id);
