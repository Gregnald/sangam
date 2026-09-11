"""Asset-availability KPIs for one block plan.

The problem this system exists to solve is "maximize asset availability" —
so every plan reports, in operational terms, how much of the zone's
infrastructure it takes out of service, how efficiently it uses each
possession, what it does to the backlog, and what it protects. These are
computed from the plan's assignments plus the same network / forecast data
the solver saw, not from the solver's objective value (which is an internal
weighted score nobody can read).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy import text

from app.goods_forecast import IST


def _minute_of_day(dt: datetime) -> int:
    local = dt.astimezone(IST)
    return local.hour * 60 + local.minute


def compute_plan_kpis(conn, plan_id: str) -> dict:
    plan = conn.execute(text("SELECT * FROM plan.block_plans WHERE plan_id = :id"), {"id": plan_id}).mappings().first()
    if not plan:
        raise ValueError("plan not found")

    zone = plan["zone"]
    h_start: date = plan["horizon_start"]
    h_end: date = plan["horizon_end"]
    days = (h_end - h_start).days + 1

    assignments = conn.execute(
        text(
            """
            SELECT a.assignment_id, a.window_id, a.corridor_id, a.defect_id, a.department, a.allocated_start, a.allocated_end,
                   a.joint_block_group_id, d.severity_code, d.due_date, d.speed_restriction_kmph, d.estimated_block_hours
            FROM plan.block_assignments a
            LEFT JOIN core.defects d ON d.defect_id = a.defect_id
            WHERE a.plan_id = :id
            """
        ),
        {"id": plan_id},
    ).mappings().all()

    corridor_count = conn.execute(text("SELECT count(*) FROM core.corridors WHERE zone = :z"), {"z": zone}).scalar() or 0

    # --- Backlog the plan was solving against -------------------------------
    # Everything open in the zone (not cleared) counts as the demand this
    # plan could have addressed; "scheduled" is what it actually placed.
    open_backlog = conn.execute(
        text(
            """
            SELECT d.defect_id, d.severity_code, d.due_date, d.speed_restriction_kmph, d.department
            FROM core.defects d
            JOIN core.corridors c ON c.corridor_id = d.corridor_id
            WHERE c.zone = :z AND d.workflow_status != 'cleared'
            """
        ),
        {"z": zone},
    ).mappings().all()

    scheduled_ids = {str(a["defect_id"]) for a in assignments if a["defect_id"]}
    total_open = len(open_backlog)
    sev_a_total = sum(1 for d in open_backlog if d["severity_code"] == "A")
    sev_a_scheduled = sum(1 for d in open_backlog if d["severity_code"] == "A" and str(d["defect_id"]) in scheduled_ids)
    sr_total = sum(1 for d in open_backlog if d["speed_restriction_kmph"] is not None)
    sr_scheduled = sum(1 for d in open_backlog if d["speed_restriction_kmph"] is not None and str(d["defect_id"]) in scheduled_ids)
    overdue_total = sum(1 for d in open_backlog if d["due_date"] and d["due_date"] < h_start)
    overdue_scheduled = sum(1 for d in open_backlog if d["due_date"] and d["due_date"] < h_start and str(d["defect_id"]) in scheduled_ids)

    on_time = sum(1 for a in assignments if a["due_date"] is None or a["allocated_start"].astimezone(IST).date() <= a["due_date"])
    late = len(assignments) - on_time

    # --- Possession accounting ---------------------------------------------
    # A "block event" is one window taken under possession. Several jobs
    # (possibly from different departments) can share one — the possession
    # lasts from the earliest start to the latest end among them. The
    # counterfactual "each job takes its own block" is the sum of job hours.
    by_window: dict[str, list] = {}
    for a in assignments:
        by_window.setdefault(str(a["window_id"]), []).append(a)

    job_hours = sum((a["allocated_end"] - a["allocated_start"]).total_seconds() / 3600.0 for a in assignments)
    possession_hours = 0.0
    joint_blocks = 0
    multi_dept_blocks = 0
    for group in by_window.values():
        start = min(a["allocated_start"] for a in group)
        end = max(a["allocated_end"] for a in group)
        possession_hours += (end - start).total_seconds() / 3600.0
        if len(group) > 1:
            joint_blocks += 1
        if len({a["department"] for a in group}) > 1:
            multi_dept_blocks += 1
    hours_saved = max(job_hours - possession_hours, 0.0)

    corridor_hours_available = corridor_count * 24.0 * days
    availability_pct = 100.0 * (1.0 - possession_hours / corridor_hours_available) if corridor_hours_available else 100.0
    # Same plan, but every job as its own possession — the "before" picture.
    availability_pct_unbundled = 100.0 * (1.0 - job_hours / corridor_hours_available) if corridor_hours_available else 100.0
    # Zone-wide availability is dominated by the hundreds of corridors a plan
    # never touches; the number a section controller actually feels is
    # availability of the corridors that *do* go under possession.
    affected_corridors = len({a["corridor_id"] for a in assignments if a["corridor_id"]})
    affected_hours_available = affected_corridors * 24.0 * days
    availability_pct_affected = 100.0 * (1.0 - possession_hours / affected_hours_available) if affected_hours_available else 100.0
    availability_pct_affected_unbundled = 100.0 * (1.0 - job_hours / affected_hours_available) if affected_hours_available else 100.0

    # --- Trains protected ---------------------------------------------------
    # Timetabled traversals through a blocked corridor during its block would
    # be the trains this plan disrupts. Windows are built from the timetable
    # gaps, so this should be 0 — and reporting it proves it.
    corridor_ids = sorted({a["corridor_id"] for a in assignments if a["corridor_id"]})
    passenger_affected = 0
    if corridor_ids:
        traversals = conn.execute(
            text("SELECT corridor_id, depart_min, arrive_min FROM core.corridor_traversals WHERE corridor_id = ANY(:ids)"),
            {"ids": corridor_ids},
        ).mappings().all()
        trav_by_corridor: dict[str, list[tuple[int, int]]] = {}
        for t in traversals:
            trav_by_corridor.setdefault(t["corridor_id"], []).append((t["depart_min"], t["arrive_min"]))
        for a in assignments:
            s_min = _minute_of_day(a["allocated_start"])
            e_min = s_min + int((a["allocated_end"] - a["allocated_start"]).total_seconds() // 60)
            for dep, arr in trav_by_corridor.get(a["corridor_id"], []):
                if dep < e_min and arr > s_min:
                    passenger_affected += 1

    # Goods paths the Control Office forecast on the zone's corridors in this
    # horizon, and how many of them a block in this plan would sit on top of.
    goods = conn.execute(
        text(
            """
            SELECT g.corridor_id, g.forecast_date, g.band_start_min, g.band_end_min, g.train_count
            FROM core.goods_train_forecasts g
            JOIN core.corridors c ON c.corridor_id = g.corridor_id
            WHERE c.zone = :z AND g.forecast_date BETWEEN :s AND :e
            """
        ),
        {"z": zone, "s": h_start, "e": h_end},
    ).mappings().all()
    goods_total = sum(int(g["train_count"]) for g in goods)
    goods_conflicting = 0
    if goods and assignments:
        by_corridor_day: dict[tuple[str, date], list] = {}
        for a in assignments:
            by_corridor_day.setdefault((a["corridor_id"], a["allocated_start"].astimezone(IST).date()), []).append(a)
        for g in goods:
            for a in by_corridor_day.get((g["corridor_id"], g["forecast_date"]), []):
                s_min = _minute_of_day(a["allocated_start"])
                e_min = s_min + int((a["allocated_end"] - a["allocated_start"]).total_seconds() // 60)
                if int(g["band_start_min"]) < e_min and int(g["band_end_min"]) > s_min:
                    goods_conflicting += int(g["train_count"])
                    break

    # --- Per-department breakdown -------------------------------------------
    dept: dict[str, dict] = {}
    for a in assignments:
        entry = dept.setdefault(a["department"], {"jobs": 0, "hours": 0.0})
        entry["jobs"] += 1
        entry["hours"] += (a["allocated_end"] - a["allocated_start"]).total_seconds() / 3600.0
    for d in open_backlog:
        dept.setdefault(d["department"], {"jobs": 0, "hours": 0.0}).setdefault("open", 0)
        dept[d["department"]]["open"] = dept[d["department"]].get("open", 0) + 1
    for entry in dept.values():
        entry.setdefault("open", 0)
        entry["hours"] = round(entry["hours"], 1)

    return {
        "plan_id": str(plan_id),
        "zone": zone,
        "horizon_type": plan["horizon_type"],
        "period_label": plan["period_label"],
        "horizon_start": h_start,
        "horizon_end": h_end,
        "days": days,
        "corridors_in_zone": int(corridor_count),
        # availability
        "availability_pct": round(availability_pct, 3),
        "availability_pct_unbundled": round(availability_pct_unbundled, 3),
        "affected_corridors": affected_corridors,
        "availability_pct_affected": round(availability_pct_affected, 2),
        "availability_pct_affected_unbundled": round(availability_pct_affected_unbundled, 2),
        "corridor_hours_available": round(corridor_hours_available, 1),
        "possession_hours": round(possession_hours, 1),
        "job_hours": round(job_hours, 1),
        "hours_saved_by_joint_blocks": round(hours_saved, 1),
        "block_events": len(by_window),
        "joint_blocks": joint_blocks,
        "multi_dept_blocks": multi_dept_blocks,
        # backlog impact
        "jobs_scheduled": len(assignments),
        "open_backlog": total_open,
        "severity_a_scheduled": sev_a_scheduled,
        "severity_a_total": sev_a_total,
        "speed_restrictions_scheduled": sr_scheduled,
        "speed_restrictions_total": sr_total,
        "overdue_scheduled": overdue_scheduled,
        "overdue_total": overdue_total,
        "scheduled_on_time": on_time,
        "scheduled_late": late,
        # operations protected
        "passenger_trains_affected": passenger_affected,
        "goods_paths_forecast": goods_total,
        "goods_paths_conflicting": goods_conflicting,
        "departments": dept,
    }
