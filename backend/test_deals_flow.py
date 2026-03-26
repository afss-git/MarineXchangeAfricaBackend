"""
Phase 5 — Deal Flow End-to-End Test
=====================================
Tests both Full Payment and Financing deal scenarios.

Scenario A: Full Payment
  1. Admin creates payment account
  2. Admin creates deal (full_payment)
  3. Admin sends offer → email + SMS to buyer
  4. Buyer views portal via secure token
  5. Buyer requests OTP
  6. Buyer accepts deal with OTP
  7. Admin records payment
  8. Finance admin verifies payment → deal COMPLETED

Scenario B: Financing
  1. Finance admin sets buyer credit profile
  2. Admin creates deal (financing)
  3. Admin sends offer → email + SMS to buyer
  4. Buyer accepts deal via OTP
  5. Admin records initial payment
  6. Finance admin verifies → financing ACTIVATED
  7. View installment schedule

Users:
  buyer2@gmail.com       (pass: env TEST_USER_PASS)
  admin@marinexchange.africa  (pass: env TEST_ADMIN_PASS)
"""
import asyncio
import sys
import os
import httpx

BASE = os.environ.get("API_BASE_URL", "http://localhost:8005/api/v1")

BUYER_EMAIL = "buyer2@gmail.com"
BUYER_PASS  = os.environ.get("TEST_USER_PASS", "")
ADMIN_EMAIL = "admin@marinexchange.africa"
ADMIN_PASS  = os.environ.get("TEST_ADMIN_PASS", "")


def ok(label, resp=None):
    code = f" [{resp.status_code}]" if resp else ""
    print(f"  [OK] {label}{code}")


def fail(label, detail=""):
    print(f"  [FAIL] {label} — {detail}")
    sys.exit(1)


def check(resp, label, expected=(200, 201)):
    if resp.status_code not in (expected if isinstance(expected, tuple) else (expected,)):
        fail(label, f"HTTP {resp.status_code}: {resp.text[:400]}")
    ok(label, resp)
    return resp.json()


async def login(client, email, password, role="buyer"):
    resp = await client.post(f"{BASE}/auth/{role}/login", json={"email": email, "password": password})
    data = check(resp, f"Login {email}")
    return data["access_token"]


async def get_product(client, admin_token):
    """Get first active product for testing."""
    resp = await client.get(
        f"{BASE}/marketplace/catalog",
        params={"page": 1, "page_size": 1},
    )
    data = check(resp, "GET /marketplace/catalog")
    items = data.get("items", data) if isinstance(data, dict) else data
    if not items:
        fail("No active products found", "Create and verify a product first")
    product = items[0]
    print(f"    Using product: {product['title'][:50]} (id={str(product['id'])[:8]}...)")
    return product


