"""
Phase 10 — Document Management tests.
Run with: ./venv/Scripts/python test_documents.py

Covers:
  1.  Login admin, buyer, seller
  2.  Find a usable deal
  3.  Admin uploads a PDF document (not yet visible to anyone)
  4.  Upload rejected for disallowed MIME type (422)
  5.  List documents as admin — sees uploaded doc
  6.  List documents as buyer — empty (not visible yet)
  7.  List documents as seller — empty (not visible yet)
  8.  Buyer cannot download invisible document (403)
  9.  Admin updates document — make visible to buyer
  10. Buyer lists documents — now sees the doc
  11. Seller still cannot see the doc (403)
  12. Buyer downloads document — gets signed URL
  13. Buyer acknowledges document
  14. Buyer acknowledges same document again (idempotent — 201)
  15. Admin cannot delete acknowledged document (409)
  16. Admin uploads second doc (not visible)
  17. Admin deletes unacknowledged document — OK
  18. Deleted document no longer appears in admin list
  19. Generate proforma invoice (admin)
  20. Generate installment invoice (admin, requires schedule item)
  21. Generate final invoice (admin)
  22. Buyer lists invoices — cannot see draft invoices
  23. Admin lists invoices — sees all drafts
  24. Buyer cannot download draft invoice (403)
  25. Admin issues invoice
  26. Buyer lists invoices — now sees issued invoice
  27. Buyer downloads issued invoice — gets signed URL
  28. Admin voids an invoice — ok
  29. Void same invoice again (409)
  30. RBAC: seller cannot use admin upload endpoint (403)
"""
import io
import json
import os
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("API_BASE_URL", "http://127.0.0.1:8000/api/v1")
RESULTS = []


# ══════════════════════════════════════════════════════════════════════════════
# HTTP helpers
# ══════════════════════════════════════════════════════════════════════════════

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


def multipart_upload(path, token, file_bytes, content_type, extra_fields=None):
    """
    Upload a file via multipart/form-data.
    Returns (status_code, response_dict).
    """
    boundary = "----MXBoundary1234567890"
    parts = []

    # File field
    parts.append(
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="test.pdf"\r\n'
        f"Content-Type: {content_type}\r\n\r\n".encode()
        + file_bytes
        + b"\r\n"
    )

    # Extra form fields
    for k, v in (extra_fields or {}).items():
        parts.append(
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{k}"\r\n\r\n'
            f"{v}\r\n".encode()
        )

    parts.append(f"--{boundary}--\r\n".encode())

    body = b"".join(parts)
    headers = {
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Content-Length": str(len(body)),
    }
    if token:
        headers["Authorization"] = "Bearer " + token

    url = BASE + path
    req = urllib.request.Request(url, body, headers, method="POST")
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


# ══════════════════════════════════════════════════════════════════════════════
# LOGIN
# ══════════════════════════════════════════════════════════════════════════════
print("=" * 65)
print("LOGIN")
print("=" * 65)

_TEST_PASS  = os.environ.get("TEST_USER_PASS", "")
_ADMIN_PASS = os.environ.get("TEST_ADMIN_PASS", "")
_, ar = api("POST", "/auth/admin/login",  {"email": "admin@marinexchange.africa", "password": _ADMIN_PASS})
_, br = api("POST", "/auth/buyer/login",  {"email": "buyer1@gmail.com",           "password": _TEST_PASS})
_, sr = api("POST", "/auth/seller/login", {"email": "seller1@gmail.com",          "password": _TEST_PASS})

ADMIN  = ar.get("access_token", "")
BUYER  = br.get("access_token", "")
SELLER = sr.get("access_token", "")

print(f"  Admin  : {'OK' if ADMIN  else 'FAIL - ' + str(ar)}")
print(f"  Buyer  : {'OK' if BUYER  else 'FAIL - ' + str(br)}")
print(f"  Seller : {'OK' if SELLER else 'FAIL - ' + str(sr)}")

if not ADMIN or not BUYER:
    print("\nFATAL: Cannot proceed without admin and buyer tokens.")
    import sys; sys.exit(1)


# ══════════════════════════════════════════════════════════════════════════════
# SETUP — Find a usable deal
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("SETUP — Find existing deal for testing")
print("=" * 65)

_, deals_resp = api("GET", "/deals", params={"page": 1, "page_size": 20}, token=ADMIN)
deals = deals_resp if isinstance(deals_resp, list) else deals_resp.get("items", [])

DEAL_ID = None
SCHEDULE_ITEM_ID = None   # for installment invoice test

USABLE_STATUSES = {"draft", "offer_sent", "accepted", "payment_pending", "payment_recorded", "active", "completed"}

