import urllib.request, json, os, sys

BASE = os.environ.get("API_BASE_URL", "http://127.0.0.1:8000/api/v1")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SERVICE_KEY  = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

if not SUPABASE_URL or not SERVICE_KEY:
    sys.exit("ERROR: Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables before running this script.")

def supa(path, method="GET"):
    h = {"apikey": SERVICE_KEY, "Authorization": "Bearer "+SERVICE_KEY}
    req = urllib.request.Request(SUPABASE_URL+path, None, h, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())

def api(path, data=None):
    h = {"Content-Type": "application/json"}
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(BASE+path, body, h, method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())

# Check seller2 profile
prof = supa("/rest/v1/profiles?id=eq.4608015c-5ed5-42c5-b631-403cd4b44eec&select=id,full_name,roles,company_name")
print("seller2 profile:", prof)

print("\n--- Login tests ---")
tests = [
    ("seller1@gmail.com", os.environ.get("TEST_USER_PASS", ""), "seller"),
    ("seller2@gmail.com", os.environ.get("TEST_USER_PASS", ""), "seller"),
    ("seller3@gmail.com", os.environ.get("TEST_USER_PASS", ""), "seller"),
    ("buyer1@gmail.com",  os.environ.get("TEST_USER_PASS", ""), "buyer"),
    ("buyer2@gmail.com",  os.environ.get("TEST_USER_PASS", ""), "buyer"),
    ("buyer3@gmail.com",  os.environ.get("TEST_USER_PASS", ""), "buyer"),
    ("admin@marinexchange.africa", os.environ.get("TEST_ADMIN_PASS", ""), "admin"),
]
for email, pwd, portal in tests:
    code, r = api("/auth/" + portal + "/login", {"email": email, "password": pwd})
    uid = r.get("user", {}).get("id", "")
    if code == 200:
        print(f"  {email}: OK  uid={uid[:8]}")
    else:
        print(f"  {email}: FAIL {code} - {r.get('detail')}")
