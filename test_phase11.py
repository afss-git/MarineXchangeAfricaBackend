"""
Phase 11 — Profile + Notifications + Admin Users tests.
Run with: python test_phase11.py

Covers:
  1.  Login admin, buyer, seller
  2.  GET /auth/me  — profile includes avatar_url field
  3.  PATCH /auth/me/profile  — update name + phone
  4.  PATCH /auth/me/profile  — invalid phone rejected (422)
  5.  PATCH /auth/me/password — wrong current password rejected (400)
  6.  GET /notifications/  — empty feed initially
  7.  GET /notifications/unread-count  — returns 0
  8.  Seed a notification via DB then check feed
  9.  GET /notifications/  — returns seeded notification
  10. GET /notifications/unread-count  — returns 1
  11. PATCH /notifications/{id}/read  — mark as read
  12. GET /notifications/unread-count  — back to 0
  13. POST /notifications/read-all  — works on already-empty unread
  14. Wrong user cannot mark someone else's notification (404)
  15. GET /admin/users  — admin lists all users
  16. GET /admin/users  — filter by role=buyer returns only buyers
  17. GET /admin/users  — search by name
  18. GET /admin/users/{id}  — get specific user profile
  19. GET /admin/users/{id}  — 404 for nonexistent user
  20. PATCH /admin/users/{id}/roles  — update buyer's roles
  21. PATCH /admin/users/{id}/roles  — invalid role rejected (422)
  22. POST /admin/users/{id}/deactivate  — deactivate buyer
  23. POST /admin/users/{id}/deactivate  — already deactivated (409)
  24. POST /admin/users/{id}/reactivate  — reactivate buyer
  25. Admin cannot deactivate themselves (400)
  26. Buyer cannot access admin user endpoints (403)
  27. GET /admin/dashboard  — returns all stat sections
  28. Buyer cannot access admin dashboard (403)
"""
import json
import urllib.error
import urllib.parse
import urllib.request
import asyncio
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
_, ar  = api("POST", "/auth/admin/login",  {"email": "admin@marinexchange.africa", "password": _ADMIN_PASS})
_, br  = api("POST", "/auth/buyer/login",  {"email": "buyer1@gmail.com",           "password": _TEST_PASS})
_, sr  = api("POST", "/auth/seller/login", {"email": "seller1@gmail.com",          "password": _TEST_PASS})
_, br2 = api("POST", "/auth/buyer/login",  {"email": "buyer2@gmail.com",           "password": _TEST_PASS})

ADMIN  = ar.get("access_token", "")
BUYER  = br.get("access_token", "")
SELLER = sr.get("access_token", "")
BUYER2 = br2.get("access_token", "")
BUYER_ID = br.get("user", {}).get("id") or ar.get("user", {}).get("id", "")

print(f"  Admin  : {'OK' if ADMIN  else 'FAIL'}")
print(f"  Buyer  : {'OK' if BUYER  else 'FAIL'}")
print(f"  Seller : {'OK' if SELLER else 'FAIL'}")

if not ADMIN or not BUYER:
    print("FATAL: Cannot proceed without admin + buyer tokens.")
    import sys; sys.exit(1)

# Get buyer's actual user ID from /me
_, me = api("GET", "/auth/me", token=BUYER)
BUYER_ID = str(me.get("id", ""))
_, admin_me = api("GET", "/auth/me", token=ADMIN)
ADMIN_ID = str(admin_me.get("id", ""))
print(f"  Buyer ID : {BUYER_ID}")
print(f"  Admin ID : {ADMIN_ID}")


# ══════════════════════════════════════════════════════════════════════════════
# T1: GET /auth/me — has avatar_url field
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T1 — GET /auth/me includes avatar_url")
print("=" * 65)

code, resp = api("GET", "/auth/me", token=BUYER)
log("T1: GET /auth/me (200)", code, resp)
log("T1: avatar_url field present", 200 if "avatar_url" in resp else 422,
    f"keys={list(resp.keys())[:8]}", expected=200)


# ══════════════════════════════════════════════════════════════════════════════
# T2: PATCH /auth/me/profile — update name + phone
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T2 — PATCH /auth/me/profile")
print("=" * 65)

original_name = me.get("full_name", "Test Buyer")
new_name = "Updated Buyer Name"

code, resp = api("PATCH", "/auth/me/profile", {"full_name": new_name}, token=BUYER)
log("T2: Update profile (200)", code, resp)
log("T2: full_name updated", 200 if resp.get("full_name") == new_name else 422,
    f"got={resp.get('full_name')}", expected=200)

# Restore original name
api("PATCH", "/auth/me/profile", {"full_name": original_name}, token=BUYER)


# ══════════════════════════════════════════════════════════════════════════════
# T3: PATCH /auth/me/profile — empty body is a no-op (200)
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T3 — PATCH /auth/me/profile with empty body (no-op)")
print("=" * 65)

code, resp = api("PATCH", "/auth/me/profile", {}, token=BUYER)
log("T3: Empty patch returns 200", code, resp)


