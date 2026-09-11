from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta

from sqlalchemy import text

from app.compatibility import is_compatible
from app.config import get_settings
from app.db import engine
from app.goods_forecast import clip_window_rows, load_bands
from workflow.events import log_event
from optimizer.run import week_bounds

logger = logging.getLogger("sangam.workflow.engine")

SEARCH_HORIZON_DAYS = 21


def _retrain_and_rescore() -> None:
    """Fold the just-decided controller override into the priority model
    (retrain with the label nudge, promote only if it holds up on holdout)
    and rescore the live backlog against whichever model is current. Failure
    here must never take down the workflow action that triggered it — a
    stale model is a much smaller problem than a broken approval."""
    from ml import score_priority
    from scripts import retrain_ranker

    try:
        retrain_ranker.retrain()
        score_priority.score()
    except Exception:
        logger.exception("retrain-on-override failed; leaving the existing model in place")


def interim_priority(severity_code: str, speed_restriction_active: bool, defer_count: int) -> float:
    base = {"A": 85.0, "B": 55.0, "C": 30.0}.get(severity_code, 30.0)
    base += defer_count * 8
    if severity_code == "A" and speed_restriction_active:
        base = max(base, 90.0)
    return min(base, 100.0)


def _active_weekly_plan(conn, zone: str, anchor: date | None = None) -> dict | None:
    _, _, label = week_bounds(anchor)
    row = conn.execute(
        text(
            """
            SELECT * FROM plan.block_plans
            WHERE zone = :zone AND horizon_type = 'weekly' AND period_label = :label AND status = 'approved'
            ORDER BY approved_at DESC LIMIT 1
            """
        ),
        {"zone": zone, "label": label},
    ).mappings().first()
    return dict(row) if row else None


def _window_usage(conn, plan_id: str, window_id: str) -> tuple[dict[str, float], str | None]:
    """What already sits in this window of the live plan: hours queued per
    department (same-department jobs run back to back inside a possession,
    so they add up) and the possession's joint-block group id, if it has one.
    Departments run in parallel, so one department's queue never counts
    against another's."""
    rows = conn.execute(
        text("SELECT department, allocated_start, allocated_end, joint_block_group_id FROM plan.block_assignments WHERE plan_id = :p AND window_id = :w"),
        {"p": plan_id, "w": window_id},
    ).mappings().all()
    hours_by_dept: dict[str, float] = {}
    group_id = None
    for r in rows:
        hours_by_dept[r["department"]] = hours_by_dept.get(r["department"], 0.0) + (r["allocated_end"] - r["allocated_start"]).total_seconds() / 3600.0
        group_id = group_id or (str(r["joint_block_group_id"]) if r["joint_block_group_id"] else None)
    return hours_by_dept, group_id


def _fits(conn, hours_by_dept: dict[str, float], department: str, duration_hours: float, window_capacity_hours: float, max_concurrent: int, window_id: str | None = None) -> bool:
    """Same rules as the optimizer: my department's queue (existing + this
    job) must fit the window; the set of departments present must stay within
    the window's concurrency cap; every other department present must be
    allowed to share a possession with mine."""
    if hours_by_dept.get(department, 0.0) + duration_hours > float(window_capacity_hours) + 1e-6:
        return False
    combined = set(hours_by_dept) | {department}
    if len(combined) > max_concurrent:
        return False
    for other in hours_by_dept:
        if other != department and not is_compatible(conn, department, other, window_id=window_id):
            return False
    return True


def _join_possession(conn, plan_id: str, window_id: str, group_id: str | None) -> str | None:
    """Adding a job to a window that already holds work turns that window
    into a joint block: every job in it shares one group id (the existing
    one, or a fresh one if the window held a single ungrouped job)."""
    if group_id:
        return group_id
    existing = conn.execute(
        text("SELECT count(*) FROM plan.block_assignments WHERE plan_id = :p AND window_id = :w"), {"p": plan_id, "w": window_id}
    ).scalar() or 0
    if not existing:
        return None
    new_group = str(uuid.uuid4())
    conn.execute(
        text("UPDATE plan.block_assignments SET joint_block_group_id = :g WHERE plan_id = :p AND window_id = :w"),
        {"g": new_group, "p": plan_id, "w": window_id},
    )
    return new_group


def _notify(conn, recipient_role: str, message: str, related_request_id: str | None = None) -> None:
    conn.execute(
        text(
            "INSERT INTO plan.notifications (recipient_role, message, related_request_id) VALUES (:role, :msg, :req)"
        ),
        {"role": recipient_role, "msg": message, "req": related_request_id},
    )


