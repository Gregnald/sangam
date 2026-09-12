from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user, require_role
from app.db import get_db
from app.schemas import DefectEvent, DefectRequest, PriorityFactor, RescheduleResponseBody, SubmitRequestBody, SubmitRequestResponse
from workflow.events import log_event
from workflow.engine import respond_to_reschedule, submit_request

router = APIRouter(prefix="/api/v1/requests", tags=["requests"])

_BASE_QUERY = """
    SELECT d.defect_id, d.source_system, d.asset_id, d.corridor_id, c.zone, d.defect_type, d.severity_code, d.department,
           d.detected_date, d.due_date, d.speed_restriction_kmph, d.estimated_block_hours,
           d.requested_window_start, d.requested_window_end, d.requested_by, d.defer_count,
           d.workflow_status, d.priority_score, d.priority_explanation, d.updated_at, d.rescheduled_at,
           live.allocated_start, live.allocated_end, live.plan_id, live.plan_period_label, live.joint_block_group_id,
           live.group_departments, live.group_size,
           ev.event_type AS last_event_type, ev.occurred_at AS last_event_at, ev.details AS last_event_details, ev.actor AS last_event_actor,
           (d.workflow_status IN ('pending', 'awaiting_dept_response', 'awaiting_controller') AND d.due_date < CURRENT_DATE) AS is_overdue,
           CASE
             WHEN d.workflow_status = 'completed' THEN 'completed'
             WHEN d.workflow_status = 'scheduled' AND live.allocated_start <= now() AND live.allocated_end > now() THEN 'in_progress'
             WHEN d.workflow_status = 'scheduled' AND live.allocated_start > now() THEN 'upcoming'
             WHEN d.workflow_status = 'scheduled' AND live.allocated_end <= now() THEN 'completed'
             ELSE NULL
           END AS execution_state
    FROM core.defects d
    LEFT JOIN core.corridors c ON c.corridor_id = d.corridor_id
    -- The live block, if any: from an approved plan, weekly plans authoritative over the monthly copy.
    LEFT JOIN LATERAL (
        SELECT a.allocated_start, a.allocated_end, a.plan_id, a.joint_block_group_id, p.period_label AS plan_period_label,
               (SELECT array_agg(DISTINCT g.department ORDER BY g.department) FROM plan.block_assignments g
                 WHERE g.joint_block_group_id = a.joint_block_group_id AND a.joint_block_group_id IS NOT NULL) AS group_departments,
               (SELECT count(*) FROM plan.block_assignments g
                 WHERE g.joint_block_group_id = a.joint_block_group_id AND a.joint_block_group_id IS NOT NULL) AS group_size
        FROM plan.block_assignments a JOIN plan.block_plans p ON p.plan_id = a.plan_id
        WHERE a.defect_id = d.defect_id AND p.status = 'approved'
        ORDER BY (p.horizon_type = 'weekly') DESC, a.allocated_start DESC
        LIMIT 1
    ) live ON TRUE
    LEFT JOIN LATERAL (
        SELECT e.event_type, e.occurred_at, e.details, e.actor FROM core.defect_events e
        WHERE e.defect_id = d.defect_id ORDER BY e.occurred_at DESC LIMIT 1
    ) ev ON TRUE
"""


def _row_to_schema(row: dict) -> DefectRequest:
    row = dict(row)
    row["priority_explanation"] = (
        [PriorityFactor.model_validate(f) for f in row["priority_explanation"]] if row["priority_explanation"] else None
    )
    return DefectRequest.model_validate(row)


