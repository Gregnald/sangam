"""Keep the backlog honest against the wall clock.

A block that was scheduled for last night has, by now, either happened or
not — nothing in the request workflow would ever say so on its own. This
runs at API startup and every minute after (see app/main.py) and applies
what the passage of time implies:

- A scheduled block whose allocated window has ended is **completed**.
- A reschedule offer whose proposed window has already started can no
  longer be accepted: it **lapses**, and the request goes back to the
  backlog as one more deferral so its priority rises for the next cycle.
- A priority-bump request whose target window has already started lapses
  the same way (the block it wanted to displace has run).

"Overdue" (a pending request past its due date) is not a status change —
it stays pending and is reported as a flag by the requests API. Once per
operational day, though, the sweep (`workflow/engine.py::reschedule_overdue`)
places every overdue request into the nearest week that can take it, and
every request due within the next two weeks into an on-time slot — so work
never stalls waiting for a plan.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import text

from app.db import engine
from workflow.events import log_events

logger = logging.getLogger("sangam.workflow.clock")
IST = timezone(timedelta(hours=5, minutes=30))

# Operational day the overdue sweep last ran on — it's a once-a-day job, the
# clock ticks every minute.
_overdue_swept_on: date | None = None


def sync_with_clock(now: datetime | None = None) -> dict:
    now = now or datetime.now(IST)
    completed = lapsed_offers = lapsed_bumps = 0

    with engine.begin() as conn:
        # 1. Scheduled → completed once the live block has ended. The live
        #    block is the one in an approved plan (weekly plans are
        #    authoritative over the monthly copy, so prefer those).
        done = conn.execute(
            text(
                """
                WITH live AS (
                    SELECT DISTINCT ON (a.defect_id) a.defect_id, a.allocated_end, a.corridor_id, p.period_label
                    FROM plan.block_assignments a
                    JOIN plan.block_plans p ON p.plan_id = a.plan_id
                    WHERE p.status = 'approved' AND a.defect_id IS NOT NULL
                    ORDER BY a.defect_id, (p.horizon_type = 'weekly') DESC, a.allocated_start DESC
                )
                UPDATE core.defects d
                SET workflow_status = 'completed', updated_at = now()
                FROM live l
                WHERE l.defect_id = d.defect_id AND d.workflow_status = 'scheduled' AND l.allocated_end <= :now
                RETURNING d.defect_id
                """
            ),
            {"now": now},
        ).scalars().all()
        if done:
            log_events(conn, done, "completed", "scheduled", "completed", "system", "block window ended")
            completed = len(done)

        # 2. Reschedule offers the department never answered before the
        #    offered slot came around.
        offers = conn.execute(
            text(
                """
                UPDATE plan.modification_requests m
                SET status = 'lapsed', decided_at = now(), decided_by = 'system',
                    decision_reason = 'offered window started before the department responded'
                WHERE m.status = 'pending_dept' AND m.request_type = 'reschedule' AND m.proposed_window_start <= :now
                RETURNING m.request_id, m.defect_id, m.requesting_department, m.proposed_corridor_id
                """
            ),
            {"now": now},
        ).mappings().all()
        for o in offers:
            conn.execute(
                text(
                    """
                    UPDATE core.defects SET workflow_status = 'pending', defer_count = defer_count + 1, rescheduled_at = NULL, updated_at = now()
                    WHERE defect_id = :id AND workflow_status = 'awaiting_dept_response'
                    """
                ),
                {"id": o["defect_id"]},
            )
            conn.execute(
                text("INSERT INTO plan.notifications (recipient_role, message, related_request_id, related_defect_id) VALUES (:role, :msg, :req, :d)"),
                {
                    "role": o["requesting_department"],
                    "msg": f"Lapsed: the alternate window offered on {o['proposed_corridor_id']} (#{str(o['defect_id'])[:8].upper()}) passed without a response. The request is back in the backlog.",
                    "req": o["request_id"],
                    "d": o["defect_id"],
                },
            )
        if offers:
            log_events(conn, [o["defect_id"] for o in offers], "lapsed", "awaiting_dept_response", "pending", "system", "offered window passed without a response; deferred")
            lapsed_offers = len(offers)

        # 3. Bump requests the controller never decided before the target
        #    block ran.
        bumps = conn.execute(
            text(
                """
                UPDATE plan.modification_requests m
                SET status = 'lapsed', decided_at = now(), decided_by = 'system',
                    decision_reason = 'target window started before the controller decided'
                WHERE m.status = 'pending_controller' AND m.request_type = 'preemption' AND m.proposed_window_start <= :now
                RETURNING m.request_id, m.defect_id, m.requesting_department, m.proposed_corridor_id
                """
            ),
            {"now": now},
        ).mappings().all()
        for b in bumps:
            conn.execute(
                text(
                    """
                    UPDATE core.defects SET workflow_status = 'pending', defer_count = defer_count + 1, rescheduled_at = NULL, updated_at = now()
                    WHERE defect_id = :id AND workflow_status = 'awaiting_controller'
                    """
                ),
                {"id": b["defect_id"]},
            )
            conn.execute(
                text("INSERT INTO plan.notifications (recipient_role, message, related_request_id, related_defect_id) VALUES (:role, :msg, :req, :d)"),
                {
                    "role": b["requesting_department"],
                    "msg": f"Lapsed: your bump request on {b['proposed_corridor_id']} (#{str(b['defect_id'])[:8].upper()}) — the block it targeted has already run. The request is back in the backlog.",
                    "req": b["request_id"],
                    "d": b["defect_id"],
                },
            )
        if bumps:
            log_events(conn, [b["defect_id"] for b in bumps], "lapsed", "awaiting_controller", "pending", "system", "target window passed before a decision; deferred")
            lapsed_bumps = len(bumps)

    result = {"completed": completed, "lapsed_offers": lapsed_offers, "lapsed_bumps": lapsed_bumps}
    if any(result.values()):
        logger.info("clock sync: %s", result)
        from app import live

        live.bump("clock")

    global _overdue_swept_on
    today = now.astimezone(IST).date()
    if _overdue_swept_on != today:
        from workflow.engine import reschedule_overdue

        try:
            sweep = reschedule_overdue(today)
            result["overdue_rescheduled"] = sweep["rescheduled"]
            result["due_soon_scheduled"] = sweep["scheduled"]
            result["urgent_placed"] = sweep.get("urgent", 0)
            _overdue_swept_on = today
            if any(v for k, v in sweep.items() if k in ("rescheduled", "scheduled", "urgent")) or sweep.get("pinned"):
                from app import live

                live.bump("sweep")
        except Exception:  # noqa: BLE001 - the sweep must never break the clock
            logger.exception("overdue reschedule sweep failed; will retry next tick")
    return result