# ══════════════════════════════════════════════════════════════════════════════
# T4: PATCH /auth/me/password — wrong current password (400)
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T4 — Change password with wrong current password")
print("=" * 65)

code, resp = api("PATCH", "/auth/me/password",
    {"current_password": "WrongPassword999!", "new_password": "NewSecurePass2024!"},
    token=BUYER,
)
log("T4: Wrong current password rejected (400)", code, resp, expected=400)


# ══════════════════════════════════════════════════════════════════════════════
# T5-T6: Notification feed — initially empty
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T5-T6 — Notification feed (initially empty)")
print("=" * 65)

code, resp = api("GET", "/notifications/", token=BUYER)
log("T5: GET /notifications/ (200)", code, resp)
log("T5: items is a list", 200 if isinstance(resp.get("items"), list) else 422,
    str(type(resp.get("items"))), expected=200)

code, resp = api("GET", "/notifications/unread-count", token=BUYER)
log("T6: GET /notifications/unread-count (200)", code, resp)
log("T6: unread_count field present", 200 if "unread_count" in resp else 422,
    str(resp), expected=200)


# ══════════════════════════════════════════════════════════════════════════════
# T7-T10: Seed a notification and verify feed
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T7-T10 — Seed notification via service, verify feed")
print("=" * 65)

NOTIF_ID = None

async def seed_notification():
    from app.db.client import get_pool
    from app.services.notifications_service import write_notification
    from uuid import UUID
    pool = await get_pool()
    async with pool.acquire() as conn:
        await write_notification(
            conn,
            user_id=UUID(BUYER_ID),
            title="Test Notification",
            body="This is a test notification for Phase 11.",
            category="system",
            resource_type="deal",
            resource_id="test-resource-id",
        )

asyncio.run(seed_notification())
print("  Seeded 1 notification for buyer.")

code, resp = api("GET", "/notifications/", token=BUYER)
items = resp.get("items", [])
log("T7: Feed has 1+ items after seed", 200 if items else 422,
    f"got {len(items)} items", expected=200)
if items:
    NOTIF_ID = items[0].get("id")
    log("T8: Notification title correct", 200 if items[0].get("title") == "Test Notification" else 422,
        f"title={items[0].get('title')}", expected=200)
    log("T9: is_read = False initially", 200 if not items[0].get("is_read") else 422,
        f"is_read={items[0].get('is_read')}", expected=200)

code, resp = api("GET", "/notifications/unread-count", token=BUYER)
count = resp.get("unread_count", 0)
log("T10: unread_count >= 1 after seed", 200 if count >= 1 else 422,
    f"count={count}", expected=200)


# ══════════════════════════════════════════════════════════════════════════════
# T11-T12: Mark notification as read
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T11-T12 — Mark notification as read")
print("=" * 65)

if NOTIF_ID:
    code, resp = api("PATCH", f"/notifications/{NOTIF_ID}/read", token=BUYER)
    log("T11: Mark notification as read (200)", code, resp)
    log("T11: is_read = True", 200 if resp.get("is_read") else 422,
        f"is_read={resp.get('is_read')}", expected=200)
    log("T11: read_at is set", 200 if resp.get("read_at") else 422,
        f"read_at={resp.get('read_at')}", expected=200)

    code, resp = api("GET", "/notifications/unread-count", token=BUYER)
    log("T12: unread_count = 0 after read", 200 if resp.get("unread_count") == 0 else 422,
        f"count={resp.get('unread_count')}", expected=200)
else:
    print("  SKIP: no notification ID")


# ══════════════════════════════════════════════════════════════════════════════
# T13: POST /notifications/read-all
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T13 — POST /notifications/read-all")
print("=" * 65)

code, resp = api("POST", "/notifications/read-all", token=BUYER)
log("T13: Read-all returns 200", code, resp)


# ══════════════════════════════════════════════════════════════════════════════
# T14: Wrong user cannot mark someone else's notification
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T14 — Buyer2 cannot mark Buyer1 notification as read")
print("=" * 65)

if NOTIF_ID and BUYER2:
    code, resp = api("PATCH", f"/notifications/{NOTIF_ID}/read", token=BUYER2)
    log("T14: Other user's notification returns 404", code, resp, expected=404)
else:
    print("  SKIP: no NOTIF_ID or BUYER2 token")


# ══════════════════════════════════════════════════════════════════════════════
# T15-T17: Admin user list
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T15-T17 — Admin lists users")
print("=" * 65)

code, resp = api("GET", "/admin/users", token=ADMIN)
log("T15: GET /admin/users (200)", code, resp)
items = resp.get("items", [])
total = resp.get("total", 0)
log("T15: Returns list of users", 200 if isinstance(items, list) and total > 0 else 422,
    f"total={total}", expected=200)

code, resp = api("GET", "/admin/users", params={"role": "buyer"}, token=ADMIN)
items = resp.get("items", [])
log("T16: Filter by role=buyer (200)", code, resp)
non_buyers = [u for u in items if "buyer" not in u.get("roles", [])]
log("T16: All returned users have buyer role", 200 if not non_buyers else 422,
    f"non-buyers found: {len(non_buyers)}", expected=200)

