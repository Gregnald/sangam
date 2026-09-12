from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import text

from optimizer.pair_compat import load_pair_compatibility
from app.config import get_settings
from app.db import engine
from app.goods_forecast import IST, clip_window_rows, load_bands
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
        outcome = _place(conn, defect_id, department, corridor_id, zone, estimated_block_hours, score, requested_window_start, requested_window_end, settings.preemption_margin, defect_type=defect_type, due_date=due_date)

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
                       d.requested_window_start, d.requested_window_end, d.defect_type, d.due_date
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
            defect_type=row["defect_type"], due_date=row["due_date"],
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


def _place(conn, defect_id: str, department: str, corridor_id: str, zone: str | None, duration_hours: float, score: float, requested_start: datetime | None, requested_end: datetime | None, preemption_margin: float, defect_type: str | None = None, due_date: date | None = None) -> str:
    if not zone:
        return "pending"

    now = datetime.now(IST)
    today = now.date()
    if requested_start and requested_end and requested_start < now:
        # The time it asked for has passed — treat it as "any time", it
        # can't be honoured any more.
        requested_start = requested_end = None

    created_plan = False
    if requested_start and requested_end:
        # A pinned request is judged in the week it asked for: that week's
        # live plan, or a system plan opened for it so the request has
        # somewhere to land (or be offered an alternate in).
        ws, we, label = week_bounds(requested_start.astimezone(IST).date())
        if ws > today + timedelta(days=7 * WEEKS_AHEAD):
            return "pending"
        active_plan, range_start, range_end, created_plan = _ensure_week_plan(conn, zone, ws, we, label)
    else:
        active_plan = _active_weekly_plan(conn, zone)
        if not active_plan:
            # Nothing live this week to join — go straight to the weeks ahead.
            return "scheduled" if _place_ahead(conn, defect_id, zone, today, now) else "pending"
        range_start, range_end = active_plan["horizon_start"], active_plan["horizon_end"]

    # Only windows that haven't started yet — a slot that's already gone
    # can't be given to anyone.
    windows = [w for w in _candidate_windows(conn, corridor_id, range_start, range_end) if w["window_start"] >= now]

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

    def _find_fit(candidates: list, plan_id: str | None = None) -> dict | None:
        # Windows that already hold a possession come first: joining an
        # existing block costs the corridor nothing extra, a fresh window is
        # a new outage. Among equals, keep the plan's chronological order.
        plan_id = plan_id or str(active_plan["plan_id"])

        def _usage(w):
            return _window_usage(conn, plan_id, str(w["window_id"]))

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
    # No on-time slot this week for an unpinned request: before asking to
    # bump anyone, look at the weeks ahead up to its due date — a clean slot
    # next week beats displacing a scheduled job this week.
    if not direct_fit and not (requested_start and requested_end) and _place_ahead(conn, defect_id, zone, today, now):
        return "scheduled"
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
        log_event(conn, defect_id, "scheduled", "pending", "scheduled", "system", f"auto-placed {allocated_start:%Y-%m-%d %H:%M}–{allocated_end:%H:%M} on {corridor_id} ({active_plan['horizon_type']} plan {active_plan['period_label']})" + (" (joined an existing possession)" if group_id else ""))
        if created_plan:
            _snapshot(conn, str(active_plan["plan_id"]), "weekly", active_plan["period_label"], "proposed")
            _snapshot(conn, str(active_plan["plan_id"]), "weekly", active_plan["period_label"], "final")
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
    offer_plan = active_plan
    if alt_window is None and requested_start and requested_end:
        # Nothing left in the week it asked for: offer the nearest slot in a
        # later week, as long as it's still on or before the due date.
        _, asked_week_end, _ = week_bounds(requested_start.astimezone(IST).date())
        for k in range(1, WEEKS_AHEAD + 1):
            ws, we, label = week_bounds(asked_week_end + timedelta(days=1 + 7 * (k - 1)))
            if due_date is not None and ws > due_date:
                break
            plan_k, rs, re_, _created = _ensure_week_plan(conn, zone, ws, we, label)
            later = [w for w in _candidate_windows(conn, corridor_id, rs, re_) if w["window_start"] >= now and (due_date is None or w["window_start"].astimezone(IST).date() <= due_date)]
            alt_window = _find_fit(later, str(plan_k["plan_id"])) if later else None
            if alt_window:
                offer_plan = plan_k
                break

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
                "id": request_id, "defect": defect_id, "dept": department, "plan": offer_plan["plan_id"], "corridor": corridor_id,
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


