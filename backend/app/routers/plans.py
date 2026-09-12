from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user, require_role
from app.db import get_db
from app.schemas import BlockAssignment, BlockPlan, BulkPlanResult, ModelVersion, PeriodKpis, PlanHistoryEntry, PlanKpis, RejectPlanBody
from optimizer.kpis import compute_period_kpis, compute_plan_kpis
from optimizer.run import (
    approve_plan,
    generate_and_approve_all,
    generate_monthly_plan,
    generate_weekly_plan,
    regenerate_current_month_plan,
    reject_plan,
)

router = APIRouter(prefix="/api/v1/plans", tags=["plans"])
CamelModel = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class GeneratePlanRequest(BaseModel):
    model_config = CamelModel
    zone: str | None = None
    time_limit_s: int = 120


class GenerateMonthlyPlanRequest(GeneratePlanRequest):
    months_ahead: int = 1


@router.get("", response_model=list[BlockPlan])
def list_plans(
    horizon: str | None = Query(None),
    status: str | None = Query(None),
    zone: str | None = Query(None),
    limit: int = Query(50, le=2000),
    db: Session = Depends(get_db),
):
    clauses, params = [], {"limit": limit}
    if horizon:
        clauses.append("horizon_type = :horizon")
        params["horizon"] = horizon
    if status:
        clauses.append("status = :status")
        params["status"] = status
    if zone:
        clauses.append("zone = :zone")
        params["zone"] = zone
    q = "SELECT * FROM plan.block_plans"
    if clauses:
        q += " WHERE " + " AND ".join(clauses)
    q += " ORDER BY generated_at DESC LIMIT :limit"
    rows = db.execute(text(q), params).mappings().all()
    return [BlockPlan.model_validate(dict(r)) for r in rows]


_KPI_STATUSES = {"approved", "pending_approval", "superseded", "rejected"}


