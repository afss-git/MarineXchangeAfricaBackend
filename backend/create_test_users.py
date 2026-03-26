"""One-time script to create test users via Supabase Admin API (no email required).

Required environment variables:
  SUPABASE_URL              - e.g. https://xxxx.supabase.co
  SUPABASE_SERVICE_ROLE_KEY - service_role key from Supabase dashboard
  TEST_USER_PASS            - password for buyer/seller test accounts
  TEST_ADMIN_PASS           - password for admin test account
"""
import urllib.request
import json
import os
import sys

BASE = os.environ.get("API_BASE_URL", "http://127.0.0.1:8000/api/v1")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SERVICE_KEY  = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
TEST_PASS    = os.environ.get("TEST_USER_PASS", "")

if not all([SUPABASE_URL, SERVICE_KEY, TEST_PASS]):
    sys.exit(
        "ERROR: Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and TEST_USER_PASS "
        "environment variables before running this script."
    )


def api(path, data=None, headers=None, method=None):
    h = {"Content-Type": "application/json"}
    if headers:
        h.update(headers)
    m = method or ("POST" if data else "GET")
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(BASE + path, body, h, method=m)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def supa_post(path, data):
    h = {
        "apikey": SERVICE_KEY,
        "Authorization": "Bearer " + SERVICE_KEY,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    body = json.dumps(data).encode()
    req = urllib.request.Request(SUPABASE_URL + path, body, h, method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def create_user(email, full_name, company_name, company_reg_no, phone, country, roles):
    # Step 1: Create Supabase auth user (admin API, email pre-confirmed)
    code, r = supa_post("/auth/v1/admin/users", {
        "email": email,
        "password": TEST_PASS,
        "email_confirm": True,
        "user_metadata": {"full_name": full_name, "roles": roles},
    })
    uid = r.get("id")
    if not uid:
        print(f"  AUTH FAIL ({code}): {r.get('msg') or r.get('error_description') or r}")
        return None

    # Step 2: Insert profile via REST
    kyc = "pending" if "buyer" in roles else "not_applicable"
    code2, pr = supa_post("/rest/v1/profiles", {
        "id": uid,
        "full_name": full_name,
        "company_name": company_name,
        "company_reg_no": company_reg_no,
        "phone": phone,
        "country": country,
        "roles": roles,
        "kyc_status": kyc,
        "is_active": True,
    })
    if code2 not in (200, 201):
        print(f"  PROFILE FAIL ({code2}): {pr}")
        return None

    return uid


print("=" * 60)
print("Creating test users via Supabase Admin API")
print("=" * 60)

users = [
    ("seller2@gmail.com", "Kwame Boateng", "Boateng Offshore Ltd", "NG-OFF-2024-002", "+2348031234567", "Nigeria", ["seller"]),
    ("buyer1@gmail.com",  "James Osei",    None,                    None,              "+233209876543",  "Ghana",   ["buyer"]),
    ("buyer2@gmail.com",  "Amara Diallo",  "Diallo Resources SA",   None,              "+221771234567",  "Senegal", ["buyer"]),
    ("buyer3@gmail.com",  "Ngozi Okafor",  "Okafor Energy Ltd",     None,              "+2347034567890", "Nigeria", ["buyer"]),
]

for email, full_name, company, reg, phone, country, roles in users:
    print(f"\n{email} ({'/'.join(roles)})...")
    # Check if already exists
    code, r = api(f"/auth/{'seller' if 'seller' in roles else 'buyer'}/login",
                  {"email": email, "password": TEST_PASS})
    if code == 200:
        print(f"  Already exists, login OK")
        continue
    uid = create_user(email, full_name, company, reg, phone, country, roles)
    if uid:
        print(f"  Created: uid={uid[:8]}...")
        # Verify login works
        portal = "seller" if "seller" in roles else "buyer"
        code2, r2 = api(f"/auth/{portal}/login", {"email": email, "password": TEST_PASS})
        result = "OK" if code2 == 200 else f"FAIL ({code2}) - {r2.get('detail')}"
        print(f"  Login test: {result}")

print("\n" + "=" * 60)
print("Done. All test users created.")
print("=" * 60)
