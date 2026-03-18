-- ═══════════════════════════════════════════════════════════════════════════
-- MarineXchange Africa — Phase 9: Payment Lifecycle & Escrow Tracking
-- Run AFTER 005_auctions.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. finance.payment_schedules ─────────────────────────────────────────
--    One record per deal. Admin creates it (auto or manual mode).
--    A deal may only have ONE active schedule.
CREATE TABLE IF NOT EXISTS finance.payment_schedules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id         UUID NOT NULL REFERENCES finance.deals(id) ON DELETE CASCADE,

    mode            TEXT NOT NULL CHECK (mode IN ('auto', 'manual')),
    total_items     INTEGER NOT NULL CHECK (total_items BETWEEN 1 AND 60),
    currency        TEXT NOT NULL DEFAULT 'USD',

    -- Track whether all items are verified (denormalised for fast lookup)
    is_complete     BOOLEAN NOT NULL DEFAULT FALSE,
    completed_at    TIMESTAMPTZ,

    created_by      UUID NOT NULL REFERENCES public.profiles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_payment_schedule_per_deal UNIQUE (deal_id)
);

-- ── 2. finance.payment_schedule_items ────────────────────────────────────
--    Individual installments inside a schedule.
--    For manual mode: admin provides label + amount + due_date.
--    For auto mode:   system generates equal amounts spaced 30 days apart.
CREATE TABLE IF NOT EXISTS finance.payment_schedule_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id         UUID NOT NULL REFERENCES finance.payment_schedules(id) ON DELETE CASCADE,
    deal_id             UUID NOT NULL REFERENCES finance.deals(id) ON DELETE CASCADE,

    installment_number  INTEGER NOT NULL CHECK (installment_number >= 1),
    label               TEXT NOT NULL,          -- e.g. "Deposit", "Installment 1", "Final Payment"
    amount              NUMERIC(18,2) NOT NULL CHECK (amount > 0),
    currency            TEXT NOT NULL DEFAULT 'USD',
    due_date            DATE NOT NULL,

    status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                            'pending',              -- awaiting buyer payment
                            'payment_submitted',    -- buyer uploaded evidence
                            'verified',             -- admin confirmed receipt
                            'rejected',             -- admin rejected evidence
                            'overdue',              -- past due_date, no verified payment
                            'waived'                -- admin waived this installment
                        )),

    -- Populated when verified or waived
    verified_by         UUID REFERENCES public.profiles(id),
    verified_at         TIMESTAMPTZ,
    waived_by           UUID REFERENCES public.profiles(id),
    waived_at           TIMESTAMPTZ,
    waiver_reason       TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_schedule_item_number UNIQUE (schedule_id, installment_number)
);

-- ── 3. finance.schedule_payment_records ──────────────────────────────────
--    Buyer submits a payment record for a schedule item.
--    One item can have multiple records (e.g. resubmission after rejection).
--    Only ONE record per item can be in 'pending_verification' or 'verified' state.
CREATE TABLE IF NOT EXISTS finance.schedule_payment_records (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_item_id    UUID NOT NULL REFERENCES finance.payment_schedule_items(id) ON DELETE CASCADE,
    deal_id             UUID NOT NULL REFERENCES finance.deals(id) ON DELETE CASCADE,
    submitted_by        UUID NOT NULL REFERENCES public.profiles(id),

    amount_paid         NUMERIC(18,2) NOT NULL CHECK (amount_paid > 0),
    currency            TEXT NOT NULL DEFAULT 'USD',
    payment_method      TEXT NOT NULL CHECK (payment_method IN (
                            'bank_transfer', 'wire_transfer', 'swift',
                            'cheque', 'cash', 'other'
                        )),
    payment_date        DATE NOT NULL,
    bank_name           TEXT,
    bank_reference      TEXT,          -- TRN / ref on bank slip
    notes               TEXT,

    status              TEXT NOT NULL DEFAULT 'pending_verification' CHECK (status IN (
                            'pending_verification',
                            'verified',
                            'rejected'
                        )),

    -- Admin action
    reviewed_by         UUID REFERENCES public.profiles(id),
    reviewed_at         TIMESTAMPTZ,
    rejection_reason    TEXT,

    submitted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 4. finance.schedule_payment_files ────────────────────────────────────
--    Files uploaded as payment proof. One record can have many files.
--    Stored in Supabase Storage bucket "payment-evidence".
CREATE TABLE IF NOT EXISTS finance.schedule_payment_files (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_record_id   UUID NOT NULL REFERENCES finance.schedule_payment_records(id) ON DELETE CASCADE,
    deal_id             UUID NOT NULL REFERENCES finance.deals(id) ON DELETE CASCADE,
    uploaded_by         UUID NOT NULL REFERENCES public.profiles(id),

    file_name           TEXT NOT NULL,
    file_path           TEXT NOT NULL,
    file_size_bytes     BIGINT,
    mime_type           TEXT NOT NULL,

    uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Triggers ──────────────────────────────────────────────────────────────
CREATE TRIGGER trg_payment_schedules_updated_at
    BEFORE UPDATE ON finance.payment_schedules
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_payment_schedule_items_updated_at
    BEFORE UPDATE ON finance.payment_schedule_items
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_schedule_payment_records_updated_at
    BEFORE UPDATE ON finance.schedule_payment_records
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_payment_schedules_deal_id
    ON finance.payment_schedules(deal_id);

CREATE INDEX IF NOT EXISTS idx_payment_schedule_items_schedule_id
    ON finance.payment_schedule_items(schedule_id);

CREATE INDEX IF NOT EXISTS idx_payment_schedule_items_deal_id
    ON finance.payment_schedule_items(deal_id);

CREATE INDEX IF NOT EXISTS idx_payment_schedule_items_status
    ON finance.payment_schedule_items(status)
    WHERE status IN ('pending', 'payment_submitted', 'overdue');

CREATE INDEX IF NOT EXISTS idx_sched_payment_records_item_id
    ON finance.schedule_payment_records(schedule_item_id);

CREATE INDEX IF NOT EXISTS idx_sched_payment_records_deal_id
    ON finance.schedule_payment_records(deal_id);

CREATE INDEX IF NOT EXISTS idx_sched_payment_records_submitted_by
    ON finance.schedule_payment_records(submitted_by);

CREATE INDEX IF NOT EXISTS idx_sched_payment_files_record_id
    ON finance.schedule_payment_files(payment_record_id);

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE finance.payment_schedules           ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.payment_schedule_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.schedule_payment_records    ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.schedule_payment_files      ENABLE ROW LEVEL SECURITY;