# How far ahead a job is chased for a slot. The window calendar is built 35
# days out, so anything beyond this has no windows to place into.
WEEKS_AHEAD = 4
# A pending job due within this many days is placed proactively by the daily
# sweep, so a due week nobody has planned yet doesn't stall it.
DUE_SOON_DAYS = 14
RESCUE_SOLVE_SECONDS = 30

_JOB_COLUMNS = """d.defect_id, d.department, d.corridor_id, d.defect_type, d.estimated_block_hours, d.due_date, d.priority_score,
                  d.requested_window_start, c.zone"""


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


def _ensure_week_plan(conn, zone: str, week_start: date, week_end: date, week_label: str) -> tuple[dict, date, date, bool]:
    """The live plan for this week, or — when the zone has none — a fresh,
    empty, approved weekly plan by `system` so that placements and offers
    for that week have a plan to live in. Returns (plan, range_start,
    range_end, created)."""
    live = _live_plan_for_week(conn, zone, week_start, week_end)
    if live:
        return live[0], live[1], live[2], False
    plan_id = str(uuid.uuid4())
    _insert_plan_row(conn, plan_id, "weekly", week_label, week_start, week_end, zone, "approved", "LIVE", 0.0, 0.0)
    conn.execute(text("UPDATE plan.block_plans SET approved_by = 'system', approved_at = now() WHERE plan_id = :id"), {"id": plan_id})
    plan = dict(conn.execute(text("SELECT * FROM plan.block_plans WHERE plan_id = :id"), {"id": plan_id}).mappings().first())
    logger.info("opened system weekly plan %s (%s, %s) for live placement", plan_id, zone, week_label)
    return plan, week_start, week_end, True


def _mark_placed(conn, r, today: date, allocated_start: datetime, allocated_end: datetime, week_label: str, joined: bool, how: str) -> None:
    """Record an automatic placement: status, the RESCHEDULED tag when the
    job was overdue, an event and a notification to the department."""
    overdue = r["due_date"] is not None and r["due_date"] < today
    conn.execute(
        text(
            "UPDATE core.defects SET workflow_status = 'scheduled', rescheduled_at = CASE WHEN :overdue THEN now() ELSE rescheduled_at END, updated_at = now() WHERE defect_id = :id"
        ),
        {"id": r["defect_id"], "overdue": overdue},
    )
    suffix = " — joined an existing possession" if joined else ""
    when = f"{allocated_start:%Y-%m-%d %H:%M}–{allocated_end:%H:%M} on {r['corridor_id']} (week {week_label}, {how})"
    if overdue:
        days_late = (today - r["due_date"]).days
        plural = "s" if days_late != 1 else ""
        log_event(conn, str(r["defect_id"]), "auto_rescheduled", "pending", "scheduled", "system", f"overdue by {days_late} day{plural} (due {r['due_date']}); rescheduled to {when}{suffix}")
        verb = "Overdue request"
    else:
        log_event(conn, str(r["defect_id"]), "scheduled", "pending", "scheduled", "system", f"auto-placed {when}{suffix}")
        verb = "Request"
    work = (r["defect_type"] or "").replace("_", " ")
    _notify(conn, r["department"], f"{verb} on {r['corridor_id']} ({work}, due {r['due_date']}) was scheduled for {allocated_start:%a %d %b %H:%M}–{allocated_end:%H:%M}.")


def _fit_into_live_plan(conn, plan: dict, range_start: date, range_end: date, rows: list, today: date, week_label: str, not_before: datetime | None = None, on_time_only: bool = False) -> list:
    """Greedy placement into a plan that is already live: each job (highest
    priority first) takes the first window it fits — an existing possession
    by preference, then the earliest free gap — under the same queue and
    compatibility rules as a fresh request. `on_time_only` refuses windows
    after the job's due date. Returns the rows that still didn't fit."""
    left = []
    for r in rows:
        duration_hours = float(r["estimated_block_hours"])
        windows = _candidate_windows(conn, r["corridor_id"], range_start, range_end)
        if not_before is not None:
            windows = [w for w in windows if w["window_start"] >= not_before]
        if on_time_only and r["due_date"] is not None:
            windows = [w for w in windows if w["window_start"].astimezone(IST).date() <= r["due_date"]]
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
        _mark_placed(conn, r, today, allocated_start, allocated_end, week_label, bool(group_id), f"added to {plan['horizon_type']} plan {plan['period_label']}")
    return left


