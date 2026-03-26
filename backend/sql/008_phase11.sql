-- ═══════════════════════════════════════════════════════════════════════════
-- MarineXchange Africa — Phase 11: Profile + Notifications + Admin Users
-- Run AFTER 007_documents.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Add avatar_url to public.profiles ─────────────────────────────────────
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- ── 2. notifications.messages ─────────────────────────────────────────────────
--    Persists every significant platform event for in-app display.
--    Written alongside every email notification.
--    Immutable once created — only is_read / read_at can change.
CREATE TABLE IF NOT EXISTS notifications.messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

    -- Display fields
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,

    -- Categorisation (used by frontend to show correct icon / colour)
    category        TEXT NOT NULL DEFAULT 'system' CHECK (category IN (
                        'deal', 'payment', 'kyc', 'document', 'invoice',
                        'auction', 'purchase', 'account', 'system'
                    )),

    -- Optional deep-link back to the resource
    resource_type   TEXT,   -- 'deal', 'invoice', 'kyc_submission', 'auction', etc.
    resource_id     TEXT,   -- UUID as text

    -- Read state
    is_read         BOOLEAN NOT NULL DEFAULT FALSE,
    read_at         TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON notifications.messages(user_id, created_at DESC)
    WHERE is_read = FALSE;

CREATE INDEX IF NOT EXISTS idx_notifications_user_all
    ON notifications.messages(user_id, created_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE notifications.messages ENABLE ROW LEVEL SECURITY;
