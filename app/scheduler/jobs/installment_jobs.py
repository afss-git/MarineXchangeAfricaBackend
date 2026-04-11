"""
Phase 8A — Installment scheduled jobs.

run_installment_reminders:    Daily 07:00 UTC — remind buyers 5 days before due date.
run_installment_overdue_alerts: Daily 09:00 UTC — escalate overdue installments.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

from app.config import settings
from app.db.client import get_pool
from app.services import notification_service

logger = logging.getLogger(__name__)

REMINDER_DAYS_BEFORE = 5


async def run_installment_reminders() -> None:
    logger.info("[installment_reminders] job started")
    pool = await get_pool()
    async with pool.acquire() as db:
        await _send_reminders(db)
    logger.info("[installment_reminders] job finished")


async def run_installment_overdue_alerts() -> None:
    logger.info("[installment_overdue_alerts] job started")
    pool = await get_pool()
    async with pool.acquire() as db:
        await _send_overdue_alerts(db)
    logger.info("[installment_overdue_alerts] job finished")


async def _send_reminders(db) -> None:
    target_date = date.today() + timedelta(days=REMINDER_DAYS_BEFORE)

    rows = await db.fetch(
        """
        SELECT
            di.id              AS installment_id,
            di.deal_id,
            di.installment_number,
            di.amount_due,
            di.due_date,
            d.currency,
            d.deal_ref,
            d.buyer_id,
            d.payment_instructions,
            p.full_name        AS buyer_name,
            p.phone            AS buyer_phone,
            u.email            AS buyer_email,
            pa.bank_name,
            pa.account_number
        FROM finance.deal_installments di
        JOIN finance.deals d          ON d.id  = di.deal_id
        JOIN public.profiles p        ON p.id  = d.buyer_id
        JOIN auth.users u             ON u.id  = d.buyer_id
        LEFT JOIN finance.payment_accounts pa ON pa.id = d.payment_account_id
        WHERE di.status   = 'pending'
          AND di.due_date = $1
          AND d.status    = 'active'
        """,
        target_date,
    )

    logger.info("[installment_reminders] %d installments due on %s", len(rows), target_date)

    for row in rows:
        try:
            await notification_service.send_installment_reminder_notification(
                buyer_email=row["buyer_email"],
                buyer_phone=row["buyer_phone"],
                buyer_name=row["buyer_name"] or "",
                deal_ref=row["deal_ref"],
                installment_number=row["installment_number"],
                amount_due=str(row["amount_due"]),
                currency=row["currency"],
                due_date=str(row["due_date"]),
                bank_name=row["bank_name"] or "Harbours360",
                account_number=row["account_number"] or "",
                payment_reference=row["deal_ref"],
                days_until_due=REMINDER_DAYS_BEFORE,
            )
        except Exception as exc:
            logger.error(
                "[installment_reminders] failed for installment %s: %s",
                row["installment_id"], exc,
            )


async def _send_overdue_alerts(db) -> None:
    grace_days = settings.INSTALLMENT_GRACE_PERIOD_DAYS
    cutoff_date = date.today() - timedelta(days=grace_days)

    rows = await db.fetch(
        """
        SELECT
            di.id              AS installment_id,
            di.deal_id,
            di.installment_number,
            di.amount_due,
            di.due_date,
            d.currency,
            d.deal_ref,
            d.buyer_id,
            p.full_name        AS buyer_name,
            p.phone            AS buyer_phone,
            u.email            AS buyer_email
        FROM finance.deal_installments di
        JOIN finance.deals d     ON d.id = di.deal_id
        JOIN public.profiles p   ON p.id = d.buyer_id
        JOIN auth.users u        ON u.id = d.buyer_id
        WHERE di.status   = 'pending'
          AND di.due_date <= $1
          AND d.status    = 'active'
        """,
        cutoff_date,
    )

    logger.info("[installment_overdue_alerts] %d overdue installments found", len(rows))

    today = date.today()
    for row in rows:
        days_overdue = (today - row["due_date"]).days
        try:
            await notification_service.send_installment_overdue_notification(
                buyer_email=row["buyer_email"],
                buyer_phone=row["buyer_phone"],
                buyer_name=row["buyer_name"] or "",
                deal_ref=row["deal_ref"],
                installment_number=row["installment_number"],
                amount_due=str(row["amount_due"]),
                currency=row["currency"],
                due_date=str(row["due_date"]),
                days_overdue=days_overdue,
            )
        except Exception as exc:
            logger.error(
                "[installment_overdue_alerts] failed for installment %s: %s",
                row["installment_id"], exc,
            )

        # Mark installment as overdue in DB
        try:
            await db.execute(
                """
                UPDATE finance.deal_installments
                SET status = 'overdue', updated_at = NOW()
                WHERE id = $1 AND status = 'pending'
                """,
                row["installment_id"],
            )
        except Exception as exc:
            logger.error(
                "[installment_overdue_alerts] failed to mark overdue for %s: %s",
                row["installment_id"], exc,
            )
