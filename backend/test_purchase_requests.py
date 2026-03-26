"""
Phase 7 — Purchase Request flow tests.
Run with: ./venv/Scripts/python test_purchase_requests.py

Covers:
  1. Buyer submits purchase request (KYC-gated)
  2. Admin lists / views requests
  3. Admin assigns buyer agent
  4. Agent views assigned request
  5. Agent submits due-diligence report
  6. Admin approves request
  7. Admin converts to DRAFT deal
  8. Buyer views request (sees status=converted, deal_id)
  9. Buyer cancels a fresh request
 10. RBAC guard: seller cannot submit purchase request
 11. RBAC guard: buyer cannot hit admin endpoints
 12. Duplicate active request is blocked (409)
"""
import urllib.request
import urllib.parse
import json
import os
from uuid import UUID

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
    if expected is not None:
        ok = code == expected
    else:
        ok = code < 400
    icon = "OK  " if ok else "FAIL"
    RESULTS.append((icon, code, label))
    print(f"  [{icon}] {code}  {label}")
    if not ok:
        note_str = note if isinstance(note, str) else json.dumps(note)[:200]
        print(f"         --> {note_str}")
    return ok


# ── Login ──────────────────────────────────────────────────────────────────────
print("=" * 60)
print("LOGIN")
print("=" * 60)

_TEST_PASS  = os.environ.get("TEST_USER_PASS", "")
_ADMIN_PASS = os.environ.get("TEST_ADMIN_PASS", "")
_, ar  = api("POST", "/auth/admin/login",  {"email": "admin@marinexchange.africa",  "password": _ADMIN_PASS})
_, br  = api("POST", "/auth/buyer/login",  {"email": "buyer1@gmail.com",            "password": _TEST_PASS})
_, sr  = api("POST", "/auth/seller/login", {"email": "seller1@gmail.com",           "password": _TEST_PASS})
_, agr = api("POST", "/auth/agent/login",  {"email": "agent1@marinexchange.africa", "password": _TEST_PASS})

ADMIN  = ar.get("access_token", "")
BUYER  = br.get("access_token", "")
SELLER = sr.get("access_token", "")
AGENT  = agr.get("access_token", "")   # verification_agent — used for RBAC guard only

print(f"  Admin  : {'OK' if ADMIN  else 'FAIL - ' + str(ar)}")
print(f"  Buyer  : {'OK' if BUYER  else 'FAIL - ' + str(br)}")
print(f"  Seller : {'OK' if SELLER else 'FAIL - ' + str(sr)}")
print(f"  Agent  : {'OK' if AGENT  else 'FAIL - ' + str(agr)}")

# ── Need a buyer_agent user ────────────────────────────────────────────────────
# The test expects a user with role 'buyer_agent' to exist.
# If your test DB doesn't have one yet, this section will gracefully skip agent tests.
_, bag = api("POST", "/auth/agent/login",  {"email": "buyer_agent1@marinexchange.africa", "password": _TEST_PASS})
BUYER_AGENT = bag.get("access_token", "")
print(f"  BuyerAgent: {'OK' if BUYER_AGENT else 'NOT FOUND (agent tests will be skipped)'}")


# ── Get a live product_id ──────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("SETUP — fetch a live product")
print("=" * 60)

_, catalog = api("GET", "/marketplace/catalog", params={"limit": 5})
products = catalog.get("items", [])
PRODUCT_ID = None
for p in products:
    if p.get("status") == "live":
        PRODUCT_ID = p["id"]
        print(f"  Using product: {PRODUCT_ID}  title={p.get('title', '')[:40]}")
        break

if not PRODUCT_ID and products:
    PRODUCT_ID = products[0]["id"]
    print(f"  No live product found — using: {PRODUCT_ID} (status={products[0].get('status')})")

if not PRODUCT_ID:
    print("  ERROR: No products in catalog. Cannot run tests.")


# ── Test 1: Buyer submits purchase request ─────────────────────────────────────
print("\n" + "=" * 60)
print("TEST 1: Buyer submits purchase request")
print("=" * 60)

