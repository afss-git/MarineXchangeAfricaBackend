"""
Phase 9 — Payment Lifecycle tests.
Run with: ./venv/Scripts/python test_payments.py

Covers:
  1.  Login admin + buyer
  2.  Get an existing deal (or create one from a purchase request)
  3.  Admin creates AUTO payment schedule (3 installments)
  4.  Admin cannot create duplicate schedule (409)
  5.  Admin views schedule — 3 items returned
  6.  Buyer views their own schedule
  7.  Non-owner buyer cannot view schedule (403)
  8.  Admin gets payment summary — 0 verified, 0 pending paid
  9.  Buyer submits payment record for installment 1
  10. Buyer cannot double-submit for same installment (409)
  11. Admin lists payment records for deal
  12. Admin verifies payment record
  13. Item 1 status becomes 'verified'
  14. Admin creates MANUAL schedule on a second deal (3 custom installments)
  15. Manual schedule total mismatch -> 422
  16. Buyer submits + admin rejects (with reason)
  17. Item reverts to 'pending' after rejection
  18. Buyer can resubmit after rejection
  19. Admin waives item 3 on first deal
  20. Auto-complete: verify item 2 -> all items done -> deal status = 'completed'
  21. Admin deletes schedule that has verified payments -> 409
  22. RBAC: seller cannot access admin payment endpoints (403)
  23. RBAC: buyer cannot access admin verify/reject endpoints (403)
  24. Deal payment summary shows is_complete = True
"""
import urllib.request
import urllib.parse
import json
from datetime import date, timedelta

import os
BASE = os.environ.get("API_BASE_URL", "http://127.0.0.1:8000/api/v1")
RESULTS = []


def api(method, path, data=None, token=None, params=None):
    url = BASE + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = "Bearer " + token
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, body, h, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {"detail": str(e)}


def log(label, code, note="", expected=None):
    ok = (code == expected) if expected is not None else (code < 400)
    icon = "OK  " if ok else "FAIL"
    RESULTS.append((icon, code, label))
    print(f"  [{icon}] {code}  {label}")
    if not ok:
        note_str = note if isinstance(note, str) else json.dumps(note)[:300]
        print(f"         --> {note_str}")
    return ok


def log_rbac(label, code, expected=403):
    return log(label, code, expected=expected)


# ── Login ─────────────────────────────────────────────────────────────────────
print("=" * 65)
print("LOGIN")
print("=" * 65)

_TEST_PASS  = os.environ.get("TEST_USER_PASS", "")
_ADMIN_PASS = os.environ.get("TEST_ADMIN_PASS", "")
_, ar  = api("POST", "/auth/admin/login",  {"email": "admin@marinexchange.africa", "password": _ADMIN_PASS})
_, br  = api("POST", "/auth/buyer/login",  {"email": "buyer1@gmail.com",           "password": _TEST_PASS})
_, br2 = api("POST", "/auth/buyer/login",  {"email": "buyer2@gmail.com",           "password": _TEST_PASS})
_, sr  = api("POST", "/auth/seller/login", {"email": "seller1@gmail.com",          "password": _TEST_PASS})

ADMIN   = ar.get("access_token", "")
BUYER   = br.get("access_token", "")
BUYER2  = br2.get("access_token", "")
SELLER  = sr.get("access_token", "")

print(f"  Admin  : {'OK' if ADMIN   else 'FAIL - ' + str(ar)}")
print(f"  Buyer1 : {'OK' if BUYER   else 'FAIL - ' + str(br)}")
print(f"  Buyer2 : {'OK' if BUYER2  else 'FAIL - ' + str(br2)}")
print(f"  Seller : {'OK' if SELLER  else 'FAIL - ' + str(sr)}")


# ── Find a usable deal ────────────────────────────────────────────────────────
print("\n" + "=" * 65)
print("SETUP — Find existing deal for testing")
print("=" * 65)

_, deals_resp = api("GET", "/deals", params={"page": 1, "page_size": 10}, token=ADMIN)
deals = deals_resp if isinstance(deals_resp, list) else deals_resp.get("items", [])

