"""
Full marketplace endpoint test script.
Run with: ./venv/Scripts/python test_endpoints.py
"""
import urllib.request
import urllib.parse
import json
import os

BASE = os.environ.get("API_BASE_URL", "http://127.0.0.1:8000/api/v1")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SERVICE_KEY  = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

RESULTS = []

def log(label, code, body):
    ok = code < 400
    icon = "OK" if ok else "FAIL"
    RESULTS.append((icon, code, label, body))
    print(f"  [{icon}] {code} {label}")
    if not ok:
        print(f"       --> {body}")
    return ok, body

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
        return e.code, json.loads(e.read())

def supa_admin(path, data=None, method="GET"):
    h = {"apikey": SERVICE_KEY, "Authorization": "Bearer "+SERVICE_KEY, "Content-Type": "application/json"}
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(SUPABASE_URL+path, body, h, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())

# ─────────────────────────────────────────────────────────────────
# STEP 0: Login all users
# ─────────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("STEP 0: Logging in all users")
print("="*60)

_TEST_PASS  = os.environ.get("TEST_USER_PASS", "")
_ADMIN_PASS = os.environ.get("TEST_ADMIN_PASS", "")
_, admin_r   = api("POST", "/auth/admin/login",  {"email":"admin@marinexchange.africa","password":_ADMIN_PASS})
_, seller1_r = api("POST", "/auth/seller/login", {"email":"seller1@gmail.com","password":_TEST_PASS})
_, seller2_r = api("POST", "/auth/seller/login", {"email":"seller2@gmail.com","password":_TEST_PASS})
_, seller3_r = api("POST", "/auth/seller/login", {"email":"seller3@gmail.com","password":_TEST_PASS})
_, buyer1_r  = api("POST", "/auth/buyer/login",  {"email":"buyer1@gmail.com","password":_TEST_PASS})

ADMIN_TOKEN   = admin_r.get("access_token", "")
SELLER1_TOKEN = seller1_r.get("access_token", "")
SELLER2_TOKEN = seller2_r.get("access_token", "")
SELLER3_TOKEN = seller3_r.get("access_token", "")
BUYER1_TOKEN  = buyer1_r.get("access_token", "")
ADMIN_ID      = admin_r.get("user", {}).get("id", "")
SELLER1_ID    = seller1_r.get("user", {}).get("id", "")

for name, tok in [("admin", ADMIN_TOKEN), ("seller1", SELLER1_TOKEN),
                  ("seller2", SELLER2_TOKEN), ("seller3", SELLER3_TOKEN),
                  ("buyer1", BUYER1_TOKEN)]:
    print(f"  {name}: {'OK' if tok else 'FAIL'}")

# ─────────────────────────────────────────────────────────────────
# STEP 1: Create verification agent
# ─────────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("STEP 1: Create verification_agent1 via admin")
print("="*60)

code, r = api("POST", "/auth/internal/create-agent", {
    "email": "agent1@marinexchange.africa",
    "full_name": "Ibrahim Sule",
    "agent_type": "verification_agent",
    "phone": "+2348041234567",
    "country": "Nigeria",
}, token=ADMIN_TOKEN)
if code == 201:
    log("POST /auth/internal/create-agent", code, r)
    AGENT_ID = r.get("id", "")
else:
    print(f"  [NOTE] Agent already exists (HTTP {code}) — fetching existing agent")
    # Login to get agent ID from /me
    _, ar = api("POST", "/auth/agent/login", {"email":"agent1@marinexchange.africa","password":_TEST_PASS})
    AGENT_ID = ar.get("user", {}).get("id", "")
    if AGENT_ID:
        print(f"  [OK] Found existing agent: {AGENT_ID[:8]}")
    else:
        log("POST /auth/internal/create-agent", code, r)
        AGENT_ID = ""

# Reset agent password to known value via Supabase admin
if AGENT_ID:
    supa_admin(f"/auth/v1/admin/users/{AGENT_ID}", {"password": _TEST_PASS}, method="PUT")
    print(f"  Agent password reset via SUPABASE_SERVICE_ROLE_KEY")