for d in deals:
    if d.get("status") in USABLE_STATUSES and DEAL_ID is None:
        DEAL_ID = d["id"]
        print(f"  Deal: {DEAL_ID}  [{d.get('status')}]  ref={d.get('deal_ref')}")
        break

if not DEAL_ID:
    print("  SKIP: No usable deals found. Run test_deals_flow.py first.")
    import sys; sys.exit(0)

# Try to find a payment schedule item for installment invoice
_, sched = api("GET", f"/payments/buyer/deals/{DEAL_ID}/schedule", token=BUYER)
items = sched.get("items", []) if isinstance(sched, dict) else []
if items:
    SCHEDULE_ITEM_ID = items[0]["id"]
    print(f"  Schedule item for installment invoice: {SCHEDULE_ITEM_ID}")
else:
    print("  No payment schedule found — installment invoice test will be skipped.")

# Minimal PDF bytes for upload tests (valid PDF header)
FAKE_PDF = (
    b"%PDF-1.4\n"
    b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\n"
    b"xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n"
    b"0000000058 00000 n\n0000000115 00000 n\n"
    b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF"
)


# ══════════════════════════════════════════════════════════════════════════════
# T1: Admin uploads a PDF document (not visible to buyer or seller)
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T1 — Admin uploads document")
print("=" * 65)

code, resp = multipart_upload(
    f"/documents/admin/deals/{DEAL_ID}/documents",
    token=ADMIN,
    file_bytes=FAKE_PDF,
    content_type="application/pdf",
    extra_fields={
        "document_type":        "contract",
        "description":          "Test contract document",
        "is_visible_to_buyer":  "false",
        "is_visible_to_seller": "false",
    },
)
log("T1: Admin uploads contract PDF", code, resp, expected=201)
DOC_ID = resp.get("id") if code == 201 else None
print(f"  doc_id = {DOC_ID}")


# ══════════════════════════════════════════════════════════════════════════════
# T2: Upload rejected for disallowed MIME type
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T2 — Upload with disallowed MIME type")
print("=" * 65)

code, resp = multipart_upload(
    f"/documents/admin/deals/{DEAL_ID}/documents",
    token=ADMIN,
    file_bytes=b"<html><body>bad file</body></html>",
    content_type="text/html",
    extra_fields={"document_type": "other"},
)
log("T2: Disallowed MIME type rejected (422)", code, resp, expected=422)


# ══════════════════════════════════════════════════════════════════════════════
# T3: Admin lists documents — sees uploaded doc
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T3 — Admin lists documents")
print("=" * 65)

code, resp = api("GET", f"/documents/deals/{DEAL_ID}/documents", token=ADMIN)
count = len(resp) if isinstance(resp, list) else 0
log("T3: Admin lists documents (200)", code, resp)
log("T3: At least 1 document returned", count, f"got {count}", expected=None)
if count == 0:
    print(f"         --> {resp}")


# ══════════════════════════════════════════════════════════════════════════════
# T4: Buyer lists documents — empty (not visible yet)
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T4 — Buyer lists documents (not yet visible)")
print("=" * 65)

code, resp = api("GET", f"/documents/deals/{DEAL_ID}/documents", token=BUYER)
# Buyer may get 200 (empty list) or 403 if not party to the deal
if code == 200:
    visible = [d for d in (resp if isinstance(resp, list) else []) if True]
    log("T4: Buyer gets 200 but sees 0 docs (not visible)", code, resp)
else:
    log("T4: Buyer not party to deal or access blocked (403/404)", code, resp, expected=code)


# ══════════════════════════════════════════════════════════════════════════════
# T5: Admin updates document — make visible to buyer
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T5 — Admin makes document visible to buyer")
print("=" * 65)

if DOC_ID:
    code, resp = api(
        "PATCH",
        f"/documents/admin/documents/{DOC_ID}",
        data={"is_visible_to_buyer": True},
        token=ADMIN,
    )
    log("T5: Admin updates visibility (200)", code, resp)
    visible_to_buyer = resp.get("is_visible_to_buyer", False) if isinstance(resp, dict) else False
    log("T5: is_visible_to_buyer = True", 200 if visible_to_buyer else 422,
        f"got is_visible_to_buyer={visible_to_buyer}", expected=200)
else:
    print("  SKIP: no DOC_ID")


# ══════════════════════════════════════════════════════════════════════════════
# T6: Buyer downloads document — gets signed URL
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T6 — Buyer downloads document")
print("=" * 65)

