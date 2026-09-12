from __future__ import annotations

import argparse
import calendar
import logging
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import text

from ml.pair_compat_model import PairPreference
from optimizer.pair_compat import load_pair_compatibility
from app.db import engine
from app.goods_forecast import clip_windows, load_bands
from optimizer.model import Job, Window, solve
from workflow.events import log_events

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("sangam.optimizer.run")


def list_zones(conn, limit: int = 30) -> list[dict]:
    rows = conn.execute(
        text(
            """
            SELECT c.zone AS zone, COUNT(DISTINCT d.defect_id) AS pending_requests, COUNT(DISTINCT c.corridor_id) AS corridors
            FROM core.corridors c
            LEFT JOIN core.defects d ON d.corridor_id = c.corridor_id AND d.workflow_status = 'pending'
            WHERE c.zone IS NOT NULL
            GROUP BY c.zone
            ORDER BY pending_requests DESC
            LIMIT :limit
            """
        ),
        {"limit": limit},
    ).mappings().all()
    return [dict(r) for r in rows]


def default_zone(conn) -> str | None:
    zones = list_zones(conn, limit=1)
    return zones[0]["zone"] if zones else None


def month_bounds(today: date | None = None) -> tuple[date, date, str]:
    today = today or date.today()
    start = today.replace(day=1)
    end = start.replace(day=calendar.monthrange(start.year, start.month)[1])
    return start, end, f"{start.year}-{start.month:02d}"


def week_bounds(anchor: date | None = None) -> tuple[date, date, str]:
    anchor = anchor or date.today()
    start = anchor - timedelta(days=anchor.weekday())
    end = start + timedelta(days=6)
    iso_year, iso_week, _ = start.isocalendar()
    return start, end, f"{iso_year}-W{iso_week:02d}"


def add_months(d: date, n: int) -> date:
    month_index = d.month - 1 + n
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    return date(year, month, 1)


def week_label_state(week_start: date, week_end: date, today: date | None = None) -> str:
    today = today or date.today()
    if week_end < today:
        return "past"
    if week_start > today:
        return "upcoming"
    return "current"


def _load_corridor_ids(conn, zone: str) -> list[str]:
    return conn.execute(text("SELECT corridor_id FROM core.corridors WHERE zone = :zone"), {"zone": zone}).scalars().all()


def _load_jobs(conn, corridor_ids: list[str], horizon_start: date, horizon_end: date, locked_days: set[date] | None = None) -> list[Job]:
    """Everything the solver is allowed to (re)place inside this horizon.

    That is the pending backlog, plus any job that is currently *scheduled*
    but whose live assignment either (a) sits inside this horizon on a day
    that isn't frozen — re-solving the period means those blocks are up for
    re-placement alongside the backlog, not silently excluded so the new
    plan comes out empty and, once approved, supersedes the only plan that
    held them — or (b) has no approved assignment anywhere at all (an
    orphan left behind by an earlier supersession), which is pending in
    everything but name.
    """
    if not corridor_ids:
        return []
    rows = conn.execute(
        text(
            """
            WITH live AS (
                SELECT a.defect_id, MIN(a.allocated_start)::date AS planned_day
                FROM plan.block_assignments a
                JOIN plan.block_plans p ON p.plan_id = a.plan_id
                WHERE p.status = 'approved' AND a.defect_id IS NOT NULL
                GROUP BY a.defect_id
            )
            SELECT d.defect_id, d.corridor_id, d.department, d.priority_score, d.estimated_block_hours, d.due_date,
                   l.planned_day, d.defect_type
            FROM core.defects d
            LEFT JOIN live l ON l.defect_id = d.defect_id
            WHERE d.corridor_id = ANY(:corridor_ids) AND d.priority_score IS NOT NULL
              AND (
                    d.workflow_status = 'pending'
                 OR (d.workflow_status = 'scheduled' AND l.defect_id IS NULL)
                 OR (d.workflow_status = 'scheduled' AND l.planned_day BETWEEN :horizon_start AND :horizon_end)
              )
              -- A job that isn't yet overdue but is due before this horizon
              -- even starts belongs to an earlier/current horizon, not this
              -- one — otherwise a later plan solved out of order (e.g. next
              -- month generated before this week) can vacuum up work that
              -- should have gone to the nearer plan. Once a job actually IS
              -- overdue (due_date < today), it's fair game for any horizon,
              -- since nothing will make it on-time anymore anyway.
              AND (d.due_date IS NULL OR d.due_date < CURRENT_DATE OR d.due_date >= :horizon_start)
            """
        ),
        {"corridor_ids": corridor_ids, "horizon_start": horizon_start, "horizon_end": horizon_end},
    ).mappings().all()
    locked_days = locked_days or set()
    return [
        Job(
            str(r["defect_id"]), r["corridor_id"], r["department"], float(r["priority_score"]), float(r["estimated_block_hours"]), r["due_date"],
            defect_type=r["defect_type"],
        )
        for r in rows
        # A job already planned on a frozen day stays exactly where it is —
        # it's carried over, not re-solved.
        if not (r["planned_day"] and r["planned_day"] in locked_days)
    ]