async def run_full_payment_test(client, admin_token, buyer_token, product):
    print(f"\n{'='*60}")
    print("SCENARIO A: FULL PAYMENT")
    print(f"{'='*60}\n")

    # ── Step 1: Create payment account ───────────────────────────
    print("STEP 1: Create MarineXchange payment account")
    resp = await client.post(
        f"{BASE}/deals/payment-accounts",
        json={
            "bank_name": "First Bank Nigeria",
            "account_name": "MarineXchange Africa Ltd",
            "account_number": "3012345678",
            "swift_code": "FBNINIFL",
            "currency": "USD",
            "country": "NG",
            "additional_info": "Please include deal reference in payment description.",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    account = check(resp, "POST /deals/payment-accounts")
    account_id = account["id"]
    print(f"    account_id={account_id[:8]}... bank={account['bank_name']}")

    # ── Step 2: Create deal ───────────────────────────────────────
    print("\nSTEP 2: Admin creates full payment deal")
    resp = await client.get(
        f"{BASE}/auth/me",
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    buyer_data = check(resp, "GET buyer /auth/me")
    buyer_id = buyer_data["id"]

    resp = await client.post(
        f"{BASE}/deals",
        json={
            "product_id": str(product["id"]),
            "buyer_id": str(buyer_id),
            "deal_type": "full_payment",
            "total_price": 75000.00,
            "currency": "USD",
            "payment_account_id": account_id,
            "payment_deadline": "2026-04-15T23:59:59Z",
            "payment_instructions": "Wire transfer only. Include deal reference code.",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    deal = check(resp, "POST /deals (full_payment)")
    deal_id = deal["id"]
    deal_ref = deal["deal_ref"]
    print(f"    deal_id={deal_id[:8]}... ref={deal_ref} status={deal['status']}")
    assert deal["status"] == "draft", f"Expected draft, got {deal['status']}"

    # ── Step 3: Send offer ────────────────────────────────────────
    print(f"\nSTEP 3: Admin sends deal offer  [email + SMS to buyer]")
    resp = await client.post(
        f"{BASE}/deals/{deal_id}/send-offer",
        json={},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    deal = check(resp, "POST /deals/{id}/send-offer")
    portal_token = deal["portal_token"]
    print(f"    status={deal['status']} portal_token={portal_token[:16]}...")
    assert deal["status"] == "offer_sent"

    # ── Step 4: Buyer views portal ────────────────────────────────
    print("\nSTEP 4: Buyer views deal portal (no auth — token only)")
    resp = await client.get(f"{BASE}/deals/portal/{portal_token}")
    portal = check(resp, "GET /deals/portal/{token}")
    print(f"    deal_ref={portal['deal_ref']} total_price={portal['total_price']} status={portal['status']}")

    # ── Step 5: Buyer requests OTP ────────────────────────────────
    print("\nSTEP 5: Buyer requests OTP  [email + SMS]")
    resp = await client.post(f"{BASE}/deals/portal/{portal_token}/request-otp")
    otp_resp = check(resp, "POST /deals/portal/{token}/request-otp")
    print(f"    {otp_resp['message']}")

    # ── Step 6: Buyer accepts with OTP ───────────────────────────
    # In a real test we'd intercept the OTP — here we fetch it from DB directly
    print("\nSTEP 6: Buyer accepts deal with OTP  [payment instructions sent]")
    import asyncpg, os, hashlib
    from dotenv import load_dotenv
    load_dotenv()
    dsn = os.getenv("DATABASE_URL").replace("postgresql+asyncpg://", "postgresql://")
    db = await asyncpg.connect(dsn)
    row = await db.fetchrow(
        "SELECT acceptance_otp_hash, acceptance_otp_expires FROM finance.deals WHERE id = $1",
        deal_id,
    )
    await db.close()
    if not row["acceptance_otp_hash"]:
        fail("OTP not generated", "acceptance_otp_hash is NULL")

    # Brute-force the 6-digit OTP (test only)
    otp_hash = row["acceptance_otp_hash"]
    found_otp = None
    for i in range(1000000):
        candidate = f"{i:06d}"
        if hashlib.sha256(candidate.encode()).hexdigest() == otp_hash:
            found_otp = candidate
            break
    if not found_otp:
        fail("OTP brute-force failed", "Could not find matching OTP")
    print(f"    OTP found: {found_otp}")

    resp = await client.post(
        f"{BASE}/deals/portal/{portal_token}/accept",
        json={"otp": found_otp},
    )
    deal = check(resp, "POST /deals/portal/{token}/accept")
    print(f"    status={deal['status']} accepted_at={deal.get('accepted_at', 'N/A')}")
    assert deal["status"] == "payment_pending", f"Expected payment_pending, got {deal['status']}"

    # ── Step 7: Admin records payment ────────────────────────────
    print("\nSTEP 7: Admin records offline payment  [email + SMS to buyer]")
    import json as _json
    payload_json = _json.dumps({
        "payment_type": "full_payment",
        "amount": 75000.00,
        "currency": "USD",
        "payment_date": "2026-03-15",
        "bank_name": "GTBank Nigeria",
        "bank_reference": "GTB-TXN-20260315-001",
        "notes": "Wire transfer received. Confirmed by relationship manager.",
    })
    resp = await client.post(
        f"{BASE}/deals/{deal_id}/record-payment",
        data={"payload": payload_json},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    payment = check(resp, "POST /deals/{id}/record-payment")
    payment_id = payment["id"]
    print(f"    payment_id={payment_id[:8]}... amount={payment['amount']} status={payment['verification_status']}")

    # ── Step 8: Finance admin verifies payment ────────────────────
    print("\nSTEP 8: Finance admin verifies payment  [deal COMPLETED]")
    resp = await client.post(
        f"{BASE}/deals/{deal_id}/payments/{payment_id}/verify",
        json={"verification_status": "verified", "verification_notes": "Bank confirmation received. Amount matches."},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    check(resp, "POST /deals/{id}/payments/{pid}/verify")

    # Final check
    resp = await client.get(
        f"{BASE}/deals/{deal_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    final = check(resp, "GET /deals/{id} (final)")
    print(f"    FINAL status={final['status']}")
    assert final["status"] == "completed", f"Expected completed, got {final['status']}"

    print(f"\n{'='*60}")
    print(f"SCENARIO A PASSED — Full Payment deal {deal_ref} COMPLETED")
    print(f"{'='*60}")
    return deal_ref


async def run_financing_test(client, admin_token, buyer_token, product):
    print(f"\n{'='*60}")
    print("SCENARIO B: FINANCING DEAL")
    print(f"{'='*60}\n")

    buyer_data = (await (await client.get(
        f"{BASE}/auth/me", headers={"Authorization": f"Bearer {buyer_token}"}
    )).json() if False else None)

    resp = await client.get(f"{BASE}/auth/me", headers={"Authorization": f"Bearer {buyer_token}"})
    buyer_data = check(resp, "GET buyer /auth/me")
    buyer_id = buyer_data["id"]

    # ── Step 1: Finance admin sets credit profile ─────────────────
    print("STEP 1: Finance admin sets buyer credit profile")
    resp = await client.put(
        f"{BASE}/deals/buyers/{buyer_id}/credit-profile",
        json={
            "is_financing_eligible": True,
            "credit_limit_usd": 500000.00,
            "max_single_deal_usd": 300000.00,
            "risk_rating": "low",
            "notes": "Strong KYC, verified buyer.",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    profile = check(resp, "PUT /deals/buyers/{id}/credit-profile")
    print(f"    eligible={profile['is_financing_eligible']} credit_limit={profile['credit_limit_usd']}")

    # ── Step 2: Create financing deal ────────────────────────────
    print("\nSTEP 2: Admin creates financing deal")

    # Use an existing payment account or create one
    resp = await client.get(
        f"{BASE}/deals/payment-accounts",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    accounts = check(resp, "GET /deals/payment-accounts")
    account_id = accounts[0]["id"] if accounts else None

    resp = await client.post(
        f"{BASE}/deals",
        json={
            "product_id": str(product["id"]),
            "buyer_id": str(buyer_id),
            "deal_type": "financing",
            "total_price": 90000.00,
            "currency": "USD",
            "payment_account_id": account_id,
            "initial_payment_percent": 20.0,
            "duration_months": 12,
            "monthly_finance_rate": 0.0052,
            "arrangement_fee": 450.00,
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    deal = check(resp, "POST /deals (financing)")
    deal_id = deal["id"]
    deal_ref = deal["deal_ref"]
    print(f"    deal_ref={deal_ref} status={deal['status']}")
    print(f"    initial_payment={deal.get('initial_payment_amount')} financed={deal.get('financed_amount')}")
    print(f"    monthly_payment={deal.get('first_monthly_payment')} total_charge={deal.get('total_finance_charge')}")

    # ── Step 3: Send offer ────────────────────────────────────────
    print(f"\nSTEP 3: Send financing offer  [email + SMS]")
    resp = await client.post(
        f"{BASE}/deals/{deal_id}/send-offer",
        json={},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    deal = check(resp, "POST /deals/{id}/send-offer")
    portal_token = deal["portal_token"]
    print(f"    status={deal['status']}")

    # ── Step 4: Buyer views portal ────────────────────────────────
    print("\nSTEP 4: Buyer views deal portal")
    resp = await client.get(f"{BASE}/deals/portal/{portal_token}")
    portal = check(resp, "GET /deals/portal/{token}")
    print(f"    deal_type={portal['deal_type']} financed_amount={portal.get('financed_amount')}")

    # ── Step 5: OTP + Accept ──────────────────────────────────────
    print("\nSTEP 5: Buyer requests OTP and accepts financing deal")
    await client.post(f"{BASE}/deals/portal/{portal_token}/request-otp")
    ok("POST /deals/portal/{token}/request-otp (OTP sent)")

    import asyncpg, os, hashlib
    from dotenv import load_dotenv
    load_dotenv()
    dsn = os.getenv("DATABASE_URL").replace("postgresql+asyncpg://", "postgresql://")
    db = await asyncpg.connect(dsn)
    row = await db.fetchrow("SELECT acceptance_otp_hash FROM finance.deals WHERE id = $1", deal_id)
    await db.close()

    found_otp = None
    for i in range(1000000):
        candidate = f"{i:06d}"
        if hashlib.sha256(candidate.encode()).hexdigest() == row["acceptance_otp_hash"]:
            found_otp = candidate
            break
    print(f"    OTP: {found_otp}")

    resp = await client.post(
        f"{BASE}/deals/portal/{portal_token}/accept",
        json={"otp": found_otp},
    )
    deal = check(resp, "POST /deals/portal/{token}/accept")
    print(f"    status={deal['status']}")
    assert deal["status"] == "payment_pending"

    # ── Step 6: Record initial payment ───────────────────────────
    print("\nSTEP 6: Admin records initial payment  [email + SMS]")
    initial_amount = float(deal.get("initial_payment_amount", 36000)) + float(deal.get("arrangement_fee", 450))
    import json as _json
    payload_json = _json.dumps({
        "payment_type": "initial_payment",
        "amount": initial_amount,
        "currency": "USD",
        "payment_date": "2026-03-15",
        "bank_name": "GTBank Nigeria",
        "bank_reference": "GTB-INIT-20260315-002",
        "notes": "Initial payment + arrangement fee received.",
    })
    resp = await client.post(
        f"{BASE}/deals/{deal_id}/record-payment",
        data={"payload": payload_json},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    payment = check(resp, "POST /deals/{id}/record-payment (initial)")
    payment_id = payment["id"]
    print(f"    payment_id={payment_id[:8]}... amount={payment['amount']}")

    # ── Step 7: Verify initial payment → ACTIVE ───────────────────
    print("\nSTEP 7: Finance admin verifies initial payment  [financing ACTIVATED]")
    resp = await client.post(
        f"{BASE}/deals/{deal_id}/payments/{payment_id}/verify",
        json={"verification_status": "verified", "verification_notes": "Initial payment confirmed."},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    check(resp, "POST /deals/{id}/payments/{pid}/verify")

    resp = await client.get(f"{BASE}/deals/{deal_id}", headers={"Authorization": f"Bearer {admin_token}"})
    final = check(resp, "GET /deals/{id} (final)")
    print(f"    FINAL status={final['status']}")
    assert final["status"] == "active", f"Expected active, got {final['status']}"

    # ── Step 8: View installment schedule ────────────────────────
    print("\nSTEP 8: View installment schedule")
    resp = await client.get(
        f"{BASE}/deals/{deal_id}/schedule",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    schedule = check(resp, "GET /deals/{id}/schedule")
    installments = schedule.get("installments", [])
    print(f"    {len(installments)} installments generated")
    if installments:
        first = installments[0]
        last = installments[-1]
        print(f"    #1  due={first['due_date']} opening={first['opening_balance']} charge={first['finance_charge']} due={first['amount_due']}")
        print(f"    #{len(installments)} due={last['due_date']}  closing={last['closing_balance']}")

    print(f"\n{'='*60}")
    print(f"SCENARIO B PASSED — Financing deal {deal_ref} ACTIVE")
    print(f"Check devmarineexchange@gmail.com + buyer2 phone for SMS")
    print(f"{'='*60}")


async def run():
    print(f"\n{'='*60}")
    print("PHASE 5 — DEALS FLOW TEST")
    print(f"{'='*60}\n")

    async with httpx.AsyncClient(timeout=30.0) as client:
        # Login
        admin_token = await login(client, ADMIN_EMAIL, ADMIN_PASS, "admin")
        buyer_token = await login(client, BUYER_EMAIL, BUYER_PASS, "buyer")

        # Get product for testing
        print("\nSetup: Fetching active product...")
        product = await get_product(client, admin_token)

        # Run both scenarios
        await run_full_payment_test(client, admin_token, buyer_token, product)
        await run_financing_test(client, admin_token, buyer_token, product)

    print(f"\n{'='*60}")
    print("ALL PHASE 5 TESTS PASSED")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    asyncio.run(run())