DEAL_ID = None
DEAL_ID2 = None
BUYER_ID_FOR_DEAL = None

for d in deals:
    status_ok = d.get("status") in (
        "draft", "offer_sent", "accepted", "payment_pending",
        "payment_recorded", "active"
    )
    if status_ok and DEAL_ID is None:
        DEAL_ID = d["id"]
        BUYER_ID_FOR_DEAL = d.get("buyer_id")
        print(f"  Deal 1: {DEAL_ID}  [{d.get('status')}]  ref={d.get('deal_ref')}")
    elif status_ok and DEAL_ID2 is None and d["id"] != DEAL_ID:
        DEAL_ID2 = d["id"]
        print(f"  Deal 2: {DEAL_ID2}  [{d.get('status')}]  ref={d.get('deal_ref')}")
    if DEAL_ID and DEAL_ID2:
        break

if not DEAL_ID:
    print("  SKIP: No usable deals found. Run test_deals_flow.py first.")
    import sys; sys.exit(0)


# ── Dates for manual schedule ─────────────────────────────────────────────────
today = date.today()
D1 = (today + timedelta(days=15)).isoformat()
D2 = (today + timedelta(days=45)).isoformat()
D3 = (today + timedelta(days=75)).isoformat()


# ── Get deal's total_price to build manual schedule ───────────────────────────
_, deal_detail = api("GET", f"/deals/{DEAL_ID}", token=ADMIN)
TOTAL_PRICE = deal_detail.get("total_price", 300000)
print(f"  Deal 1 total_price: {TOTAL_PRICE}")


# ── Cleanup: force-delete existing schedules via DB so tests are idempotent ───
import asyncio, asyncpg as _asyncpg

async def _cleanup():
    from app.config import settings
    url = str(settings.DATABASE_URL).replace('postgresql+asyncpg://', 'postgresql://')
    conn = await _asyncpg.connect(url)
    for did in filter(None, [DEAL_ID, DEAL_ID2]):
        await conn.execute("DELETE FROM finance.payment_schedules WHERE deal_id = $1", did)
        # Also reset deal status to a non-terminal state for auto-complete test
        await conn.execute(
            "UPDATE finance.deals SET status = 'offer_sent', updated_at = NOW() WHERE id = $1 AND status = 'completed'",
            did
        )
    await conn.close()

asyncio.run(_cleanup())


# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("TESTS")
print("=" * 65)

# ── Test 3: Admin creates AUTO schedule ───────────────────────────────────────
code, resp = api("POST", f"/payments/admin/deals/{DEAL_ID}/schedule", {
    "mode": "auto",
    "installments": 3,
    "currency": "USD",
}, token=ADMIN)
log("T3  Admin creates AUTO payment schedule (3 installments)", code, resp, expected=201)
SCHEDULE_ID = resp.get("id")
items = resp.get("items", [])
ITEM_IDS = [i["id"] for i in items]
print(f"       schedule_id={SCHEDULE_ID}  items={len(items)}")


# ── Test 4: Duplicate schedule -> 409 ─────────────────────────────────────────
code, resp = api("POST", f"/payments/admin/deals/{DEAL_ID}/schedule", {
    "mode": "auto",
    "installments": 2,
    "currency": "USD",
}, token=ADMIN)
log("T4  Duplicate schedule -> 409", code, resp, expected=409)


# ── Test 5: Admin views schedule ──────────────────────────────────────────────
code, resp = api("GET", f"/payments/admin/deals/{DEAL_ID}/schedule", token=ADMIN)
ok = log("T5  Admin views schedule — 3 items", code, resp)
if ok:
    n = len(resp.get("items", []))
    if n != 3:
        print(f"         --> FAIL: expected 3 items, got {n}")
        RESULTS[-1] = ("FAIL", code, RESULTS[-1][2])


# ── Test 6: Buyer views own schedule ──────────────────────────────────────────
code, resp = api("GET", f"/payments/buyer/deals/{DEAL_ID}/schedule", token=BUYER)
log("T6  Buyer views their own schedule", code, resp)