def _load_windows(conn, corridor_ids: list[str], horizon_start: date, horizon_end: date) -> list[Window]:
    if not corridor_ids:
        return []
    rows = conn.execute(
        text(
            """
            SELECT window_id, corridor_id, window_start, window_end, max_concurrent_depts
            FROM core.corridor_block_windows
            WHERE corridor_id = ANY(:corridor_ids)
              AND window_start::date >= :hs AND window_start::date <= :he
            """
        ),
        {"corridor_ids": corridor_ids, "hs": horizon_start, "he": horizon_end},
    ).mappings().all()
    # Corridor busyness relative to the busiest corridor among these: the
    # objective charges more for possession hours where the trains are.
    traffic = {
        r["corridor_id"]: int(r["train_count"] or 0)
        for r in conn.execute(text("SELECT corridor_id, train_count FROM core.corridors WHERE corridor_id = ANY(:ids)"), {"ids": corridor_ids}).mappings()
    }
    busiest = max(traffic.values(), default=0) or 1
    out = []
    for r in rows:
        duration_h = (r["window_end"] - r["window_start"]).total_seconds() / 3600.0
        out.append(
            Window(
                str(r["window_id"]), r["corridor_id"], r["window_start"], r["window_end"], duration_h, r["max_concurrent_depts"],
                traffic_factor=traffic.get(r["corridor_id"], 0) / busiest,
            )
        )
    # Carve the Control Office's goods-train forecast out of the timetable
    # gaps — a freight path expected through a slot makes that slot
    # unavailable for a block exactly as a timetabled train would.
    return clip_windows(out, load_bands(conn, corridor_ids, horizon_start, horizon_end))


def _snapshot(conn, plan_id: str, horizon_type: str, period_label: str, snapshot_type: str) -> None:
    rows = conn.execute(
        text(
            """
            SELECT a.assignment_id, a.corridor_id, a.department, a.allocated_start, a.allocated_end, d.defect_type, d.severity_code
            FROM plan.block_assignments a
            LEFT JOIN core.defects d ON d.defect_id = a.defect_id
            WHERE a.plan_id = :id
            """
        ),
        {"id": plan_id},
    ).mappings().all()
    import json

    payload = [dict(r) for r in rows]
    for row in payload:
        for key in ("assignment_id", "allocated_start", "allocated_end"):
            row[key] = str(row[key])
    conn.execute(
        text(
            """
            INSERT INTO plan.plan_history (plan_id, horizon_type, period_label, snapshot_type, payload)
            VALUES (:plan_id, :horizon_type, :period_label, :snapshot_type, :payload)
            """
        ),
        {"plan_id": plan_id, "horizon_type": horizon_type, "period_label": period_label, "snapshot_type": snapshot_type, "payload": json.dumps(payload)},
    )


def _insert_plan_row(conn, plan_id: str, horizon_type: str, period_label: str, horizon_start: date, horizon_end: date, zone: str, status: str, solver_status: str, objective_value: float, solve_seconds: float) -> None:
    conn.execute(
        text(
            """
            INSERT INTO plan.block_plans
                (plan_id, horizon_type, period_label, horizon_start, horizon_end, zone,
                 status, solver_status, objective_value, solve_seconds)
            VALUES (:id, :htype, :period, :hs, :he, :zone, :status, :solver_status, :obj, :secs)
            """
        ),
        {
            "id": plan_id, "htype": horizon_type, "period": period_label, "hs": horizon_start, "he": horizon_end,
            "zone": zone, "status": status, "solver_status": solver_status, "obj": objective_value, "secs": solve_seconds,
        },
    )


