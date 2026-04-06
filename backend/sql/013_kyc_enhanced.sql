-- ═══════════════════════════════════════════════════════════════════════════
-- MarineXchange Africa — Phase 13: Enhanced KYC + Twilio Integration
-- Run AFTER 012_product_snapshots.sql in Supabase SQL Editor
--
-- Adds:
--   1. Profile fields for progressive KYC (address, business type, phone verification)
--   2. Document access audit log (security)
--   3. Agent document requests (agent-driven verification)
--   4. Per-document structured verification (checklist-based)
--   5. Verification calls (Twilio voice call records)
--   6. Checklist templates on document types
--   7. Tier support on submissions
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. EXTEND public.profiles — Progressive KYC fields
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS address_line      TEXT,
    ADD COLUMN IF NOT EXISTS city              TEXT,
    ADD COLUMN IF NOT EXISTS state_province    TEXT,
    ADD COLUMN IF NOT EXISTS business_type     TEXT CHECK (business_type IS NULL OR business_type IN (
        'vessel_owner',
        'ship_operator',
        'marine_equipment',
        'shipyard',
        'port_services',
        'trading_company',
        'logistics',
        'individual_buyer',
        'other'
    )),
    ADD COLUMN IF NOT EXISTS business_description TEXT,
    ADD COLUMN IF NOT EXISTS phone_verified    BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.address_line IS
    'Self-declared street address. Collected at Tier 1 onboarding.';
COMMENT ON COLUMN public.profiles.business_type IS
    'What the buyer/seller trades. Dropdown at signup.';
COMMENT ON COLUMN public.profiles.phone_verified IS
    'TRUE once buyer completes Twilio SMS OTP verification.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. DOCUMENT ACCESS AUDIT LOG
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE kyc.document_access_log (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     UUID        NOT NULL REFERENCES kyc.documents(id),
    submission_id   UUID        NOT NULL REFERENCES kyc.submissions(id),
    accessed_by     UUID        NOT NULL REFERENCES public.profiles(id),
    accessor_role   TEXT        NOT NULL,   -- 'buyer_agent', 'admin', 'buyer'
    access_type     TEXT        NOT NULL CHECK (access_type IN (
                        'view',             -- signed URL generated for viewing
                        'download'          -- explicit download requested
                    )),
    ip_address      TEXT,
    user_agent      TEXT,
    integrity_ok    BOOLEAN,    -- SHA-256 re-check passed?
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE kyc.document_access_log IS
    'Immutable audit trail. Every document view/download is recorded.';

-- Make it immutable — no updates or deletes
CREATE OR REPLACE FUNCTION kyc.prevent_access_log_modification()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'kyc.document_access_log records are immutable';
END;
$$;

CREATE TRIGGER trg_immutable_access_log
    BEFORE UPDATE OR DELETE ON kyc.document_access_log
    FOR EACH ROW EXECUTE FUNCTION kyc.prevent_access_log_modification();

CREATE INDEX idx_kyc_access_log_document   ON kyc.document_access_log(document_id);
CREATE INDEX idx_kyc_access_log_accessed_by ON kyc.document_access_log(accessed_by);
CREATE INDEX idx_kyc_access_log_created_at ON kyc.document_access_log(created_at);


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. AGENT DOCUMENT REQUESTS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE kyc.document_requests (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id       UUID        NOT NULL REFERENCES kyc.submissions(id),
    document_type_id    UUID        NOT NULL REFERENCES kyc.document_types(id),
    requested_by        UUID        NOT NULL REFERENCES public.profiles(id),  -- agent or admin
    reason              TEXT,       -- why this document is needed
    priority            TEXT        NOT NULL DEFAULT 'required' CHECK (priority IN (
                            'required',     -- must upload before verification can proceed
                            'recommended'   -- helpful but not blocking
                        )),
    status              TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN (
                            'pending',      -- requested, buyer not yet uploaded
                            'uploaded',     -- buyer has uploaded the document
                            'waived'        -- agent decided it's not needed after all
                        )),
    fulfilled_doc_id    UUID        REFERENCES kyc.documents(id),   -- the doc that fulfilled this request
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (submission_id, document_type_id)
);