def submit_request(
    department: str,
    corridor_id: str,
    asset_id: str,
    defect_type: str,
    severity_code: str,
    estimated_block_hours: float,
    due_date: date,
    requested_by: str,
    requested_window_start: datetime | None = None,
    requested_window_end: datetime | None = None,
    speed_restriction_kmph: int | None = None,
) -> dict:
    settings = get_settings()
    defect_id = str(uuid.uuid4())
    source_map = {"ENGG": "TMS", "SIGNAL": "SMMS", "TRD": "TDMS"}
    score = interim_priority(severity_code, speed_restriction_kmph is not None, 0)

    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO core.defects
                    (defect_id, source_system, asset_id, corridor_id, defect_type, severity_code, department,
                     detected_date, due_date, speed_restriction_kmph, estimated_block_hours,
                     requested_window_start, requested_window_end, requested_by, workflow_status, priority_score)
                VALUES
                    (:id, :src, :asset, :corridor, :dtype, :sev, :dept, CURRENT_DATE, :due, :speed, :hours,
                     :ws, :we, :by, 'pending', :score)
                """
            ),
            {
                "id": defect_id, "src": source_map[department], "asset": asset_id, "corridor": corridor_id,
                "dtype": defect_type, "sev": severity_code, "dept": department, "due": due_date, "speed": speed_restriction_kmph,
                "hours": estimated_block_hours, "ws": requested_window_start, "we": requested_window_end, "by": requested_by,
                "score": score,
            },
        )

        zone = conn.execute(text("SELECT zone FROM core.corridors WHERE corridor_id = :c"), {"c": corridor_id}).scalar()
        log_event(conn, defect_id, "submitted", None, "pending", requested_by, f"{department} · {defect_type} · sev {severity_code} · {estimated_block_hours:.2f} h")
        outcome = _place(conn, defect_id, department, corridor_id, zone, estimated_block_hours, score, requested_window_start, requested_window_end, settings.preemption_margin)

    return {"defect_id": defect_id, "outcome": outcome}


def place_existing_defect(defect_id: str) -> str:
    """Run a defect that's already in core.defects (e.g. from a bulk Excel
    ingest, once it's been scored) through the same placement attempt an
    individually-submitted request gets — auto-schedule into the current
    approved week, offer a reschedule, or flag a preemption for the
    controller. A freshly ingested row otherwise has no way to reach the
    published plan except waiting for the next full plan generation."""
    settings = get_settings()
    with engine.begin() as conn:
        row = conn.execute(
            text(
                """
                SELECT corridor_id, department, estimated_block_hours, priority_score,
                       requested_window_start, requested_window_end
                FROM core.defects WHERE defect_id = :id AND workflow_status = 'pending'
                """
            ),
            {"id": defect_id},
        ).mappings().first()
        if not row or row["priority_score"] is None:
            return "skipped"

        zone = conn.execute(text("SELECT zone FROM core.corridors WHERE corridor_id = :c"), {"c": row["corridor_id"]}).scalar()
        return _place(
            conn, defect_id, row["department"], row["corridor_id"], zone,
            float(row["estimated_block_hours"]), float(row["priority_score"]),
            row["requested_window_start"], row["requested_window_end"], settings.preemption_margin,
        )


def _place(conn, defect_id: str, department: str, corridor_id: str, zone: str | None, duration_hours: float, score: float, requested_start: datetime | None, requested_end: datetime | None, preemption_margin: float) -> str:
    if not zone:
        return "pending"

    active_plan = _active_weekly_plan(conn, zone)
    if not active_plan:
        return "pending"

    windows = conn.execute(
        text(
            """
            SELECT window_id, corridor_id, window_start, window_end, max_concurrent_depts,
                   EXTRACT(EPOCH FROM (window_end - window_start)) / 3600.0 AS duration_hours
            FROM core.corridor_block_windows
            WHERE corridor_id = :corridor AND window_start::date BETWEEN :ws AND :we
            ORDER BY window_start
            """
        ),
        {"corridor": corridor_id, "ws": active_plan["horizon_start"], "we": active_plan["horizon_end"]},
    ).mappings().all()
    windows = clip_window_rows(
        [dict(w) for w in windows],
        load_bands(conn, [corridor_id], active_plan["horizon_start"], active_plan["horizon_end"]),
    )

    # A request pinned to a specific window only auto-schedules if it fits
    # *at that time* — anything else is a different deal than what the
    # department asked for and needs their confirmation (see the
    # matching/other split below). A request with no pinned time has nothing
    # to confirm against, so any fit anywhere this week is fine to apply
    # directly.
    if requested_start and requested_end:
        matching = [w for w in windows if w["window_start"] <= requested_start and w["window_end"] >= requested_end]
        other = [w for w in windows if w not in matching]
    else:
        matching = list(windows)
        other = []

    def _find_fit(candidates: list) -> dict | None:
        # Windows that already hold a possession come first: joining an
        # existing block costs the corridor nothing extra, a fresh window is
        # a new outage. Among equals, keep the plan's chronological order.
        def _usage(w):
            return _window_usage(conn, active_plan["plan_id"], str(w["window_id"]))

        ranked = sorted(candidates, key=lambda w: (0 if _usage(w)[0] else 1, w["window_start"]))
        for w in ranked:
            if w["duration_hours"] < duration_hours:
                continue
            hours_by_dept, _ = _usage(w)
            if _fits(conn, hours_by_dept, department, duration_hours, w["duration_hours"], w["max_concurrent_depts"], window_id=str(w["window_id"])):
                return w
        return None

    direct_fit = _find_fit(matching)
    if direct_fit:
        hours_by_dept, group_id = _window_usage(conn, active_plan["plan_id"], str(direct_fit["window_id"]))
        # Queue behind my own department's jobs already in this possession;
        # other departments work alongside from the window's start.
        allocated_start = direct_fit["window_start"] + timedelta(hours=hours_by_dept.get(department, 0.0))
        allocated_end = allocated_start + timedelta(hours=duration_hours)
        group_id = _join_possession(conn, active_plan["plan_id"], str(direct_fit["window_id"]), group_id)
        conn.execute(
            text(
                """
                INSERT INTO plan.block_assignments (plan_id, window_id, corridor_id, defect_id, department, allocated_start, allocated_end, joint_block_group_id)
                VALUES (:plan, :win, :corridor, :defect, :dept, :start, :end, :group)
                """
            ),
            {"plan": active_plan["plan_id"], "win": str(direct_fit["window_id"]), "corridor": corridor_id, "defect": defect_id, "dept": department, "start": allocated_start, "end": allocated_end, "group": group_id},
        )
        conn.execute(text("UPDATE core.defects SET workflow_status = 'scheduled', updated_at = now() WHERE defect_id = :id"), {"id": defect_id})
        log_event(conn, defect_id, "scheduled", "pending", "scheduled", "system", f"auto-placed {allocated_start:%Y-%m-%d %H:%M}–{allocated_end:%H:%M} on {corridor_id}" + (" (joined an existing possession)" if group_id else ""))
        return "scheduled"

    preemption_target = conn.execute(
        text(
            """
            SELECT a.assignment_id, a.window_id, a.defect_id, a.department, a.allocated_start, a.allocated_end, d.priority_score
            FROM plan.block_assignments a
            JOIN core.defects d ON d.defect_id = a.defect_id
            WHERE a.plan_id = :plan AND a.corridor_id = :corridor
            ORDER BY d.priority_score ASC LIMIT 1
            """
        ),
        {"plan": active_plan["plan_id"], "corridor": corridor_id},
    ).mappings().first()

    if preemption_target and score - float(preemption_target["priority_score"] or 0) >= preemption_margin:
        request_id = str(uuid.uuid4())
        conn.execute(
            text(
                """
                INSERT INTO plan.modification_requests
                    (request_id, request_type, defect_id, requesting_department, target_plan_id,
                     affected_defect_id, affected_department, proposed_corridor_id,
                     proposed_window_start, proposed_window_end, description, status)
                VALUES (:id, 'preemption', :defect, :dept, :plan, :affected, :adept, :corridor, :ws, :we, :desc, 'pending_controller')
                """
            ),
            {
                "id": request_id, "defect": defect_id, "dept": department, "plan": active_plan["plan_id"],
                "affected": preemption_target["defect_id"], "adept": preemption_target["department"], "corridor": corridor_id,
                "ws": preemption_target["allocated_start"], "we": preemption_target["allocated_end"],
                "desc": f"{department} request has priority score {score:.0f}, exceeding the currently scheduled {preemption_target['department']} job (score {float(preemption_target['priority_score'] or 0):.0f}) by the preemption margin. Approving will bump that job back to the backlog and schedule this one in its place.",
            },
        )
        conn.execute(text("UPDATE core.defects SET workflow_status = 'awaiting_controller', updated_at = now() WHERE defect_id = :id"), {"id": defect_id})
        _notify(conn, "CONTROLLER", f"{department} submitted a high-priority request that requires bumping an existing scheduled block on {corridor_id}.", request_id)
        log_event(conn, defect_id, "preemption_requested", "pending", "awaiting_controller", "system", f"asks to bump {preemption_target['department']} block {preemption_target['allocated_start']:%Y-%m-%d %H:%M} on {corridor_id}")
        return "preemption_pending"

    # `other` is only non-empty when the department pinned a specific time
    # and it didn't work out — that's the case an alternate-window offer
    # makes sense for. With no pinned time, `matching` already covered every
    # window this week, so there's nothing left to offer as an "alternate."
    alt_window = _find_fit(other) if other else None

    if alt_window:
        request_id = str(uuid.uuid4())
        conn.execute(
            text(
                """
                INSERT INTO plan.modification_requests
                    (request_id, request_type, defect_id, requesting_department, target_plan_id,
                     proposed_corridor_id, proposed_window_start, proposed_window_end, description, status)
                VALUES (:id, 'reschedule', :defect, :dept, :plan, :corridor, :ws, :we, :desc, 'pending_dept')
                """
            ),
            {
                "id": request_id, "defect": defect_id, "dept": department, "plan": active_plan["plan_id"], "corridor": corridor_id,
                "ws": alt_window["window_start"], "we": alt_window["window_start"] + timedelta(hours=duration_hours),
                "desc": f"No capacity at the requested time on {corridor_id}. Nearest available window: {alt_window['window_start']} - {alt_window['window_end']}.",
            },
        )
        conn.execute(text("UPDATE core.defects SET workflow_status = 'awaiting_dept_response', updated_at = now() WHERE defect_id = :id"), {"id": defect_id})
        log_event(conn, defect_id, "reschedule_offered", "pending", "awaiting_dept_response", "system", f"offered {alt_window['window_start']:%Y-%m-%d %H:%M} on {corridor_id}")
        return "reschedule_offered"

    return "pending"


def respond_to_reschedule(request_id: str, accept: bool, responder: str) -> None:
    with engine.begin() as conn:
        req = conn.execute(text("SELECT * FROM plan.modification_requests WHERE request_id = :id"), {"id": request_id}).mappings().first()
        if not req or req["status"] != "pending_dept":
            raise ValueError("no such pending reschedule request")

        if accept:
            conn.execute(text("UPDATE plan.modification_requests SET status = 'pending_controller' WHERE request_id = :id"), {"id": request_id})
            conn.execute(text("UPDATE core.defects SET workflow_status = 'awaiting_controller', updated_at = now() WHERE defect_id = :id"), {"id": req["defect_id"]})
            _notify(conn, "CONTROLLER", f"{req['requesting_department']} accepted a rescheduled window on {req['proposed_corridor_id']}. Modify the plan?", request_id)
            log_event(conn, req["defect_id"], "reschedule_accepted", "awaiting_dept_response", "awaiting_controller", responder, f"accepted {req['proposed_window_start']:%Y-%m-%d %H:%M}; awaiting controller")
        else:
            conn.execute(
                text("UPDATE plan.modification_requests SET status = 'rejected', decided_at = now(), decided_by = :by WHERE request_id = :id"),
                {"id": request_id, "by": responder},
            )
            conn.execute(text("UPDATE core.defects SET workflow_status = 'pending', defer_count = defer_count + 1, updated_at = now() WHERE defect_id = :id"), {"id": req["defect_id"]})
            log_event(conn, req["defect_id"], "reschedule_rejected", "awaiting_dept_response", "pending", responder, "department declined the offered window; deferred")


def _apply_modification_approval(conn, req, request_id: str, controller: str, reason: str | None) -> None:
    window_row = conn.execute(
        text(
            """
            SELECT window_id, max_concurrent_depts,
                   EXTRACT(EPOCH FROM (window_end - window_start)) / 3600.0 AS duration_hours
            FROM core.corridor_block_windows
            WHERE corridor_id = :corridor AND window_start = :ws
            """
        ),
        {"corridor": req["proposed_corridor_id"], "ws": req["proposed_window_start"]},
    ).mappings().first()

    if req["request_type"] == "preemption":
        conn.execute(text("DELETE FROM plan.block_assignments WHERE assignment_id = (SELECT assignment_id FROM plan.block_assignments WHERE defect_id = :d AND plan_id = :p LIMIT 1)"), {"d": req["affected_defect_id"], "p": req["target_plan_id"]})
        conn.execute(
            text("UPDATE core.defects SET workflow_status = 'pending', defer_count = defer_count + 1, updated_at = now() WHERE defect_id = :id"),
            {"id": req["affected_defect_id"]},
        )
        _notify(conn, req["affected_department"], f"Your scheduled block on {req['proposed_corridor_id']} was bumped by a higher-priority {req['requesting_department']} request. It has returned to the backlog.", request_id)
        log_event(conn, req["affected_defect_id"], "bumped", "scheduled", "pending", controller, f"displaced by a higher-priority {req['requesting_department']} request on {req['proposed_corridor_id']}; deferred")

    defect = conn.execute(text("SELECT estimated_block_hours FROM core.defects WHERE defect_id = :id"), {"id": req["defect_id"]}).mappings().first()
    group_id = None
    start = req["proposed_window_start"]
    if window_row:
        # Same joint-possession rules as auto-placement: queue behind my own
        # department's work in that window and share the group id with
        # whatever else is in it.
        hours_by_dept, group_id = _window_usage(conn, req["target_plan_id"], str(window_row["window_id"]))
        start = start + timedelta(hours=hours_by_dept.get(req["requesting_department"], 0.0))
        group_id = _join_possession(conn, req["target_plan_id"], str(window_row["window_id"]), group_id)
    conn.execute(
        text(
            """
            INSERT INTO plan.block_assignments (plan_id, window_id, corridor_id, defect_id, department, allocated_start, allocated_end, joint_block_group_id)
            VALUES (:plan, :win, :corridor, :defect, :dept, :start, :end, :group)
            """
        ),
        {
            "plan": req["target_plan_id"], "win": window_row["window_id"] if window_row else None, "corridor": req["proposed_corridor_id"],
            "defect": req["defect_id"], "dept": req["requesting_department"], "start": start,
            "end": start + timedelta(hours=float(defect["estimated_block_hours"])), "group": group_id,
        },
    )
    conn.execute(text("UPDATE core.defects SET workflow_status = 'scheduled', updated_at = now() WHERE defect_id = :id"), {"id": req["defect_id"]})
    conn.execute(
        text("UPDATE plan.modification_requests SET status = 'approved', decided_at = now(), decided_by = :by, decision_reason = :reason WHERE request_id = :id"),
        {"id": request_id, "by": controller, "reason": reason},
    )
    _notify(conn, req["requesting_department"], f"Controller approved your schedule change on {req['proposed_corridor_id']}.", request_id)
    log_event(conn, req["defect_id"], "scheduled", "awaiting_controller", "scheduled", controller, f"controller approved {req['request_type']}: {start:%Y-%m-%d %H:%M} on {req['proposed_corridor_id']}" + (f" — {reason}" if reason else ""))


def decide_modification(request_id: str, approve: bool, controller: str, reason: str | None = None) -> None:
    with engine.begin() as conn:
        req = conn.execute(text("SELECT * FROM plan.modification_requests WHERE request_id = :id"), {"id": request_id}).mappings().first()
        if not req or req["status"] not in ("pending_controller",):
            raise ValueError("request is not awaiting controller decision")

        if not approve:
            conn.execute(
                text("UPDATE plan.modification_requests SET status = 'rejected', decided_at = now(), decided_by = :by, decision_reason = :reason WHERE request_id = :id"),
                {"id": request_id, "by": controller, "reason": reason},
            )
            conn.execute(text("UPDATE core.defects SET workflow_status = 'pending', defer_count = defer_count + 1, updated_at = now() WHERE defect_id = :id"), {"id": req["defect_id"]})
            _notify(conn, req["requesting_department"], f"Controller rejected your requested schedule change on {req['proposed_corridor_id'] or ''}: {reason or 'no reason given'}.", request_id)
            log_event(conn, req["defect_id"], "modification_rejected", "awaiting_controller", "pending", controller, f"controller rejected {req['request_type']}: {reason or 'no reason given'}; deferred")
        else:
            _apply_modification_approval(conn, req, request_id, controller, reason)

    # A controller approval/rejection is exactly the human "override" signal
    # the ranker should learn from — retrain (with that decision folded in as
    # a label nudge) and rescore the backlog right away rather than waiting
    # for the next unrelated ingestion to happen to trigger it.
    _retrain_and_rescore()