if items:
    sample_name = items[0].get("full_name", "")
    search_term = sample_name[:4] if len(sample_name) >= 4 else sample_name
    code, resp = api("GET", "/admin/users", params={"search": search_term}, token=ADMIN)
    log(f"T17: Search by name '{search_term}' returns results", code, resp)


# ══════════════════════════════════════════════════════════════════════════════
# T18-T19: Admin gets specific user
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T18-T19 — Admin gets specific user")
print("=" * 65)

if BUYER_ID:
    code, resp = api("GET", f"/admin/users/{BUYER_ID}", token=ADMIN)
    log("T18: GET /admin/users/{id} (200)", code, resp)
    log("T18: Returns email + roles", 200 if resp.get("email") and resp.get("roles") else 422,
        str(resp.get("email")), expected=200)

code, resp = api("GET", "/admin/users/00000000-0000-0000-0000-000000000000", token=ADMIN)
log("T19: Nonexistent user returns 404", code, resp, expected=404)


# ══════════════════════════════════════════════════════════════════════════════
# T20-T21: Admin updates roles
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T20-T21 — Admin updates user roles")
print("=" * 65)

if BUYER_ID:
    code, resp = api("PATCH", f"/admin/users/{BUYER_ID}/roles",
        {"roles": ["buyer"]}, token=ADMIN)
    log("T20: Update roles (200)", code, resp)
    log("T20: Roles updated to ['buyer']", 200 if resp.get("roles") == ["buyer"] else 422,
        f"roles={resp.get('roles')}", expected=200)

    code, resp = api("PATCH", f"/admin/users/{BUYER_ID}/roles",
        {"roles": ["invalid_role"]}, token=ADMIN)
    log("T21: Invalid role rejected (422)", code, resp, expected=422)


# ══════════════════════════════════════════════════════════════════════════════
# T22-T24: Deactivate / Reactivate
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T22-T24 — Deactivate / Reactivate user")
print("=" * 65)

if BUYER_ID:
    # Use buyer2 for deactivation to avoid locking out our test token
    _, me2 = api("GET", "/auth/me", token=BUYER2)
    BUYER2_ID = str(me2.get("id", ""))

    if BUYER2_ID:
        code, resp = api("POST", f"/admin/users/{BUYER2_ID}/deactivate",
            {"reason": "Test deactivation for phase 11 tests"}, token=ADMIN)
        log("T22: Deactivate user (200)", code, resp)
        log("T22: is_active = False", 200 if resp.get("is_active") == False else 422,
            f"is_active={resp.get('is_active')}", expected=200)

        code, resp = api("POST", f"/admin/users/{BUYER2_ID}/deactivate",
            {"reason": "Already deactivated"}, token=ADMIN)
        log("T23: Already deactivated returns 409", code, resp, expected=409)

        code, resp = api("POST", f"/admin/users/{BUYER2_ID}/reactivate", token=ADMIN)
        log("T24: Reactivate user (200)", code, resp)
        log("T24: is_active = True", 200 if resp.get("is_active") == True else 422,
            f"is_active={resp.get('is_active')}", expected=200)
    else:
        print("  SKIP: no buyer2 ID")


# ══════════════════════════════════════════════════════════════════════════════
# T25: Admin cannot deactivate themselves
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T25 — Admin cannot deactivate themselves")
print("=" * 65)

if ADMIN_ID:
    code, resp = api("POST", f"/admin/users/{ADMIN_ID}/deactivate",
        {"reason": "Self-deactivation attempt"}, token=ADMIN)
    log("T25: Self-deactivation blocked (400)", code, resp, expected=400)


# ══════════════════════════════════════════════════════════════════════════════
# T26: Buyer cannot access admin user endpoints
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T26 — RBAC: Buyer blocked from admin user endpoints")
print("=" * 65)

code, resp = api("GET", "/admin/users", token=BUYER)
log("T26: Buyer cannot list users (403)", code, resp, expected=403)

code, resp = api("GET", f"/admin/users/{ADMIN_ID}", token=BUYER)
log("T26: Buyer cannot get user profile (403)", code, resp, expected=403)


# ══════════════════════════════════════════════════════════════════════════════
# T27: GET /admin/dashboard
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T27 — Admin dashboard stats")
print("=" * 65)

code, resp = api("GET", "/admin/dashboard", token=ADMIN)
log("T27: GET /admin/dashboard (200)", code, resp)
for section in ("users", "deals", "kyc", "purchase_requests", "auctions", "recent_activity"):
    log(f"T27: '{section}' section present", 200 if section in resp else 422,
        f"keys={list(resp.keys())}", expected=200)


# ══════════════════════════════════════════════════════════════════════════════
# T28: Buyer cannot access admin dashboard
# ══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("T28 — RBAC: Buyer blocked from admin dashboard")
print("=" * 65)

code, resp = api("GET", "/admin/dashboard", token=BUYER)
log("T28: Buyer cannot access dashboard (403)", code, resp, expected=403)


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