@router.get("", response_model=list[DefectRequest])
def list_requests(
    department: str | None = Query(None),
    workflow_status: str | None = Query(None, alias="workflowStatus"),
    severity: str | None = Query(None),
    corridor_id: str | None = Query(None, alias="corridorId"),
    limit: int = Query(1000, le=5000),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    clauses, params = [], {"limit": limit}
    if user.role != "CONTROLLER":
        clauses.append("d.department = :dept")
        params["dept"] = user.role
    elif department:
        clauses.append("d.department = :dept")
        params["dept"] = department
    if workflow_status:
        clauses.append("d.workflow_status = :status")
        params["status"] = workflow_status
    if severity:
        clauses.append("d.severity_code = :sev")
        params["sev"] = severity
    if corridor_id:
        clauses.append("d.corridor_id = :corridor")
        params["corridor"] = corridor_id

    q = _BASE_QUERY
    if clauses:
        q += " WHERE " + " AND ".join(clauses)
    q += " ORDER BY d.priority_score DESC NULLS LAST, d.due_date ASC LIMIT :limit"

    rows = db.execute(text(q), params).mappings().all()
    return [_row_to_schema(r) for r in rows]


@router.get("/events", response_model=list[DefectEvent])
def list_events(
    department: str | None = Query(None),
    defect_id: str | None = Query(None, alias="defectId"),
    event_type: str | None = Query(None, alias="eventType"),
    limit: int = Query(500, le=5000),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The backlog's audit trail — every status transition, newest first."""
    clauses, params = [], {"limit": limit}
    if user.role != "CONTROLLER":
        clauses.append("d.department = :dept")
        params["dept"] = user.role
    elif department:
        clauses.append("d.department = :dept")
        params["dept"] = department
    if defect_id:
        clauses.append("e.defect_id = :defect")
        params["defect"] = defect_id
    if event_type:
        clauses.append("e.event_type = :etype")
        params["etype"] = event_type
    q = """
        SELECT e.event_id, e.defect_id, e.event_type, e.from_status, e.to_status, e.actor, e.details, e.occurred_at,
               d.department, d.corridor_id, c.zone, d.defect_type, d.severity_code
        FROM core.defect_events e
        JOIN core.defects d ON d.defect_id = e.defect_id
        LEFT JOIN core.corridors c ON c.corridor_id = d.corridor_id
    """
    if clauses:
        q += " WHERE " + " AND ".join(clauses)
    q += " ORDER BY e.occurred_at DESC LIMIT :limit"
    rows = db.execute(text(q), params).mappings().all()
    return [DefectEvent.model_validate(dict(r)) for r in rows]


@router.post("", response_model=SubmitRequestResponse)
def create_request(
    body: SubmitRequestBody,
    user: CurrentUser = Depends(require_role("ENGG", "SIGNAL", "TRD")),
):
    result = submit_request(
        department=user.role,
        corridor_id=body.corridor_id,
        asset_id=body.asset_id,
        defect_type=body.defect_type,
        severity_code=body.severity_code,
        estimated_block_hours=body.estimated_block_hours,
        due_date=body.due_date,
        requested_by=user.username,
        requested_window_start=body.requested_window_start,
        requested_window_end=body.requested_window_end,
        speed_restriction_kmph=body.speed_restriction_kmph,
    )
    return SubmitRequestResponse.model_validate(result)


@router.post("/{defect_id}/clear")
def clear_request(defect_id: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.execute(text("SELECT department FROM core.defects WHERE defect_id = :id"), {"id": defect_id}).mappings().first()
    if not row:
        raise HTTPException(404, "request not found")
    if user.role != "CONTROLLER" and user.role != row["department"]:
        raise HTTPException(403, "not your department's request")
    prev = db.execute(text("SELECT workflow_status FROM core.defects WHERE defect_id = :id"), {"id": defect_id}).scalar()
    db.execute(text("UPDATE core.defects SET workflow_status = 'cleared', updated_at = now() WHERE defect_id = :id"), {"id": defect_id})
    log_event(db, defect_id, "cleared", prev, "cleared", user.username, "withdrawn")
    db.commit()
    return {"ok": True}


@router.post("/reschedule/{request_id}/respond")
def respond(
    request_id: str,
    body: RescheduleResponseBody,
    user: CurrentUser = Depends(require_role("ENGG", "SIGNAL", "TRD")),
    db: Session = Depends(get_db),
):
    req = db.execute(text("SELECT requesting_department FROM plan.modification_requests WHERE request_id = :id"), {"id": request_id}).mappings().first()
    if not req:
        raise HTTPException(404, "request not found")
    if req["requesting_department"] != user.role:
        raise HTTPException(403, "not your department's request")
    try:
        respond_to_reschedule(request_id, body.accept, user.username)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True}
