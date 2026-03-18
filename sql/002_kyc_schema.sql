-- ═══════════════════════════════════════════════════════════════════════════
-- MarineXchange Africa — Phase 4: KYC Schema Migration
-- Run AFTER 001_initial_schema.sql in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════


-- ── New schema ────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS kyc;


-- ── Drop old placeholder KYC tables (Phase 1 scaffold — never used) ──────────

DROP TABLE IF EXISTS marketplace.kyc_reports     CASCADE;
DROP TABLE IF EXISTS marketplace.kyc_assignments  CASCADE;
DROP TABLE IF EXISTS marketplace.kyc_documents    CASCADE;
DROP TABLE IF EXISTS marketplace.kyc_submissions  CASCADE;


-- ═══════════════════════════════════════════════════════════════════════════
-- EXTEND public.profiles
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS kyc_expires_at             TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS kyc_attempt_count          INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS current_kyc_submission_id  UUID;   -- FK added below after table exists

-- Expand kyc_status to include new lifecycle states
ALTER TABLE public.profiles
    DROP CONSTRAINT IF EXISTS profiles_kyc_status_check;

ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_kyc_status_check CHECK (kyc_status IN (
        'pending',                  -- buyer registered, no submission yet
        'under_review',             -- submission in agent/admin review
        'approved',                 -- KYC approved by admin
        'rejected',                 -- permanently rejected
        'requires_resubmission',    -- admin asked buyer to redo
        'expired',                  -- approved but 12-month window lapsed
        'not_applicable'            -- seller / agent / admin — no KYC needed
    ));

COMMENT ON COLUMN public.profiles.kyc_expires_at IS
    'Set to submitted_at + 12 months when admin approves KYC. Null until approved.';
COMMENT ON COLUMN public.profiles.kyc_attempt_count IS
    'Incremented on each new submission cycle. Capped enforcement at service layer.';
COMMENT ON COLUMN public.profiles.current_kyc_submission_id IS
    'Points to the active (or most recent) kyc.submissions record for this buyer.';


-- ═══════════════════════════════════════════════════════════════════════════
-- KYC SCHEMA TABLES
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. Document Types — admin-configurable ────────────────────────────────────

CREATE TABLE kyc.document_types (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT        NOT NULL,
    slug            TEXT        NOT NULL UNIQUE,
    description     TEXT,
    is_required     BOOLEAN     NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    display_order   INT         NOT NULL DEFAULT 0,
    created_by      UUID        REFERENCES public.profiles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE kyc.document_types IS
    'Admin-managed registry of KYC document types. is_required = TRUE means all buyers must upload one.';


-- ── 2. Submissions — one row per review cycle per buyer ───────────────────────

CREATE TABLE kyc.submissions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_id        UUID        NOT NULL REFERENCES public.profiles(id),
    cycle_number    INT         NOT NULL DEFAULT 1,

    status          TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN (
                        'draft',                  -- buyer uploading docs, not yet submitted
                        'submitted',              -- buyer submitted, awaiting agent assignment
                        'under_review',           -- agent assigned and reviewing
                        'approved',               -- admin granted approval
                        'rejected',               -- admin rejected (permanent unless admin overrides)
                        'requires_resubmission'   -- admin requested a new cycle
                    )),

    -- Timestamps for lifecycle tracking
    locked_at       TIMESTAMPTZ,    -- set when buyer submits (docs locked after this)
    submitted_at    TIMESTAMPTZ,
    decided_at      TIMESTAMPTZ,    -- set when admin makes final decision
    expires_at      TIMESTAMPTZ,    -- submitted_at + 12 months (set on approval)

    rejection_reason TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (buyer_id, cycle_number)
);

COMMENT ON TABLE kyc.submissions IS
    'Each KYC review cycle. A buyer may have multiple cycles (resubmissions). History preserved.';


-- ── 3. Documents — files attached to a submission ────────────────────────────

CREATE TABLE kyc.documents (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id       UUID        NOT NULL REFERENCES kyc.submissions(id) ON DELETE CASCADE,
    buyer_id            UUID        NOT NULL REFERENCES public.profiles(id),
    document_type_id    UUID        NOT NULL REFERENCES kyc.document_types(id),

    storage_path        TEXT        NOT NULL,
    original_name       TEXT,
    file_size_bytes     INT,
    mime_type           TEXT,
    file_hash           TEXT        NOT NULL,   -- SHA-256 — tamper-evident audit trail

    uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- 5-year regulatory retention metadata
    scheduled_deletion  TIMESTAMPTZ,
    deleted_at          TIMESTAMPTZ
);

COMMENT ON COLUMN kyc.documents.file_hash IS
    'SHA-256 of raw file bytes at upload time. Proves the reviewed doc matches the uploaded doc.';


-- ── 4. Assignments — buyer_agent assigned to a submission ─────────────────────

