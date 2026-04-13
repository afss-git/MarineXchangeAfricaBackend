-- Migration 013: OTP brute-force protection for deal acceptance
-- Adds an attempt counter and lockout mechanism to finance.deals.
-- After MAX_OTP_ATTEMPTS wrong guesses the OTP is invalidated and
-- must be explicitly re-requested via /portal/{token}/request-otp.

ALTER TABLE finance.deals
    ADD COLUMN IF NOT EXISTS otp_attempt_count   INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS otp_locked_at       TIMESTAMPTZ;

COMMENT ON COLUMN finance.deals.otp_attempt_count IS
    'Number of failed OTP attempts for the current OTP. Reset to 0 when a new OTP is issued.';

COMMENT ON COLUMN finance.deals.otp_locked_at IS
    'Set when otp_attempt_count reaches the limit. OTP is invalidated until a new one is requested.';
