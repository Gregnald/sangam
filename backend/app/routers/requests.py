from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user, require_role
from app.db import get_db
from app.schemas import DefectRequest, PriorityFactor, RescheduleResponseBody, SubmitRequestBody, SubmitRequestResponse
from workflow.engine import respond_to_reschedule, submit_request

router = APIRouter(prefix="/api/v1/requests", tags=["requests"])

_BASE_QUERY = """
    SELECT d.defect_id, d.source_system, d.asset_id, d.corridor_id, c.zone, d.defect_type, d.severity_code, d.department,
           d.detected_date, d.due_date, d.speed_restriction_kmph, d.estimated_block_hours,
           d.requested_window_start, d.requested_window_end, d.requested_by, d.defer_count,
           d.workflow_status, d.priority_score, d.priority_explanation
    FROM core.defects d
    LEFT JOIN core.corridors c ON c.corridor_id = d.corridor_id
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
    db.execute(text("UPDATE core.defects SET workflow_status = 'cleared', updated_at = now() WHERE defect_id = :id"), {"id": defect_id})
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