COMMENT ON TABLE kyc.document_requests IS
    'Agent-driven document collection. Agent requests specific docs from buyer during Tier 2 review.';

CREATE TRIGGER trg_kyc_document_requests_updated_at
    BEFORE UPDATE ON kyc.document_requests
    FOR EACH ROW EXECUTE FUNCTION kyc.set_updated_at();

CREATE INDEX idx_kyc_doc_requests_submission ON kyc.document_requests(submission_id);
CREATE INDEX idx_kyc_doc_requests_status     ON kyc.document_requests(status);


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. PER-DOCUMENT STRUCTURED VERIFICATION
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE kyc.document_verifications (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id         UUID        NOT NULL REFERENCES kyc.documents(id),
    submission_id       UUID        NOT NULL REFERENCES kyc.submissions(id),
    verified_by         UUID        NOT NULL REFERENCES public.profiles(id),  -- agent
    verifier_role       TEXT        NOT NULL,

    -- Per-document verdict
    status              TEXT        NOT NULL CHECK (status IN (
                            'verified',             -- document passed all checks
                            'rejected',             -- document failed verification
                            'needs_clarification'   -- buyer needs to explain something
                        )),
    rejection_reason    TEXT        CHECK (status != 'rejected' OR rejection_reason IS NOT NULL),

    -- Structured checklist results — JSON array of completed checks
    -- e.g. [{"key":"legible","label":"Document is legible","passed":true},
    --       {"key":"not_expired","label":"Not expired","passed":true,"value":"2028-03-15"},
    --       {"key":"name_match","label":"Name matches application","passed":false,"notes":"Surname differs"}]
    checklist_results   JSONB       NOT NULL DEFAULT '[]'::jsonb,

    -- Extracted data from the document (proves agent actually read it)
    extracted_data      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    -- e.g. {"id_number":"A12345678","expiry_date":"2028-03-15","issuing_authority":"NIS","full_name_on_doc":"Amara Osei"}

    notes               TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (document_id, verified_by)  -- one verification per agent per document
);

COMMENT ON TABLE kyc.document_verifications IS
    'Immutable per-document verification record. Agent completes a checklist for each document.';

-- Make it immutable
CREATE TRIGGER trg_immutable_doc_verifications
    BEFORE UPDATE OR DELETE ON kyc.document_verifications
    FOR EACH ROW EXECUTE FUNCTION kyc.prevent_review_modification();