def _insert_assignment(conn, plan_id: str, window_id, corridor_id, defect_id, department, start, end, group_id) -> None:
    conn.execute(
        text(
            """
            INSERT INTO plan.block_assignments
                (assignment_id, plan_id, window_id, corridor_id, defect_id, department, allocated_start, allocated_end, joint_block_group_id)
            VALUES (:id, :plan_id, :window_id, :corridor_id, :defect_id, :department, :start, :end, :group_id)
            """
        ),
        {
            "id": str(uuid.uuid4()), "plan_id": plan_id, "window_id": window_id, "corridor_id": corridor_id,
            "defect_id": defect_id, "department": department, "start": start, "end": end, "group_id": group_id,
        },
    )


def run_plan(
    horizon_type: str,
    zone: str | None,
    horizon_start: date,
    horizon_end: date,
    period_label: str,
    time_limit_s: int = 120,
) -> str:
    with engine.begin() as conn:
        if not zone:
            zone = default_zone(conn)
            if not zone:
                raise ValueError("no zone with corridors found")

        corridor_ids = _load_corridor_ids(conn, zone)
        jobs = _load_jobs(conn, corridor_ids, horizon_start, horizon_end)
        windows = _load_windows(conn, corridor_ids, horizon_start, horizon_end)
        pair_compat = load_pair_compatibility(conn, [w.window_id for w in windows])
        logger.info("zone=%s corridors=%d jobs=%d windows=%d", zone, len(corridor_ids), len(jobs), len(windows))

        result = solve(jobs, windows, pair_compat=pair_compat, pair_preference=PairPreference(), time_limit_s=time_limit_s)
        logger.info(
            "solve status=%s objective=%.1f scheduled=%d/%d in %.1fs",
            result.status, result.objective_value, len(result.scheduled_defect_ids), len(jobs), result.solve_seconds,
        )

        plan_id = str(uuid.uuid4())
        _insert_plan_row(conn, plan_id, horizon_type, period_label, horizon_start, horizon_end, zone, "pending_approval", result.status, result.objective_value, result.solve_seconds)

        for a in result.assignments:
            _insert_assignment(conn, plan_id, a.window_id, a.corridor_id, a.defect_id, a.department, a.allocated_start, a.allocated_end, a.joint_block_group_id)

        _snapshot(conn, plan_id, horizon_type, period_label, "proposed")

    logger.info("plan %s persisted (%s %s, zone=%s)", plan_id, horizon_type, period_label, zone)
    return plan_id


def generate_monthly_plan(zone: str | None = None, time_limit_s: int = 120, months_ahead: int = 1) -> str:
    if months_ahead not in (0, 1, 2):
        raise ValueError("months_ahead must be 0 (current month), 1 (next month), or 2 (month after)")
    if months_ahead == 0:
        return regenerate_current_month_plan(zone, time_limit_s)
    target_first = add_months(date.today().replace(day=1), months_ahead)
    start, end, label = month_bounds(target_first)
    return run_plan("monthly", zone, start, end, label, time_limit_s)


