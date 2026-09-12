from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import text

from optimizer.pair_compat import load_pair_compatibility
from app.config import get_settings
from app.db import engine
from app.goods_forecast import clip_window_rows, load_bands
from workflow.events import log_event
from optimizer.run import _insert_assignment, _insert_plan_row, _load_windows, _snapshot, week_bounds

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
    try:
        from ml.pair_compat_model import train as train_pair_model

        with engine.connect() as conn:
            train_pair_model(conn)
    except Exception:
        logger.exception("pair-compatibility model retrain failed; leaving the existing model in place")


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


def _window_usage(conn, plan_id: str, window_id: str) -> tuple[dict[str, float], str | None, list[tuple[str, float | None]]]:
    """What already sits in this window of the live plan: hours queued per
    department (same-department jobs run back to back inside a possession,
    so they add up), the possession's joint-block group id, and where each
    job's kind of work (department, work type) for the compatibility check.
    Departments run in parallel, so one department's queue never counts
    against another's."""
    rows = conn.execute(
        text(
            """
            SELECT b.department, b.allocated_start, b.allocated_end, b.joint_block_group_id, d.defect_type
            FROM plan.block_assignments b
            LEFT JOIN core.defects d ON d.defect_id = b.defect_id
            WHERE b.plan_id = :p AND b.window_id = :w
            """
        ),
        {"p": plan_id, "w": window_id},
    ).mappings().all()
    hours_by_dept: dict[str, float] = {}
    group_id = None
    sites: list[_JobLike] = []
    for r in rows:
        hours_by_dept[r["department"]] = hours_by_dept.get(r["department"], 0.0) + (r["allocated_end"] - r["allocated_start"]).total_seconds() / 3600.0
        group_id = group_id or (str(r["joint_block_group_id"]) if r["joint_block_group_id"] else None)
        sites.append(_JobLike(r["department"], r["defect_type"]))
    return hours_by_dept, group_id, sites


@dataclass
class _JobLike:
    department: str
    defect_type: str | None


def _fits(conn, hours_by_dept: dict[str, float], department: str, duration_hours: float, window_capacity_hours: float, window_id: str | None = None, sites: list[_JobLike] | None = None, defect_type: str | None = None, pair_compat=None) -> tuple[bool, str]:
    """Can this job join what's already in the window? Same engine as the
    optimizer: my department's queue (existing + this job) must fit, and I
    must be compatible (work-type matrix) with every job already in the
    possession. Returns the verdict and the reason, so a refusal can be
    explained."""
    if hours_by_dept.get(department, 0.0) + duration_hours > float(window_capacity_hours) + 1e-6:
        return False, f"{department}'s queue in this window would exceed its {float(window_capacity_hours):.1f} h"
    engine_ = pair_compat or load_pair_compatibility(conn, [window_id] if window_id else [])
    verdict = engine_.check_against(_JobLike(department, defect_type), sites or [], window_id)
    return verdict.ok, verdict.reason


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
        outcome = _place(conn, defect_id, department, corridor_id, zone, estimated_block_hours, score, requested_window_start, requested_window_end, settings.preemption_margin, defect_type=defect_type)

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
                SELECT d.corridor_id, d.department, d.estimated_block_hours, d.priority_score,
                       d.requested_window_start, d.requested_window_end, d.defect_type
                FROM core.defects d
                WHERE d.defect_id = :id AND d.workflow_status = 'pending'
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
            defect_type=row["defect_type"],
        )


def _candidate_windows(conn, corridor_id: str, start: date, end: date) -> list[dict]:
    """The corridor's free windows on these days, with the Control Office
    goods-train bands carved out — exactly what the optimizer would see."""
    rows = conn.execute(
        text(
            """
            SELECT window_id, corridor_id, window_start, window_end, max_concurrent_depts,
                   EXTRACT(EPOCH FROM (window_end - window_start)) / 3600.0 AS duration_hours
            FROM core.active_block_windows
            WHERE corridor_id = :corridor AND window_start::date BETWEEN :ws AND :we
            ORDER BY window_start
            """
        ),
        {"corridor": corridor_id, "ws": start, "we": end},
    ).mappings().all()
    return clip_window_rows([dict(w) for w in rows], load_bands(conn, [corridor_id], start, end))