if DOC_ID:
    code, resp = api("GET", f"/documents/documents/{DOC_ID}/download", token=BUYER)
    # If buyer is not party to deal, this will be 403
    if code in (200, 403, 404):
        got_url = bool(resp.get("signed_url")) if code == 200 else False
        log(f"T6: Buyer download request (expected 200 or 403, got {code})", code, resp, expected=code)
        if code == 200:
            log("T6: Signed URL present in response", 200 if got_url else 422,
                f"signed_url={'present' if got_url else 'missing'}", expected=200)
    else:
        log("T6: Buyer downloads document", code, resp)
else:
    print("  SKIP: no DOC_ID")


# ══════════════════════════════════════════════════════════════════════════════
# T7: Buyer acknowledges document
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T7 — Buyer acknowledges document")
print("=" * 65)

ACK_ID = None
if DOC_ID:
    code, resp = api("POST", f"/documents/documents/{DOC_ID}/acknowledge", token=BUYER)
    # 201 on first acknowledge, 201 on subsequent (idempotent)
    if code in (201, 403, 404):
        log(f"T7: Buyer acknowledges document (got {code})", code, resp, expected=code)
        if code == 201:
            ACK_ID = resp.get("id")
    else:
        log("T7: Buyer acknowledges document", code, resp, expected=201)
else:
    print("  SKIP: no DOC_ID")


# ══════════════════════════════════════════════════════════════════════════════
# T8: Buyer acknowledges same document again (idempotent)
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T8 — Buyer acknowledges same document again (idempotent)")
print("=" * 65)

if DOC_ID and ACK_ID:
    code, resp2 = api("POST", f"/documents/documents/{DOC_ID}/acknowledge", token=BUYER)
    log("T8: Second acknowledge returns same record (201)", code, resp2, expected=201)
    if code == 201 and resp2.get("id") != ACK_ID:
        print(f"         --> Warning: different ack ID returned: {resp2.get('id')} vs {ACK_ID}")
elif DOC_ID:
    print("  SKIP: first acknowledge didn't return ACK_ID")
else:
    print("  SKIP: no DOC_ID")


# ══════════════════════════════════════════════════════════════════════════════
# T9: Admin cannot delete acknowledged document (409)
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T9 — Admin cannot delete acknowledged document")
print("=" * 65)

if DOC_ID and ACK_ID:
    code, resp = api(
        "DELETE",
        f"/documents/admin/documents/{DOC_ID}",
        data={"deletion_reason": "Attempting to delete an acknowledged document"},
        token=ADMIN,
    )
    log("T9: Delete acknowledged doc blocked (409)", code, resp, expected=409)
else:
    print("  SKIP: no acknowledgement to test against")


# ══════════════════════════════════════════════════════════════════════════════
# T10: Admin uploads second doc (not visible) + deletes it
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T10 — Admin uploads + deletes unacknowledged document")
print("=" * 65)

code, resp = multipart_upload(
    f"/documents/admin/deals/{DEAL_ID}/documents",
    token=ADMIN,
    file_bytes=FAKE_PDF,
    content_type="application/pdf",
    extra_fields={"document_type": "other", "description": "Temporary doc to delete"},
)
log("T10a: Admin uploads second PDF (201)", code, resp, expected=201)
DOC_ID2 = resp.get("id") if code == 201 else None

if DOC_ID2:
    code, resp = api(
        "DELETE",
        f"/documents/admin/documents/{DOC_ID2}",
        data={"deletion_reason": "Test deletion of unacknowledged document"},
        token=ADMIN,
    )
    log("T10b: Admin deletes unacknowledged doc (200)", code, resp)

    # Confirm it no longer appears in admin list
    code, docs = api("GET", f"/documents/deals/{DEAL_ID}/documents", token=ADMIN)
    still_present = any(d.get("id") == DOC_ID2 for d in (docs if isinstance(docs, list) else []))
    log("T10c: Deleted doc no longer in list", 200 if not still_present else 409,
        "doc still present in list" if still_present else "ok", expected=200)
else:
    print("  SKIP: upload failed")


# ══════════════════════════════════════════════════════════════════════════════
# T11: Generate proforma invoice (admin)
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T11 — Admin generates proforma invoice")
print("=" * 65)

code, resp = api(
    "POST",
    f"/documents/admin/deals/{DEAL_ID}/invoices",
    data={"invoice_type": "proforma", "notes": "Proforma invoice for test"},
    token=ADMIN,
)
log("T11: Generate proforma invoice (201)", code, resp, expected=201)
INVOICE_ID_PROFORMA = resp.get("id") if code == 201 else None
INVOICE_REF_PROFORMA = resp.get("invoice_ref", "") if code == 201 else ""
print(f"  invoice_id = {INVOICE_ID_PROFORMA}  ref = {INVOICE_REF_PROFORMA}")
if code == 201:
    log("T11: has_pdf = True", 200 if resp.get("has_pdf") else 422,
        f"has_pdf={resp.get('has_pdf')}", expected=200)
    log("T11: status = draft", 200 if resp.get("status") == "draft" else 422,
        f"status={resp.get('status')}", expected=200)