PR_ID = None
if PRODUCT_ID and BUYER:
    code, r = api("POST", "/purchase-requests/", token=BUYER, data={
        "product_id":       PRODUCT_ID,
        "purchase_type":    "full_payment",
        "quantity":         1,
        "offered_price":    "500000.00",
        "offered_currency": "USD",
        "message":          "I am interested in acquiring this asset for our fleet.",
    })
    if log("POST /purchase-requests (buyer submits)", code, r.get("detail", "")):
        PR_ID = r["id"]
        print(f"    request_id={PR_ID}  status={r['status']}  purchase_type={r['purchase_type']}")
else:
    print("  SKIP — missing buyer token or product_id")


# ── Test 2: Duplicate request blocked ─────────────────────────────────────────
print("\n" + "=" * 60)
print("TEST 2: Duplicate active request blocked (expect 409)")
print("=" * 60)

if PRODUCT_ID and BUYER:
    code2, r2 = api("POST", "/purchase-requests/", token=BUYER, data={
        "product_id":    PRODUCT_ID,
        "purchase_type": "full_payment",
        "quantity":      1,
        "offered_price": "490000.00",
    })
    log("POST /purchase-requests (duplicate — expect 409)", code2, r2.get("detail", ""), expected=409)


# ── Test 3: Buyer lists my requests ───────────────────────────────────────────
print("\n" + "=" * 60)
print("TEST 3: Buyer lists my purchase requests")
print("=" * 60)

if BUYER:
    code, r = api("GET", "/purchase-requests/my", token=BUYER)
    if log("GET /purchase-requests/my", code, r.get("detail", "")):
        print(f"    total={r['total']}  items={[i['id'] for i in r['items'][:3]]}")


# ── Test 4: Buyer views one request ───────────────────────────────────────────
print("\n" + "=" * 60)
print("TEST 4: Buyer views one request")
print("=" * 60)

if BUYER and PR_ID:
    code, r = api("GET", f"/purchase-requests/{PR_ID}", token=BUYER)
    if log(f"GET /purchase-requests/{PR_ID}", code, r.get("detail", "")):
        print(f"    status={r['status']}  offered_price={r['offered_price']}")


# ── Test 5: Admin lists all requests ──────────────────────────────────────────
print("\n" + "=" * 60)
print("TEST 5: Admin lists all purchase requests")
print("=" * 60)

if ADMIN:
    code, r = api("GET", "/purchase-requests/admin", token=ADMIN)
    if log("GET /purchase-requests/admin", code, r.get("detail", "")):
        print(f"    total={r['total']}")
        if r["items"]:
            item = r["items"][0]
            print(f"    first: id={item['id']}  status={item['status']}  buyer={item.get('buyer_name')}")


# ── Test 6: Admin views one request (full detail) ─────────────────────────────
print("\n" + "=" * 60)
print("TEST 6: Admin views one request (full detail)")
print("=" * 60)

if ADMIN and PR_ID:
    code, r = api("GET", f"/purchase-requests/admin/{PR_ID}", token=ADMIN)
    if log(f"GET /purchase-requests/admin/{PR_ID}", code, r.get("detail", "")):
        print(f"    status={r['status']}  buyer_email={r.get('buyer_email')}  agent_assignment={r.get('agent_assignment')}")


# ── Test 7: Admin assigns buyer agent ─────────────────────────────────────────
print("\n" + "=" * 60)
print("TEST 7: Admin assigns buyer agent (skipped if no buyer_agent user)")
print("=" * 60)

if ADMIN and PR_ID and BUYER_AGENT:
    # Get buyer_agent user id
    _, me = api("GET", "/auth/me", token=BUYER_AGENT)
    BUYER_AGENT_ID = me.get("id")
    if BUYER_AGENT_ID:
        code, r = api("POST", f"/purchase-requests/admin/{PR_ID}/assign-agent", token=ADMIN, data={
            "agent_id": BUYER_AGENT_ID,
            "notes":    "Please conduct full financial and operational due diligence.",
        })
        if log(f"POST /purchase-requests/admin/{PR_ID}/assign-agent", code, r.get("detail", "")):
            print(f"    new_status={r['status']}  agent={r.get('agent_assignment', {}).get('agent_name')}")
    else:
        print("  SKIP — could not retrieve buyer_agent user id")
