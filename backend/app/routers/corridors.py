from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
from app.goods_forecast import IST, clip_window_rows, load_bands
from app.schemas import (
    Asset,
    Corridor,
    CorridorSchedule,
    GoodsForecastBand,
    ScheduleAssignment,
    SchedulePendingRequest,
    ScheduleTraversal,
    CorridorBlockWindow,
    ZoneSummary,
)

router = APIRouter(prefix="/api/v1", tags=["corridors"])


@router.get("/zones", response_model=list[ZoneSummary])
def list_zones(db: Session = Depends(get_db)):
    from optimizer.run import list_zones as _list

    return _list(db.connection(), limit=100)


@router.get("/assets", response_model=list[Asset])
def list_assets(
    department: str | None = Query(None),
    corridor_id: str | None = Query(None, alias="corridorId"),
    zone: str | None = Query(None),
    limit: int = Query(200, le=2000),
    db: Session = Depends(get_db),
):
    clauses, params = [], {"limit": limit}
    joins = ""
    if department:
        clauses.append("a.department = :dept")
        params["dept"] = department
    if corridor_id:
        clauses.append("a.corridor_id = :corridor")
        params["corridor"] = corridor_id
    if zone:
        joins = "JOIN core.corridors c ON c.corridor_id = a.corridor_id"
        clauses.append("c.zone = :zone")
        params["zone"] = zone

    q = f"SELECT a.asset_id, a.corridor_id, a.asset_type, a.department, a.km_marker FROM core.assets a {joins}"
    if clauses:
        q += " WHERE " + " AND ".join(clauses)
    q += " ORDER BY a.corridor_id LIMIT :limit"
    rows = db.execute(text(q), params).mappings().all()
    return [Asset.model_validate(dict(r)) for r in rows]


@router.get("/corridors", response_model=list[Corridor])
def get_corridors(zone: str | None = Query(None), search: str | None = Query(None, alias="q"), db: Session = Depends(get_db)):
    clauses, params = [], {}
    if zone:
        clauses.append("zone = :zone")
        params["zone"] = zone
    if search:
        # A text search targets one specific corridor regardless of how busy
        # it is — most real defects sit on ordinary branch lines, not the
        # top-5000-by-traffic corridors the unfiltered browse view returns.
        clauses.append("(corridor_id ILIKE :search OR station_a_code ILIKE :search OR station_b_code ILIKE :search OR line_name ILIKE :search)")
        params["search"] = f"%{search}%"

    query = "SELECT corridor_id, station_a_code, station_b_code, direction, line_name, zone, length_km, train_count FROM core.corridors"
    if clauses:
        query += " WHERE " + " AND ".join(clauses)
    query += " ORDER BY train_count DESC LIMIT :limit"
    params["limit"] = 300 if search else 5000
    rows = db.execute(text(query), params).mappings().all()
    return [Corridor.model_validate(dict(r)) for r in rows]


def _plan_scope(plan_id: str | None) -> tuple[str, dict]:
    """Which plan(s) a schedule view draws assignments from — shared by the
    per-corridor Gantt and the zone-wide block counts so both agree.

    Viewing one specific plan (e.g. a just-generated, still-unapproved
    monthly/weekly plan) shows exactly what that plan proposes regardless
    of whether it's live yet — otherwise a freshly solved plan looks like
    it scheduled nothing at all, since nothing it did is "approved" yet.

    Live view: every approved plan — except that once a week has its own
    approved weekly plan, that is the authoritative schedule for those days,
    and the monthly plan's copy of the same week must not be drawn on top of
    it (the same job would show twice, possibly at two different times).
    """
    if plan_id:
        return "a.plan_id = :plan_id", {"plan_id": plan_id}
    return (
        """p.status = 'approved'
              AND NOT (
                    p.horizon_type = 'monthly'
                    AND EXISTS (
                        SELECT 1 FROM plan.block_plans w
                        WHERE w.status = 'approved' AND w.horizon_type = 'weekly' AND w.zone IS NOT DISTINCT FROM p.zone
                          AND a.allocated_start::date BETWEEN w.horizon_start AND w.horizon_end
                    )
              )""",
        {},
    )


@router.get("/corridors/block-counts", response_model=dict[str, int])
def corridor_block_counts(
    zone: str = Query(...),
    start: date = Query(...),
    end: date = Query(...),
    plan_id: str | None = Query(None, alias="planId"),
    db: Session = Depends(get_db),
):
    """Blocks per corridor in a zone over a date range — the number the
    corridor's Gantt would draw for the same range/plan. Corridors with no
    blocks are omitted."""
    plan_clause, params = _plan_scope(plan_id)
    params.update({"zone": zone, "s": start, "e": end})
    rows = db.execute(
        text(
            f"""
            SELECT a.corridor_id, count(*) AS n
            FROM plan.block_assignments a
            JOIN plan.block_plans p ON p.plan_id = a.plan_id
            JOIN core.corridors c ON c.corridor_id = a.corridor_id
            WHERE c.zone = :zone AND {plan_clause}
              AND a.allocated_start::date >= :s AND a.allocated_start::date <= :e
            GROUP BY a.corridor_id
            """
        ),
        params,
    ).mappings().all()
    return {r["corridor_id"]: int(r["n"]) for r in rows}