@router.get("/kpis", response_model=PeriodKpis)
def get_period_kpis(
    horizon: str = Query(..., pattern="^(monthly|weekly)$"),
    period: str = Query(..., min_length=6, max_length=12),
    statuses: str = Query("approved,pending_approval"),
    zone: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """One period across zones: one plan per zone (statuses in preference
    order), counts and hours summed, percentages re-derived from the sums."""
    wanted = [s.strip() for s in statuses.split(",") if s.strip()]
    bad = [s for s in wanted if s not in _KPI_STATUSES]
    if bad or not wanted:
        raise HTTPException(400, f"unknown status: {', '.join(bad) or '(none)'}")
    try:
        return PeriodKpis.model_validate(compute_period_kpis(db, horizon, period, wanted, zone))
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/{plan_id}/assignments", response_model=list[BlockAssignment])
def get_plan_assignments(plan_id: str, db: Session = Depends(get_db)):
    rows = db.execute(
        text("SELECT * FROM plan.block_assignments WHERE plan_id = :id ORDER BY allocated_start"), {"id": plan_id}
    ).mappings().all()
    return [BlockAssignment.model_validate(dict(r)) for r in rows]


@router.get("/{plan_id}/kpis", response_model=PlanKpis)
def get_plan_kpis(plan_id: str, db: Session = Depends(get_db)):
    """Asset-availability KPIs for one plan: how much infrastructure it takes
    out of service and for how long, how efficiently it bundles work into
    joint possessions, what it clears from the backlog, and what it keeps
    running."""
    try:
        return PlanKpis.model_validate(compute_plan_kpis(db, plan_id))
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post("/monthly/generate", response_model=BlockPlan)
def generate_monthly(body: GenerateMonthlyPlanRequest, user: CurrentUser = Depends(require_role("CONTROLLER")), db: Session = Depends(get_db)):
    try:
        plan_id = generate_monthly_plan(body.zone, body.time_limit_s, months_ahead=body.months_ahead)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    row = db.execute(text("SELECT * FROM plan.block_plans WHERE plan_id = :id"), {"id": plan_id}).mappings().first()
    return BlockPlan.model_validate(dict(row))


@router.post("/monthly/regenerate-current", response_model=BlockPlan)
def regenerate_current_monthly(body: GeneratePlanRequest, user: CurrentUser = Depends(require_role("CONTROLLER")), db: Session = Depends(get_db)):
    try:
        plan_id = regenerate_current_month_plan(body.zone, body.time_limit_s)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    row = db.execute(text("SELECT * FROM plan.block_plans WHERE plan_id = :id"), {"id": plan_id}).mappings().first()
    return BlockPlan.model_validate(dict(row))


@router.post("/weekly/generate", response_model=BlockPlan)
def generate_weekly(body: GeneratePlanRequest, user: CurrentUser = Depends(require_role("CONTROLLER")), db: Session = Depends(get_db)):
    try:
        plan_id = generate_weekly_plan(body.zone, time_limit_s=body.time_limit_s)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    row = db.execute(text("SELECT * FROM plan.block_plans WHERE plan_id = :id"), {"id": plan_id}).mappings().first()
    return BlockPlan.model_validate(dict(row))


@router.post("/monthly/generate-approve-all", response_model=list[BulkPlanResult])
def generate_approve_all_monthly(body: GenerateMonthlyPlanRequest, user: CurrentUser = Depends(require_role("CONTROLLER"))):
    return generate_and_approve_all("monthly", user.username, months_ahead=body.months_ahead, time_limit_s=body.time_limit_s)


@router.post("/weekly/generate-approve-all", response_model=list[BulkPlanResult])
def generate_approve_all_weekly(body: GeneratePlanRequest, user: CurrentUser = Depends(require_role("CONTROLLER"))):
    return generate_and_approve_all("weekly", user.username, time_limit_s=body.time_limit_s)


@router.post("/{plan_id}/approve", response_model=BlockPlan)
def approve(plan_id: str, user: CurrentUser = Depends(require_role("CONTROLLER")), db: Session = Depends(get_db)):
    try:
        approve_plan(plan_id, user.username)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    row = db.execute(text("SELECT * FROM plan.block_plans WHERE plan_id = :id"), {"id": plan_id}).mappings().first()
    return BlockPlan.model_validate(dict(row))


@router.post("/{plan_id}/reject", response_model=BlockPlan)
def reject(plan_id: str, body: RejectPlanBody, user: CurrentUser = Depends(require_role("CONTROLLER")), db: Session = Depends(get_db)):
    try:
        reject_plan(plan_id, user.username, body.reason)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    row = db.execute(text("SELECT * FROM plan.block_plans WHERE plan_id = :id"), {"id": plan_id}).mappings().first()
    return BlockPlan.model_validate(dict(row))


@router.get("/models", response_model=list[ModelVersion])
def list_model_versions(limit: int = Query(50, le=200), db: Session = Depends(get_db)):
    """Every priority-ranker retrain: when, its holdout score, and whether it was promoted."""
    rows = db.execute(text("SELECT * FROM plan.model_versions ORDER BY trained_at DESC LIMIT :limit"), {"limit": limit}).mappings().all()
    return [ModelVersion.model_validate(dict(r)) for r in rows]


@router.get("/history", response_model=list[PlanHistoryEntry])
def get_history(
    period_label: str | None = Query(None, alias="periodLabel"),
    horizon_type: str | None = Query(None, alias="horizonType"),
    limit: int = Query(100, le=500),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    clauses, params = [], {"limit": limit}
    if period_label:
        clauses.append("period_label = :period")
        params["period"] = period_label
    if horizon_type:
        clauses.append("horizon_type = :htype")
        params["htype"] = horizon_type
    q = "SELECT * FROM plan.plan_history"
    if clauses:
        q += " WHERE " + " AND ".join(clauses)
    q += " ORDER BY snapshot_at DESC LIMIT :limit"
    rows = db.execute(text(q), params).mappings().all()

    entries = [dict(r) for r in rows]
    if user.role != "CONTROLLER":
        # A snapshot spans every department active in that zone's plan — a
        # department should only see the slice of it that's theirs.
        scoped = []
        for e in entries:
            e["payload"] = [row for row in (e["payload"] or []) if row.get("department") == user.role]
            if e["payload"]:
                scoped.append(e)
        entries = scoped

    return [PlanHistoryEntry.model_validate(e) for e in entries]