# Login as agent
_, agent_r = api("POST", "/auth/agent/login", {"email":"agent1@marinexchange.africa","password":_TEST_PASS})
AGENT_TOKEN = agent_r.get("access_token", "")
print(f"  agent1 login: {'OK' if AGENT_TOKEN else 'FAIL - '+str(agent_r.get('detail'))}")

# ─────────────────────────────────────────────────────────────────
# STEP 2: Public catalog — categories, attributes, empty catalog
# ─────────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("STEP 2: Public catalog (no auth)")
print("="*60)

code, cats = api("GET", "/marketplace/categories")
log("GET /marketplace/categories", code, f"{len(cats)} categories")
CAT_ID = cats[0]["id"] if cats else None
SUB_CAT_ID = cats[0]["subcategories"][0]["id"] if cats and cats[0]["subcategories"] else CAT_ID

code, cat = api("GET", f"/marketplace/categories/{CAT_ID}")
log(f"GET /marketplace/categories/{CAT_ID[:8]}...", code, cat.get("name"))

code, attrs = api("GET", "/marketplace/attributes", params={"category_id": SUB_CAT_ID})
log("GET /marketplace/attributes", code, f"{len(attrs)} attributes")

code, catalog = api("GET", "/marketplace/catalog")
log("GET /marketplace/catalog (empty)", code, f"{catalog.get('total')} listings")

# ─────────────────────────────────────────────────────────────────
# STEP 3: Seller creates draft listing
# ─────────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("STEP 3: Seller creates draft listing")
print("="*60)

listing_payload = {
    "title": "2019 Offshore Support Vessel — MV Sea Eagle",
    "category_id": SUB_CAT_ID,
    "description": "Well-maintained 78m OSV, DP2, available for sale or time charter. Recently dry-docked.",
    "availability_type": "for_sale",
    "location_country": "Nigeria",
    "location_port": "Onne Port, Rivers State",
    "asking_price": "4500000.00",
    "currency": "USD",
    "contact": {
        "contact_name": "Alice Mensah",
        "phone": "+233201234567",
        "email": "seller1@gmail.com"
    }
}
code, listing = api("POST", "/marketplace/listings", listing_payload, token=SELLER1_TOKEN)
log("POST /marketplace/listings (create draft)", code, listing.get("id") or listing.get("detail"))
PRODUCT_ID = listing.get("id", "")

# Second listing by seller2
listing2_payload = {
    "title": "Drilling Rig — Semi-Submersible Unit",
    "category_id": cats[2]["subcategories"][0]["id"] if len(cats) > 2 and cats[2]["subcategories"] else SUB_CAT_ID,
    "description": "300ft semi-submersible drilling rig, 8th generation, full BOP stack included.",
    "availability_type": "hire",
    "location_country": "Nigeria",
    "location_port": "Apapa, Lagos",
    "asking_price": "12000000.00",
    "currency": "USD",
    "contact": {
        "contact_name": "Kwame Boateng",
        "phone": "+2348031234567",
        "email": "seller2@gmail.com"
    }
}
code2, listing2 = api("POST", "/marketplace/listings", listing2_payload, token=SELLER2_TOKEN)
log("POST /marketplace/listings (seller2 draft)", code2, listing2.get("id") or listing2.get("detail"))
PRODUCT2_ID = listing2.get("id", "")

# Third listing — time charter by seller3
listing3_payload = {
    "title": "Anchor Handling Tug — MV Atlantic Force",
    "category_id": cats[0]["subcategories"][2]["id"] if cats[0].get("subcategories") and len(cats[0]["subcategories"]) > 2 else SUB_CAT_ID,
    "description": "12,000 BHP AHTS with DP1, suitable for deepwater anchor-handling operations.",
    "availability_type": "time_charter",
    "location_country": "Ghana",
    "location_port": "Tema Port",
    "asking_price": "28000.00",
    "currency": "USD",
    "contact": {
        "contact_name": "Fatima Hassan",
        "phone": "+2348039876543",
        "email": "seller3@gmail.com"
    }
}
code3, listing3 = api("POST", "/marketplace/listings", listing3_payload, token=SELLER3_TOKEN)
log("POST /marketplace/listings (seller3 draft)", code3, listing3.get("id") or listing3.get("detail"))
PRODUCT3_ID = listing3.get("id", "")

