"""
Phase 8A — APScheduler setup.

AsyncIOScheduler runs inside the FastAPI process — no separate worker needed.
Jobs acquire a connection from the existing asyncpg pool.

Scheduler is started/stopped via FastAPI lifespan hooks in main.py.
"""
from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler(timezone="UTC")


def start_scheduler() -> None:
    """Register all jobs and start the scheduler. Called at app startup."""
    from app.scheduler.jobs.kyc_jobs import run_kyc_expiry_warnings
    from app.scheduler.jobs.installment_jobs import (
        run_installment_reminders,
        run_installment_overdue_alerts,
    )
    from app.scheduler.jobs.deal_jobs import run_deal_offer_timeout
    from app.scheduler.jobs.auction_jobs import (
        run_open_scheduled_auctions,
        run_close_live_auctions,
        run_auction_ending_soon_alerts,
    )

    # ── KYC ──────────────────────────────────────────────────────────────────
    # Daily 08:00 UTC — warn buyers whose KYC expires in 30 or 7 days
    scheduler.add_job(
        run_kyc_expiry_warnings,
        CronTrigger(hour=8, minute=0),
        id="kyc_expiry_warnings",
        replace_existing=True,
        misfire_grace_time=3600,
    )

    # ── Installments ──────────────────────────────────────────────────────────
    # Daily 07:00 UTC — remind buyers of installments due in 5 days
    scheduler.add_job(
        run_installment_reminders,
        CronTrigger(hour=7, minute=0),
        id="installment_reminders",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    # Daily 09:00 UTC — flag overdue installments (past grace period)
    scheduler.add_job(
        run_installment_overdue_alerts,
        CronTrigger(hour=9, minute=0),
        id="installment_overdue_alerts",
        replace_existing=True,
        misfire_grace_time=3600,
    )

    # ── Deals ─────────────────────────────────────────────────────────────────
    # Daily 06:00 UTC — auto-cancel deals stuck in offer_sent past deadline
    scheduler.add_job(
        run_deal_offer_timeout,
        CronTrigger(hour=6, minute=0),
        id="deal_offer_timeout",
        replace_existing=True,
        misfire_grace_time=3600,
    )

    # ── Payments ──────────────────────────────────────────────────────────────
    from app.scheduler.jobs.payment_jobs import (
        run_payment_overdue_alerts,
        run_payment_schedule_completion_check,
    )
    # Daily 10:00 UTC — mark overdue schedule items and notify buyers
    scheduler.add_job(
        run_payment_overdue_alerts,
        CronTrigger(hour=10, minute=0),
        id="payment_overdue_alerts",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    # Every 60s — safety-net completion checker
    scheduler.add_job(
        run_payment_schedule_completion_check,
        IntervalTrigger(seconds=60),
        id="payment_schedule_completion",
        replace_existing=True,
        misfire_grace_time=60,
    )

    # ── Auctions ──────────────────────────────────────────────────────────────
    # Every 60s — open scheduled auctions whose start_time has passed
    scheduler.add_job(
        run_open_scheduled_auctions,
        IntervalTrigger(seconds=60),
        id="open_scheduled_auctions",
        replace_existing=True,
        misfire_grace_time=60,
    )
    # Every 60s — close live/closing_soon auctions whose end_time has passed
    scheduler.add_job(
        run_close_live_auctions,
        IntervalTrigger(seconds=60),
        id="close_live_auctions",
        replace_existing=True,
        misfire_grace_time=60,
    )
    # Every 30 min — send "ending in 1 hour" alerts to active bidders
    scheduler.add_job(
        run_auction_ending_soon_alerts,
        IntervalTrigger(minutes=30),
        id="auction_ending_soon_alerts",
        replace_existing=True,
        misfire_grace_time=600,
    )

    scheduler.start()
    logger.info("Scheduler started — %d jobs registered.", len(scheduler.get_jobs()))


def stop_scheduler() -> None:
    """Gracefully shut down the scheduler. Called at app shutdown."""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped.")