def _rescue_plan(conn, zone: str, week_start: date, week_end: date, week_label: str, rows: list, today: date, not_before: datetime | None = None) -> list:
    """No live plan covers this week for the zone, so nothing can be joined:
    solve one with CP-SAT over these jobs alone — priority-weighted
    objective, work-type compatibility, goods-forecast clipping, traffic-
    weighted possession cost, lateness penalty, bundling — and publish it
    as an approved weekly plan by `system`. The controller's next weekly
    solve for the same week re-solves these jobs alongside the rest of the
    backlog and supersedes it. Returns the rows the solver left out."""
    from ml.pair_compat_model import PairPreference
    from optimizer.model import Job, solve

    jobs = [
        Job(str(r["defect_id"]), r["corridor_id"], r["department"], float(r["priority_score"]), float(r["estimated_block_hours"]), r["due_date"], defect_type=r["defect_type"])
        for r in rows
    ]
    corridor_ids = sorted({r["corridor_id"] for r in rows})
    windows = _load_windows(conn, corridor_ids, week_start, week_end)
    if not_before is not None:
        windows = [w for w in windows if w.start >= not_before]
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
        _mark_placed(conn, by_id[a.defect_id], today, a.allocated_start, a.allocated_end, week_label, bool(a.joint_block_group_id), "system weekly plan")
    _snapshot(conn, plan_id, "weekly", week_label, "proposed")
    _snapshot(conn, plan_id, "weekly", week_label, "final")
    logger.info("system plan %s (%s, %s): %d of %d jobs placed", plan_id, zone, week_label, len(result.assignments), len(rows))
    return [r for r in rows if str(r["defect_id"]) not in result.scheduled_defect_ids]


def _chase_slots(conn, zone: str, rows: list, today: date, now: datetime, first_week: int, on_time_only: bool) -> list:
    """Week by week from `first_week` weeks ahead (0 = this week), place
    these jobs into the zone's live plan for that week, or solve a system
    plan for it when there is none. With `on_time_only`, a job is only
    chased up to its due week and only into windows on or before its due
    date. Returns the rows that found nothing."""
    left = list(rows)
    for k in range(first_week, WEEKS_AHEAD + 1):
        if not left:
            break
        week_start, week_end, week_label = week_bounds(today + timedelta(days=7 * k))
        if on_time_only:
            # A job whose due date is before this week can't be placed on
            # time any more — leave it for the overdue sweep.
            candidates = [r for r in left if r["due_date"] is None or r["due_date"] >= week_start]
        else:
            candidates = left
        if not candidates:
            break
        not_before = now if k == 0 else None
        live = _live_plan_for_week(conn, zone, week_start, week_end)
        if live:
            plan, range_start, range_end = live
            remaining = _fit_into_live_plan(conn, plan, range_start, range_end, candidates, today, week_label, not_before=not_before, on_time_only=on_time_only)
        else:
            remaining = _rescue_plan(conn, zone, week_start, week_end, week_label, candidates, today, not_before=not_before)
        placed_ids = {str(r["defect_id"]) for r in candidates} - {str(r["defect_id"]) for r in remaining}
        left = [r for r in left if str(r["defect_id"]) not in placed_ids]
    return left


def _place_ahead(conn, defect_id: str, zone: str, today: date, now: datetime) -> bool:
    """Place-on-arrival, looking past this week: the weeks up to the
    request's due date, live plan or a system plan, on-time windows only."""
    row = conn.execute(
        text(f"SELECT {_JOB_COLUMNS} FROM core.defects d JOIN core.corridors c ON c.corridor_id = d.corridor_id WHERE d.defect_id = :id"),
        {"id": defect_id},
    ).mappings().first()
    if not row or row["priority_score"] is None:
        return False
    left = _chase_slots(conn, zone, [row], today, now, first_week=0, on_time_only=True)
    return not left