else:
    print("  SKIP — no buyer_agent token")


# ── Test 8: Buyer agent views assigned request ────────────────────────────────
print("\n" + "=" * 60)
print("TEST 8: Buyer agent views assigned requests")
print("=" * 60)

if BUYER_AGENT and PR_ID:
    code, r = api("GET", "/purchase-requests/agent/assigned", token=BUYER_AGENT)
    if log("GET /purchase-requests/agent/assigned", code, r.get("detail", "")):
        print(f"    total={r['total']}")

    code2, r2 = api("GET", f"/purchase-requests/agent/{PR_ID}", token=BUYER_AGENT)
    if log(f"GET /purchase-requests/agent/{PR_ID}", code2, r2.get("detail", "")):
        print(f"    status={r2['status']}  assignment_status={r2.get('assignment_status')}")
else:
    print("  SKIP — no buyer_agent token")


# ── Test 9: Buyer agent submits report ────────────────────────────────────────
print("\n" + "=" * 60)
print("TEST 9: Buyer agent submits due-diligence report")
print("=" * 60)

if BUYER_AGENT and PR_ID:
    code, r = api("POST", f"/purchase-requests/agent/{PR_ID}/report", token=BUYER_AGENT, data={
        "financial_capacity_usd": "750000.00",
        "risk_rating":            "low",
        "recommendation":         "recommend_approve",
        "verification_notes":     (
            "Buyer has demonstrated sufficient financial capacity through bank statements "
            "and corporate filings. No adverse findings on sanctions or PEP checks. "
            "Recommend approval."
        ),
    })
    if log(f"POST /purchase-requests/agent/{PR_ID}/report", code, r.get("detail", "")):
        print(f"    recommendation={r['recommendation']}  risk_rating={r['risk_rating']}")
        print(f"    financial_capacity_usd={r['financial_capacity_usd']}")
else:
    print("  SKIP — no buyer_agent token")


# ── Test 10: Admin approves request ───────────────────────────────────────────
print("\n" + "=" * 60)
print("TEST 10: Admin approves purchase request")
print("=" * 60)

if ADMIN and PR_ID:
    code, r = api("POST", f"/purchase-requests/admin/{PR_ID}/approve", token=ADMIN, data={
        "admin_notes": "Approved based on agent recommendation. Buyer profile satisfactory.",
    })
    if log(f"POST /purchase-requests/admin/{PR_ID}/approve", code, r.get("detail", "")):
        print(f"    new_status={r['status']}  reviewed_at={r.get('reviewed_at')}")


# ── Test 11: Admin converts to DRAFT deal ─────────────────────────────────────
print("\n" + "=" * 60)
print("TEST 11: Admin converts approved request to DRAFT deal")
print("=" * 60)

DEAL_ID = None
DEAL_REF = None
if ADMIN and PR_ID:
    code, r = api("POST", f"/purchase-requests/admin/{PR_ID}/convert", token=ADMIN, data={
        "deal_type":    "full_payment",
        "agreed_price": "480000.00",
        "currency":     "USD",
        "admin_notes":  "Price agreed at $480k. Full payment terms.",
    })
    if log(f"POST /purchase-requests/admin/{PR_ID}/convert", code, r.get("detail", "")):
        DEAL_ID  = r["deal_id"]
        DEAL_REF = r["deal_ref"]
        print(f"    deal_id={DEAL_ID}  deal_ref={DEAL_REF}  deal_status={r['deal_status']}")
        print(f"    message={r['message']}")


# ── Test 12: Buyer sees converted status + deal_id ────────────────────────────
print("\n" + "=" * 60)
print("TEST 12: Buyer sees converted status + deal_id")
print("=" * 60)

