"""Month analytics for the controller: everything the live schedule did to
every corridor in a month, plus the state of the backlog behind it.

"Live" means the same rule the Gantt draws by — approved plans, with a
week's own approved weekly plan authoritative over the monthly copy — so
these numbers agree with what is on screen. Availability follows
optimizer/kpis.py: hours under possession over corridor-hours in the month,
with the bundling counterfactual (every job as its own block) alongside.
"""
from __future__ import annotations

import calendar
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from pydantic.alias_generators import to_camel

from app.db import get_db
from app.goods_forecast import IST
from app.routers.corridors import _plan_scope

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])


def _camel(obj):
    """Same wire shape as the pydantic CamelModel responses elsewhere. Keys
    that are data (department names, status codes, dates) are left alone."""
    if isinstance(obj, dict):
        return {(to_camel(k) if "_" in k else k): _camel(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [_camel(v) for v in obj]
    return obj


def _hours(a) -> float:
    return (a["allocated_end"] - a["allocated_start"]).total_seconds() / 3600.0


def _month(period: str) -> tuple[date, date]:
    try:
        y, m = (int(x) for x in period.split("-"))
        return date(y, m, 1), date(y, m, calendar.monthrange(y, m)[1])
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, "period must be YYYY-MM") from exc


@router.get("/months")
def list_months(db: Session = Depends(get_db)):
    """Months that have any live block or any request due — what the month
    picker offers, newest first."""
    rows = db.execute(
        text(
            """
            SELECT DISTINCT to_char(d, 'YYYY-MM') AS period FROM (
                SELECT a.allocated_start AS d FROM plan.block_assignments a JOIN plan.block_plans p ON p.plan_id = a.plan_id WHERE p.status = 'approved'
                UNION ALL SELECT due_date FROM core.defects
                UNION ALL SELECT horizon_start FROM plan.block_plans
            ) t ORDER BY 1 DESC
            """
        )
    ).scalars().all()
    return rows


@router.get("/month")
def month_analytics(period: str = Query(..., description="YYYY-MM"), zone: str | None = Query(None), db: Session = Depends(get_db)):
    return _camel(compute_month(db, period, zone))


def compute_month(db, period: str, zone: str | None) -> dict:
    """All month analytics as plain snake_case data."""
    start, end = _month(period)
    days = (end - start).days + 1
    plan_clause, params = _plan_scope(None)
    params.update({"s": start, "e": end, "zone": zone})
    zone_clause = "AND c.zone = :zone" if zone else ""

    assignments = db.execute(
        text(
            f"""
            SELECT a.assignment_id, a.window_id, a.corridor_id, a.defect_id, a.department, a.allocated_start, a.allocated_end,
                   a.joint_block_group_id, c.zone, c.train_count, c.station_a_code, c.station_b_code,
                   d.severity_code, d.due_date, d.defect_type, d.priority_score, d.speed_restriction_kmph, d.rescheduled_at, d.workflow_status, d.traffic_suspended,
                   p.period_label AS plan_period_label, p.approved_by
            FROM plan.block_assignments a
            JOIN plan.block_plans p ON p.plan_id = a.plan_id
            JOIN core.corridors c ON c.corridor_id = a.corridor_id
            LEFT JOIN core.defects d ON d.defect_id = a.defect_id
            WHERE {plan_clause}
              AND a.allocated_start::date >= :s AND a.allocated_start::date <= :e
              {zone_clause}
            ORDER BY a.allocated_start
            """
        ),
        params,
    ).mappings().all()

    corridors = db.execute(
        text(f"SELECT corridor_id, zone, train_count, station_a_code, station_b_code FROM core.corridors c WHERE zone IS NOT NULL {zone_clause}"),
        {"zone": zone},
    ).mappings().all()
    corridor_info = {r["corridor_id"]: r for r in corridors}
    corridors_by_zone: dict[str, int] = {}
    for r in corridors:
        corridors_by_zone[r["zone"]] = corridors_by_zone.get(r["zone"], 0) + 1

    # Backlog relevant to the month: due in it, or still open and overdue
    # coming into it, or placed in it.
    placed_ids = {str(a["defect_id"]) for a in assignments if a["defect_id"]}
    backlog = db.execute(
        text(
            f"""
            SELECT d.defect_id, d.corridor_id, c.zone, d.department, d.defect_type, d.severity_code, d.due_date, d.detected_date,
                   d.workflow_status, d.priority_score, d.defer_count, d.speed_restriction_kmph, d.rescheduled_at, d.estimated_block_hours
            FROM core.defects d JOIN core.corridors c ON c.corridor_id = d.corridor_id
            WHERE (d.due_date BETWEEN :s AND :e OR (d.workflow_status NOT IN ('completed', 'cleared') AND d.due_date < :s) OR d.defect_id = ANY(:placed))
              {zone_clause}
            """
        ),
        {"s": start, "e": end, "zone": zone, "placed": list(placed_ids)},
    ).mappings().all()
    today = date.today()

    # ---- possession accounting (same definitions as optimizer/kpis.py) ----
    by_window: dict[str, list] = {}
    for a in assignments:
        by_window.setdefault(str(a["window_id"]) if a["window_id"] else str(a["assignment_id"]), []).append(a)

    def possession(group: list) -> float:
        return (max(x["allocated_end"] for x in group) - min(x["allocated_start"] for x in group)).total_seconds() / 3600.0

    job_hours = sum(_hours(a) for a in assignments)
    possession_hours = sum(possession(g) for g in by_window.values())
    joint_blocks = sum(1 for g in by_window.values() if len(g) > 1)
    multi_dept_blocks = sum(1 for g in by_window.values() if len({x["department"] for x in g}) > 1)
    affected = {a["corridor_id"] for a in assignments}
    corridor_hours = len(corridors) * 24.0 * days
    affected_hours = len(affected) * 24.0 * days

    def pct(numer: float, denom: float, digits: int = 3) -> float:
        return round(100.0 * (1.0 - numer / denom), digits) if denom else 100.0

    on_time = sum(1 for a in assignments if a["due_date"] is None or a["allocated_start"].astimezone(IST).date() <= a["due_date"])

    # ---- per corridor ----------------------------------------------------
    per_corridor: dict[str, dict] = {}
    for key, group in by_window.items():
        cid = group[0]["corridor_id"]
        entry = per_corridor.setdefault(
            cid,
            {
                "corridor_id": cid,
                "zone": group[0]["zone"],
                "stations": f"{group[0]['station_a_code']}→{group[0]['station_b_code']}",
                "train_count": int(group[0]["train_count"] or 0),
                "block_events": 0, "jobs": 0, "possession_hours": 0.0, "job_hours": 0.0, "joint_blocks": 0, "multi_dept_blocks": 0,
                "departments": set(), "on_time": 0, "late": 0, "severity_a": 0, "rescheduled": 0,
                "open_requests": 0, "overdue_requests": 0,
            },
        )
        entry["block_events"] += 1
        entry["jobs"] += len(group)
        entry["possession_hours"] += possession(group)
        entry["job_hours"] += sum(_hours(x) for x in group)
        entry["joint_blocks"] += 1 if len(group) > 1 else 0
        entry["multi_dept_blocks"] += 1 if len({x["department"] for x in group}) > 1 else 0
        for x in group:
            entry["departments"].add(x["department"])
            if x["due_date"] is None or x["allocated_start"].astimezone(IST).date() <= x["due_date"]:
                entry["on_time"] += 1
            else:
                entry["late"] += 1
            entry["severity_a"] += 1 if x["severity_code"] == "A" else 0
            entry["rescheduled"] += 1 if x["rescheduled_at"] else 0
    for d in backlog:
        if d["workflow_status"] in ("pending", "awaiting_dept_response", "awaiting_controller"):
            cid = d["corridor_id"]
            info = corridor_info.get(cid)
            entry = per_corridor.setdefault(
                cid,
                {
                    "corridor_id": cid, "zone": d["zone"],
                    "stations": f"{info['station_a_code']}→{info['station_b_code']}" if info else "",
                    "train_count": int(info["train_count"] or 0) if info else 0,
                    "block_events": 0, "jobs": 0, "possession_hours": 0.0, "job_hours": 0.0, "joint_blocks": 0, "multi_dept_blocks": 0,
                    "departments": set(), "on_time": 0, "late": 0, "severity_a": 0, "rescheduled": 0,
                    "open_requests": 0, "overdue_requests": 0,
                },
            )
            entry["open_requests"] += 1
            if d["due_date"] and d["due_date"] < today:
                entry["overdue_requests"] += 1
    corridor_rows = []
    for e in per_corridor.values():
        e["departments"] = sorted(e["departments"])
        e["possession_hours"] = round(e["possession_hours"], 2)
        e["job_hours"] = round(e["job_hours"], 2)
        e["hours_saved"] = round(max(e["job_hours"] - e["possession_hours"], 0.0), 2)
        e["availability_pct"] = pct(e["possession_hours"], 24.0 * days, 2)
        corridor_rows.append(e)
    corridor_rows.sort(key=lambda e: (-e["possession_hours"], -e["open_requests"], e["corridor_id"]))

    # ---- per zone ----------------------------------------------------------
    per_zone: dict[str, dict] = {}
    for z, n in corridors_by_zone.items():
        per_zone[z] = {"zone": z, "corridors": n, "affected_corridors": 0, "block_events": 0, "jobs": 0, "possession_hours": 0.0, "job_hours": 0.0,
                       "joint_blocks": 0, "open_requests": 0, "overdue_requests": 0, "rescheduled": 0}
    for e in corridor_rows:
        zc = per_zone.setdefault(e["zone"], {"zone": e["zone"], "corridors": 0, "affected_corridors": 0, "block_events": 0, "jobs": 0, "possession_hours": 0.0, "job_hours": 0.0,
                                             "joint_blocks": 0, "open_requests": 0, "overdue_requests": 0, "rescheduled": 0})
        zc["affected_corridors"] += 1 if e["block_events"] else 0
        for k in ("block_events", "jobs", "possession_hours", "job_hours", "joint_blocks", "open_requests", "overdue_requests", "rescheduled"):
            zc[k] += e[k]
    zone_rows = []
    for zc in per_zone.values():
        zc["possession_hours"] = round(zc["possession_hours"], 1)
        zc["job_hours"] = round(zc["job_hours"], 1)
        zc["availability_pct"] = pct(zc["possession_hours"], zc["corridors"] * 24.0 * days)
        zc["availability_pct_affected"] = pct(zc["possession_hours"], zc["affected_corridors"] * 24.0 * days, 2)
        zone_rows.append(zc)
    zone_rows.sort(key=lambda z: (-z["block_events"], -z["open_requests"], z["zone"]))

    # ---- per department / work type / day ---------------------------------
    dept: dict[str, dict] = {}
    for a in assignments:
        e = dept.setdefault(a["department"], {"jobs": 0, "hours": 0.0, "open": 0, "overdue": 0, "rescheduled": 0})
        e["jobs"] += 1
        e["hours"] += _hours(a)
        e["rescheduled"] += 1 if a["rescheduled_at"] else 0
    work: dict[str, dict] = {}
    for a in assignments:
        e = work.setdefault(a["defect_type"] or "unknown", {"defect_type": a["defect_type"] or "unknown", "department": a["department"], "jobs": 0, "hours": 0.0, "open": 0})
        e["jobs"] += 1
        e["hours"] += _hours(a)
    def _day(a) -> str:
        return a["allocated_start"].astimezone(IST).date().isoformat()

    daily: dict[str, dict] = {}
    for a in assignments:
        e = daily.setdefault(_day(a), {"jobs": 0, "hours": 0.0, "block_events": 0, "corridors": set()})
        e["jobs"] += 1
        e["hours"] += _hours(a)
        e["corridors"].add(a["corridor_id"])
    for g in by_window.values():
        daily[_day(min(g, key=lambda x: x["allocated_start"]))]["block_events"] += 1

    # Time-of-day profile: how many possessions start in each hour, and how
    # many possession-minutes fall in each hour of the day (a block 01:30–
    # 04:00 puts 30 min in hour 1, 60 in 2, 60 in 3).
    hourly = [{"hour": h, "block_starts": 0, "possession_minutes": 0} for h in range(24)]
    for g in by_window.values():
        b_start = min(x["allocated_start"] for x in g).astimezone(IST)
        b_end = max(x["allocated_end"] for x in g).astimezone(IST)
        hourly[b_start.hour]["block_starts"] += 1
        cursor = b_start
        while cursor < b_end:
            nxt = min(b_end, (cursor + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0))
            hourly[cursor.hour]["possession_minutes"] += int((nxt - cursor).total_seconds() // 60)
            cursor = nxt
    for h in hourly:
        h["possession_hours"] = round(h["possession_minutes"] / 60.0, 2)

    # ---- backlog -----------------------------------------------------------
    status_counts: dict[str, int] = {}
    sev_counts: dict[str, int] = {}
    overdue_open = 0
    for d in backlog:
        status_counts[d["workflow_status"]] = status_counts.get(d["workflow_status"], 0) + 1
        sev_counts[d["severity_code"]] = sev_counts.get(d["severity_code"], 0) + 1
        de = dept.setdefault(d["department"], {"jobs": 0, "hours": 0.0, "open": 0, "overdue": 0, "rescheduled": 0})
        if d["workflow_status"] in ("pending", "awaiting_dept_response", "awaiting_controller"):
            de["open"] += 1
            if d["due_date"] and d["due_date"] < today:
                de["overdue"] += 1
                overdue_open += 1
        we = work.setdefault(d["defect_type"] or "unknown", {"defect_type": d["defect_type"] or "unknown", "department": d["department"], "jobs": 0, "hours": 0.0, "open": 0})
        if d["workflow_status"] in ("pending", "awaiting_dept_response", "awaiting_controller"):
            we["open"] += 1
    for e in dept.values():
        e["hours"] = round(e["hours"], 1)
    work_rows = sorted(work.values(), key=lambda w: (-w["jobs"], -w["open"], w["defect_type"]))
    for w in work_rows:
        w["hours"] = round(w["hours"], 1)
    day_rows = []
    for k in sorted(daily):
        e = daily[k]
        day_rows.append({"day": k, "jobs": e["jobs"], "hours": round(e["hours"], 2), "corridors": len(e["corridors"]), "block_events": e["block_events"]})

    # Blocks that cancel trains: a flagged job's block overlaps timetabled
    # passages, and those runs are cancelled or postponed for it.
    flagged = [a for a in assignments if a["traffic_suspended"]]
    trains_cancelled = 0
    closure_rows = []
    if flagged:
        from etl.timetable import traversals_for_version, version_for_day

        cache: dict[int, dict[str, list[tuple[int, int]]]] = {}
        cids = sorted({a["corridor_id"] for a in flagged})
        for a in flagged:
            day = a["allocated_start"].astimezone(IST).date()
            s_min = a["allocated_start"].astimezone(IST).hour * 60 + a["allocated_start"].astimezone(IST).minute
            e_min = s_min + int((a["allocated_end"] - a["allocated_start"]).total_seconds() // 60)
            vid = version_for_day(db, day)
            n = 0
            if vid is not None:
                if vid not in cache:
                    cache[vid] = traversals_for_version(db, vid, cids)
                n = sum(1 for dep, arr in cache[vid].get(a["corridor_id"], []) if dep < e_min and arr > s_min)
            trains_cancelled += n
            closure_rows.append({"defect_id": str(a["defect_id"]), "corridor_id": a["corridor_id"], "zone": a["zone"], "department": a["department"], "defect_type": a["defect_type"],
                                 "block_start": a["allocated_start"], "block_end": a["allocated_end"], "trains_cancelled": n})

    scores = [float(d["priority_score"]) for d in backlog if d["priority_score"] is not None]
    defers = [int(d["defer_count"] or 0) for d in backlog]

    lateness_days = [(a["allocated_start"].astimezone(IST).date() - a["due_date"]).days for a in assignments if a["due_date"]]
    return {
        "period": period,
        "start": start,
        "end": end,
        "days": days,
        "zone": zone,
        "summary": {
            "corridors": len(corridors),
            "affected_corridors": len(affected),
            "block_events": len(by_window),
            "jobs_scheduled": len(assignments),
            "possession_hours": round(possession_hours, 1),
            "job_hours": round(job_hours, 1),
            "hours_saved_by_joint_blocks": round(max(job_hours - possession_hours, 0.0), 1),
            "joint_blocks": joint_blocks,
            "multi_dept_blocks": multi_dept_blocks,
            "availability_pct": pct(possession_hours, corridor_hours),
            "availability_pct_unbundled": pct(job_hours, corridor_hours),
            "availability_pct_affected": pct(possession_hours, affected_hours, 2),
            "availability_pct_affected_unbundled": pct(job_hours, affected_hours, 2),
            "corridor_hours_available": round(corridor_hours, 1),
            "scheduled_on_time": on_time,
            "scheduled_late": len(assignments) - on_time,
            "severity_a_scheduled": sum(1 for a in assignments if a["severity_code"] == "A"),
            "speed_restrictions_scheduled": sum(1 for a in assignments if a["speed_restriction_kmph"] is not None),
            "rescheduled_from_overdue": sum(1 for a in assignments if a["rescheduled_at"]),
            "system_planned": sum(1 for a in assignments if a["approved_by"] == "system"),
            "backlog_total": len(backlog),
            "backlog_open": sum(status_counts.get(s, 0) for s in ("pending", "awaiting_dept_response", "awaiting_controller")),
            "backlog_overdue_open": overdue_open,
            "backlog_completed": status_counts.get("completed", 0),
            "avg_priority": round(sum(scores) / len(scores), 1) if scores else None,
            "avg_defer_count": round(sum(defers) / len(defers), 2) if defers else 0.0,
            "max_defer_count": max(defers) if defers else 0,
            "blocks_cancelling_trains": len(closure_rows),
            "trains_cancelled": trains_cancelled,
        },
        "closures": closure_rows,
        "status_counts": status_counts,
        "severity_counts": sev_counts,
        "departments": dept,
        "work_types": work_rows,
        "daily": day_rows,
        "hourly": hourly,
        "zones": zone_rows,
        "corridors": corridor_rows,
        # raw distributions, binned client-side
        "priority_scores": scores,
        "lateness_days": lateness_days,
    }
