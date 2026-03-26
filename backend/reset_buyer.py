import asyncpg, asyncio, os
from dotenv import load_dotenv
load_dotenv()

BUYER_ID = '2d3a6dd8-fb81-466f-98ec-841771e8de12'

async def full_reset():
    dsn = os.getenv('DATABASE_URL').replace('postgresql+asyncpg://', 'postgresql://')
    conn = await asyncpg.connect(dsn)
    try:
        # Count existing submissions to avoid cycle_number unique constraint collision
        existing = await conn.fetchval(
            'SELECT COUNT(*) FROM kyc.submissions WHERE buyer_id = $1', BUYER_ID
        )
        await conn.execute(
            "UPDATE public.profiles SET kyc_status = 'pending', kyc_attempt_count = $2, "
            "current_kyc_submission_id = NULL, kyc_expires_at = NULL WHERE id = $1",
            BUYER_ID, existing
        )
        row = await conn.fetchrow(
            'SELECT kyc_status, kyc_attempt_count FROM public.profiles WHERE id = $1', BUYER_ID
        )
        print(f'Reset OK (existing submissions={existing}):', dict(row))
    finally:
        await conn.close()

asyncio.run(full_reset())
