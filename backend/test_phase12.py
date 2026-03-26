"""
Phase 12 — Seller Dashboard + Exchange Rates tests.
Run with: python test_phase12.py

Covers:
  1.  Login seller, buyer, admin
  2.  GET /seller/dashboard — returns all sections
  3.  GET /seller/dashboard — structure validation (listings, deals, purchase_requests, auctions, recent_deals)
  4.  Buyer cannot access seller dashboard (403)
  5.  GET /exchange-rates — returns list (empty or populated)
  6.  POST /exchange-rates — admin creates USD->NGN rate
  7.  POST /exchange-rates — admin creates EUR->USD rate
  8.  GET /exchange-rates — now returns at least 2 rates
  9.  GET /exchange-rates/USD/NGN — returns specific pair
  10. GET /exchange-rates/EUR/USD — returns specific pair
  11. GET /exchange-rates/XXX/YYY — 404 for unknown pair
  12. GET /exchange-rates/convert?from=USD&to=NGN&amount=1000 — conversion works
  13. POST /exchange-rates — upsert same pair updates rate
  14. Buyer can read exchange rates (200)
  15. Seller can read exchange rates (200)
  16. Buyer cannot POST exchange rates (403)
  17. Seller cannot POST exchange rates (403)
  18. POST /exchange-rates — invalid rate (0) rejected (422)
  19. POST /exchange-rates — missing fields rejected (422)
"""
import json
import urllib.error
import urllib.parse
import urllib.request
import os
from decimal import Decimal

BASE = os.environ.get("API_BASE_URL", "http://127.0.0.1:8000/api/v1")
RESULTS = []


def api(method, path, data=None, token=None, params=None):
    url = BASE + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = "Bearer " + token
    body = json.dumps(data).encode() if data is not None else None
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
    ok = expected is None or code == expected
    status = "OK  " if ok else "FAIL"
    msg = f"  [{status}] {code}  {label}"
    if not ok:
        msg += f"\n         --> {note}"
    print(msg)
    RESULTS.append((ok, label, code))
    return ok


SEP = "=" * 65

# ══════════════════════════════════════════════════════════════════════════════
print(SEP)
print("LOGIN")
print(SEP)

_TEST_PASS  = os.environ.get("TEST_USER_PASS", "")
_ADMIN_PASS = os.environ.get("TEST_ADMIN_PASS", "")
_, sr  = api("POST", "/auth/seller/login", {"email": "seller1@gmail.com", "password": _TEST_PASS})
_, br  = api("POST", "/auth/buyer/login",  {"email": "buyer1@gmail.com",  "password": _TEST_PASS})
_, ar  = api("POST", "/auth/admin/login",  {"email": "admin@marinexchange.africa", "password": _ADMIN_PASS})

SELLER = sr.get("access_token", "")
BUYER  = br.get("access_token", "")
ADMIN  = ar.get("access_token", "")

print(f"  Seller : {'OK' if SELLER else 'FAIL'}")
print(f"  Buyer  : {'OK' if BUYER  else 'FAIL'}")
print(f"  Admin  : {'OK' if ADMIN  else 'FAIL'}")

if not SELLER or not BUYER or not ADMIN:
    print("FATAL: Cannot proceed without all three tokens.")
    import sys; sys.exit(1)


# ══════════════════════════════════════════════════════════════════════════════
print(SEP)
print("T1-T3 — Seller Dashboard")
print(SEP)

code, resp = api("GET", "/seller/dashboard", token=SELLER)
log("T1: GET /seller/dashboard (200)", code, resp, expected=200)
log("T2: Response has 'listings' section", code, resp,
    expected=200) if log else None

