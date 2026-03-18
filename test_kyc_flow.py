"""
KYC End-to-End Flow Test
========================
Tests all 5 KYC email scenarios through the actual API.

Users:
  - buyer:     buyer1@gmail.com               (pass: env TEST_USER_PASS)
  - kyc_agent: kyc_agent1@marinexchange.africa (pass: env TEST_USER_PASS)
  - admin:     admin@marinexchange.africa       (pass: env TEST_ADMIN_PASS)

Flow:
  1. Buyer uploads docs + submits  → email: KYC Documents Received
  2. Admin assigns agent           → email: KYC Review Started
  3. Agent marks in_review
  4. Agent submits assessment
  5a. Admin approves               → email: KYC Approved
  -- OR --
  5b. Admin rejects                → email: KYC Verification Unsuccessful
  -- OR --
  5c. Admin requests resubmission  → email: KYC Resubmission Required
"""
import asyncio
import io
import json
import os
import sys
from pathlib import Path

import httpx

BASE = os.environ.get("API_BASE_URL", "http://localhost:8004/api/v1")

BUYER_EMAIL    = "buyer2@gmail.com"
BUYER_PASS     = os.environ.get("TEST_USER_PASS", "")
AGENT_EMAIL    = "kyc_agent1@marinexchange.africa"
AGENT_PASS     = os.environ.get("TEST_USER_PASS", "")
ADMIN_EMAIL    = "admin@marinexchange.africa"
ADMIN_PASS     = os.environ.get("TEST_ADMIN_PASS", "")

PASS_MARK = "[OK]"
FAIL_MARK = "[FAIL]"


def ok(label, resp=None):
    code = f" [{resp.status_code}]" if resp else ""
    print(f"  {PASS_MARK} {label}{code}")


def fail(label, detail=""):
    print(f"  {FAIL_MARK} FAIL: {label} — {detail}")
    sys.exit(1)


def check(resp, label, expected=(200, 201)):
    if resp.status_code not in (expected if isinstance(expected, tuple) else (expected,)):
        fail(label, f"HTTP {resp.status_code}: {resp.text[:300]}")
    ok(label, resp)
    return resp.json()


async def login(client: httpx.AsyncClient, email: str, password: str, role: str = "buyer") -> str:
    resp = await client.post(f"{BASE}/auth/{role}/login", json={"email": email, "password": password})
    data = check(resp, f"Login {email}")
    return data["access_token"]


async def get_doc_types(client: httpx.AsyncClient) -> list[dict]:
    resp = await client.get(f"{BASE}/kyc/document-types")
    data = check(resp, "GET /kyc/document-types")
    print(f"    {len(data)} doc types found: {[d['slug'] for d in data]}")
    return data


async def upload_doc(client: httpx.AsyncClient, token: str, doc_type_id: str, filename: str, content: bytes) -> dict:
    resp = await client.post(
        f"{BASE}/kyc/me/documents",
        params={"document_type_id": doc_type_id},
        files={"file": (filename, io.BytesIO(content), "image/jpeg")},
        headers={"Authorization": f"Bearer {token}"},
    )
    return check(resp, f"  Upload {filename}", (200, 201))