def regenerate_current_month_plan(zone: str | None = None, time_limit_s: int = 120) -> str:
    """(Re-)solve the current month's plan around whatever's already locked
    in. If no monthly plan has been approved for this month yet, there's
    simply nothing to carry forward — this is then just the first plan for
    the month, solved from today onward instead of from day one, since days
    that have already passed can't be scheduled into regardless.

    Days that have already passed, and any week that already has its own
    approved weekly plan, are frozen exactly as they stand — only the
    remaining, not-yet-committed part of the month is re-optimized, using
    every request currently sitting in the backlog (including ones that
    arrived after the original monthly plan was approved).
    """
    start, end, label = month_bounds()
    today = date.today()

    with engine.begin() as conn:
        if not zone:
            zone = default_zone(conn)
            if not zone:
                raise ValueError("no zone with corridors found")

        current_plan = conn.execute(
            text(
                """
                SELECT * FROM plan.block_plans
                WHERE zone = :zone AND horizon_type = 'monthly' AND period_label = :label AND status = 'approved'
                ORDER BY approved_at DESC LIMIT 1
                """
            ),
            {"zone": zone, "label": label},
        ).mappings().first()

        locked_weeks = conn.execute(
            text(
                """
                SELECT horizon_start, horizon_end FROM plan.block_plans
                WHERE zone = :zone AND horizon_type = 'weekly' AND status = 'approved'
                  AND horizon_start <= :end AND horizon_end >= :start
                """
            ),
            {"zone": zone, "start": start, "end": end},
        ).mappings().all()

        def is_locked(day: date) -> bool:
            if day < today:
                return True
            return any(w["horizon_start"] <= day <= w["horizon_end"] for w in locked_weeks)

        corridor_ids = _load_corridor_ids(conn, zone)
        locked_days = {start + timedelta(days=i) for i in range((end - start).days + 1) if is_locked(start + timedelta(days=i))}
        jobs = _load_jobs(conn, corridor_ids, start, end, locked_days=locked_days)
        all_windows = _load_windows(conn, corridor_ids, start, end)
        free_windows = [w for w in all_windows if not is_locked(w.start.date())]

        pair_compat = load_pair_compatibility(conn, [w.window_id for w in free_windows])
        result = solve(jobs, free_windows, pair_compat=pair_compat, pair_preference=PairPreference(), time_limit_s=time_limit_s)
        logger.info(
            "regenerate current month zone=%s free_windows=%d/%d jobs=%d scheduled=%d",
            zone, len(free_windows), len(all_windows), len(jobs), len(result.scheduled_defect_ids),
        )

        plan_id = str(uuid.uuid4())
        _insert_plan_row(conn, plan_id, "monthly", label, start, end, zone, "pending_approval", result.status, result.objective_value, result.solve_seconds)

        carried = 0
        if current_plan:
            frozen_rows = conn.execute(
                text(
                    """
                    SELECT window_id, corridor_id, defect_id, department, allocated_start, allocated_end, joint_block_group_id
                    FROM plan.block_assignments WHERE plan_id = :id
                    """
                ),
                {"id": current_plan["plan_id"]},
            ).mappings().all()
            for r in frozen_rows:
                if is_locked(r["allocated_start"].date()):
                    _insert_assignment(conn, plan_id, r["window_id"], r["corridor_id"], r["defect_id"], r["department"], r["allocated_start"], r["allocated_end"], r["joint_block_group_id"])
                    carried += 1

        for a in result.assignments:
            _insert_assignment(conn, plan_id, a.window_id, a.corridor_id, a.defect_id, a.department, a.allocated_start, a.allocated_end, a.joint_block_group_id)

        logger.info("carried over %d frozen assignments from history/locked weeks", carried)
        _snapshot(conn, plan_id, "monthly", label, "proposed")

    return plan_id


def generate_weekly_plan(zone: str | None = None, anchor: date | None = None, time_limit_s: int = 60) -> str:
    start, end, label = week_bounds(anchor)
    return run_plan("weekly", zone, start, end, label, time_limit_s)


