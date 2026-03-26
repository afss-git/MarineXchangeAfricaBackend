"""
Phase 6 — Report endpoint tests.
Run with: ./venv/Scripts/python test_reports.py
"""
import urllib.request
import urllib.parse
import json
import os

BASE = os.environ.get("API_BASE_URL", "http://127.0.0.1:8000/api/v1")
RESULTS = []
FROM = "2025-01-01"
TO   = "2026-12-31"


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


def get_csv(path, token):
    url = BASE + path
    req = urllib.request.Request(url, None, {"Authorization": "Bearer " + token})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read(), r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        return e.code, e.read(), ""


def log(label, code, note=""):
    ok = code < 400
    icon = "OK  " if ok else "FAIL"
    RESULTS.append((icon, code, label))
    print(f"  [{icon}] {code}  {label}")
    if not ok:
        print(f"         --> {note}")
    return ok


# ── Login ──────────────────────────────────────────────────────────────────────
print("=" * 60)
print("LOGIN")
print("=" * 60)

_TEST_PASS  = os.environ.get("TEST_USER_PASS", "")
_ADMIN_PASS = os.environ.get("TEST_ADMIN_PASS", "")
_, r = api("POST", "/auth/admin/login",  {"email": "admin@marinexchange.africa", "password": _ADMIN_PASS})
ADMIN = r.get("access_token", "")

_, ar = api("POST", "/auth/agent/login", {"email": "agent1@marinexchange.africa", "password": _TEST_PASS})
AGENT = ar.get("access_token", "")

_, sr = api("POST", "/auth/seller/login", {"email": "seller1@gmail.com", "password": _TEST_PASS})
SELLER = sr.get("access_token", "")

print(f"  Admin  : {'OK' if ADMIN  else 'FAIL - ' + str(r)}")
print(f"  Agent  : {'OK' if AGENT  else 'FAIL - ' + str(ar)}")
print(f"  Seller : {'OK' if SELLER else 'FAIL - ' + str(sr)}")


# ── Report 1: Overview Dashboard ──────────────────────────────────────────────
print("\n" + "=" * 60)
print("REPORT 1: Overview Dashboard")
print("=" * 60)

code, r = api("GET", "/reports/overview", token=ADMIN)
if log("GET /reports/overview", code, r.get("detail", "")):
    print(f"    listings : total={r['listings']['total']}  live={r['listings']['live']}  pending_verification={r['listings']['pending_verification']}")
    print(f"    deals    : total={r['deals']['total']}  active={r['deals']['active']}  awaiting_2nd={r['deals']['awaiting_second_approval']}")
    print(f"    kyc      : total_buyers={r['kyc']['total_buyers']}  active={r['kyc']['active_kyc']}  expiring_soon={r['kyc']['expiring_soon']}")
    print(f"    payments : pending_verification={r['payment_alerts']['pending_verification']}  disputed={r['payment_alerts']['disputed']}")


# ── Report 2: Financial Report ────────────────────────────────────────────────
print("\n" + "=" * 60)
print("REPORT 2: Financial Report")
print("=" * 60)

code, r = api("GET", "/reports/financial", token=ADMIN, params={"from_date": FROM, "to_date": TO})
if log("GET /reports/financial", code, r.get("detail", "")):
    ps = r["payment_summary"]
    print(f"    payment_summary : total={ps['total_payments']}  verified={ps['total_verified']}  pending={ps['total_pending']}  disputed={ps['total_disputed']}")
    print(f"    amounts         : verified=${ps['amount_verified']}  pending=${ps['amount_pending']}")
    print(f"    late_installments={len(r['late_installments'])}  defaulted_deals={len(r['defaulted_deals'])}")
    print(f"    by_deal_type    : {[d['deal_type'] + ':' + str(d['count']) for d in r['by_deal_type']]}")

# CSV exports
code2, body2, ct2 = get_csv(f"/reports/financial/late-installments/export?from_date={FROM}&to_date={TO}", ADMIN)
if log("GET /reports/financial/late-installments/export (CSV)", code2, body2[:200] if code2 >= 400 else ""):
    print(f"    Content-Type={ct2}  bytes={len(body2)}  lines={len(body2.splitlines())}")

code3, body3, ct3 = get_csv(f"/reports/financial/defaulted-deals/export?from_date={FROM}&to_date={TO}", ADMIN)
if log("GET /reports/financial/defaulted-deals/export (CSV)", code3, body3[:200] if code3 >= 400 else ""):
    print(f"    Content-Type={ct3}  bytes={len(body3)}")


# ── Report 3: Deal Pipeline ───────────────────────────────────────────────────
print("\n" + "=" * 60)
print("REPORT 3: Deal Pipeline")
print("=" * 60)

code, r = api("GET", "/reports/pipeline", token=ADMIN, params={"from_date": FROM, "to_date": TO})
if log("GET /reports/pipeline", code, r.get("detail", "")):
    print(f"    total={r['total']}  by_status={r['by_status']}")
    if r["deals"]:
        d = r["deals"][0]
        print(f"    sample deal: ref={d['deal_ref']}  type={d['deal_type']}  status={d['status']}  days_in_status={d['days_in_status']}")