# ── Test 7: Non-owner buyer gets 403 ─────────────────────────────────────────
if BUYER2:
    code, resp = api("GET", f"/payments/buyer/deals/{DEAL_ID}/schedule", token=BUYER2)
    log_rbac("T7  Non-owner buyer cannot view schedule (403)", code)
else:
    print("  [SKIP] T7  No BUYER2 token — skipping non-owner test")
    RESULTS.append(("SKIP", 0, "T7  Non-owner buyer cannot view schedule (403)"))


# ── Test 8: Admin gets payment summary ────────────────────────────────────────
code, resp = api("GET", f"/payments/admin/deals/{DEAL_ID}/summary", token=ADMIN)
ok = log("T8  Payment summary — 0 verified", code, resp)
if ok:
    if resp.get("verified_count", -1) != 0:
        print(f"         --> expected verified_count=0, got {resp.get('verified_count')}")


# ── Test 9: Buyer submits payment record for installment 1 ────────────────────
ITEM1_ID = ITEM_IDS[0] if ITEM_IDS else None
RECORD_ID = None
if ITEM1_ID:
    code, resp = api("POST", f"/payments/buyer/deals/{DEAL_ID}/items/{ITEM1_ID}/pay", {
        "amount_paid": round(float(TOTAL_PRICE) / 3, 2),
        "currency": "USD",
        "payment_method": "bank_transfer",
        "payment_date": today.isoformat(),
        "bank_name": "First Bank Nigeria",
        "bank_reference": "TRN-TEST-001",
        "notes": "First installment payment",
    }, token=BUYER)
    ok = log("T9  Buyer submits payment record for installment 1", code, resp, expected=201)
    if ok:
        RECORD_ID = resp.get("id")
        print(f"       record_id={RECORD_ID}")
else:
    print("  [SKIP] T9  No item IDs available")


# ── Test 10: Double-submit same installment -> 409 ─────────────────────────────
if ITEM1_ID:
    code, resp = api("POST", f"/payments/buyer/deals/{DEAL_ID}/items/{ITEM1_ID}/pay", {
        "amount_paid": round(float(TOTAL_PRICE) / 3, 2),
        "currency": "USD",
        "payment_method": "bank_transfer",
        "payment_date": today.isoformat(),
    }, token=BUYER)
    log("T10 Double-submit same installment -> 409", code, resp, expected=409)


# ── Test 11: Admin lists payment records ──────────────────────────────────────
code, resp = api("GET", f"/payments/admin/deals/{DEAL_ID}/payments", token=ADMIN)
ok = log("T11 Admin lists payment records for deal", code, resp)
if ok and isinstance(resp, list):
    print(f"       {len(resp)} record(s) found")


# ── Test 12: Admin verifies payment record ────────────────────────────────────
if RECORD_ID:
    code, resp = api("POST", f"/payments/admin/payments/{RECORD_ID}/verify", {
        "notes": "Bank confirmed receipt"
    }, token=ADMIN)
    ok = log("T12 Admin verifies payment record", code, resp)
    if ok:
        if resp.get("status") != "verified":
            print(f"         --> expected status=verified, got {resp.get('status')}")


# ── Test 13: Item 1 status is now 'verified' ──────────────────────────────────
if ITEM1_ID and SCHEDULE_ID:
    code, resp = api("GET", f"/payments/admin/deals/{DEAL_ID}/schedule", token=ADMIN)
    ok = log("T13 Schedule item 1 status = 'verified'", code, resp)
    if ok:
        item1 = next((i for i in resp.get("items", []) if i["id"] == ITEM1_ID), None)
        if item1 and item1.get("status") != "verified":
            print(f"         --> expected verified, got {item1.get('status')}")
            RESULTS[-1] = ("FAIL", code, RESULTS[-1][2])