if code == 200:
    for section in ("listings", "deals", "purchase_requests", "auctions", "recent_deals"):
        present = section in resp
        ok = "OK  " if present else "FAIL"
        msg = f"  [{ok}] {code}  T2: '{section}' section present"
        if not present:
            msg += f"\n         --> keys={list(resp.keys())}"
        print(msg)
        RESULTS.append((present, f"T2: '{section}' section present", code))

    # Validate listings sub-keys
    listings = resp.get("listings", {})
    for key in ("total_listings", "active_listings", "active_listings_value"):
        present = key in listings
        ok = "OK  " if present else "FAIL"
        print(f"  [{ok}] {code}  T3: listings.{key} present")
        RESULTS.append((present, f"T3: listings.{key} present", code))

    # Validate deals sub-keys
    deals = resp.get("deals", {})
    for key in ("total_deals", "active_deals", "completed_deals", "revenue_this_month"):
        present = key in deals
        ok = "OK  " if present else "FAIL"
        print(f"  [{ok}] {code}  T3: deals.{key} present")
        RESULTS.append((present, f"T3: deals.{key} present", code))
else:
    print(f"  [FAIL] Skipping structure checks — dashboard returned {code}")
    for k in ("listings", "deals", "purchase_requests", "auctions", "recent_deals"):
        RESULTS.append((False, f"T2: '{k}' section present", code))


# ══════════════════════════════════════════════════════════════════════════════
print(SEP)
print("T4 — RBAC: Buyer blocked from seller dashboard")
print(SEP)

code, resp = api("GET", "/seller/dashboard", token=BUYER)
log("T4: Buyer cannot access seller dashboard (403)", code, resp, expected=403)


# ══════════════════════════════════════════════════════════════════════════════
print(SEP)
print("T5 — Exchange Rates: initial list")
print(SEP)

code, resp = api("GET", "/exchange-rates", token=BUYER)
log("T5: GET /exchange-rates returns 200", code, resp, expected=200)
if code == 200:
    has_items = "items" in resp and isinstance(resp["items"], list)
    ok = "OK  " if has_items else "FAIL"
    print(f"  [{ok}] {code}  T5: Response has 'items' list")
    RESULTS.append((has_items, "T5: Response has 'items' list", code))


# ══════════════════════════════════════════════════════════════════════════════
print(SEP)
print("T6-T8 — Admin creates exchange rates")
print(SEP)

# USD -> NGN
code, resp = api("POST", "/exchange-rates",
    {"from_currency": "USD", "to_currency": "NGN", "rate": 1650.50, "source": "manual"},
    token=ADMIN)
log("T6: POST USD->NGN rate (201)", code, resp, expected=201)
if code == 201:
    ok = resp.get("rate") is not None and resp.get("from_currency") == "USD"
    s = "OK  " if ok else "FAIL"
    print(f"  [{s}] {code}  T6: Rate value and currency in response")
    RESULTS.append((ok, "T6: Rate value and currency in response", code))

# EUR -> USD
code, resp = api("POST", "/exchange-rates",
    {"from_currency": "EUR", "to_currency": "USD", "rate": 1.08, "source": "manual"},
    token=ADMIN)
log("T7: POST EUR->USD rate (201)", code, resp, expected=201)

# List should now have at least 2
code, resp = api("GET", "/exchange-rates", token=SELLER)
log("T8: GET /exchange-rates after inserts (200)", code, resp, expected=200)
if code == 200:
    count = len(resp.get("items", []))
    ok = count >= 2
    s = "OK  " if ok else "FAIL"
    print(f"  [{s}] {code}  T8: At least 2 rates returned (got {count})")
    RESULTS.append((ok, f"T8: At least 2 rates returned (got {count})", code))


# ══════════════════════════════════════════════════════════════════════════════
print(SEP)
print("T9-T11 — Get specific rate / 404")
print(SEP)

code, resp = api("GET", "/exchange-rates/USD/NGN", token=SELLER)
log("T9: GET /exchange-rates/USD/NGN (200)", code, resp, expected=200)
if code == 200:
    ok = float(resp.get("rate", 0)) > 0
    s = "OK  " if ok else "FAIL"
    print(f"  [{s}] {code}  T9: Rate > 0 (got {resp.get('rate')})")
    RESULTS.append((ok, "T9: Rate > 0", code))

code, resp = api("GET", "/exchange-rates/EUR/USD", token=SELLER)
log("T10: GET /exchange-rates/EUR/USD (200)", code, resp, expected=200)