code2, body2, ct2 = get_csv(f"/reports/pipeline/export?from_date={FROM}&to_date={TO}", ADMIN)
if log("GET /reports/pipeline/export (CSV)", code2, body2[:200] if code2 >= 400 else ""):
    print(f"    bytes={len(body2)}  lines={len(body2.splitlines())}")


# ── Report 4: KYC Compliance ──────────────────────────────────────────────────
print("\n" + "=" * 60)
print("REPORT 4: KYC Compliance")
print("=" * 60)

code, r = api("GET", "/reports/kyc", token=ADMIN, params={"from_date": FROM, "to_date": TO})
if log("GET /reports/kyc", code, r.get("detail", "")):
    print(f"    total={r['total']}  expiring_30d={r['expiring_within_30_days']}")
    print(f"    by_status={r['by_status']}")
    if r["submissions"]:
        s = r["submissions"][0]
        print(f"    sample: buyer={s['buyer_name']}  status={s['status']}  pep={s['is_pep']}  sanctions={s['sanctions_match']}")

code2, body2, ct2 = get_csv(f"/reports/kyc/export?from_date={FROM}&to_date={TO}", ADMIN)
if log("GET /reports/kyc/export (CSV)", code2, body2[:200] if code2 >= 400 else ""):
    print(f"    bytes={len(body2)}  lines={len(body2.splitlines())}")


# ── Report 5: Marketplace Health ──────────────────────────────────────────────
print("\n" + "=" * 60)
print("REPORT 5: Marketplace Health")
print("=" * 60)

code, r = api("GET", "/reports/marketplace", token=ADMIN, params={"from_date": FROM, "to_date": TO})
if log("GET /reports/marketplace", code, r.get("detail", "")):
    print(f"    total_listings={r['total_listings']}  stuck={len(r['stuck_listings'])}")
    print(f"    by_status={r['by_status']}")
    print(f"    top_categories={[c['category'] for c in r['by_category'][:3]]}")

code2, body2, ct2 = get_csv(f"/reports/marketplace/stuck/export?from_date={FROM}&to_date={TO}", ADMIN)
if log("GET /reports/marketplace/stuck/export (CSV)", code2, body2[:200] if code2 >= 400 else ""):
    print(f"    bytes={len(body2)}")


# ── Report 6: Agent Workload ──────────────────────────────────────────────────
print("\n" + "=" * 60)
print("REPORT 6: Agent Workload & Performance")
print("=" * 60)

# Admin sees all
code, r = api("GET", "/reports/agents", token=ADMIN, params={"from_date": FROM, "to_date": TO})
if log("GET /reports/agents (admin — all agents)", code, r.get("detail", "")):
    print(f"    agents_count={len(r['agents'])}")
    for a in r["agents"]:
        print(f"    {a['agent_name']}: kyc_assigned={a['kyc_assigned']}  kyc_reviewed={a['kyc_reviewed']}  listings_assigned={a['listings_assigned']}")

# Agent sees own only
code2, r2 = api("GET", "/reports/agents", token=AGENT, params={"from_date": FROM, "to_date": TO})
if log("GET /reports/agents (agent — own only)", code2, r2.get("detail", "")):
    print(f"    returned={len(r2['agents'])} agent(s)  (expected: 1)")

# CSV export (admin only)
code3, body3, ct3 = get_csv(f"/reports/agents/export?from_date={FROM}&to_date={TO}", ADMIN)
if log("GET /reports/agents/export (CSV)", code3, body3[:200] if code3 >= 400 else ""):
    print(f"    bytes={len(body3)}")


# ── RBAC Guards ───────────────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("RBAC GUARD TESTS  (403 = correct)")
print("=" * 60)

def log_rbac(label, code, expected_code=403):
    ok = (code == expected_code)
    icon = "OK  " if ok else "FAIL"
    RESULTS.append((icon, code, label))
    print(f"  [{icon}] {code}  {label}")
    if not ok:
        print(f"         --> Expected {expected_code}, got {code}")
    return ok

code, r   = api("GET", "/reports/overview",  token=SELLER)
log_rbac("GET /reports/overview as SELLER (expect 403)", code)

code2, r2 = api("GET", "/reports/financial", token=SELLER, params={"from_date": FROM, "to_date": TO})
log_rbac("GET /reports/financial as SELLER (expect 403)", code2)

code3, r3 = api("GET", "/reports/financial", token=AGENT, params={"from_date": FROM, "to_date": TO})
log_rbac("GET /reports/financial as AGENT (expect 403)", code3)

code4, r4 = api("GET", "/reports/kyc", token=AGENT, params={"from_date": FROM, "to_date": TO})
log_rbac("GET /reports/kyc as AGENT (expect 403)", code4)


# ── Summary ───────────────────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("SUMMARY")
print("=" * 60)
passed = sum(1 for i in RESULTS if i[0] == "OK  ")
failed = sum(1 for i in RESULTS if i[0] == "FAIL")
print(f"  PASSED : {passed}")
print(f"  FAILED : {failed}")
print(f"  TOTAL  : {len(RESULTS)}")

if failed:
    print("\nFailed endpoints:")
    for icon, code, label in RESULTS:
        if icon == "FAIL":
            print(f"  [{code}] {label}")
