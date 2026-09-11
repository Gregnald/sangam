from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import text

IST = timezone(timedelta(hours=5, minutes=30))


def compute_statuses(conn, as_of: datetime | None = None) -> dict[str, str]:
    now = as_of.astimezone(IST) if as_of else datetime.now(IST)
    now_minute = now.hour * 60 + now.minute

    blocked = set(
        conn.execute(
            text(
                """
                SELECT DISTINCT a.corridor_id
                FROM plan.block_assignments a
                JOIN plan.block_plans p ON p.plan_id = a.plan_id
                WHERE p.status = 'approved' AND a.allocated_start <= :now AND a.allocated_end >= :now
                """
            ),
            {"now": now},
        ).scalars().all()
    )

    traversal_rows = conn.execute(text("SELECT corridor_id, depart_min, arrive_min FROM core.corridor_traversals")).mappings().all()
    running: set[str] = set()
    for r in traversal_rows:
        corridor_id = r["corridor_id"]
        if corridor_id in running or corridor_id in blocked:
            continue
        dep, arr = r["depart_min"], r["arrive_min"]
        if dep <= now_minute < arr or (arr > 1440 and now_minute < arr - 1440):
            running.add(corridor_id)

    statuses: dict[str, str] = {}
    for corridor_id in blocked:
        statuses[corridor_id] = "blocked"
    for corridor_id in running:
        if corridor_id not in statuses:
            statuses[corridor_id] = "running"
    return statuses
