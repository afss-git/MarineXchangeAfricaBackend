-- ═══════════════════════════════════════════════════════════════════════════
-- MarineXchange Africa — Phase 10: Document Management
-- Run AFTER 006_payment_lifecycle.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- Invoice reference sequence: MXI-2026-00001
CREATE SEQUENCE IF NOT EXISTS finance.invoice_ref_seq START 1;

-- ── 1. finance.deal_documents ─────────────────────────────────────────────
--    Files uploaded and attached to a deal.
--    Admin controls visibility per party.
CREATE TABLE IF NOT EXISTS finance.deal_documents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id             UUID NOT NULL REFERENCES finance.deals(id) ON DELETE CASCADE,

    document_type       TEXT NOT NULL CHECK (document_type IN (
                            'contract',
                            'inspection_report',
                            'receipt',
                            'invoice',
                            'identification',
                            'bank_statement',
                            'title_deed',
                            'survey_report',
                            'correspondence',
                            'other'
                        )),
    description         TEXT,
    file_name           TEXT NOT NULL,
    file_path           TEXT NOT NULL,       -- Supabase Storage: deal-documents/{deal_id}/{uuid}.ext
    file_size_bytes     BIGINT CHECK (file_size_bytes > 0),
    mime_type           TEXT NOT NULL,
    checksum_sha256     TEXT,                -- SHA-256 hex of file content for integrity verification

    -- Visibility controls — admin sets who can see each document
    is_visible_to_buyer  BOOLEAN NOT NULL DEFAULT FALSE,
    is_visible_to_seller BOOLEAN NOT NULL DEFAULT FALSE,

    -- Soft delete — documents are never hard-deleted once acknowledged
    is_deleted          BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_by          UUID REFERENCES public.profiles(id),
    deleted_at          TIMESTAMPTZ,
    deletion_reason     TEXT,

    uploaded_by         UUID NOT NULL REFERENCES public.profiles(id),
    uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. finance.deal_invoices ──────────────────────────────────────────────
--    Auto-generated or manually created invoices attached to deals.
CREATE TABLE IF NOT EXISTS finance.deal_invoices (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id             UUID NOT NULL REFERENCES finance.deals(id) ON DELETE CASCADE,

    invoice_ref         TEXT NOT NULL UNIQUE,    -- MXI-2026-00001
    invoice_type        TEXT NOT NULL CHECK (invoice_type IN (
                            'proforma',      -- upfront estimate before deal is active
                            'installment',   -- per payment schedule item
                            'final'          -- full summary on deal completion
                        )),

    -- Optional link to a specific schedule item (for installment invoices)
    schedule_item_id    UUID REFERENCES finance.payment_schedule_items(id),

    -- Financial details
    amount              NUMERIC(18,2) NOT NULL CHECK (amount > 0),
    currency            TEXT NOT NULL DEFAULT 'USD',
    due_date            DATE,
    issued_at           TIMESTAMPTZ,

    -- Status machine
    status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                            'draft',    -- generated but not sent
                            'issued',   -- sent to buyer
                            'paid',     -- marked paid (linked to verified payment)
                            'void'      -- cancelled
                        )),
    void_reason         TEXT,
    voided_by           UUID REFERENCES public.profiles(id),
    voided_at           TIMESTAMPTZ,

    -- PDF storage
    pdf_path            TEXT,       -- Supabase Storage: deal-invoices/{deal_id}/{invoice_ref}.pdf
    pdf_generated_at    TIMESTAMPTZ,

    -- Notes
    notes               TEXT,

    generated_by        UUID NOT NULL REFERENCES public.profiles(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3. finance.document_acknowledgements ─────────────────────────────────
--    Tracks when a buyer or seller has read/acknowledged a document.
--    Immutable once created — provides legal audit trail.
CREATE TABLE IF NOT EXISTS finance.document_acknowledgements (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id         UUID NOT NULL REFERENCES finance.deal_documents(id) ON DELETE CASCADE,
    deal_id             UUID NOT NULL REFERENCES finance.deals(id) ON DELETE CASCADE,
    acknowledged_by     UUID NOT NULL REFERENCES public.profiles(id),
    acknowledged_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address          TEXT,
    user_agent          TEXT,

    CONSTRAINT uq_document_acknowledgement UNIQUE (document_id, acknowledged_by)
);

-- ── Immutable trigger on acknowledgements ────────────────────────────────
CREATE OR REPLACE FUNCTION finance.prevent_acknowledgement_changes()
RETURNS TRIGGER LANGUAGE plpgsql AS
$$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Document acknowledgements are immutable and cannot be deleted.';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'Document acknowledgements are immutable and cannot be updated.';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_acknowledgements_immutable
    BEFORE UPDATE OR DELETE ON finance.document_acknowledgements
    FOR EACH ROW EXECUTE FUNCTION finance.prevent_acknowledgement_changes();

-- ── Triggers ─────────────────────────────────────────────────────────────
CREATE TRIGGER trg_deal_documents_updated_at
    BEFORE UPDATE ON finance.deal_documents
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_deal_invoices_updated_at
    BEFORE UPDATE ON finance.deal_invoices
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_deal_documents_deal_id
    ON finance.deal_documents(deal_id)
    WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_deal_documents_type
    ON finance.deal_documents(deal_id, document_type)
    WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_deal_invoices_deal_id
    ON finance.deal_invoices(deal_id);

CREATE INDEX IF NOT EXISTS idx_deal_invoices_status
    ON finance.deal_invoices(status)
    WHERE status IN ('draft', 'issued');

CREATE INDEX IF NOT EXISTS idx_deal_invoices_schedule_item
    ON finance.deal_invoices(schedule_item_id)
    WHERE schedule_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_doc_acknowledgements_document
    ON finance.document_acknowledgements(document_id);

CREATE INDEX IF NOT EXISTS idx_doc_acknowledgements_user
    ON finance.document_acknowledgements(acknowledged_by);

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE finance.deal_documents              ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.deal_invoices               ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.document_acknowledgements   ENABLE ROW LEVEL SECURITY;