async def run_test(scenario: str = "approve"):
    """
    scenario: 'approve' | 'reject' | 'resubmit'
    """
    print(f"\n{'='*60}")
    print(f"KYC FLOW TEST  — scenario: {scenario.upper()}")
    print(f"{'='*60}\n")

    async with httpx.AsyncClient(timeout=30.0) as client:

        # ── STEP 1: Get required doc types ───────────────────────────────
        print("STEP 1: Public document types")
        doc_types = await get_doc_types(client)
        required = [d for d in doc_types if d["is_required"]]
        print(f"    Required: {[d['slug'] for d in required]}")

        # ── STEP 2: Buyer login ───────────────────────────────────────────
        print("\nSTEP 2: Buyer login")
        buyer_token = await login(client, BUYER_EMAIL, BUYER_PASS, "buyer")

        # ── STEP 3: Check KYC status ─────────────────────────────────────
        print("\nSTEP 3: Buyer KYC status")
        resp = await client.get(f"{BASE}/kyc/me", headers={"Authorization": f"Bearer {buyer_token}"})
        status_data = check(resp, "GET /kyc/me")
        print(f"    kyc_status={status_data['kyc_status']}, submission_id={status_data.get('submission_id')}")

        # ── STEP 4: Upload documents ─────────────────────────────────────
        print("\nSTEP 4: Upload KYC documents")

        # Minimal valid JPEG bytes
        fake_jpeg = (
            b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00'
            b'\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t'
            b'\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a'
            b'\x1f\x1e\x1d\x1a\x1c\x1c $.\' ",#\x1c\x1c(7),01444\x1f\'9=82<.342\x1e'
            b'\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00'
            b'\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00'
            b'\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b\xff\xc4\x00'
            b'\xb5\x10\x00\x02\x01\x03\x03\x02\x04\x03\x05\x05\x04\x04\x00\x00'
            b'\x01}\x01\x02\x03\x00\x04\x11\x05\x12!1A\x06\x13Qa\x07"q\x142\x81'
            b'\x91\xa1\x08#B\xb1\xc1\x15R\xd1\xf0$3br\x82\t\n\x16\x17\x18\x19'
            b'\x1a%&\'()*456789:CDEFGHIJSTUVWXYZcdefghijstuvwxyz\xff\xda\x00\x08'
            b'\x01\x01\x00\x00?\x00\xfb\xd3\xff\xd9'
        )

        uploaded_docs = []
        for doc_type in required:
            doc = await upload_doc(
                client, buyer_token,
                doc_type["id"],
                f"test_{doc_type['slug']}.jpg",
                fake_jpeg,
            )
            uploaded_docs.append(doc)
            print(f"    Uploaded: {doc['document_type_name']} (id={doc['id'][:8]}...)")

        # ── STEP 5: List documents ────────────────────────────────────────
        print("\nSTEP 5: List uploaded documents")
        resp = await client.get(f"{BASE}/kyc/me/documents", headers={"Authorization": f"Bearer {buyer_token}"})
        docs = check(resp, "GET /kyc/me/documents")
        print(f"    {len(docs)} doc(s) in draft")

        # ── STEP 6: Submit KYC ────────────────────────────────────────────
        print("\nSTEP 6: Submit KYC for review  [email: KYC Documents Received]")
        resp = await client.post(f"{BASE}/kyc/me/submit", headers={"Authorization": f"Bearer {buyer_token}"})
        check(resp, "POST /kyc/me/submit")

        # Verify status changed
        resp = await client.get(f"{BASE}/kyc/me", headers={"Authorization": f"Bearer {buyer_token}"})
        data = check(resp, "GET /kyc/me (post-submit)")
        submission_id = data["current_submission_id"]
        print(f"    submission_id={submission_id}, kyc_status={data['kyc_status']}")
        # Profile kyc_status goes to 'under_review' on submit; submission status = 'submitted'
        assert data["kyc_status"] in ("submitted", "under_review"), f"Expected submitted/under_review, got {data['kyc_status']}"

        # ── STEP 7: Admin assigns agent ───────────────────────────────────
        print("\nSTEP 7: Admin assigns buyer_agent  [email: KYC Review Started]")
        admin_token = await login(client, ADMIN_EMAIL, ADMIN_PASS, "admin")

        # Get buyer_agent user id
        resp = await client.get(f"{BASE}/auth/me", headers={"Authorization": f"Bearer {admin_token}"})
        admin_data = check(resp, "Admin /auth/me")

        # Look up agent ID via admin submissions list
        # We need the buyer_agent's ID — fetch from the agent's own /auth/me
        agent_token = await login(client, AGENT_EMAIL, AGENT_PASS, "agent")
        resp = await client.get(f"{BASE}/auth/me", headers={"Authorization": f"Bearer {agent_token}"})
        agent_data = check(resp, "Agent /auth/me")
        agent_id = agent_data["id"]
        print(f"    agent_id={agent_id}")

        resp = await client.post(
            f"{BASE}/kyc/admin/submissions/{submission_id}/assign-agent",
            json={"agent_id": str(agent_id)},
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assignment = check(resp, "POST /assign-agent")
        print(f"    assignment_id={assignment['id'][:8]}..., status={assignment['status']}")

        # ── STEP 8: Agent marks in_review ─────────────────────────────────
        print("\nSTEP 8: Agent marks assignment in_review")
        resp = await client.patch(
            f"{BASE}/kyc/agent/submissions/{submission_id}/assignment",
            json={"status": "in_review"},
            headers={"Authorization": f"Bearer {agent_token}"},
        )
        check(resp, "PATCH /assignment (in_review)")

        # ── STEP 9: Agent submits review ──────────────────────────────────
        print("\nSTEP 9: Agent submits KYC assessment")
        resp = await client.post(
            f"{BASE}/kyc/agent/submissions/{submission_id}/review",
            json={
                "risk_score": "low",
                "is_pep": False,
                "sanctions_match": False,
                "recommendation": "requires_resubmission",  # agents can't recommend approve
                "assessment": "All documents look valid and are consistent with the application. National ID matches applicant details. Proof of address is recent.",
            },
            headers={"Authorization": f"Bearer {agent_token}"},
        )
        review = check(resp, "POST /review", (200, 201))
        print(f"    review_id={review['id'][:8]}..., recommendation={review['recommendation']}")

        # ── STEP 10: Admin final decision ─────────────────────────────────
        print(f"\nSTEP 10: Admin final decision — {scenario}  [email: {scenario.upper()}]")
        decision_map = {
            "approve":  {
                "decision": "approve",
                "assessment": "All documents verified and consistent with application details.",
                "risk_score": "low",
                "is_pep": False,
                "sanctions_match": False,
                "reason": "All checks passed.",
            },
            "reject": {
                "decision": "reject",
                "assessment": "Identity document provided has expired and cannot be accepted.",
                "risk_score": "low",
                "is_pep": False,
                "sanctions_match": False,
                "reason": "Identity document is expired.",
            },
            "resubmit": {
                "decision": "requires_resubmission",
                "assessment": "Documents submitted but proof of address does not meet recency requirements.",
                "risk_score": "low",
                "is_pep": False,
                "sanctions_match": False,
                "reason": "Proof of address must be dated within 3 months.",
            },
        }
        resp = await client.post(
            f"{BASE}/kyc/admin/submissions/{submission_id}/decide",
            json=decision_map[scenario],
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        check(resp, f"POST /decide ({scenario})")

        # Final status check
        resp = await client.get(f"{BASE}/kyc/me", headers={"Authorization": f"Bearer {buyer_token}"})
        data = check(resp, "GET /kyc/me (final)")
        print(f"    FINAL kyc_status={data['kyc_status']}")

        print(f"\n{'='*60}")
        print(f"ALL STEPS PASSED — scenario '{scenario}'")
        print(f"Check devmarineexchange@gmail.com for email receipt")
        print(f"{'='*60}")


if __name__ == "__main__":
    scenario = sys.argv[1] if len(sys.argv) > 1 else "approve"
    if scenario not in ("approve", "reject", "resubmit"):
        print("Usage: python test_kyc_flow.py [approve|reject|resubmit]")
        sys.exit(1)
    asyncio.run(run_test(scenario))