code, resp = api("GET", "/exchange-rates/XXX/YYY", token=SELLER)
log("T11: GET /exchange-rates/XXX/YYY (404)", code, resp, expected=404)


# ══════════════════════════════════════════════════════════════════════════════
print(SEP)
print("T12 — Currency Conversion")
print(SEP)

code, resp = api("GET", "/exchange-rates/convert", token=BUYER,
    params={"from_currency": "USD", "to_currency": "NGN", "amount": "1000"})
log("T12: Convert 1000 USD->NGN (200)", code, resp, expected=200)
if code == 200:
    converted = resp.get("converted_amount")
    ok = converted is not None and float(converted) > 0
    s = "OK  " if ok else "FAIL"
    print(f"  [{s}] {code}  T12: Converted amount > 0 (got {converted})")
    RESULTS.append((ok, f"T12: Converted amount > 0 (got {converted})", code))

    ok2 = resp.get("from_currency") == "USD" and resp.get("to_currency") == "NGN"
    s2 = "OK  " if ok2 else "FAIL"
    print(f"  [{s2}] {code}  T12: Currencies correct in response")
    RESULTS.append((ok2, "T12: Currencies correct in response", code))


# ══════════════════════════════════════════════════════════════════════════════
print(SEP)
print("T13 — Upsert (same pair, new rate)")
print(SEP)

code, resp = api("POST", "/exchange-rates",
    {"from_currency": "USD", "to_currency": "NGN", "rate": 1680.00, "source": "manual"},
    token=ADMIN)
log("T13: Upsert same pair (same date) updates rate (201)", code, resp, expected=201)
if code == 201:
    ok = abs(float(resp.get("rate", 0)) - 1680.0) < 0.01
    s = "OK  " if ok else "FAIL"
    print(f"  [{s}] {code}  T13: Rate updated to 1680.00 (got {resp.get('rate')})")
    RESULTS.append((ok, "T13: Rate updated to 1680.00", code))


# ══════════════════════════════════════════════════════════════════════════════
print(SEP)
print("T14-T15 — Buyer + Seller can read rates")
print(SEP)

code, _ = api("GET", "/exchange-rates", token=BUYER)
log("T14: Buyer can read exchange rates (200)", code, expected=200)

code, _ = api("GET", "/exchange-rates", token=SELLER)
log("T15: Seller can read exchange rates (200)", code, expected=200)


# ══════════════════════════════════════════════════════════════════════════════
print(SEP)
print("T16-T17 — RBAC: Buyer + Seller blocked from POST")
print(SEP)

code, _ = api("POST", "/exchange-rates",
    {"from_currency": "GBP", "to_currency": "USD", "rate": 1.27},
    token=BUYER)
log("T16: Buyer cannot POST exchange rates (403)", code, expected=403)

code, _ = api("POST", "/exchange-rates",
    {"from_currency": "GBP", "to_currency": "USD", "rate": 1.27},
    token=SELLER)
log("T17: Seller cannot POST exchange rates (403)", code, expected=403)


# ══════════════════════════════════════════════════════════════════════════════
print(SEP)
print("T18-T19 — Validation")
print(SEP)

code, _ = api("POST", "/exchange-rates",
    {"from_currency": "GBP", "to_currency": "USD", "rate": 0},
    token=ADMIN)
log("T18: Rate of 0 rejected (422)", code, expected=422)

code, _ = api("POST", "/exchange-rates",
    {"from_currency": "GBP"},
    token=ADMIN)
log("T19: Missing fields rejected (422)", code, expected=422)


# ══════════════════════════════════════════════════════════════════════════════
print(SEP)
passed = sum(1 for ok, _, _ in RESULTS if ok)
failed = sum(1 for ok, _, _ in RESULTS if not ok)
total  = len(RESULTS)
print(f"RESULTS:  {passed} passed  /  {failed} failed  /  {total} total")
print(SEP)

if failed:
    print("\nFailed tests:")
    for ok, label, code in RESULTS:
        if not ok:
            print(f"  [{code}] {label}")