# ─────────────────────────────────────────────────────────────────
# STEP 4: Update draft listing
# ─────────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("STEP 4: Update draft listing")
print("="*60)

code, updated = api("PUT", f"/marketplace/listings/{PRODUCT_ID}", {
    "description": "Well-maintained 78m OSV, DP2, available for sale. Recently dry-docked. 2024 survey completed.",
    "asking_price": "4250000.00",
    "location_details": "Currently berthed at Onne Port Terminal 3"
}, token=SELLER1_TOKEN)
log(f"PUT /marketplace/listings/{PRODUCT_ID[:8]}...", code, updated.get("status") or updated.get("detail"))

# ─────────────────────────────────────────────────────────────────
# STEP 5: List own listings
# ─────────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("STEP 5: List own listings")
print("="*60)

code, listings = api("GET", "/marketplace/listings", token=SELLER1_TOKEN)
log("GET /marketplace/listings (seller1)", code, f"{listings.get('total')} listings")

# ─────────────────────────────────────────────────────────────────
# STEP 6: Get own listing detail
# ─────────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("STEP 6: Get own listing detail")
print("="*60)

code, detail = api("GET", f"/marketplace/listings/{PRODUCT_ID}", token=SELLER1_TOKEN)
log(f"GET /marketplace/listings/{PRODUCT_ID[:8]}...", code, f"status={detail.get('status')} price={detail.get('asking_price')}")

# ─────────────────────────────────────────────────────────────────
# STEP 7: Upload image (create a tiny test PNG inline)
# ─────────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("STEP 7: Upload product image")
print("="*60)

# Minimal 1x1 white PNG (67 bytes)
import base64
PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg=="
png_bytes = base64.b64decode(PNG_B64)

boundary = "----MarineXchangeBoundary"
body_parts = (
    f"--{boundary}\r\n"
    f'Content-Disposition: form-data; name="file"; filename="test_vessel.png"\r\n'
    f"Content-Type: image/png\r\n\r\n"
).encode() + png_bytes + f"\r\n--{boundary}--\r\n".encode()

upload_req = urllib.request.Request(
    f"{BASE}/marketplace/listings/{PRODUCT_ID}/images",
    body_parts,
    {
        "Authorization": "Bearer " + SELLER1_TOKEN,
        "Content-Type": f"multipart/form-data; boundary={boundary}",
    },
    method="POST"
)
try:
    with urllib.request.urlopen(upload_req) as r:
        img_resp = json.loads(r.read())
        log("POST /marketplace/listings/{id}/images", r.status, f"image_id={img_resp.get('id','')[:8]}...")
        IMAGE_ID = img_resp.get("id", "")
except urllib.error.HTTPError as e:
    resp = json.loads(e.read())
    log("POST /marketplace/listings/{id}/images", e.code, resp)
    IMAGE_ID = ""