CREATE INDEX idx_kyc_doc_verifications_doc  ON kyc.document_verifications(document_id);
CREATE INDEX idx_kyc_doc_verifications_sub  ON kyc.document_verifications(submission_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. VERIFICATION CALLS (Twilio Voice Records)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE kyc.verification_calls (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id       UUID        NOT NULL REFERENCES kyc.submissions(id),
    agent_id            UUID        NOT NULL REFERENCES public.profiles(id),
    buyer_id            UUID        NOT NULL REFERENCES public.profiles(id),

    -- Twilio reference
    twilio_call_sid     TEXT        UNIQUE,
    from_number         TEXT        NOT NULL,   -- platform Twilio number
    to_number           TEXT        NOT NULL,   -- buyer's phone

    -- Call outcome
    status              TEXT        NOT NULL DEFAULT 'initiated' CHECK (status IN (
                            'initiated',        -- call request sent to Twilio
                            'ringing',          -- Twilio confirmed ringing
                            'in_progress',      -- call connected
                            'completed',        -- call ended normally
                            'no_answer',        -- buyer didn't pick up
                            'busy',             -- line busy
                            'failed',           -- technical failure
                            'cancelled'         -- agent cancelled before connect
                        )),
    duration_seconds    INT,
    recording_url       TEXT,           -- Twilio recording URL (consent-based)
    recording_duration  INT,

    -- Agent notes after the call
    call_outcome        TEXT CHECK (call_outcome IS NULL OR call_outcome IN (
                            'identity_confirmed',       -- buyer confirmed identity
                            'identity_not_confirmed',   -- could not confirm
                            'additional_info_gathered',  -- got useful info
                            'callback_requested',       -- buyer asked to call back
                            'suspicious'                -- something felt off
                        )),
    call_notes          TEXT,

    started_at          TIMESTAMPTZ,
    ended_at            TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE kyc.verification_calls IS
    'Every agent-to-buyer call via Twilio. Auto-populated by webhooks. Agent adds notes after.';

CREATE TRIGGER trg_kyc_verification_calls_updated_at
    BEFORE UPDATE ON kyc.verification_calls
    FOR EACH ROW EXECUTE FUNCTION kyc.set_updated_at();

CREATE INDEX idx_kyc_calls_submission ON kyc.verification_calls(submission_id);
CREATE INDEX idx_kyc_calls_agent      ON kyc.verification_calls(agent_id);
CREATE INDEX idx_kyc_calls_twilio_sid ON kyc.verification_calls(twilio_call_sid);


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. ADD CHECKLIST TEMPLATE TO DOCUMENT TYPES
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE kyc.document_types
    ADD COLUMN IF NOT EXISTS checklist_template JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN kyc.document_types.checklist_template IS
    'JSON array of checks agent must complete for this doc type. '
    'e.g. [{"key":"legible","label":"Document is legible and complete","type":"boolean"}, '
    '      {"key":"expiry_date","label":"Expiry date","type":"date"}, '
    '      {"key":"name_match","label":"Name matches application","type":"boolean"}]';

-- Seed checklist templates for existing document types
UPDATE kyc.document_types SET checklist_template = '[
    {"key":"legible","label":"Document is legible and complete","type":"boolean","required":true},
    {"key":"not_expired","label":"Document is not expired","type":"boolean","required":true},
    {"key":"expiry_date","label":"Expiry date on document","type":"date","required":true},
    {"key":"name_match","label":"Name matches buyer application","type":"boolean","required":true},
    {"key":"photo_match","label":"Photo matches (if applicable)","type":"boolean","required":false},
    {"key":"no_tampering","label":"No signs of tampering or alteration","type":"boolean","required":true},
    {"key":"issuing_authority","label":"Issuing authority visible","type":"boolean","required":true}
]'::jsonb WHERE slug = 'national_id';

UPDATE kyc.document_types SET checklist_template = '[
    {"key":"legible","label":"Document is legible and complete","type":"boolean","required":true},
    {"key":"recent","label":"Dated within last 3 months","type":"boolean","required":true},
    {"key":"issue_date","label":"Document issue date","type":"date","required":true},
    {"key":"name_match","label":"Name matches buyer application","type":"boolean","required":true},
    {"key":"address_readable","label":"Full address is readable","type":"boolean","required":true},
    {"key":"no_tampering","label":"No signs of tampering or alteration","type":"boolean","required":true}
]'::jsonb WHERE slug = 'proof_of_address';

UPDATE kyc.document_types SET checklist_template = '[
    {"key":"legible","label":"Document is legible and complete","type":"boolean","required":true},
    {"key":"company_name_match","label":"Company name matches buyer profile","type":"boolean","required":true},
    {"key":"reg_number_present","label":"Registration number is present","type":"boolean","required":true},
    {"key":"authority_visible","label":"Issuing authority name visible","type":"boolean","required":true},
    {"key":"no_tampering","label":"No signs of tampering or alteration","type":"boolean","required":true}
]'::jsonb WHERE slug = 'company_registration';

UPDATE kyc.document_types SET checklist_template = '[
    {"key":"legible","label":"Document is legible and complete","type":"boolean","required":true},
    {"key":"tin_present","label":"Tax ID number is present","type":"boolean","required":true},
    {"key":"name_match","label":"Name/company matches buyer profile","type":"boolean","required":true},
    {"key":"no_tampering","label":"No signs of tampering or alteration","type":"boolean","required":true}
]'::jsonb WHERE slug = 'tax_certificate';

UPDATE kyc.document_types SET checklist_template = '[
    {"key":"legible","label":"Document is legible and complete","type":"boolean","required":true},
    {"key":"bank_letterhead","label":"On official bank letterhead","type":"boolean","required":true},
    {"key":"recent","label":"Dated within last 6 months","type":"boolean","required":true},
    {"key":"issue_date","label":"Document issue date","type":"date","required":true},
    {"key":"account_holder_match","label":"Account holder name matches buyer","type":"boolean","required":true},
    {"key":"good_standing","label":"Confirms account in good standing","type":"boolean","required":true}
]'::jsonb WHERE slug = 'bank_reference';

