-- Migration 009: Seller product documents
-- Run against Supabase database

CREATE TABLE IF NOT EXISTS marketplace.product_documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID NOT NULL REFERENCES marketplace.products(id) ON DELETE CASCADE,
    storage_path    TEXT NOT NULL UNIQUE,
    original_name   TEXT,
    file_size_bytes INTEGER,
    mime_type       TEXT,
    description     TEXT,
    uploaded_by     UUID NOT NULL REFERENCES public.profiles(id),
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_documents_product_id ON marketplace.product_documents(product_id);
