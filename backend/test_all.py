"""
MarineXchange Africa -- Master Test Runner
==========================================
Runs every phase test file sequentially and prints a unified summary.

Usage:
    python test_all.py              # run all suites
    python test_all.py phase11      # run one suite by name
    python test_all.py --with-setup # include test_endpoints.py (slow, seeds data)

Notes:
    - test_endpoints.py is excluded by default (it seeds test data, takes ~5 min).
      Pass --with-setup to include it as the first suite.
    - The server must already be running on http://127.0.0.1:8000
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import time
import urllib.request

BASE_URL = "http://127.0.0.1:8000"

# ── Suite registry ─────────────────────────────────────────────────────────────
# (name, filename, description, timeout_seconds)
SUITES = [
    # test_kyc_flow.py  targets port 8004  -- outdated, skip
    # test_deals_flow.py targets port 8005 -- outdated, skip
    ("purchase_requests", "test_purchase_requests.py",  "Purchase request flow",                120),
    ("auctions",          "test_auctions.py",           "Auction bidding",                      150),
    ("payments",          "test_payments.py",           "Payment schedules",                    150),
    ("documents",         "test_documents.py",          "Document management",                  150),
    ("reports",           "test_reports.py",            "Reports & analytics",                   90),
    ("phase11",           "test_phase11.py",            "Profiles + Notifications + Admin",     120),
    ("phase12",           "test_phase12.py",            "Seller Dashboard + Exchange Rates",     90),
]

SETUP_SUITE = ("endpoints", "test_endpoints.py", "Auth + Marketplace setup (data seeding)", 360)


# ── Result parsers ─────────────────────────────────────────────────────────────

def parse_results(output: str) -> tuple[int, int, int]:
    """
    Extract (passed, failed, total) from a test file's stdout.

    Handles every format used across the suite:
      Phase 11/12:  RESULTS:  47 passed  /  0 failed  /  47 total
      Most others:  PASSED: 38  FAILED: 0  TOTAL: 38
      With spaces:  PASSED : 38  FAILED : 0  TOTAL : 38
      Auctions:     PASSED: 38/50   FAILED: 0   SKIPPED: 2
    """
    # Format A -- phase11 / phase12
    m = re.search(
        r"RESULTS[:\s]+(\d+)\s+passed\s*/\s*(\d+)\s+failed\s*/\s*(\d+)\s+total",
        output, re.IGNORECASE,
    )
    if m:
        return int(m.group(1)), int(m.group(2)), int(m.group(3))

    # Format B/C -- most older suites (PASSED/FAILED/TOTAL with optional space before colon)
    # Also handles PASSED: 38/50 (auctions)
    p = re.search(r"PASSED\s*:\s*(\d+)", output, re.IGNORECASE)
    f = re.search(r"FAILED\s*:\s*(\d+)", output, re.IGNORECASE)
    t = re.search(r"TOTAL\s*:\s*(\d+)",  output, re.IGNORECASE)

    if p and f:
        passed = int(p.group(1))
        failed = int(f.group(1))
        # Try to get total from TOTAL line; fall back to passed+failed
        total = int(t.group(1)) if t else (passed + failed)
        return passed, failed, total

    return 0, 0, 0


def check_server() -> bool:
    try:
        with urllib.request.urlopen(f"{BASE_URL}/health", timeout=5) as r:
            return r.status == 200
    except Exception:
        return False


# ── Suite runner ───────────────────────────────────────────────────────────────

def run_suite(name: str, filename: str, description: str, timeout: int) -> dict:
    from pathlib import Path
    path = Path(__file__).parent / filename

    if not path.exists():
        print(f"  [??] {name:<22} {description}  -- FILE NOT FOUND")
        return {"name": name, "description": description,
                "passed": 0, "failed": 0, "total": 0,
                "status": "MISSING", "elapsed": 0.0, "output": ""}

    print(f"  [...] {name:<22} {description}", end="", flush=True)
    t0 = time.time()

    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"   # prevent cp1252 crashes on Windows

    try:
        result = subprocess.run(
            [sys.executable, str(path)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            cwd=str(path.parent),
            env=env,
        )
        elapsed = time.time() - t0
        output = result.stdout + result.stderr
        passed, failed, total = parse_results(output)

        if total == 0 and result.returncode != 0:
            status = "ERROR"
        elif failed > 0:
            status = "FAIL"
        else:
            status = "PASS"

        tag = "[PASS]" if status == "PASS" else f"[{status}]"
        frac = f"{passed}/{total}" if total > 0 else "0/0"
        # overwrite the [...] line
        print(f"\r  {tag} {name:<22} {description:<38} {frac:>6}  {elapsed:.1f}s")

        return {"name": name, "description": description,
                "passed": passed, "failed": failed, "total": total,
                "status": status, "elapsed": elapsed, "output": output}

    except subprocess.TimeoutExpired:
        elapsed = time.time() - t0
        print(f"\r  [TIME] {name:<22} {description:<38} {'--':>6}  {elapsed:.1f}s")
        return {"name": name, "description": description,
                "passed": 0, "failed": 0, "total": 0,
                "status": "TIMEOUT", "elapsed": elapsed, "output": ""}

    except Exception as exc:
        elapsed = time.time() - t0
        print(f"\r  [ERR]  {name:<22} {description:<38} {'--':>6}  {elapsed:.1f}s")
        return {"name": name, "description": description,
                "passed": 0, "failed": 0, "total": 0,
                "status": "ERROR", "elapsed": elapsed, "output": str(exc)}


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    args = sys.argv[1:]
    include_setup = "--with-setup" in args
    args = [a for a in args if not a.startswith("--")]

    suites = list(SUITES)
    if include_setup:
        suites = [SETUP_SUITE] + suites

    # Filter by name if given
    if args:
        name_filter = args[0].lower()
        suites = [(n, f, d, t) for n, f, d, t in suites if name_filter in n.lower()]
        if not suites:
            available = [n for n, _, _, _ in SUITES]
            print(f"No suite matching '{name_filter}'. Available: {available}")
            sys.exit(1)

    W = 72
    print("=" * W)
    print("  MarineXchange Africa -- Full Backend Test Suite")
    print("=" * W)
    print(f"  Server : {BASE_URL}")
    print(f"  Suites : {len(suites)}")
    print("=" * W)

    # Server check
    if not check_server():
        print()
        print("  ERROR: Server is not running at http://127.0.0.1:8000")
        print("  Start it with:  python -m uvicorn app.main:app --port 8000")
        sys.exit(1)
    print("  Server : healthy")
    print()

    results = []
    overall_start = time.time()

    for name, filename, description, timeout in suites:
        r = run_suite(name, filename, description, timeout)
        results.append(r)

        # Print failures inline
        if r["status"] in ("FAIL", "ERROR", "TIMEOUT") and r["output"]:
            fail_lines = [
                ln.strip() for ln in r["output"].splitlines()
                if "[FAIL]" in ln or "FATAL" in ln
                or ("Error" in ln and "urllib" not in ln and "httpx" not in ln)
            ]
            for ln in fail_lines[:8]:
                print(f"         {ln}")
            if len(fail_lines) > 8:
                print(f"         ... ({len(fail_lines) - 8} more)")

        # Brief pause between suites so the server is not overloaded
        if len(suites) > 1:
            time.sleep(1)

    overall_elapsed = time.time() - overall_start

    # ── Grand summary ──────────────────────────────────────────────────────────
    total_passed = sum(r["passed"] for r in results)
    total_failed = sum(r["failed"] for r in results)
    total_tests  = sum(r["total"]  for r in results)

    print()
    print("=" * W)
    print("  SUMMARY")
    print("=" * W)
    print(f"  {'Suite':<22} {'Description':<38} {'Result':>8}")
    print(f"  {'-'*22} {'-'*38} {'-'*8}")
    for r in results:
        if r["status"] == "PASS":
            tag = "[PASS]"
        elif r["status"] == "MISSING":
            tag = "[??]  "
        else:
            tag = "[FAIL]"
        frac = f"{r['passed']}/{r['total']}" if r["total"] > 0 else r["status"]
        print(f"  {tag} {r['name']:<21} {r['description']:<38} {frac:>8}")

    print()
    print(f"  Tests  : {total_passed} passed / {total_failed} failed / {total_tests} total")
    print(f"  Time   : {overall_elapsed:.1f}s")
    print("=" * W)

    all_ok = all(r["status"] in ("PASS", "MISSING") for r in results) and total_failed == 0
    if all_ok:
        print("  ALL SUITES PASSED")
    else:
        print("  SOME SUITES FAILED -- see details above")
    print("=" * W)

    sys.exit(0 if total_failed == 0 else 1)


if __name__ == "__main__":
    main()