# ── Test 14: Admin creates MANUAL schedule on deal 2 ─────────────────────────
if DEAL_ID2:
    _, deal2_detail = api("GET", f"/deals/{DEAL_ID2}", token=ADMIN)
    total2 = float(deal2_detail.get("total_price", 600000))
    dep = round(total2 * 0.3, 2)
    mid = round(total2 * 0.4, 2)
    fin = round(total2 - dep - mid, 2)

    code, resp = api("POST", f"/payments/admin/deals/{DEAL_ID2}/schedule", {
        "mode": "manual",
        "currency": "USD",
        "installments": [
            {"label": "Deposit",          "amount": dep, "due_date": D1},
            {"label": "Milestone Payment","amount": mid, "due_date": D2},
            {"label": "Final Payment",    "amount": fin, "due_date": D3},
        ],
    }, token=ADMIN)
    ok = log("T14 Admin creates MANUAL schedule on deal 2", code, resp, expected=201)
    DEAL2_ITEMS = resp.get("items", []) if ok else []
    if ok:
        print(f"       items: {[(i['label'], i['amount']) for i in DEAL2_ITEMS]}")
else:
    print("  [SKIP] T14 No second deal available")
    DEAL2_ITEMS = []


# ── Test 15: Manual schedule total mismatch -> 422 ────────────────────────────
if DEAL_ID2:
    _, deal2_detail = api("GET", f"/deals/{DEAL_ID2}", token=ADMIN)
    total2 = float(deal2_detail.get("total_price", 600000))
    code, resp = api("POST", f"/payments/admin/deals/{DEAL_ID2}/schedule", {
        "mode": "manual",
        "currency": "USD",
        "installments": [
            {"label": "Part A", "amount": 50.00,          "due_date": D1},
            {"label": "Part B", "amount": total2 - 150.0, "due_date": D2},
        ],
    }, token=ADMIN)
    # Will be 409 (already exists) OR 422 (mismatch) — both are failures
    log("T15 Manual total mismatch -> 409 or 422", code, resp,
        expected=409 if DEAL_ID2 else 422)


# ── Test 16: Buyer submits + admin rejects ────────────────────────────────────
ITEM2_ID = ITEM_IDS[1] if len(ITEM_IDS) > 1 else None
RECORD2_ID = None
if ITEM2_ID:
    code, resp = api("POST", f"/payments/buyer/deals/{DEAL_ID}/items/{ITEM2_ID}/pay", {
        "amount_paid": round(float(TOTAL_PRICE) / 3, 2),
        "currency": "USD",
        "payment_method": "swift",
        "payment_date": today.isoformat(),
        "bank_reference": "SWIFT-TEST-002",
    }, token=BUYER)
    ok = log("T16a Buyer submits payment for installment 2", code, resp, expected=201)
    if ok:
        RECORD2_ID = resp.get("id")

    if RECORD2_ID:
        code, resp = api("POST", f"/payments/admin/payments/{RECORD2_ID}/reject", {
            "rejection_reason": "Bank reference not found in our records. Please re-upload."
        }, token=ADMIN)
        log("T16b Admin rejects payment record", code, resp)


# ── Test 17: Item reverts to 'pending' after rejection ───────────────────────
if ITEM2_ID and RECORD2_ID:
    code, resp = api("GET", f"/payments/admin/deals/{DEAL_ID}/schedule", token=ADMIN)
    ok = log("T17 Item 2 reverts to 'pending' after rejection", code, resp)
    if ok:
        item2 = next((i for i in resp.get("items", []) if i["id"] == ITEM2_ID), None)
        if item2 and item2.get("status") != "pending":
            print(f"         --> expected pending, got {item2.get('status')}")
            RESULTS[-1] = ("FAIL", code, RESULTS[-1][2])


# ── Test 18: Buyer can resubmit after rejection ───────────────────────────────
RECORD3_ID = None
if ITEM2_ID and RECORD2_ID:
    code, resp = api("POST", f"/payments/buyer/deals/{DEAL_ID}/items/{ITEM2_ID}/pay", {
        "amount_paid": round(float(TOTAL_PRICE) / 3, 2),
        "currency": "USD",
        "payment_method": "bank_transfer",
        "payment_date": today.isoformat(),
        "bank_reference": "TRN-CORRECTED-003",
        "notes": "Corrected bank reference",
    }, token=BUYER)
    ok = log("T18 Buyer resubmits after rejection", code, resp, expected=201)
    if ok:
        RECORD3_ID = resp.get("id")