def _place(conn, defect_id: str, department: str, corridor_id: str, zone: str | None, duration_hours: float, score: float, requested_start: datetime | None, requested_end: datetime | None, preemption_margin: float, defect_type: str | None = None) -> str:
    if not zone:
        return "pending"

    active_plan = _active_weekly_plan(conn, zone)
    if not active_plan:
        return "pending"

    windows = _candidate_windows(conn, corridor_id, active_plan["horizon_start"], active_plan["horizon_end"])

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

    pair_compat = load_pair_compatibility(conn, [str(w["window_id"]) for w in windows])
    refusals: list[str] = []

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
            hours_by_dept, _, sites = _usage(w)
            ok, reason = _fits(conn, hours_by_dept, department, duration_hours, w["duration_hours"], window_id=str(w["window_id"]), sites=sites, defect_type=defect_type, pair_compat=pair_compat)
            if ok:
                return w
            if sites:
                # Only possessions we *tried to join* are worth explaining.
                refusals.append(f"{w['window_start']:%a %d %b %H:%M}: {reason}")
        return None

    direct_fit = _find_fit(matching)
    if direct_fit:
        hours_by_dept, group_id, _ = _window_usage(conn, active_plan["plan_id"], str(direct_fit["window_id"]))
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
                "desc": (
                    f"{department} request has priority score {score:.0f}, exceeding the currently scheduled {preemption_target['department']} job "
                    f"(score {float(preemption_target['priority_score'] or 0):.0f}) by the preemption margin. "
                    + (f"It could not simply join that possession: {refusals[0].split(': ', 1)[-1]}. " if refusals else "")
                    + "Approving will bump that job back to the backlog and schedule this one in its place."
                ),
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
                "desc": (
                    f"No capacity at the requested time on {corridor_id}"
                    + (f" ({refusals[0].split(': ', 1)[-1]})" if refusals else "")
                    + f". Nearest available window: {alt_window['window_start']:%Y-%m-%d %H:%M} - {alt_window['window_end']:%H:%M}."
                ),
            },
        )
        conn.execute(text("UPDATE core.defects SET workflow_status = 'awaiting_dept_response', updated_at = now() WHERE defect_id = :id"), {"id": defect_id})
        log_event(conn, defect_id, "reschedule_offered", "pending", "awaiting_dept_response", "system", f"offered {alt_window['window_start']:%Y-%m-%d %H:%M} on {corridor_id}")
        return "reschedule_offered"

    if refusals:
        log_event(conn, defect_id, "no_fit", None, None, "system", "could not join an existing possession — " + "; ".join(refusals[:3]) + ("; …" if len(refusals) > 3 else ""))
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
            conn.execute(text("UPDATE core.defects SET workflow_status = 'pending', defer_count = defer_count + 1, rescheduled_at = NULL, updated_at = now() WHERE defect_id = :id"), {"id": req["defect_id"]})
            log_event(conn, req["defect_id"], "reschedule_rejected", "awaiting_dept_response", "pending", responder, "department declined the offered window; deferred")