if BUYER and PR_ID:
    code, r = api("GET", f"/purchase-requests/{PR_ID}", token=BUYER)
    if log(f"GET /purchase-requests/{PR_ID} (post-convert)", code, r.get("detail", "")):
        print(f"    status={r['status']}  converted_deal_id={r.get('converted_deal_id')}")
        if r.get("converted_deal_id") and DEAL_ID:
            match = str(r["converted_deal_id"]) == str(DEAL_ID)
            print(f"    deal_id matches: {'YES' if match else 'NO — MISMATCH'}")


# ── Test 13: Submit a second request & cancel it ──────────────────────────────
print("\n" + "=" * 60)
print("TEST 13: Buyer submits + cancels a new request")
print("=" * 60)

PR2_ID = None
if PRODUCT_ID and BUYER:
    # Need a different product for this (existing one is now converted)
    _, catalog2 = api("GET", "/marketplace/catalog", params={"limit": 20})
    products2 = catalog2.get("items", [])
    PRODUCT2_ID = None
    for p in products2:
        if p.get("status") == "live" and p["id"] != PRODUCT_ID:
            PRODUCT2_ID = p["id"]
            break

    if PRODUCT2_ID:
        code, r = api("POST", "/purchase-requests/", token=BUYER, data={
            "product_id":    PRODUCT2_ID,
            "purchase_type": "financing",
            "quantity":      1,
            "offered_price": "200000.00",
        })
        if log("POST /purchase-requests (second request for cancel test)", code, r.get("detail", "")):
            PR2_ID = r["id"]
            print(f"    created: {PR2_ID}  status={r['status']}")

            code2, r2 = api("DELETE", f"/purchase-requests/{PR2_ID}", token=BUYER,
                            params={"reason": "Changed my mind — budget constraints."})
            if log(f"DELETE /purchase-requests/{PR2_ID} (cancel)", code2, r2.get("detail", "")):
                print(f"    new_status={r2['status']}  cancelled_reason={r2.get('cancelled_reason')}")
    else:
        print("  SKIP — no second live product available")


# ── RBAC Guards ───────────────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("RBAC GUARD TESTS  (expected codes shown)")
print("=" * 60)


def log_rbac(label, code, expected=403):
    ok = code == expected
    icon = "OK  " if ok else "FAIL"
    RESULTS.append((icon, code, label))
    print(f"  [{icon}] {code}  {label}")
    if not ok:
        print(f"         --> Expected {expected}, got {code}")
    return ok


# Seller cannot submit purchase request (no 'buyer' role)
if SELLER and PRODUCT_ID:
    code, r = api("POST", "/purchase-requests/", token=SELLER, data={
        "product_id":    PRODUCT_ID,
        "purchase_type": "full_payment",
        "quantity":      1,
        "offered_price": "100000.00",
    })
    log_rbac("POST /purchase-requests as SELLER (expect 403)", code)

# Buyer cannot access admin endpoints
if BUYER:
    code2, _ = api("GET", "/purchase-requests/admin", token=BUYER)
    log_rbac("GET /purchase-requests/admin as BUYER (expect 403)", code2)

# Verification agent cannot submit purchase request
if AGENT and PRODUCT_ID:
    code3, _ = api("POST", "/purchase-requests/", token=AGENT, data={
        "product_id":    PRODUCT_ID,
        "purchase_type": "full_payment",
        "quantity":      1,
        "offered_price": "100000.00",
    })
    log_rbac("POST /purchase-requests as VER_AGENT (expect 403)", code3)

# Unauthenticated request
code4, _ = api("GET", "/purchase-requests/my")
log_rbac("GET /purchase-requests/my unauthenticated (expect 401)", code4, expected=401)


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
    print(f"\n  Deal created: {DEAL_REF} (id={DEAL_ID})")
    print("  --> Go to the Deals module to configure terms and send the offer.")

if failed:
    print("\nFailed:")
    for icon, code, label in RESULTS:
        if icon == "FAIL":
            print(f"  [{code}] {label}")