def reschedule_overdue(today: date | None = None) -> dict:
    """The daily sweep: keep block stalling to a minimum.

    - Overdue backlog (pending, past its due date) is placed into the
      nearest upcoming week that can take it — live plan or system plan —
      and tagged RESCHEDULED.
    - Backlog due within DUE_SOON_DAYS is placed the same way, but only on
      time: this week's remaining windows first, then each week up to the
      due week, so a due week nobody has planned yet never strands a job.

    Nothing is bumped and nothing is offered. A job no window can take gets
    a `no_fit` event saying why. Run by the clock once per operational day
    and after every plan approval."""
    now = datetime.now(IST)
    today = today or now.date()
    with engine.begin() as conn:
        rows = conn.execute(
            text(
                f"""
                SELECT {_JOB_COLUMNS}
                FROM core.defects d JOIN core.corridors c ON c.corridor_id = d.corridor_id
                WHERE d.workflow_status = 'pending' AND d.priority_score IS NOT NULL AND c.zone IS NOT NULL
                  AND d.due_date <= :horizon
                ORDER BY d.priority_score DESC, d.due_date
                """
            ),
            {"horizon": today + timedelta(days=DUE_SOON_DAYS)},
        ).mappings().all()
        if not rows:
            return {"overdue": 0, "due_soon": 0, "rescheduled": 0, "scheduled": 0, "unplaced": 0}

        overdue = [r for r in rows if r["due_date"] < today]
        due_soon = [r for r in rows if r["due_date"] >= today and r["requested_window_start"] is None]
        # A request pinned to a specific time goes through the request
        # workflow instead — placed at that time if it fits, else offered
        # the nearest alternate in that week (or a bump, if it outranks).
        pinned = [r for r in rows if r["due_date"] >= today and r["requested_window_start"] is not None]

        unplaced: list = []
        by_zone: dict[str, list] = {}
        for r in overdue:
            by_zone.setdefault(r["zone"], []).append(r)
        for zone, zone_rows in by_zone.items():
            unplaced.extend(_chase_slots(conn, zone, zone_rows, today, now, first_week=1, on_time_only=False))
        n_rescheduled = len(overdue) - len(unplaced)

        by_zone = {}
        for r in due_soon:
            by_zone.setdefault(r["zone"], []).append(r)
        still_pending: list = []
        for zone, zone_rows in by_zone.items():
            still_pending.extend(_chase_slots(conn, zone, zone_rows, today, now, first_week=0, on_time_only=True))
        n_scheduled = len(due_soon) - len(still_pending)

        margin = get_settings().preemption_margin
        pinned_outcomes: dict[str, int] = {}
        for r in pinned:
            end = r["requested_window_start"] + timedelta(hours=float(r["estimated_block_hours"]))
            outcome = _place(conn, str(r["defect_id"]), r["department"], r["corridor_id"], r["zone"], float(r["estimated_block_hours"]), float(r["priority_score"]),
                             r["requested_window_start"], end, margin, defect_type=r["defect_type"], due_date=r["due_date"])
            pinned_outcomes[outcome] = pinned_outcomes.get(outcome, 0) + 1
            if outcome == "pending":
                log_event(
                    conn, str(r["defect_id"]), "no_fit", None, None, "system",
                    f"asked for {r['requested_window_start']:%Y-%m-%d %H:%M}, due {r['due_date']}: no free window on {r['corridor_id']} up to the due date can take {float(r['estimated_block_hours']):.2f} h — needs a longer gap or a split job",
                )

        for r in still_pending:
            log_event(
                conn, str(r["defect_id"]), "no_fit", None, None, "system",
                f"due {r['due_date']}: no free window on {r['corridor_id']} on or before the due date can take {float(r['estimated_block_hours']):.2f} h — needs a longer gap or a split job",
            )
        for r in unplaced:
            log_event(
                conn, str(r["defect_id"]), "no_fit", None, None, "system",
                f"overdue (due {r['due_date']}): no window on {r['corridor_id']} can take {float(r['estimated_block_hours']):.2f} h within the next {WEEKS_AHEAD} weeks",
            )

    result = {"overdue": len(overdue), "due_soon": len(due_soon), "rescheduled": n_rescheduled, "scheduled": n_scheduled, "unplaced": len(unplaced), "due_soon_unplaced": len(still_pending), "pinned": pinned_outcomes}
    logger.info("daily sweep: %s", result)
    return result