@router.get("/corridors/{corridor_id}/schedule", response_model=CorridorSchedule)
def corridor_schedule(
    corridor_id: str,
    start: date = Query(...),
    end: date = Query(...),
    plan_id: str | None = Query(None, alias="planId"),
    db: Session = Depends(get_db),
):
    window_rows = db.execute(
        text(
            """
            SELECT window_id, corridor_id, window_start, window_end, max_concurrent_depts
            FROM core.active_block_windows
            WHERE corridor_id = :c AND window_start::date >= :s AND window_start::date <= :e
            ORDER BY window_start
            """
        ),
        {"c": corridor_id, "s": start, "e": end},
    ).mappings().all()

    plan_clause, params = _plan_scope(plan_id)
    params.update({"c": corridor_id, "s": start, "e": end})

    assignment_rows = db.execute(
        text(
            f"""
            SELECT a.assignment_id, a.plan_id, a.defect_id, a.department, a.allocated_start, a.allocated_end, a.joint_block_group_id,
                   a.decision, a.decided_by, a.decided_at,
                   d.defect_type, d.severity_code, d.requested_by, d.asset_id, d.source_system, d.estimated_block_hours,
                   d.due_date, d.priority_score, d.speed_restriction_kmph, d.rescheduled_at, d.defer_count, d.detected_date,
                   p.status AS plan_status, p.period_label AS plan_period_label
            FROM plan.block_assignments a
            JOIN plan.block_plans p ON p.plan_id = a.plan_id
            LEFT JOIN core.defects d ON d.defect_id = a.defect_id
            WHERE a.corridor_id = :c AND {plan_clause}
              AND a.allocated_start::date >= :s AND a.allocated_start::date <= :e
            ORDER BY a.allocated_start
            """
        ),
        params,
    ).mappings().all()

    pending_rows = db.execute(
        text(
            """
            SELECT defect_id, department, defect_type, severity_code, estimated_block_hours,
                   requested_window_start, requested_window_end, priority_score, workflow_status,
                   due_date, (due_date < CURRENT_DATE) AS is_overdue
            FROM core.defects
            WHERE corridor_id = :c AND workflow_status IN ('pending', 'awaiting_dept_response', 'awaiting_controller')
            ORDER BY priority_score DESC NULLS LAST
            """
        ),
        {"c": corridor_id},
    ).mappings().all()

    # Goods-train forecast bands for this corridor/range: shown on the Gantt
    # as occupied, and carved out of the free windows exactly as the
    # optimizer sees them, so what's drawn as "free" is what's plannable.
    bands = load_bands(db, [corridor_id], start, end)
    band_rows = db.execute(
        text(
            """
            SELECT forecast_id, corridor_id, forecast_date, band_start_min, band_end_min, train_count, source
            FROM core.goods_train_forecasts
            WHERE corridor_id = :c AND forecast_date BETWEEN :s AND :e
            ORDER BY forecast_date, band_start_min
            """
        ),
        {"c": corridor_id, "s": start, "e": end},
    ).mappings().all()
    goods = []
    for r in band_rows:
        day0 = datetime(r["forecast_date"].year, r["forecast_date"].month, r["forecast_date"].day, tzinfo=IST)
        goods.append(
            GoodsForecastBand(
                forecast_id=r["forecast_id"], corridor_id=r["corridor_id"], forecast_date=r["forecast_date"],
                band_start=day0 + timedelta(minutes=int(r["band_start_min"])), band_end=day0 + timedelta(minutes=int(r["band_end_min"])),
                train_count=int(r["train_count"]), source=r["source"],
            )
        )

    # The timetabled trains through this corridor — the reason the free
    # windows have gaps in them. Same every day (the timetable repeats), so
    # one list serves every row of the Gantt.
    # Each traversal carries the dates its timetable version is in force, so
    # the Gantt can show the right trains on each day of a range that spans
    # a timetable change.
    traversal_rows = db.execute(
        text(
            """
            SELECT t.train_number, t.train_name, t.direction, t.depart_min, t.arrive_min,
                   v.effective_from,
                   (SELECT min(n.effective_from) FROM core.timetable_versions n WHERE n.effective_from > v.effective_from) AS effective_to
            FROM core.corridor_traversals t JOIN core.timetable_versions v ON v.version_id = t.version_id
            WHERE t.corridor_id = :c
              AND v.effective_from <= :e
              AND NOT EXISTS (SELECT 1 FROM core.timetable_versions n WHERE n.effective_from > v.effective_from AND n.effective_from <= :s)
            ORDER BY v.effective_from, t.depart_min
            """
        ),
        {"c": corridor_id, "s": start, "e": end},
    ).mappings().all()

    return CorridorSchedule(
        corridor_id=corridor_id,
        windows=[CorridorBlockWindow.model_validate(r) for r in clip_window_rows([dict(r) for r in window_rows], bands)],
        assignments=[ScheduleAssignment.model_validate(dict(r)) for r in assignment_rows],
        pending_requests=[SchedulePendingRequest.model_validate(dict(r)) for r in pending_rows],
        goods_forecasts=goods,
        traversals=[ScheduleTraversal.model_validate(dict(r)) for r in traversal_rows],
    )
