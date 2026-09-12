from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from app import reset
from app.auth import CurrentUser, require_role

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])
CamelModel = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class ResetRequest(BaseModel):
    model_config = CamelModel
    confirm: str
    horizon_days: int = 35


class ResetJobStatus(BaseModel):
    model_config = CamelModel
    job_id: str
    status: str
    stage: str | None = None
    progress: int
    started_at: str
    finished_at: str | None = None
    error: str | None = None
    log: list[str]
    stats: dict


@router.post("/reset", status_code=202)
def start_reset(body: ResetRequest, request: Request, user: CurrentUser = Depends(require_role("CONTROLLER"))):
    """Wipe everything except login accounts and reload the network from
    mapData/. Runs in the background; poll GET /reset/{jobId}."""
    if body.confirm != "RESET":
        raise HTTPException(400, 'type RESET to confirm')
    try:
        job_id = reset.start_reset(getattr(request.app.state, "scheduler", None), requested_by=user.username, horizon_days=body.horizon_days)
    except RuntimeError as exc:
        return JSONResponse(status_code=409, content={"detail": "a reset is already running", "jobId": str(exc)})
    return {"jobId": job_id, "status": "running"}


@router.get("/reset/{job_id}", response_model=ResetJobStatus)
def reset_status(job_id: str, user: CurrentUser = Depends(require_role("CONTROLLER"))):
    job = reset.get_job(job_id)
    if not job:
        raise HTTPException(404, "no such reset job (the server may have restarted)")
    return ResetJobStatus.model_validate(job)
