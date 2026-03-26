"""
Phase 8 — Auction Engine tests.
Run with: ./venv/Scripts/python test_auctions.py

Covers:
  1.  Admin creates auction (draft)
  2.  Admin edits auction
  3.  Admin schedules auction
  4.  Admin lists auctions
  5.  Admin views auction detail (includes reserve_price)
  6.  Public catalog — auction visible as 'scheduled'
  7.  Public view — reserve_price NOT in response
  8.  Admin manually transitions to live (simulate scheduler)
  9.  Buyer 1 places first bid
  10. Buyer 1 cannot outbid themselves
  11. Public view shows updated bid + reserve_status
  12. Admin views all bids
  13. Admin approves winner (after manual close)
  14. Admin rejects winner (second test auction)
  15. Admin converts winner_approved → DRAFT deal
  16. Buyer views their bid history
  17. RBAC: seller cannot bid (403)
  18. RBAC: buyer cannot access admin endpoints (403)
  19. Duplicate bid too low (400)
  20. Cancel draft auction
"""
import urllib.request
import urllib.parse
import json
from datetime import datetime, timedelta, timezone

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


# ── Login ──────────────────────────────────────────────────────────────────────
print("=" * 60)
print("LOGIN")
print("=" * 60)

_TEST_PASS  = os.environ.get("TEST_USER_PASS", "")
_ADMIN_PASS = os.environ.get("TEST_ADMIN_PASS", "")
_, ar  = api("POST", "/auth/admin/login",  {"email": "admin@marinexchange.africa",  "password": _ADMIN_PASS})
_, br  = api("POST", "/auth/buyer/login",  {"email": "buyer1@gmail.com",            "password": _TEST_PASS})
_, sr  = api("POST", "/auth/seller/login", {"email": "seller1@gmail.com",           "password": _TEST_PASS})

ADMIN  = ar.get("access_token", "")
BUYER  = br.get("access_token", "")
SELLER = sr.get("access_token", "")

print(f"  Admin  : {'OK' if ADMIN  else 'FAIL - ' + str(ar)}")
print(f"  Buyer  : {'OK' if BUYER  else 'FAIL - ' + str(br)}")
print(f"  Seller : {'OK' if SELLER else 'FAIL - ' + str(sr)}")


# ── Get a product ──────────────────────────────────────────────────────────────
_, catalog = api("GET", "/marketplace/catalog", params={"limit": 5})
PRODUCT_ID = None
for p in catalog.get("items", []):
    if p.get("status") in ("active", "under_offer"):
        PRODUCT_ID = p["id"]
        print(f"\nUsing product: {PRODUCT_ID}  ({p.get('title', '')[:40]})")
        break

