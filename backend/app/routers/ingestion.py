from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from app.auth import CurrentUser, require_role
from etl import conform_defects, ingest_excel
from ml import score_priority
from scripts import retrain_ranker
from workflow.engine import place_existing_defect
from workflow.events import log_events
from app.db import engine as db_engine

logger = logging.getLogger("sangam.app.routers.ingestion")

router = APIRouter(prefix="/api/v1/ingest", tags=["ingestion"])
CamelModel = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class BacklogIngestResult(BaseModel):
    model_config = CamelModel
    rows_read: int
    rows_ingested: int
    rows_conformed: int
    errors: list[str]
    scheduled: int
    reschedule_offered: int
    preemption_pending: int
    still_pending: int
    model_promoted: bool


class ScheduleIngestResult(BaseModel):
    model_config = CamelModel
    rows_read: int
    rows_used: int
    unknown_stations: list[str]
    corridors_added: int
    corridors_updated: int
    traversals_added: int
    windows_added: int


@router.post("/backlog", response_model=BacklogIngestResult)
async def ingest_backlog_excel(
    department: Literal["ENGG", "SIGNAL", "TRD"] = Form(...),
    file: UploadFile = File(...),
    user: CurrentUser = Depends(require_role("CONTROLLER")),
):
    content = await file.read()
    try:
        rows = ingest_excel.parse_backlog_workbook(content)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not rows:
        raise HTTPException(400, "no usable rows found in the workbook")

    result = ingest_excel.ingest_backlog(department, rows, requested_by=user.username)
    new_defect_ids = conform_defects.conform()
    if new_defect_ids:
        with db_engine.begin() as conn:
            log_events(conn, new_defect_ids, "ingested", None, "pending", user.username, f"{department} backlog upload ({file.filename})")

    model_promoted = False
    if new_defect_ids:
        try:
            metrics = retrain_ranker.retrain()
            model_promoted = bool(metrics.get("promoted"))
        except Exception:
            logger.exception("retrain failed during ingestion; scoring with whatever model is currently promoted")
        score_priority.score()

    # A freshly-scored defect otherwise just sits at workflow_status='pending'
    # until someone happens to run a plan generation — put it through the
    # same placement attempt an individually-submitted request gets, so it's
    # either already scheduled, offered a reschedule, or flagged for the
    # controller by the time this call returns.
    outcomes = {"scheduled": 0, "reschedule_offered": 0, "preemption_pending": 0, "pending": 0, "skipped": 0}
    for defect_id in new_defect_ids:
        outcome = place_existing_defect(defect_id)
        outcomes[outcome] = outcomes.get(outcome, 0) + 1

    return BacklogIngestResult(
        rows_read=result["rows_read"],
        rows_ingested=result["rows_ingested"],
        rows_conformed=len(new_defect_ids),
        errors=result["errors"],
        scheduled=outcomes["scheduled"],
        reschedule_offered=outcomes["reschedule_offered"],
        preemption_pending=outcomes["preemption_pending"],
        still_pending=outcomes["pending"] + outcomes["skipped"],
        model_promoted=model_promoted,
    )


class GoodsForecastIngestResult(BaseModel):
    model_config = CamelModel
    rows_read: int
    bands_inserted: int
    bands_updated: int
    errors: list[str]
    windows_affected: int


@router.post("/goods-forecast", response_model=GoodsForecastIngestResult)
async def ingest_goods_forecast_excel(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(require_role("CONTROLLER")),
):
    """Control Office goods-train forecast: one row per corridor / date /
    time band. The planner treats each band as occupied when it builds
    weekly and monthly plans, so freight paths aren't blocked over."""
    content = await file.read()
    try:
        rows = ingest_excel.parse_goods_forecast_workbook(content)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not rows:
        raise HTTPException(400, "no usable rows found in the workbook")
    result = ingest_excel.ingest_goods_forecast(rows, uploaded_by=user.username)
    return GoodsForecastIngestResult.model_validate(result)


@router.post("/schedule", response_model=ScheduleIngestResult)
async def ingest_schedule_excel(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(require_role("CONTROLLER")),
):
    content = await file.read()
    try:
        rows = ingest_excel.parse_schedule_workbook(content)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not rows:
        raise HTTPException(400, "no usable rows found in the workbook")

    result = ingest_excel.ingest_schedule(rows)
    return ScheduleIngestResult.model_validate(result)