def approve_plan(plan_id: str, approved_by: str) -> None:
    with engine.begin() as conn:
        plan = conn.execute(text("SELECT * FROM plan.block_plans WHERE plan_id = :id"), {"id": plan_id}).mappings().first()
        if not plan:
            raise ValueError("plan not found")

        superseded_ids = conn.execute(
            text(
                """
                UPDATE plan.block_plans SET status = 'superseded'
                WHERE zone = :zone AND horizon_type = :htype AND period_label = :period AND plan_id != :id AND status = 'approved'
                RETURNING plan_id
                """
            ),
            {"zone": plan["zone"], "htype": plan["horizon_type"], "period": plan["period_label"], "id": plan_id},
        ).scalars().all()
        conn.execute(
            text("UPDATE plan.block_plans SET status = 'approved', approved_by = :by, approved_at = now() WHERE plan_id = :id"),
            {"id": plan_id, "by": approved_by},
        )

        scheduled_defect_ids = conn.execute(
            text("SELECT defect_id FROM plan.block_assignments WHERE plan_id = :id AND defect_id IS NOT NULL"), {"id": plan_id}
        ).scalars().all()
        if scheduled_defect_ids:
            newly = conn.execute(
                text("SELECT defect_id FROM core.defects WHERE defect_id = ANY(:ids) AND workflow_status != 'scheduled'"),
                {"ids": scheduled_defect_ids},
            ).scalars().all()
            conn.execute(
                text("UPDATE core.defects SET workflow_status = 'scheduled', updated_at = now() WHERE defect_id = ANY(:ids)"),
                {"ids": scheduled_defect_ids},
            )
            log_events(conn, newly, "plan_scheduled", "pending", "scheduled", approved_by, f"placed by approved {plan['horizon_type']} plan {plan['period_label']} ({plan['zone']})")

        # Anything the plan(s) we just replaced had scheduled that this one
        # doesn't — and that no other approved plan still holds — is back in
        # the backlog. Leaving it at 'scheduled' would strand it: invisible on
        # every Gantt (its only assignment is in a superseded plan) and never
        # picked up again by the solver. It counts as a deferral, so its
        # priority rises for the next cycle instead of starving.
        if superseded_ids:
            released = conn.execute(
                text(
                    """
                    UPDATE core.defects d
                    SET workflow_status = 'pending', defer_count = defer_count + 1, updated_at = now()
                    WHERE d.workflow_status = 'scheduled'
                      AND d.defect_id IN (SELECT defect_id FROM plan.block_assignments WHERE plan_id = ANY(:old_ids))
                      AND NOT EXISTS (
                            SELECT 1 FROM plan.block_assignments a JOIN plan.block_plans p ON p.plan_id = a.plan_id
                            WHERE a.defect_id = d.defect_id AND p.status = 'approved'
                      )
                    RETURNING d.defect_id
                    """
                ),
                {"old_ids": superseded_ids},
            ).scalars().all()
            if released:
                log_events(conn, released, "released", "scheduled", "pending", approved_by, f"not carried by the re-generated {plan['horizon_type']} plan {plan['period_label']}; deferred")
                logger.info("plan %s superseded %d plan(s); %d job(s) they held are back in the backlog", plan_id, len(superseded_ids), len(released))

        _snapshot(conn, plan_id, plan["horizon_type"], plan["period_label"], "final")

        if plan["horizon_type"] == "monthly":
            # "Week 1" is the current operational week, not necessarily the
            # calendar's first week of the month — if the monthly plan is
            # approved after the month has already started, week 1 should
            # still be *this* week rather than a week that's already past.
            anchor = max(plan["horizon_start"], date.today())
            week1_start, week1_end, week_label = week_bounds(anchor)
            week1_start = max(week1_start, plan["horizon_start"])
            week1_end = min(week1_end, plan["horizon_end"])

            already_approved = conn.execute(
                text(
                    """
                    SELECT 1 FROM plan.block_plans
                    WHERE zone = :zone AND horizon_type = 'weekly' AND period_label = :label AND status = 'approved'
                    """
                ),
                {"zone": plan["zone"], "label": week_label},
            ).scalar()
            if already_approved:
                # A regenerated-current-month approval landing on a week that
                # already has its own approved weekly plan (e.g. this week,
                # already committed) must not spawn a second, conflicting one.
                logger.info("week %s already has an approved weekly plan; skipping auto-derive", week_label)
                return

            week_plan_id = str(uuid.uuid4())
            conn.execute(
                text(
                    """
                    INSERT INTO plan.block_plans
                        (plan_id, horizon_type, period_label, horizon_start, horizon_end, zone, status,
                         solver_status, objective_value, solve_seconds, approved_by, approved_at)
                    VALUES (:id, 'weekly', :period, :hs, :he, :zone, 'approved', :status, :obj, :secs, :by, now())
                    """
                ),
                {
                    "id": week_plan_id, "period": week_label, "hs": week1_start, "he": week1_end, "zone": plan["zone"],
                    "status": plan["solver_status"], "obj": plan["objective_value"], "secs": plan["solve_seconds"], "by": approved_by,
                },
            )
            rows = conn.execute(
                text(
                    """
                    SELECT window_id, corridor_id, defect_id, department, allocated_start, allocated_end, joint_block_group_id
                    FROM plan.block_assignments
                    WHERE plan_id = :id AND allocated_start::date BETWEEN :ws AND :we
                    """
                ),
                {"id": plan_id, "ws": week1_start, "we": week1_end},
            ).mappings().all()
            for r in rows:
                conn.execute(
                    text(
                        """
                        INSERT INTO plan.block_assignments
                            (assignment_id, plan_id, window_id, corridor_id, defect_id, department, allocated_start, allocated_end, joint_block_group_id)
                        VALUES (:id, :plan_id, :window_id, :corridor_id, :defect_id, :department, :start, :end, :group_id)
                        """
                    ),
                    {
                        "id": str(uuid.uuid4()), "plan_id": week_plan_id, "window_id": r["window_id"], "corridor_id": r["corridor_id"],
                        "defect_id": r["defect_id"], "department": r["department"], "start": r["allocated_start"], "end": r["allocated_end"],
                        "group_id": r["joint_block_group_id"],
                    },
                )
            _snapshot(conn, week_plan_id, "weekly", week_label, "proposed")
            _snapshot(conn, week_plan_id, "weekly", week_label, "final")
            logger.info("derived week-1 plan %s (%s) from monthly plan %s", week_plan_id, week_label, plan_id)