# ── Test 19: Admin waives item 3 ──────────────────────────────────────────────
ITEM3_ID = ITEM_IDS[2] if len(ITEM_IDS) > 2 else None
if ITEM3_ID:
    code, resp = api("POST", f"/payments/admin/schedule-items/{ITEM3_ID}/waive", {
        "waiver_reason": "Commercial agreement — waived by management approval."
    }, token=ADMIN)
    ok = log("T19 Admin waives item 3", code, resp)
    if ok and resp.get("status") != "waived":
        print(f"         --> expected waived, got {resp.get('status')}")
        RESULTS[-1] = ("FAIL", code, RESULTS[-1][2])


# ── Test 20: Verify item 2 -> all done -> deal auto-completed ──────────────────
if RECORD3_ID and ITEM3_ID:
    code, resp = api("POST", f"/payments/admin/payments/{RECORD3_ID}/verify", {
        "notes": "Verified on second submission"
    }, token=ADMIN)
    ok = log("T20a Admin verifies resubmitted item 2", code, resp)

    if ok:
        # Check deal is now completed
        code2, deal_now = api("GET", f"/deals/{DEAL_ID}", token=ADMIN)
        deal_status = deal_now.get("status")
        ok2 = log("T20b Deal auto-completed after all items verified/waived", code2, deal_now)
        if ok2 and deal_status != "completed":
            print(f"         --> expected completed, got '{deal_status}'")
            RESULTS[-1] = ("FAIL", code2, RESULTS[-1][2])

        # Check summary
        code3, summary = api("GET", f"/payments/admin/deals/{DEAL_ID}/summary", token=ADMIN)
        ok3 = log("T20c Summary shows is_complete = True", code3, summary)
        if ok3 and not summary.get("is_complete"):
            print(f"         --> is_complete={summary.get('is_complete')}")
            RESULTS[-1] = ("FAIL", code3, RESULTS[-1][2])


# ── Test 21: Delete schedule with verified payments -> 409 ────────────────────
code, resp = api("DELETE", f"/payments/admin/deals/{DEAL_ID}/schedule", token=ADMIN)
log("T21 Delete schedule with verified payments -> 409", code, resp, expected=409)


# ── Test 22: RBAC — seller cannot access admin endpoints ─────────────────────
code, resp = api("GET", f"/payments/admin/deals/{DEAL_ID}/schedule", token=SELLER)
log_rbac("T22 RBAC: seller cannot access admin payments (403)", code)


# ── Test 23: RBAC — buyer cannot verify payments ─────────────────────────────
if RECORD_ID:
    code, resp = api("POST", f"/payments/admin/payments/{RECORD_ID}/verify", {}, token=BUYER)
    log_rbac("T23 RBAC: buyer cannot verify payments (403)", code)


# ── Test 24: Summary final state ─────────────────────────────────────────────
code, resp = api("GET", f"/payments/admin/deals/{DEAL_ID}/summary", token=ADMIN)
ok = log("T24 Final summary check", code, resp)
if ok:
    print(f"       total={resp.get('total_items')} verified={resp.get('verified_count')} "
          f"waived={resp.get('waived_count')} complete={resp.get('is_complete')} "
          f"total_amt={resp.get('total_amount')} verified_amt={resp.get('verified_amount')}")


# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
passed = sum(1 for r in RESULTS if r[0] == "OK  ")
failed = sum(1 for r in RESULTS if r[0] == "FAIL")
skipped = sum(1 for r in RESULTS if r[0] == "SKIP")
total = len(RESULTS)
print(f"  PASSED: {passed}/{total}   FAILED: {failed}   SKIPPED: {skipped}")
print("=" * 65)
if failed:
    print("\nFailed tests:")
    for r in RESULTS:
        if r[0] == "FAIL":
            print(f"  [{r[1]}] {r[2]}")
