-- Phone OTP storage for verification
-- Works with any SMS provider (Twilio, etc.) and allows testing without paid SMS.

CREATE TABLE IF NOT EXISTS public.phone_otps (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone       TEXT NOT NULL,
    code        TEXT NOT NULL,
    used        BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup by phone + code
CREATE INDEX IF NOT EXISTS idx_phone_otps_lookup
    ON public.phone_otps (phone, code, used, expires_at);

-- Auto-cleanup: delete expired OTPs older than 1 hour
CREATE INDEX IF NOT EXISTS idx_phone_otps_expires
    ON public.phone_otps (expires_at);