UPDATE kyc.document_types SET checklist_template = '[
    {"key":"legible","label":"Document is legible and complete","type":"boolean","required":true},
    {"key":"company_name_match","label":"Company name matches registration","type":"boolean","required":true},
    {"key":"signatory_named","label":"Authorized signatory is named","type":"boolean","required":true},
    {"key":"scope_defined","label":"Scope of authorization is defined","type":"boolean","required":true},
    {"key":"dated_and_signed","label":"Document is dated and signed","type":"boolean","required":true}
]'::jsonb WHERE slug = 'board_resolution';

UPDATE kyc.document_types SET checklist_template = '[
    {"key":"legible","label":"Document is legible and complete","type":"boolean","required":true},
    {"key":"relevant","label":"Document is relevant to verification","type":"boolean","required":true},
    {"key":"no_tampering","label":"No signs of tampering or alteration","type":"boolean","required":true}
]'::jsonb WHERE slug = 'other';


-- ═══════════════════════════════════════════════════════════════════════════
-- 7. ADD TIER SUPPORT TO SUBMISSIONS
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE kyc.submissions
    ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'tier_1' CHECK (tier IN ('tier_1', 'tier_2'));

COMMENT ON COLUMN kyc.submissions.tier IS
    'tier_1 = basic onboarding (no documents). tier_2 = full verification (agent-driven).';


-- ═══════════════════════════════════════════════════════════════════════════
-- 8. ADD SCREENING EVIDENCE TO REVIEWS
-- ═══════════════════════════════════════════════════════════════════════════

-- Reviews are immutable, so we need to drop+recreate the trigger temporarily
DROP TRIGGER IF EXISTS trg_immutable_kyc_reviews ON kyc.reviews;

ALTER TABLE kyc.reviews
    ADD COLUMN IF NOT EXISTS screening_details JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN kyc.reviews.screening_details IS
    'Evidence of PEP/sanctions screening. '
    'e.g. {"lists_checked":["UN","OFAC","EU"],"date_checked":"2026-04-06","search_terms":["Amara Osei"],"results":"no match"}';

-- Restore immutability trigger
CREATE TRIGGER trg_immutable_kyc_reviews
    BEFORE UPDATE OR DELETE ON kyc.reviews
    FOR EACH ROW EXECUTE FUNCTION kyc.prevent_review_modification();


-- ═══════════════════════════════════════════════════════════════════════════
-- 9. ADD CROSS-DOCUMENT CONSISTENCY TO REVIEWS
-- ═══════════════════════════════════════════════════════════════════════════
-- Already covered by screening_details + assessment text.
-- The consistency checks are part of the structured review flow and stored
-- as part of the review's assessment field. No additional columns needed.


-- ═══════════════════════════════════════════════════════════════════════════
-- 10. RLS POLICIES FOR NEW TABLES
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE kyc.document_access_log   ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc.document_requests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc.document_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc.verification_calls    ENABLE ROW LEVEL SECURITY;

-- Access log: admins and the accessor can read
CREATE POLICY "admin_agent_read_access_log" ON kyc.document_access_log
    FOR SELECT USING (
        accessed_by = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND roles && ARRAY['admin','buyer_agent']::TEXT[]
        )
    );

-- Document requests: buyer sees their own, agents/admins see all
CREATE POLICY "buyer_own_doc_requests" ON kyc.document_requests
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM kyc.submissions s
            WHERE s.id = submission_id AND s.buyer_id = auth.uid()
        )
    );

CREATE POLICY "admin_agent_all_doc_requests" ON kyc.document_requests
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND roles && ARRAY['admin','buyer_agent']::TEXT[]
        )
    );

-- Document verifications: agents/admins read, agents insert
CREATE POLICY "admin_agent_doc_verifications" ON kyc.document_verifications
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND roles && ARRAY['admin','buyer_agent']::TEXT[]
        )
    );

-- Verification calls: agents/admins only
CREATE POLICY "admin_agent_verification_calls" ON kyc.verification_calls
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND roles && ARRAY['admin','buyer_agent']::TEXT[]
        )
    );


-- ═══════════════════════════════════════════════════════════════════════════
-- DONE
-- ═══════════════════════════════════════════════════════════════════════════