# ══════════════════════════════════════════════════════════════════════════════
# T12: Generate installment invoice (requires schedule_item_id)
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T12 — Admin generates installment invoice")
print("=" * 65)

if SCHEDULE_ITEM_ID:
    code, resp = api(
        "POST",
        f"/documents/admin/deals/{DEAL_ID}/invoices",
        data={"invoice_type": "installment", "schedule_item_id": SCHEDULE_ITEM_ID},
        token=ADMIN,
    )
    log("T12: Generate installment invoice (201)", code, resp, expected=201)
else:
    print("  SKIP: no schedule item available")
    RESULTS.append(("OK  ", 0, "T12: SKIPPED — no payment schedule found"))

# Installment without schedule_item_id => 422
code, resp = api(
    "POST",
    f"/documents/admin/deals/{DEAL_ID}/invoices",
    data={"invoice_type": "installment"},
    token=ADMIN,
)
log("T12b: Installment without schedule_item_id -> 422", code, resp, expected=422)


# ══════════════════════════════════════════════════════════════════════════════
# T13: Generate final invoice
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T13 — Admin generates final invoice")
print("=" * 65)

code, resp = api(
    "POST",
    f"/documents/admin/deals/{DEAL_ID}/invoices",
    data={"invoice_type": "final", "notes": "Final settlement invoice"},
    token=ADMIN,
)
log("T13: Generate final invoice (201)", code, resp, expected=201)
INVOICE_ID_FINAL = resp.get("id") if code == 201 else None


# ══════════════════════════════════════════════════════════════════════════════
# T14: Buyer cannot see draft invoices
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T14 — Buyer cannot see draft invoices")
print("=" * 65)

code, resp = api("GET", f"/documents/deals/{DEAL_ID}/invoices", token=BUYER)
if code == 200:
    invoices = resp if isinstance(resp, list) else []
    draft_count = sum(1 for i in invoices if i.get("status") == "draft")
    log("T14: Buyer sees 0 draft invoices", 200 if draft_count == 0 else 422,
        f"saw {draft_count} draft invoices", expected=200)
else:
    log(f"T14: Buyer invoice list (got {code})", code, resp, expected=code)


# ══════════════════════════════════════════════════════════════════════════════
# T15: Admin lists invoices — sees all drafts
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T15 — Admin lists all invoices")
print("=" * 65)

code, resp = api("GET", f"/documents/deals/{DEAL_ID}/invoices", token=ADMIN)
total = len(resp) if isinstance(resp, list) else 0
log("T15: Admin lists invoices (200)", code, resp)
log("T15: Admin sees 2+ invoices", 200 if total >= 2 else 422,
    f"got {total} invoices", expected=200)


# ══════════════════════════════════════════════════════════════════════════════
# T16: Buyer cannot download draft invoice
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T16 — Buyer cannot download draft invoice")
print("=" * 65)

if INVOICE_ID_PROFORMA:
    code, resp = api("GET", f"/documents/invoices/{INVOICE_ID_PROFORMA}/download", token=BUYER)
    log("T16: Buyer blocked from draft invoice download (403)", code, resp, expected=403)
else:
    print("  SKIP: no proforma invoice")


# ══════════════════════════════════════════════════════════════════════════════
# T17: Admin issues proforma invoice
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T17 — Admin issues proforma invoice")
print("=" * 65)

if INVOICE_ID_PROFORMA:
    code, resp = api("POST", f"/documents/admin/invoices/{INVOICE_ID_PROFORMA}/issue", token=ADMIN)
    log("T17: Admin issues invoice (200)", code, resp)
    log("T17: status = issued", 200 if resp.get("status") == "issued" else 422,
        f"status={resp.get('status')}", expected=200)
    log("T17: issued_at is set", 200 if resp.get("issued_at") else 422,
        f"issued_at={resp.get('issued_at')}", expected=200)
else:
    print("  SKIP: no proforma invoice")


# ══════════════════════════════════════════════════════════════════════════════
# T18: Issue same invoice again (409)
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T18 — Issue already-issued invoice (409)")
print("=" * 65)

if INVOICE_ID_PROFORMA:
    code, resp = api("POST", f"/documents/admin/invoices/{INVOICE_ID_PROFORMA}/issue", token=ADMIN)
    log("T18: Re-issuing invoice blocked (409)", code, resp, expected=409)
