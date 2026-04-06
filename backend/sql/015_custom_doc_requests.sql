-- ─────────────────────────────────────────────────────────────────────────────
-- 015 — Custom document requests
--
-- Allows agents to request documents by custom name (not just pre-defined types)
-- and request the same type more than once (e.g. multiple custom docs).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add custom_document_name column
ALTER TABLE kyc.document_requests
    ADD COLUMN IF NOT EXISTS custom_document_name TEXT;

-- 2. Make document_type_id nullable (custom requests don't need a type ID)
ALTER TABLE kyc.document_requests
    ALTER COLUMN document_type_id DROP NOT NULL;

-- 3. Drop the old UNIQUE constraint that blocked multiple custom entries
ALTER TABLE kyc.document_requests
    DROP CONSTRAINT IF EXISTS document_requests_submission_id_document_type_id_key;

-- 4. Partial unique index — still prevent duplicate pre-defined types per submission
CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_requests_unique_type
    ON kyc.document_requests(submission_id, document_type_id)
    WHERE document_type_id IS NOT NULL;

-- 5. Ensure every row has either a type_id or a custom name
ALTER TABLE kyc.document_requests
    DROP CONSTRAINT IF EXISTS doc_request_type_or_custom;

ALTER TABLE kyc.document_requests
    ADD CONSTRAINT doc_request_type_or_custom CHECK (
        document_type_id IS NOT NULL
        OR (custom_document_name IS NOT NULL AND custom_document_name <> '')
    );
