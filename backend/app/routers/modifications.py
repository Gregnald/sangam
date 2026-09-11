from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user, require_role
from app.db import get_db
from app.schemas import DecisionBody, ModificationRequest
from workflow.engine import decide_modification

router = APIRouter(prefix="/api/v1/modifications", tags=["modifications"])


_BASE_QUERY = """
    SELECT m.*, d.defect_type, d.severity_code, d.estimated_block_hours,
           d.requested_window_start AS original_window_start, d.requested_window_end AS original_window_end
    FROM plan.modification_requests m
    LEFT JOIN core.defects d ON d.defect_id = m.defect_id
"""


@router.get("", response_model=list[ModificationRequest])
def list_modifications(
    status: str | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    clauses, params = [], {}
    if user.role != "CONTROLLER":
        clauses.append("m.requesting_department = :dept")
        params["dept"] = user.role
    if status:
        clauses.append("m.status = :status")
        params["status"] = status

    q = _BASE_QUERY
    if clauses:
        q += " WHERE " + " AND ".join(clauses)
    q += " ORDER BY m.created_at DESC LIMIT 500"
    rows = db.execute(text(q), params).mappings().all()
    return [ModificationRequest.model_validate(dict(r)) for r in rows]


@router.post("/{request_id}/decide", response_model=ModificationRequest)
def decide(
    request_id: str,
    body: DecisionBody,
    user: CurrentUser = Depends(require_role("CONTROLLER")),
    db: Session = Depends(get_db),
):
    try:
        decide_modification(request_id, body.approve, user.username, body.reason)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    row = db.execute(text(_BASE_QUERY + " WHERE m.request_id = :id"), {"id": request_id}).mappings().first()
    return ModificationRequest.model_validate(dict(row))