def decide_block(assignment_id: str, approve: bool, controller: str, reason: str | None = None) -> dict:
    """The controller's verdict on one block of a plan that is still awaiting
    approval — from the Gantt, without approving or rejecting the whole plan.

    Accept: the block is kept and marked; approving the plan later publishes
    it with the rest. Reject: the block is removed from the proposal, so the
    request stays in the backlog for the next solve (its status doesn't
    change — nothing was live). Either way the decision is recorded in
    plan.block_decisions and treated as training signal: a label nudge for
    the priority ranker, and — when the block shared a possession with other
    departments — a compatibility decision about each such pair for the
    pairwise model. Both retrain right away."""
    with engine.begin() as conn:
        a = conn.execute(
            text(
                """
                SELECT a.*, p.status AS plan_status, p.period_label, p.zone, p.horizon_type,
                       d.defect_type, d.estimated_block_hours, c.train_count,
                       (SELECT max(train_count) FROM core.corridors z WHERE z.zone = c.zone) AS busiest
                FROM plan.block_assignments a
                JOIN plan.block_plans p ON p.plan_id = a.plan_id
                LEFT JOIN core.defects d ON d.defect_id = a.defect_id
                LEFT JOIN core.corridors c ON c.corridor_id = a.corridor_id
                WHERE a.assignment_id = :id
                """
            ),
            {"id": assignment_id},
        ).mappings().first()
        if not a:
            raise ValueError("block not found")
        if a["plan_status"] != "pending_approval":
            raise ValueError("only a block of a plan awaiting approval can be decided on its own")

        decision = "accepted" if approve else "rejected"
        conn.execute(
            text(
                """
                INSERT INTO plan.block_decisions
                    (plan_id, assignment_id, defect_id, corridor_id, department, allocated_start, allocated_end, decision, reason, decided_by)
                VALUES (:plan, :aid, :defect, :corridor, :dept, :s, :e, :decision, :reason, :by)
                """
            ),
            {"plan": a["plan_id"], "aid": assignment_id, "defect": a["defect_id"], "corridor": a["corridor_id"], "dept": a["department"],
             "s": a["allocated_start"], "e": a["allocated_end"], "decision": decision, "reason": reason, "by": controller},
        )

        # Partners in the same possession — each cross-department pair is a
        # compatibility decision in its own right.
        partners = []
        if a["joint_block_group_id"]:
            partners = conn.execute(
                text(
                    """
                    SELECT b.assignment_id, b.department, b.allocated_start, b.allocated_end, d.defect_type, d.estimated_block_hours
                    FROM plan.block_assignments b LEFT JOIN core.defects d ON d.defect_id = b.defect_id
                    WHERE b.plan_id = :plan AND b.joint_block_group_id = :g AND b.assignment_id != :id
                    """
                ),
                {"plan": a["plan_id"], "g": a["joint_block_group_id"], "id": assignment_id},
            ).mappings().all()
        if partners:
            from ml.pair_compat_model import log_decision

            traffic = float(a["train_count"] or 0) / float(a["busiest"] or 1)
            for b in partners:
                if b["department"] == a["department"]:
                    continue
                log_decision(
                    conn, source="block", decided_by=controller, dept_a=a["department"], dept_b=b["department"],
                    type_a=a["defect_type"], type_b=b["defect_type"],
                    duration_a_h=float(a["estimated_block_hours"]) if a["estimated_block_hours"] is not None else None,
                    duration_b_h=float(b["estimated_block_hours"]) if b["estimated_block_hours"] is not None else None,
                    traffic_factor=traffic, corridor_id=a["corridor_id"], window_id=str(a["window_id"]) if a["window_id"] else None,
                    compatible=approve,
                )

        where = f"{a['allocated_start']:%Y-%m-%d %H:%M}–{a['allocated_end']:%H:%M} on {a['corridor_id']}"
        plan_ref = f"proposed {a['horizon_type']} plan {a['period_label']} ({a['zone']})"
        if approve:
            conn.execute(
                text("UPDATE plan.block_assignments SET decision = 'accepted', decided_by = :by, decided_at = now() WHERE assignment_id = :id"),
                {"id": assignment_id, "by": controller},
            )
            if a["defect_id"]:
                log_event(conn, str(a["defect_id"]), "block_accepted", None, None, controller, f"controller accepted the block {where} in {plan_ref}" + (f" — {reason}" if reason else ""))
        else:
            conn.execute(text("DELETE FROM plan.block_assignments WHERE assignment_id = :id"), {"id": assignment_id})
            if a["joint_block_group_id"] and len(partners) == 1:
                # A possession of one is not a joint block any more.
                conn.execute(
                    text("UPDATE plan.block_assignments SET joint_block_group_id = NULL WHERE assignment_id = :id"),
                    {"id": partners[0]["assignment_id"]},
                )
            if a["defect_id"]:
                log_event(conn, str(a["defect_id"]), "block_rejected", None, None, controller, f"controller rejected the block {where} in {plan_ref}; stays in the backlog for the next solve" + (f" — {reason}" if reason else ""))

    # The smallest controller call is still a controller call — fold it in.
    _retrain_and_rescore()
    return {"assignment_id": assignment_id, "decision": decision, "partners": len(partners)}
