"""
Bootstrap the first admin account and optionally create agent accounts.

Run AFTER restarting the backend server with ADMIN_BOOTSTRAP_SECRET set in .env

Usage:
    python bootstrap_admin.py
"""
import urllib.request
import json

BASE = "http://127.0.0.1:8000/api/v1"
BOOTSTRAP_SECRET = "ec714f98685eb41adc1711f0fa3beff921dd1dc73318ae6d44e775b2469ef810"

# ── Credentials to set ────────────────────────────────────────────────────────
ADMIN_EMAIL    = "admin@marinexchange.africa"
ADMIN_PASSWORD = "Admin@Marine2024!"
ADMIN_NAME     = "Platform Admin"
ADMIN_PHONE    = "+2348000000001"
ADMIN_COUNTRY  = "Nigeria"

AGENT_EMAIL    = "agent@marinexchange.africa"
AGENT_NAME     = "Verification Agent"
AGENT_PHONE    = "+2348000000002"
AGENT_COUNTRY  = "Nigeria"
AGENT_TYPE     = "verification_agent"   # or "buyer_agent"
# ─────────────────────────────────────────────────────────────────────────────


def post(path, data, headers=None):
    h = {"Content-Type": "application/json"}
    if headers:
        h.update(headers)
    body = json.dumps(data).encode()
    req = urllib.request.Request(BASE + path, body, h, method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


print("=" * 60)
print("Step 1 — Bootstrap admin account")
print("=" * 60)

code, r = post(
    "/auth/internal/bootstrap",
    {
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD,
        "full_name": ADMIN_NAME,
        "phone": ADMIN_PHONE,
        "country": ADMIN_COUNTRY,
    },
    headers={"X-Bootstrap-Secret": BOOTSTRAP_SECRET},
)

if code == 201:
    print(f"  Admin created: {r.get('email')}  id={str(r.get('id',''))[:8]}...")
elif code == 403 and "already exists" in str(r):
    print("  Admin already exists — skipping bootstrap.")
else:
    print(f"  FAILED ({code}): {r}")
    raise SystemExit(1)

print()
print("=" * 60)
print("Step 2 — Login as admin and create agent")
print("=" * 60)

code2, login = post("/auth/admin/login", {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
if code2 != 200:
    print(f"  Admin login FAILED ({code2}): {login}")
    raise SystemExit(1)

token = login["access_token"]
print(f"  Admin login OK  token={token[:20]}...")

code3, agent = post(
    "/auth/internal/create-agent",
    {
        "email": AGENT_EMAIL,
        "full_name": AGENT_NAME,
        "phone": AGENT_PHONE,
        "country": AGENT_COUNTRY,
        "agent_type": AGENT_TYPE,
    },
    headers={"Authorization": f"Bearer {token}"},
)

if code3 == 201:
    temp_pwd = agent.get("temp_password") or "(sent to agent's email)"
    print(f"  Agent created: {agent.get('email')}")
    print(f"  Temp password: {temp_pwd}")
    print(f"  Role: {agent.get('roles')}")
elif code3 == 409:
    print("  Agent already exists — skipping.")
else:
    print(f"  Agent creation FAILED ({code3}): {agent}")

print()
print("=" * 60)
print("DONE — Credentials:")
print(f"  Admin:  {ADMIN_EMAIL}  /  {ADMIN_PASSWORD}")
print(f"  Agent:  {AGENT_EMAIL}  /  (temp password above)")
print("=" * 60)
print()
print("IMPORTANT: Comment out ADMIN_BOOTSTRAP_SECRET in .env and restart the server!")