def _apply_modification_approval(conn, req, request_id: str, controller: str, reason: str | None) -> None:
    window_row = conn.execute(
        text(
            """
            SELECT window_id, max_concurrent_depts,
                   EXTRACT(EPOCH FROM (window_end - window_start)) / 3600.0 AS duration_hours
            FROM core.active_block_windows
            WHERE corridor_id = :corridor AND window_start = :ws
            """
        ),
        {"corridor": req["proposed_corridor_id"], "ws": req["proposed_window_start"]},
    ).mappings().first()

    if req["request_type"] == "preemption":
        conn.execute(text("DELETE FROM plan.block_assignments WHERE assignment_id = (SELECT assignment_id FROM plan.block_assignments WHERE defect_id = :d AND plan_id = :p LIMIT 1)"), {"d": req["affected_defect_id"], "p": req["target_plan_id"]})
        conn.execute(
            text("UPDATE core.defects SET workflow_status = 'pending', defer_count = defer_count + 1, rescheduled_at = NULL, updated_at = now() WHERE defect_id = :id"),
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
        hours_by_dept, group_id, _ = _window_usage(conn, req["target_plan_id"], str(window_row["window_id"]))
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
            conn.execute(text("UPDATE core.defects SET workflow_status = 'pending', defer_count = defer_count + 1, rescheduled_at = NULL, updated_at = now() WHERE defect_id = :id"), {"id": req["defect_id"]})
            _notify(conn, req["requesting_department"], f"Controller rejected your requested schedule change on {req['proposed_corridor_id'] or ''}: {reason or 'no reason given'}.", request_id)
            log_event(conn, req["defect_id"], "modification_rejected", "awaiting_controller", "pending", controller, f"controller rejected {req['request_type']}: {reason or 'no reason given'}; deferred")
        else:
            _apply_modification_approval(conn, req, request_id, controller, reason)

    # A controller approval/rejection is exactly the human "override" signal
    # the ranker should learn from — retrain (with that decision folded in as
    # a label nudge) and rescore the backlog right away rather than waiting
    # for the next unrelated ingestion to happen to trigger it.
    _retrain_and_rescore()


# How far ahead the overdue sweep looks for a slot. The window calendar is
# built 35 days out, so anything beyond this has no windows to place into.
OVERDUE_WEEKS_AHEAD = 4
RESCUE_SOLVE_SECONDS = 30


def _live_plan_for_week(conn, zone: str, week_start: date, week_end: date) -> tuple[dict, date, date] | None:
    """The plan whose assignments are live for these days: the week's own
    approved weekly plan if one exists, otherwise the approved monthly plan
    covering it (its copy of the week is the schedule until a weekly plan
    supersedes it). Returns (plan, range_start, range_end) or None."""
    weekly = _active_weekly_plan(conn, zone, anchor=week_start)
    if weekly:
        return weekly, week_start, week_end
    monthly = conn.execute(
        text(
            """
            SELECT * FROM plan.block_plans
            WHERE zone = :zone AND horizon_type = 'monthly' AND status = 'approved'
              AND horizon_start <= :start AND horizon_end >= :start
            ORDER BY approved_at DESC LIMIT 1
            """
        ),
        {"zone": zone, "start": week_start},
    ).mappings().first()
    if monthly:
        return dict(monthly), week_start, min(week_end, monthly["horizon_end"])
    return None


def _mark_rescheduled(conn, r, today: date, allocated_start: datetime, allocated_end: datetime, week_label: str, joined: bool, how: str) -> None:
    conn.execute(
        text("UPDATE core.defects SET workflow_status = 'scheduled', rescheduled_at = now(), updated_at = now() WHERE defect_id = :id"),
        {"id": r["defect_id"]},
    )
    days_late = (today - r["due_date"]).days
    plural = "s" if days_late != 1 else ""
    suffix = " — joined an existing possession" if joined else ""
    log_event(
        conn, str(r["defect_id"]), "auto_rescheduled", "pending", "scheduled", "system",
        f"overdue by {days_late} day{plural} (due {r['due_date']}); rescheduled to {allocated_start:%Y-%m-%d %H:%M}–{allocated_end:%H:%M} on {r['corridor_id']} (week {week_label}, {how}){suffix}",
    )
    work = (r["defect_type"] or "").replace("_", " ")
    _notify(
        conn, r["department"],
        f"Overdue request on {r['corridor_id']} ({work}, due {r['due_date']}) was rescheduled to {allocated_start:%a %d %b %H:%M}–{allocated_end:%H:%M}.",
    )


def _fit_into_live_plan(conn, plan: dict, range_start: date, range_end: date, rows: list, today: date, week_label: str) -> list:
    """Greedy placement into a plan that is already live: each overdue job
    (highest priority first) takes the first window it fits — an existing
    possession by preference, then the earliest free gap — under the same
    queue and compatibility rules as a fresh request. Returns the rows that
    still didn't fit."""
    left = []
    for r in rows:
        duration_hours = float(r["estimated_block_hours"])
        windows = _candidate_windows(conn, r["corridor_id"], range_start, range_end)
        pair_compat = load_pair_compatibility(conn, [str(w["window_id"]) for w in windows])
        usage = {str(w["window_id"]): _window_usage(conn, plan["plan_id"], str(w["window_id"])) for w in windows}
        ranked = sorted(windows, key=lambda w: (0 if usage[str(w["window_id"])][0] else 1, w["window_start"]))
        fit = None
        for w in ranked:
            if w["duration_hours"] < duration_hours:
                continue
            hours_by_dept, _, sites = usage[str(w["window_id"])]
            ok, _reason = _fits(conn, hours_by_dept, r["department"], duration_hours, w["duration_hours"], window_id=str(w["window_id"]), sites=sites, defect_type=r["defect_type"], pair_compat=pair_compat)
            if ok:
                fit = w
                break
        if not fit:
            left.append(r)
            continue
        hours_by_dept, group_id, _ = usage[str(fit["window_id"])]
        allocated_start = fit["window_start"] + timedelta(hours=hours_by_dept.get(r["department"], 0.0))
        allocated_end = allocated_start + timedelta(hours=duration_hours)
        group_id = _join_possession(conn, plan["plan_id"], str(fit["window_id"]), group_id)
        _insert_assignment(conn, plan["plan_id"], str(fit["window_id"]), r["corridor_id"], str(r["defect_id"]), r["department"], allocated_start, allocated_end, group_id)
        _mark_rescheduled(conn, r, today, allocated_start, allocated_end, week_label, bool(group_id), f"added to {plan['horizon_type']} plan {plan['period_label']}")
    return left


def _rescue_plan(conn, zone: str, week_start: date, week_end: date, week_label: str, rows: list, today: date) -> list:
    """No live plan covers this week for the zone, so nothing can be joined:
    solve one with CP-SAT over the overdue jobs alone — priority-weighted
    objective, work-type compatibility, goods-forecast clipping, traffic-
    weighted possession cost, bundling — and publish it as an approved weekly
    plan by `system`. The controller's next weekly solve for the same week
    re-solves these jobs alongside the rest of the backlog and supersedes
    it. Returns the rows the solver left out."""
    from ml.pair_compat_model import PairPreference
    from optimizer.model import Job, solve

    jobs = [
        Job(str(r["defect_id"]), r["corridor_id"], r["department"], float(r["priority_score"]), float(r["estimated_block_hours"]), r["due_date"], defect_type=r["defect_type"])
        for r in rows
    ]
    corridor_ids = sorted({r["corridor_id"] for r in rows})
    windows = _load_windows(conn, corridor_ids, week_start, week_end)
    if not windows:
        return list(rows)
    pair_compat = load_pair_compatibility(conn, [w.window_id for w in windows])
    result = solve(jobs, windows, pair_compat=pair_compat, pair_preference=PairPreference(), time_limit_s=RESCUE_SOLVE_SECONDS)
    if not result.assignments:
        return list(rows)

    plan_id = str(uuid.uuid4())
    _insert_plan_row(conn, plan_id, "weekly", week_label, week_start, week_end, zone, "approved", result.status, result.objective_value, result.solve_seconds)
    conn.execute(text("UPDATE plan.block_plans SET approved_by = 'system', approved_at = now() WHERE plan_id = :id"), {"id": plan_id})
    by_id = {str(r["defect_id"]): r for r in rows}
    for a in result.assignments:
        _insert_assignment(conn, plan_id, a.window_id, a.corridor_id, a.defect_id, a.department, a.allocated_start, a.allocated_end, a.joint_block_group_id)
        _mark_rescheduled(conn, by_id[a.defect_id], today, a.allocated_start, a.allocated_end, week_label, bool(a.joint_block_group_id), "system weekly plan")
    _snapshot(conn, plan_id, "weekly", week_label, "proposed")
    _snapshot(conn, plan_id, "weekly", week_label, "final")
    logger.info("rescue plan %s (%s, %s): %d of %d overdue jobs placed", plan_id, zone, week_label, len(result.assignments), len(rows))
    return [r for r in rows if str(r["defect_id"]) not in result.scheduled_defect_ids]


def reschedule_overdue(today: date | None = None) -> dict:
    """Reschedule every overdue backlog request (pending, past its due date)
    into the nearest upcoming week that can take it.

    Week by week, starting with next week: if the zone already has a live
    plan for that week (approved weekly, else approved monthly) the jobs are
    fitted into it in priority order, joining existing possessions by
    preference; if it has none, a weekly plan is solved for the overdue
    jobs with CP-SAT and published by `system`. Nothing is bumped and
    nothing is offered. A job no window can take within OVERDUE_WEEKS_AHEAD
    weeks stays overdue with a `no_fit` event saying why.

    Placed jobs are marked `rescheduled_at` (the RESCHEDULED tag in the
    UI) and their department is notified. Run by the clock once per
    operational day and after every plan approval."""
    today = today or date.today()
    with engine.begin() as conn:
        rows = conn.execute(
            text(
                """
                SELECT d.defect_id, d.department, d.corridor_id, d.defect_type, d.estimated_block_hours, d.due_date, d.priority_score, c.zone
                FROM core.defects d JOIN core.corridors c ON c.corridor_id = d.corridor_id
                WHERE d.workflow_status = 'pending' AND d.due_date < :today AND d.priority_score IS NOT NULL AND c.zone IS NOT NULL
                ORDER BY d.priority_score DESC, d.due_date
                """
            ),
            {"today": today},
        ).mappings().all()
        if not rows:
            return {"overdue": 0, "rescheduled": 0, "unplaced": 0}

        by_zone: dict[str, list] = {}
        for r in rows:
            by_zone.setdefault(r["zone"], []).append(r)

        unplaced: list = []
        for zone, zone_rows in by_zone.items():
            left = list(zone_rows)
            for k in range(1, OVERDUE_WEEKS_AHEAD + 1):
                if not left:
                    break
                week_start, week_end, week_label = week_bounds(today + timedelta(days=7 * k))
                live = _live_plan_for_week(conn, zone, week_start, week_end)
                if live:
                    plan, range_start, range_end = live
                    left = _fit_into_live_plan(conn, plan, range_start, range_end, left, today, week_label)
                else:
                    left = _rescue_plan(conn, zone, week_start, week_end, week_label, left, today)
            unplaced.extend(left)

        for r in unplaced:
            log_event(
                conn, str(r["defect_id"]), "no_fit", None, None, "system",
                f"overdue (due {r['due_date']}): no window on {r['corridor_id']} can take {float(r['estimated_block_hours']):.2f} h within the next {OVERDUE_WEEKS_AHEAD} weeks",
            )

    placed = len(rows) - len(unplaced)
    logger.info("overdue sweep: %d overdue, %d rescheduled, %d could not be placed", len(rows), placed, len(unplaced))
    return {"overdue": len(rows), "rescheduled": placed, "unplaced": len(unplaced)}