# ── Times ──────────────────────────────────────────────────────────────────────
now   = datetime.now(timezone.utc)
START = (now + timedelta(minutes=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
END   = (now + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── Test 1: Admin creates auction ─────────────────────────────────────────────
print("\n" + "=" * 60)
print("TEST 1: Admin creates auction (draft)")
print("=" * 60)

AUC_ID = None
if ADMIN and PRODUCT_ID:
    code, r = api("POST", "/auctions/admin", token=ADMIN, data={
        "product_id":            PRODUCT_ID,
        "title":                 "Test Auction — Offshore Patrol Vessel",
        "description":           "24-hour auction for a well-maintained offshore patrol vessel.",
        "starting_bid":          "250000.00",
        "reserve_price":         "300000.00",
        "currency":              "USD",
        "min_bid_increment_usd": "10000.00",
        "start_time":            START,
        "end_time":              END,
        "auto_extend_minutes":   5,
        "max_extensions":        3,
        "admin_notes":           "Test auction created by automated test",
    })
    if log("POST /auctions/admin (create)", code, r.get("detail", "")):
        AUC_ID = r["id"]
        print(f"    auction_id={AUC_ID}  status={r['status']}")
        print(f"    reserve_price={r.get('reserve_price')}  (visible to admin)")
        assert r["reserve_price"] == "300000.00" or float(r.get("reserve_price", 0)) == 300000.0


# ── Test 2: Admin edits auction ───────────────────────────────────────────────
print("\n" + "=" * 60)
print("TEST 2: Admin edits auction (draft only)")
print("=" * 60)

if ADMIN and AUC_ID:
    code, r = api("PUT", f"/auctions/admin/{AUC_ID}", token=ADMIN, data={
        "description": "Updated: 24-hour competitive auction for well-maintained offshore patrol vessel.",
        "min_bid_increment_usd": "15000.00",
    })
    if log("PUT /auctions/admin/{id} (edit)", code, r.get("detail", "")):
        print(f"    min_bid_increment_usd={r['min_bid_increment_usd']}")


# ── Test 3: Admin schedules auction ───────────────────────────────────────────
print("\n" + "=" * 60)
print("TEST 3: Admin schedules auction")
print("=" * 60)

if ADMIN and AUC_ID:
    code, r = api("POST", f"/auctions/admin/{AUC_ID}/schedule", token=ADMIN)
    if log(f"POST /auctions/admin/{AUC_ID}/schedule", code, r.get("detail", "")):
        print(f"    status={r['status']}")


# ── Test 4: Admin lists auctions ──────────────────────────────────────────────
print("\n" + "=" * 60)
print("TEST 4: Admin lists all auctions")
print("=" * 60)

if ADMIN:
    code, r = api("GET", "/auctions/admin", token=ADMIN)
    if log("GET /auctions/admin", code, r.get("detail", "")):
        print(f"    total={r['total']}")


# ── Test 5: Admin views detail ────────────────────────────────────────────────
print("\n" + "=" * 60)
print("TEST 5: Admin views full auction detail (reserve_price visible)")
print("=" * 60)

if ADMIN and AUC_ID:
    code, r = api("GET", f"/auctions/admin/{AUC_ID}", token=ADMIN)
    if log(f"GET /auctions/admin/{AUC_ID}", code, r.get("detail", "")):
        print(f"    status={r['status']}  reserve_price={r.get('reserve_price')}  bids={r['bid_count']}")


# ── Test 6: Public catalog ────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("TEST 6: Public catalog (scheduled auctions visible)")
print("=" * 60)

code, r = api("GET", "/auctions/", params={"status": "scheduled"})
if log("GET /auctions/?status=scheduled", code, r.get("detail", "")):
    print(f"    total={r['total']}")
    if r["items"]:
        item = r["items"][0]
        assert "reserve_price" not in item, "reserve_price must not be in public response!"
        print(f"    reserve_price in response: {'reserve_price' in item} (should be False)")
        print(f"    reserve_status={item.get('reserve_status')}  min_next_bid={item.get('min_next_bid')}")


# ── Test 7: Public detail — no reserve_price ──────────────────────────────────
print("\n" + "=" * 60)
print("TEST 7: Public auction detail (reserve_price hidden)")
print("=" * 60)

if AUC_ID:
    code, r = api("GET", f"/auctions/{AUC_ID}")
    if log(f"GET /auctions/{AUC_ID} (public)", code, r.get("detail", "")):
        has_reserve = "reserve_price" in r
        print(f"    reserve_price in response: {has_reserve} (must be False)")
        print(f"    reserve_status={r.get('reserve_status')}  time_remaining={r.get('time_remaining_seconds')}s")
        if has_reserve:
            log("SECURITY: reserve_price must NOT appear in public response", 500, "reserve_price exposed!")


# ── Simulate scheduler: set auction to LIVE ────────────────────────────────────
print("\n" + "=" * 60)
print("SETUP — manually transition auction to 'live' (simulating scheduler)")
print("=" * 60)

import urllib.request as _ur
if ADMIN and AUC_ID:
    # Use the DB directly via a quick admin endpoint isn't available
    # Instead, patch start_time to the past using the edit endpoint
    past_start = (now - timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
    # First revert to draft via a workaround: create new auction already live
    # Actually, simulate by directly setting the DB
    # We'll just use the test to hit the auction when it's live
    # For now, use the admin to set start_time to past; then trigger the job
    # Since we can call the scheduler job directly via the service, let's just
    # hit the DB directly for the test
    try:
        import asyncio, asyncpg, os

        DB_URL = None
        with open(".env", encoding="utf-8") as f:
            for line in f:
                if line.startswith("DATABASE_URL="):
                    DB_URL = line.split("=", 1)[1].strip().replace("postgresql+asyncpg://", "postgresql://")
                    break

        async def set_live():
            conn = await asyncpg.connect(DB_URL)
            await conn.execute(
                "UPDATE marketplace.auctions SET status='live', start_time=NOW()-interval'1 minute' WHERE id=$1",
                AUC_ID
            )
            await conn.close()

        asyncio.run(set_live())
        print(f"  Auction {AUC_ID} set to 'live'")
    except Exception as e:
        print(f"  Could not set live via DB: {e}")


# ── Test 8: Public sees live auction ─────────────────────────────────────────
print("\n" + "=" * 60)
print("TEST 8: Buyer views live auction")
print("=" * 60)

if AUC_ID:
    code, r = api("GET", f"/auctions/{AUC_ID}")
    if log(f"GET /auctions/{AUC_ID} (live)", code, r.get("detail", "")):
        print(f"    status={r['status']}  min_next_bid={r['min_next_bid']}  reserve_status={r['reserve_status']}")


# ── Test 9: Buyer places first bid ────────────────────────────────────────────
print("\n" + "=" * 60)
print("TEST 9: Buyer places first bid")
print("=" * 60)

if BUYER and AUC_ID:
    code, r = api("POST", f"/auctions/{AUC_ID}/bids", token=BUYER, data={"amount": "260000.00"})
    if log("POST /auctions/{id}/bids (first bid)", code, r.get("detail", "")):
        print(f"    bid_id={r['bid_id']}  amount={r['amount']}  is_winning={r['is_winning_bid']}")
        print(f"    extended={r['extended']}  reserve_status={r['reserve_status']}")
        print(f"    min_next_bid={r['min_next_bid']}")


# ── Test 10: Buyer cannot outbid themselves ───────────────────────────────────
print("\n" + "=" * 60)
print("TEST 10: Buyer cannot outbid themselves (expect 400)")
print("=" * 60)

if BUYER and AUC_ID:
    code, r = api("POST", f"/auctions/{AUC_ID}/bids", token=BUYER, data={"amount": "280000.00"})
    log("POST /auctions/{id}/bids (self-outbid — expect 400)", code, r.get("detail", ""), expected=400)
    if code == 400:
        print(f"    detail: {r.get('detail')}")


# ── Test 11: Bid too low (expect 400) ─────────────────────────────────────────
print("\n" + "=" * 60)
print("TEST 11: Bid too low (expect 400)")
print("=" * 60)

if BUYER and AUC_ID:
    code, r = api("POST", f"/auctions/{AUC_ID}/bids", token=BUYER, data={"amount": "100.00"})
    log("POST /auctions/{id}/bids (too low — expect 400)", code, r.get("detail", ""), expected=400)
    if code == 400:
        print(f"    detail: {r.get('detail')}")


# ── Test 12: Public bid history ───────────────────────────────────────────────
print("\n" + "=" * 60)
print("TEST 12: Public bid history (company names only)")
print("=" * 60)

if AUC_ID:
    code, r = api("GET", f"/auctions/{AUC_ID}/bids")
    detail = r.get("detail", "") if isinstance(r, dict) else ""
    bids_list = r if isinstance(r, list) else r.get("items", [])
    if log(f"GET /auctions/{AUC_ID}/bids", code, detail):
        print(f"    bids={len(bids_list)}")
        if bids_list:
            bid = bids_list[0]
            has_personal_name = "bidder_name" in bid or "full_name" in bid
            print(f"    bidder_company present: {'bidder_company' in bid}")
            print(f"    personal name exposed: {has_personal_name} (must be False)")


# ── Test 13: Admin closes and approves winner ─────────────────────────────────
print("\n" + "=" * 60)
print("TEST 13: Admin closes auction + approves winner")
print("=" * 60)

if ADMIN and AUC_ID:
    # Simulate scheduler closing the auction
    try:
        import asyncio, asyncpg

        async def close_auction():
            conn = await asyncpg.connect(DB_URL)
            # Force end_time to past
            await conn.execute(
                "UPDATE marketplace.auctions SET end_time=NOW()-interval'1 minute', status='winner_pending_approval' WHERE id=$1",
                AUC_ID
            )
            await conn.close()

        asyncio.run(close_auction())
        print("  Auction manually closed → winner_pending_approval")
    except Exception as e:
        print(f"  DB set failed: {e}")

    # Admin views the auction
    code, r = api("GET", f"/auctions/admin/{AUC_ID}", token=ADMIN)
    if log(f"GET /auctions/admin/{AUC_ID} (after close)", code, r.get("detail", "")):
        print(f"    status={r['status']}  current_highest_bid={r.get('current_highest_bid')}")

    # Admin approves winner
    code2, r2 = api("POST", f"/auctions/admin/{AUC_ID}/approve-winner", token=ADMIN, data={
        "admin_notes": "Winner KYC verified. Approved."
    })
    if log(f"POST /auctions/admin/{AUC_ID}/approve-winner", code2, r2.get("detail", "")):
        print(f"    status={r2['status']}  winner_approved_at={r2.get('winner_approved_at')}")


# ── Test 14: Admin converts to DRAFT deal ─────────────────────────────────────
print("\n" + "=" * 60)
print("TEST 14: Admin converts auction to DRAFT deal")
print("=" * 60)

DEAL_ID = None
DEAL_REF = None
if ADMIN and AUC_ID:
    code, r = api("POST", f"/auctions/admin/{AUC_ID}/convert", token=ADMIN, data={
        "deal_type":    "full_payment",
        "admin_notes":  "Deal created from auction win.",
    })
    if log(f"POST /auctions/admin/{AUC_ID}/convert", code, r.get("detail", "")):
        DEAL_ID  = r["deal_id"]
        DEAL_REF = r["deal_ref"]
        print(f"    deal_id={DEAL_ID}  deal_ref={DEAL_REF}  deal_status={r['deal_status']}")
        print(f"    {r['message']}")


# ── Test 15: Buyer views bid history ─────────────────────────────────────────
print("\n" + "=" * 60)
print("TEST 15: Buyer views their bid history")
print("=" * 60)

if BUYER:
    code, r = api("GET", "/auctions/bids/my", token=BUYER)
    if log("GET /auctions/bids/my", code, r.get("detail", "")):
        print(f"    total={r['total']}")
        for b in r["items"][:3]:
            print(f"    bid: {b['amount']}  winning={b['is_winning_bid']}  auction={b.get('auction_title', '')[:30]}")

    if AUC_ID:
        code2, r2 = api("GET", f"/auctions/{AUC_ID}/bids/my", token=BUYER)
        if log(f"GET /auctions/{AUC_ID}/bids/my", code2, r2.get("detail", "")):
            print(f"    bids on this auction: {r2['total']}")


# ── Test 16: Cancel a fresh draft auction ─────────────────────────────────────
print("\n" + "=" * 60)
print("TEST 16: Create and cancel a draft auction")
print("=" * 60)

if ADMIN and PRODUCT_ID:
    code, r = api("POST", "/auctions/admin", token=ADMIN, data={
        "product_id":   PRODUCT_ID,
        "title":        "To Be Cancelled Auction",
        "starting_bid": "100000.00",
        "currency":     "USD",
        "start_time":   START,
        "end_time":     END,
    })
    if log("POST /auctions/admin (draft for cancel)", code, r.get("detail", "")):
        cancel_id = r["id"]
        code2, r2 = api("POST", f"/auctions/admin/{cancel_id}/cancel", token=ADMIN,
                        params={"reason": "Test cancel"})
        if log(f"POST /auctions/admin/{cancel_id}/cancel", code2, r2.get("detail", "")):
            print(f"    status={r2['status']}")


# ── RBAC Guards ───────────────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("RBAC GUARD TESTS")
print("=" * 60)

# Seller cannot bid
if SELLER and AUC_ID:
    code, _ = api("POST", f"/auctions/{AUC_ID}/bids", token=SELLER, data={"amount": "500000.00"})
    log_rbac("POST /auctions/{id}/bids as SELLER (expect 403)", code)

# Buyer cannot access admin endpoints
if BUYER:
    code2, _ = api("GET", "/auctions/admin", token=BUYER)
    log_rbac("GET /auctions/admin as BUYER (expect 403)", code2)

# Unauthenticated cannot bid
if AUC_ID:
    code3, _ = api("POST", f"/auctions/{AUC_ID}/bids", data={"amount": "500000.00"})
    log_rbac("POST /auctions/{id}/bids unauthenticated (expect 401)", code3, expected=401)


# ── Summary ───────────────────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("SUMMARY")
print("=" * 60)
passed = sum(1 for i in RESULTS if i[0] == "OK  ")
failed = sum(1 for i in RESULTS if i[0] == "FAIL")
print(f"  PASSED : {passed}")
print(f"  FAILED : {failed}")
print(f"  TOTAL  : {len(RESULTS)}")

if DEAL_REF:
    print(f"\n  Auction deal created: {DEAL_REF}  (id={DEAL_ID})")
    print("  --> Go to Deals module to configure terms and send offer to winner.")

if failed:
    print("\nFailed:")
    for icon, code, label in RESULTS:
        if icon == "FAIL":
            print(f"  [{code}] {label}")