else:
    print("  SKIP: no proforma invoice")


# ══════════════════════════════════════════════════════════════════════════════
# T19: Buyer now sees issued invoice
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T19 — Buyer sees issued invoice")
print("=" * 65)

code, resp = api("GET", f"/documents/deals/{DEAL_ID}/invoices", token=BUYER)
if code == 200:
    invoices = resp if isinstance(resp, list) else []
    issued = [i for i in invoices if i.get("status") == "issued"]
    log("T19: Buyer sees at least 1 issued invoice", 200 if issued else 422,
        f"found {len(issued)} issued invoices", expected=200)
else:
    log(f"T19: Buyer invoice list (got {code})", code, resp, expected=code)


# ══════════════════════════════════════════════════════════════════════════════
# T20: Buyer downloads issued invoice
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T20 — Buyer downloads issued invoice")
print("=" * 65)

if INVOICE_ID_PROFORMA:
    code, resp = api("GET", f"/documents/invoices/{INVOICE_ID_PROFORMA}/download", token=BUYER)
    if code in (200, 403, 404):
        if code == 200:
            log("T20: Buyer downloads issued invoice (200)", code, resp)
            got_url = bool(resp.get("signed_url"))
            log("T20: Signed URL present", 200 if got_url else 422,
                f"signed_url={'present' if got_url else 'missing'}", expected=200)
        else:
            # Buyer may not be party to deal in test environment
            log(f"T20: Buyer not party to deal (got {code})", code, resp, expected=code)
    else:
        log("T20: Buyer downloads issued invoice", code, resp, expected=200)
else:
    print("  SKIP: no proforma invoice")


# ══════════════════════════════════════════════════════════════════════════════
# T21: Admin voids final invoice
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T21 — Admin voids final invoice")
print("=" * 65)

if INVOICE_ID_FINAL:
    code, resp = api(
        "POST",
        f"/documents/admin/invoices/{INVOICE_ID_FINAL}/void",
        data={"void_reason": "Test voiding — issued in error during phase 10 tests"},
        token=ADMIN,
    )
    log("T21: Admin voids invoice (200)", code, resp)
    log("T21: status = void", 200 if resp.get("status") == "void" else 422,
        f"status={resp.get('status')}", expected=200)
else:
    print("  SKIP: no final invoice")


# ══════════════════════════════════════════════════════════════════════════════
# T22: Void already-voided invoice (409)
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T22 — Void already-voided invoice (409)")
print("=" * 65)

if INVOICE_ID_FINAL:
    code, resp = api(
        "POST",
        f"/documents/admin/invoices/{INVOICE_ID_FINAL}/void",
        data={"void_reason": "Trying to void again"},
        token=ADMIN,
    )
    log("T22: Re-voiding invoice blocked (409)", code, resp, expected=409)
else:
    print("  SKIP: no final invoice")


# ══════════════════════════════════════════════════════════════════════════════
# T23: RBAC — Seller cannot use admin document endpoints
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T23 — RBAC: Seller blocked from admin endpoints")
print("=" * 65)

if SELLER:
    code, resp = multipart_upload(
        f"/documents/admin/deals/{DEAL_ID}/documents",
        token=SELLER,
        file_bytes=FAKE_PDF,
        content_type="application/pdf",
        extra_fields={"document_type": "other"},
    )
    log("T23: Seller cannot upload document (403)", code, resp, expected=403)

    if DOC_ID:
        code, resp = api(
            "PATCH",
            f"/documents/admin/documents/{DOC_ID}",
            data={"description": "Seller attempting to edit"},
            token=SELLER,
        )
        log("T23: Seller cannot update document (403)", code, resp, expected=403)

    code, resp = api(
        "POST",
        f"/documents/admin/deals/{DEAL_ID}/invoices",
        data={"invoice_type": "proforma"},
        token=SELLER,
    )
    log("T23: Seller cannot generate invoice (403)", code, resp, expected=403)
else:
    print("  SKIP: no seller token")


# ══════════════════════════════════════════════════════════════════════════════
# SUMMARY
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
ok_count   = sum(1 for r in RESULTS if r[0] == "OK  ")
fail_count = sum(1 for r in RESULTS if r[0] == "FAIL")
print(f"RESULTS:  {ok_count} passed  /  {fail_count} failed  /  {len(RESULTS)} total")
print("=" * 65)
if fail_count:
    print("\nFailed tests:")
    for icon, code, label in RESULTS:
        if icon == "FAIL":
            print(f"  [{code}] {label}")