# Upload a second image for the other listings too (needed for submit)
for prod_id, tok in [(PRODUCT2_ID, SELLER2_TOKEN), (PRODUCT3_ID, SELLER3_TOKEN)]:
    if not prod_id:
        continue
    upload_req2 = urllib.request.Request(
        f"{BASE}/marketplace/listings/{prod_id}/images",
        body_parts,
        {"Authorization": "Bearer " + tok, "Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(upload_req2) as r:
            ir = json.loads(r.read())
            print(f"  Image upload for {prod_id[:8]}: OK")
    except urllib.error.HTTPError as e:
        print(f"  Image upload for {prod_id[:8]}: FAIL {e.code}")

# ─────────────────────────────────────────────────────────────────
# STEP 8: Set primary image
# ─────────────────────────────────────────────────────────────────
if IMAGE_ID:
    print("\n" + "="*60)
    print("STEP 8: Set primary image")
    print("="*60)
    code, r = api("PATCH", f"/marketplace/listings/{PRODUCT_ID}/images/{IMAGE_ID}/primary", token=SELLER1_TOKEN)
    log(f"PATCH /listings/{PRODUCT_ID[:8]}.../images/.../primary", code, r.get("message") or r.get("detail"))

# ─────────────────────────────────────────────────────────────────
# STEP 9: Submit listing for verification
# ─────────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("STEP 9: Submit listing for verification")
print("="*60)

code, r = api("POST", f"/marketplace/listings/{PRODUCT_ID}/submit", token=SELLER1_TOKEN)
log(f"POST /listings/{PRODUCT_ID[:8]}.../submit", code, r.get("new_status") or r.get("detail"))

code2, r2 = api("POST", f"/marketplace/listings/{PRODUCT2_ID}/submit", token=SELLER2_TOKEN)
log(f"POST /listings/{PRODUCT2_ID[:8] if PRODUCT2_ID else 'N/A'}.../submit (seller2)", code2, r2.get("new_status") or r2.get("detail"))

# ─────────────────────────────────────────────────────────────────
# STEP 10: Admin — list all products (pending_verification)
# ─────────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("STEP 10: Admin views pending_verification listings")
print("="*60)

code, r = api("GET", "/marketplace/admin/products/pending-verification", token=ADMIN_TOKEN)
log("GET /admin/products/pending-verification", code, f"{r.get('total')} items")

code, r = api("GET", "/marketplace/admin/products", token=ADMIN_TOKEN, params={"page":1})
log("GET /admin/products (all)", code, f"{r.get('total')} items")

# ─────────────────────────────────────────────────────────────────
# STEP 11: Admin assigns verification agent
# ─────────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("STEP 11: Admin assigns agent to listing")
print("="*60)

if AGENT_ID and PRODUCT_ID:
    code, r = api("POST", f"/marketplace/admin/products/{PRODUCT_ID}/assign-agent",
                  {"agent_id": AGENT_ID}, token=ADMIN_TOKEN)
    log(f"POST /admin/products/{PRODUCT_ID[:8]}.../assign-agent", code, r.get("status") or r.get("detail"))
    ASSIGNMENT_ID = r.get("id", "")
else:
    print("  SKIPPED (no agent or product)")
    ASSIGNMENT_ID = ""

# ─────────────────────────────────────────────────────────────────
# STEP 12: Agent views assignments
# ─────────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("STEP 12: Agent views their assignments")
print("="*60)

if AGENT_TOKEN:
    code, r = api("GET", "/marketplace/verification/assignments", token=AGENT_TOKEN)
    log("GET /verification/assignments", code, f"{r.get('total', len(r.get('items',[])) if isinstance(r, dict) else 0)} assignments")

    if ASSIGNMENT_ID:
        code2, r2 = api("GET", f"/marketplace/verification/assignments/{ASSIGNMENT_ID}", token=AGENT_TOKEN)
        log(f"GET /verification/assignments/{ASSIGNMENT_ID[:8]}...", code2, r2.get("status") or r2.get("detail"))

# ─────────────────────────────────────────────────────────────────
# STEP 13: Agent updates assignment progress
# ─────────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("STEP 13: Agent updates assignment progress")
print("="*60)

if AGENT_TOKEN and ASSIGNMENT_ID:
    code, r = api("PATCH", f"/marketplace/verification/assignments/{ASSIGNMENT_ID}",
                  {"status": "contacted", "contact_notes": "Spoke to seller, inspection scheduled for Monday."},
                  token=AGENT_TOKEN)
    log(f"PATCH /verification/assignments/{ASSIGNMENT_ID[:8]}...", code, r.get("status") or r.get("detail"))

    code2, r2 = api("PATCH", f"/marketplace/verification/assignments/{ASSIGNMENT_ID}",
                    {"status": "inspection_scheduled", "scheduled_date": "2026-03-20"},
                    token=AGENT_TOKEN)
    log(f"PATCH status=inspection_scheduled", code2, r2.get("status") or r2.get("detail"))

    code3, r3 = api("PATCH", f"/marketplace/verification/assignments/{ASSIGNMENT_ID}",
                    {"status": "inspection_done"},
                    token=AGENT_TOKEN)
    log(f"PATCH status=inspection_done", code3, r3.get("status") or r3.get("detail"))

# ─────────────────────────────────────────────────────────────────
# STEP 14: Agent submits verification report
# ─────────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("STEP 14: Agent submits verification report")
print("="*60)

if AGENT_TOKEN and ASSIGNMENT_ID:
    code, r = api("POST", f"/marketplace/verification/assignments/{ASSIGNMENT_ID}/report", {
        "outcome": "verified",
        "findings": "Physical inspection completed. Vessel is in good condition matching description. All documentation valid. No structural damage observed.",
        "asset_condition": "Good — minor surface rust on starboard side, otherwise excellent.",
        "recommendations": "Recommend approval. Seller to provide updated classification certificate before deal closure.",
    }, token=AGENT_TOKEN)
    log(f"POST /verification/assignments/{ASSIGNMENT_ID[:8]}.../report", code, r.get("outcome") or r.get("new_product_status") or r.get("detail"))

# ─────────────────────────────────────────────────────────────────
# STEP 15: Admin reviews pending_approval
# ─────────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("STEP 15: Admin reviews pending_approval listings")
print("="*60)

code, r = api("GET", "/marketplace/admin/products/pending-approval", token=ADMIN_TOKEN)
log("GET /admin/products/pending-approval", code, f"{r.get('total')} items")

# ─────────────────────────────────────────────────────────────────
# STEP 16: Admin approves listing
# ─────────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("STEP 16: Admin approves listing")
print("="*60)

if PRODUCT_ID:
    code, r = api("POST", f"/marketplace/admin/products/{PRODUCT_ID}/decide",
                  {"decision": "approve", "reason": "All verification checks passed. Asset is genuine."},
                  token=ADMIN_TOKEN)
    log(f"POST /admin/products/{PRODUCT_ID[:8]}.../decide (approve)", code, r.get("new_status") or r.get("detail"))

# Reject listing 2
if PRODUCT2_ID:
    # First need to assign agent and go through flow for product2, OR just test reject on pending
    # For simplicity, test a request_corrections decision on product3 (if submitted)
    if PRODUCT3_ID:
        # Submit product3 first
        api("POST", f"/marketplace/listings/{PRODUCT3_ID}/submit", token=SELLER3_TOKEN)
        if AGENT_ID:
            code_a, r_a = api("POST", f"/marketplace/admin/products/{PRODUCT3_ID}/assign-agent",
                              {"agent_id": AGENT_ID}, token=ADMIN_TOKEN)
            if code_a < 400:
                assign3_id = r_a.get("id", "")
                # Quick report
                api("PATCH", f"/marketplace/verification/assignments/{assign3_id}",
                    {"status": "inspection_done"}, token=AGENT_TOKEN)
                api("POST", f"/marketplace/verification/assignments/{assign3_id}/report", {
                    "outcome": "verified",
                    "findings": "Inspection completed. AHTS in working condition but minor maintenance needed.",
                }, token=AGENT_TOKEN)
                # Admin rejects
                code_d, r_d = api("POST", f"/marketplace/admin/products/{PRODUCT3_ID}/decide",
                                  {"decision": "reject", "reason": "Asking price significantly above market rate. Seller to revise."},
                                  token=ADMIN_TOKEN)
                log(f"POST /admin/products/{PRODUCT3_ID[:8]}.../decide (reject)", code_d, r_d.get("new_status") or r_d.get("detail"))

# ─────────────────────────────────────────────────────────────────
# STEP 17: Public catalog now shows approved listing
# ─────────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("STEP 17: Public catalog after approval")
print("="*60)

code, catalog = api("GET", "/marketplace/catalog")
log("GET /marketplace/catalog (should have 1 listing)", code, f"{catalog.get('total')} active listings")

if PRODUCT_ID:
    code2, detail = api("GET", f"/marketplace/catalog/{PRODUCT_ID}")
    log(f"GET /marketplace/catalog/{PRODUCT_ID[:8]}... (public detail)", code2,
        f"status={detail.get('status')} contact_hidden={detail.get('contact') is None}")

# ─────────────────────────────────────────────────────────────────
# STEP 18: Catalog search & filters
# ─────────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("STEP 18: Catalog search & filters")
print("="*60)

code, r = api("GET", "/marketplace/catalog", params={"search": "vessel"})
log("GET /marketplace/catalog?search=vessel", code, f"{r.get('total')} results")

code2, r2 = api("GET", "/marketplace/catalog", params={"location_country": "Nigeria"})
log("GET /marketplace/catalog?location_country=Nigeria", code2, f"{r2.get('total')} results")

code3, r3 = api("GET", "/marketplace/catalog", params={"availability_type": "for_sale"})
log("GET /marketplace/catalog?availability_type=for_sale", code3, f"{r3.get('total')} results")

# ─────────────────────────────────────────────────────────────────
# STEP 19: Admin admin edit + delist
# ─────────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("STEP 19: Admin edits active listing")
print("="*60)

if PRODUCT_ID:
    code, r = api("PUT", f"/marketplace/admin/products/{PRODUCT_ID}", {
        "asking_price": "4100000.00",
        "location_details": "Updated: Berthed at Onne Terminal 3, available for inspection"
    }, token=ADMIN_TOKEN)
    log(f"PUT /admin/products/{PRODUCT_ID[:8]}... (edit)", code, f"price={r.get('asking_price') or r.get('detail')}")

# ─────────────────────────────────────────────────────────────────
# STEP 20: Seller resubmit rejected listing
# ─────────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("STEP 20: Seller resubmits rejected listing")
print("="*60)

if PRODUCT3_ID:
    code, r = api("POST", f"/marketplace/listings/{PRODUCT3_ID}/resubmit", token=SELLER3_TOKEN)
    log(f"POST /listings/{PRODUCT3_ID[:8]}.../resubmit", code, r.get("new_status") or r.get("detail"))

# ─────────────────────────────────────────────────────────────────
# STEP 21: Delete draft listing
# ─────────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("STEP 21: Delete draft listing (seller2 listing)")
print("="*60)

# Create a fresh draft to delete
code_d, draft = api("POST", "/marketplace/listings", {
    "title": "Test Draft To Delete",
    "category_id": SUB_CAT_ID,
    "availability_type": "for_sale",
    "location_country": "Ghana",
    "asking_price": "100000.00",
    "currency": "USD",
    "contact": {"contact_name": "Test", "phone": "+233200000000", "email": "seller1@gmail.com"}
}, token=SELLER1_TOKEN)
DRAFT_ID = draft.get("id", "")

if DRAFT_ID:
    code_del, r_del = api("DELETE", f"/marketplace/listings/{DRAFT_ID}", token=SELLER1_TOKEN)
    log(f"DELETE /marketplace/listings/{DRAFT_ID[:8]}...", code_del, r_del.get("message") or r_del.get("detail"))

# ─────────────────────────────────────────────────────────────────
# STEP 22: /me endpoints
# ─────────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("STEP 22: Auth /me endpoints")
print("="*60)

code, r = api("GET", "/auth/me", token=SELLER1_TOKEN)
log("GET /auth/me (seller1)", code, f"roles={r.get('roles')}")

code2, r2 = api("GET", "/auth/me/roles", token=SELLER1_TOKEN)
log("GET /auth/me/roles (seller1)", code2, str(r2))

code3, r3 = api("GET", "/auth/me", token=BUYER1_TOKEN)
log("GET /auth/me (buyer1)", code3, f"kyc_status={r3.get('kyc_status')}")

# ─────────────────────────────────────────────────────────────────
# FINAL SUMMARY
# ─────────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("FINAL SUMMARY")
print("="*60)
passed = sum(1 for r in RESULTS if r[0] == "OK")
failed = sum(1 for r in RESULTS if r[0] == "FAIL")
print(f"  PASSED: {passed}")
print(f"  FAILED: {failed}")
print(f"  TOTAL:  {len(RESULTS)}")

if failed:
    print("\nFailed endpoints:")
    for icon, code, label, body in RESULTS:
        if icon == "FAIL":
            print(f"  [{code}] {label}")
            print(f"         {body}")

print("\nKey IDs for manual testing:")
print(f"  Admin email:   admin@marinexchange.africa  (pass: $TEST_ADMIN_PASS)")
print(f"  Sellers:       seller1/2/3@gmail.com       (pass: $TEST_USER_PASS)")
print(f"  Buyers:        buyer1/2/3@gmail.com        (pass: $TEST_USER_PASS)")
print(f"  Agent:         agent1@marinexchange.africa (pass: $TEST_USER_PASS)")
print(f"  Active product ID:  {PRODUCT_ID}")
print(f"  Category ID (OSV):  {SUB_CAT_ID}")