def reject_plan(plan_id: str, rejected_by: str, reason: str | None = None) -> None:
    with engine.begin() as conn:
        plan = conn.execute(text("SELECT * FROM plan.block_plans WHERE plan_id = :id"), {"id": plan_id}).mappings().first()
        if not plan:
            raise ValueError("plan not found")
        if plan["status"] != "pending_approval":
            raise ValueError("only a plan awaiting approval can be rejected")

        conn.execute(
            text("UPDATE plan.block_plans SET status = 'rejected', approved_by = :by, approved_at = now() WHERE plan_id = :id"),
            {"id": plan_id, "by": rejected_by},
        )
        _snapshot(conn, plan_id, plan["horizon_type"], plan["period_label"], "rejected")
        logger.info("plan %s (%s %s) rejected by %s: %s", plan_id, plan["horizon_type"], plan["period_label"], rejected_by, reason or "no reason given")


def _plan_summary(conn, plan_id: str) -> dict:
    row = conn.execute(text("SELECT period_label, objective_value, solver_status FROM plan.block_plans WHERE plan_id = :id"), {"id": plan_id}).mappings().first()
    n_assignments = conn.execute(text("SELECT count(*) FROM plan.block_assignments WHERE plan_id = :id"), {"id": plan_id}).scalar()
    n_zero_score_unscheduled = conn.execute(
        text(
            """
            SELECT count(*) FROM core.defects d
            WHERE d.workflow_status = 'pending' AND d.priority_score = 0
              AND d.corridor_id IN (SELECT corridor_id FROM core.corridors WHERE zone = (SELECT zone FROM plan.block_plans WHERE plan_id = :id))
            """
        ),
        {"id": plan_id},
    ).scalar()
    return {
        "plan_id": plan_id,
        "period_label": row["period_label"] if row else None,
        "objective_value": float(row["objective_value"] or 0) if row else 0.0,
        "solver_status": row["solver_status"] if row else None,
        "assignments": int(n_assignments or 0),
        "zero_score_pending": int(n_zero_score_unscheduled or 0),
    }


def generate_and_approve_all(horizon_type: str, approved_by: str, months_ahead: int = 1, time_limit_s: int | None = None) -> list[dict]:
    """Bulk sweep across every real zone: generate a plan and immediately
    approve it. Used both as a genuine bulk-ops convenience and as a
    diagnostic — the per-zone `assignments` / `zero_score_pending` counts in
    the result make it obvious which zones ended up with a suspiciously
    empty Gantt (0 assignments despite backlog) versus ones that are
    correctly empty (no feasible fit at all)."""
    with engine.connect() as conn:
        zones = [z["zone"] for z in list_zones(conn, limit=100) if z["zone"]]

    results = []
    for zone in zones:
        try:
            if horizon_type == "monthly":
                plan_id = generate_monthly_plan(zone, time_limit_s=time_limit_s or 120, months_ahead=months_ahead)
            else:
                plan_id = generate_weekly_plan(zone, time_limit_s=time_limit_s or 60)
            approve_plan(plan_id, approved_by)
            with engine.connect() as conn:
                summary = _plan_summary(conn, plan_id)
            results.append({"zone": zone, "error": None, **summary})
        except Exception as exc:  # noqa: BLE001 - one zone's failure must not abort the rest
            logger.exception("bulk %s generate/approve failed for zone %s", horizon_type, zone)
            results.append({"zone": zone, "error": str(exc), "plan_id": None, "period_label": None, "objective_value": 0.0, "solver_status": None, "assignments": 0, "zero_score_pending": 0})
    return results


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--horizon", choices=["weekly", "monthly"], default="monthly")
    parser.add_argument("--zone", default=None)
    parser.add_argument("--time-limit", type=int, default=120)
    args = parser.parse_args()

    if args.horizon == "monthly":
        generate_monthly_plan(args.zone, args.time_limit)
    else:
        generate_weekly_plan(args.zone, time_limit_s=args.time_limit)


if __name__ == "__main__":
    main()