CREATE TABLE kyc.assignments (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id   UUID        NOT NULL UNIQUE REFERENCES kyc.submissions(id),
    agent_id        UUID        NOT NULL REFERENCES public.profiles(id),
    assigned_by     UUID        NOT NULL REFERENCES public.profiles(id),

    status          TEXT        NOT NULL DEFAULT 'assigned' CHECK (status IN (
                        'assigned',             -- agent notified, not yet started
                        'in_review',            -- agent actively reviewing
                        'assessment_submitted'  -- agent submitted their review
                    )),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE kyc.assignments IS
    'Admin explicitly assigns a buyer_agent to each KYC submission. One agent per submission.';


-- ── 5. Reviews — agent assessment + admin decisions (immutable) ───────────────

CREATE TABLE kyc.reviews (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id   UUID        NOT NULL REFERENCES kyc.submissions(id),
    assignment_id   UUID        REFERENCES kyc.assignments(id),    -- NULL for direct admin decisions
    reviewer_id     UUID        NOT NULL REFERENCES public.profiles(id),
    reviewer_role   TEXT        NOT NULL CHECK (reviewer_role IN ('buyer_agent', 'admin')),

    -- Assessment fields
    assessment      TEXT        NOT NULL,
    risk_score      TEXT        NOT NULL CHECK (risk_score IN ('low', 'medium', 'high')),
    is_pep          BOOLEAN     NOT NULL DEFAULT FALSE,
    sanctions_match BOOLEAN     NOT NULL DEFAULT FALSE,

    -- Decision
    recommendation  TEXT        NOT NULL CHECK (recommendation IN (
                        'approve', 'reject', 'requires_resubmission'
                    )),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE kyc.reviews IS
    'Immutable review records. Agents submit assessments; admins make final decisions. Full history kept.';
COMMENT ON COLUMN kyc.reviews.is_pep IS
    'Politically Exposed Person flag. If TRUE, forces risk_score = high and blocks agent-level approval.';
COMMENT ON COLUMN kyc.reviews.sanctions_match IS
    'Potential sanctions list match. If TRUE, forces risk_score = high and escalates to admin.';


-- ── Immutable reviews trigger ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION kyc.prevent_review_modification()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'kyc.reviews records are immutable — no UPDATE or DELETE allowed';
END;
$$;

CREATE TRIGGER trg_immutable_kyc_reviews
    BEFORE UPDATE OR DELETE ON kyc.reviews
    FOR EACH ROW EXECUTE FUNCTION kyc.prevent_review_modification();


-- ── updated_at auto-maintenance triggers ─────────────────────────────────────

CREATE OR REPLACE FUNCTION kyc.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_kyc_submissions_updated_at
    BEFORE UPDATE ON kyc.submissions
    FOR EACH ROW EXECUTE FUNCTION kyc.set_updated_at();

CREATE TRIGGER trg_kyc_assignments_updated_at
    BEFORE UPDATE ON kyc.assignments
    FOR EACH ROW EXECUTE FUNCTION kyc.set_updated_at();

CREATE TRIGGER trg_kyc_document_types_updated_at
    BEFORE UPDATE ON kyc.document_types
    FOR EACH ROW EXECUTE FUNCTION kyc.set_updated_at();


-- ── Back-fill FK on profiles now that kyc.submissions exists ─────────────────

ALTER TABLE public.profiles
    ADD CONSTRAINT fk_profiles_current_kyc_submission
    FOREIGN KEY (current_kyc_submission_id) REFERENCES kyc.submissions(id);


-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX idx_kyc_submissions_buyer_id     ON kyc.submissions(buyer_id);
CREATE INDEX idx_kyc_submissions_status       ON kyc.submissions(status);
CREATE INDEX idx_kyc_documents_submission_id  ON kyc.documents(submission_id);
CREATE INDEX idx_kyc_documents_buyer_id       ON kyc.documents(buyer_id);
CREATE INDEX idx_kyc_assignments_agent_id     ON kyc.assignments(agent_id);
CREATE INDEX idx_kyc_reviews_submission_id    ON kyc.reviews(submission_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE kyc.submissions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc.documents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc.assignments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc.reviews        ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc.document_types ENABLE ROW LEVEL SECURITY;

-- Buyers see only their own submissions
CREATE POLICY "buyer_own_kyc_submissions" ON kyc.submissions
    FOR ALL USING (buyer_id = auth.uid());

-- Admins and agents see all (service role bypasses RLS anyway)
CREATE POLICY "admin_all_kyc_submissions" ON kyc.submissions
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
              AND roles && ARRAY['admin','buyer_agent']::TEXT[]
        )
    );

-- Document types are readable by all authenticated users
CREATE POLICY "all_read_document_types" ON kyc.document_types
    FOR SELECT USING (auth.uid() IS NOT NULL);

-- Only admins can modify document types
CREATE POLICY "admin_modify_document_types" ON kyc.document_types
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND 'admin' = ANY(roles)
        )
    );


-- ═══════════════════════════════════════════════════════════════════════════
-- SEED DEFAULT DOCUMENT TYPES
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO kyc.document_types
    (name, slug, description, is_required, display_order)
VALUES
    ('National ID / Passport',
     'national_id',
     'Government-issued national identity card or international passport. Must be valid and not expired.',
     TRUE, 1),

    ('Proof of Address',
     'proof_of_address',
     'Utility bill, bank statement, or official letter dated within the last 3 months showing full name and address.',
     TRUE, 2),

    ('Company Registration Certificate',
     'company_registration',
     'Certificate of incorporation or business registration document from the relevant authority.',
     FALSE, 3),

    ('Tax Identification Certificate',
     'tax_certificate',
     'TIN certificate or equivalent national tax identification document.',
     FALSE, 4),

    ('Bank Reference Letter',
     'bank_reference',
     'Signed letter from bank confirming account in good standing, on official letterhead.',
     FALSE, 5),

    ('Board Resolution',
     'board_resolution',
     'Corporate board resolution authorising the representative to transact on behalf of the entity. Required for corporate buyers.',
     FALSE, 6),

    ('Other Supporting Document',
     'other',
     'Any additional document requested by the review team.',
     FALSE, 7)

ON CONFLICT (slug) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- UPDATE SUPABASE JWT CLAIMS FUNCTION
-- Extend the existing custom_access_token_hook (if present) to include
-- kyc_expires_at so the frontend can show expiry warnings without an extra API call.
-- ═══════════════════════════════════════════════════════════════════════════

-- Note: if your project already has a custom_access_token_hook function that
-- reads kyc_status from profiles, add kyc_expires_at there too.
-- The backend re-validates expiry on every protected request via require_kyc().
