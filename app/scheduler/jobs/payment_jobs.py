"""
Phase 9 — Payment Lifecycle Scheduler Jobs.

Jobs:
  run_payment_overdue_alerts  — daily 10:00 UTC
      Finds schedule items past due_date with no verified payment.
      Marks them 'overdue' and notifies the buyer.

  run_payment_schedule_completion_check — interval every 60s
      Safety net: re-checks any schedule not yet marked complete
      to ensure auto-completion didn't miss a race condition.
      (Primary completion path is in admin_verify_payment / admin_waive_item.)
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone

from app.db.client import get_pool
from app.services import notification_service

logger = logging.getLogger(__name__)


async def run_payment_overdue_alerts() -> None:
    """
    Daily job: mark overdue schedule items and alert buyers.
    An item is overdue when:
      - due_date < today
      - status is still 'pending' (not yet submitted) or 'payment_submitted' (not yet verified)
    """
    today = date.today()
    logger.info("run_payment_overdue_alerts: checking as of %s", today)

    try:
        pool = await get_pool()
        async with pool.acquire() as db:
            # Find items to mark overdue
            items = await db.fetch(
                """
                SELECT
                    psi.id,
                    psi.deal_id,
                    psi.label,
                    psi.due_date,
                    d.deal_ref,
                    p.full_name  AS buyer_name,
                    u.email      AS buyer_email
                FROM finance.payment_schedule_items psi
                JOIN finance.deals      d ON d.id = psi.deal_id
                JOIN public.profiles    p ON p.id = d.buyer_id
                JOIN auth.users         u ON u.id = d.buyer_id
                WHERE psi.status IN ('pending', 'payment_submitted')
                  AND psi.due_date < $1
                  AND d.status NOT IN ('completed', 'cancelled', 'disputed', 'defaulted')
                """,
                today,
            )

            if not items:
                logger.info("run_payment_overdue_alerts: no overdue items found")
                return

            now = datetime.now(timezone.utc)
            ids = [row["id"] for row in items]

            # Bulk update to overdue
            await db.execute(
                """
                UPDATE finance.payment_schedule_items
                SET status = 'overdue', updated_at = $1
                WHERE id = ANY($2::uuid[])
                  AND status IN ('pending', 'payment_submitted')
                """,
                now, ids,
            )

            logger.info("run_payment_overdue_alerts: marked %d items overdue", len(ids))

            # Notify each affected buyer (de-dupe by buyer per deal)
            notified: set[tuple] = set()
            for row in items:
                key = (str(row["deal_id"]), row["buyer_email"])
                if key in notified:
                    continue
                notified.add(key)
                try:
                    await notification_service.notify_installment_overdue(
                        buyer_email=row["buyer_email"],
                        buyer_name=row["buyer_name"],
                        deal_ref=row["deal_ref"],
                        installment_label=row["label"],
                        due_date=str(row["due_date"]),
                    )
                except Exception as exc:
                    logger.error(
                        "notify_installment_overdue failed for deal %s: %s",
                        row["deal_id"], exc,
                    )

    except Exception as exc:
        logger.exception("run_payment_overdue_alerts crashed: %s", exc)


async def run_payment_schedule_completion_check() -> None:
    """
    Interval job (every 60s): safety-net completion checker.
    Finds schedules where all items are verified/waived but is_complete = FALSE.
    Marks them complete and the deal 'completed'.
    Handles edge cases where HTTP request auto-complete path failed silently.
    """
    try:
        pool = await get_pool()
        async with pool.acquire() as db:
            # Find schedules that should be complete but aren't
            schedules = await db.fetch(
                """
                SELECT ps.id, ps.deal_id
                FROM finance.payment_schedules ps
                WHERE ps.is_complete = FALSE
                  AND NOT EXISTS (
                      SELECT 1 FROM finance.payment_schedule_items psi
                      WHERE psi.schedule_id = ps.id
                        AND psi.status NOT IN ('verified', 'waived')
                  )
                  AND EXISTS (
                      SELECT 1 FROM finance.payment_schedule_items psi
                      WHERE psi.schedule_id = ps.id
                  )
                """
            )

            if not schedules:
                return

            now = datetime.now(timezone.utc)
            for sched in schedules:
                logger.info(
                    "run_payment_schedule_completion_check: completing schedule %s / deal %s",
                    sched["id"], sched["deal_id"],
                )
                await db.execute(
                    """
                    UPDATE finance.payment_schedules
                    SET is_complete = TRUE, completed_at = $1, updated_at = $1
                    WHERE id = $2
                    """,
                    now, sched["id"],
                )
                await db.execute(
                    """
                    UPDATE finance.deals
                    SET status = 'completed', updated_at = $1
                    WHERE id = $2
                      AND status NOT IN ('completed', 'cancelled', 'disputed', 'defaulted')
                    """,
                    now, sched["deal_id"],
                )

                try:
                    await notification_service.notify_deal_completed(sched["deal_id"])
                except Exception as exc:
                    logger.error(
                        "notify_deal_completed (scheduler) failed for deal %s: %s",
                        sched["deal_id"], exc,
                    )

    except Exception as exc:
        logger.exception("run_payment_schedule_completion_check crashed: %s", exc)
