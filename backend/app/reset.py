"""Full system reset: everything except the login accounts.

Wipes every table but `core.users`, deletes trained model artifacts, then
reloads the network from `mapData/` and rebuilds the window calendar and the
seeded compatibility matrices — the state of a fresh install. The network
load takes minutes, so it runs in a background thread and the API exposes a
job status to poll. One reset at a time.
"""
from __future__ import annotations

import json
import logging
import threading
import traceback
import uuid
from datetime import datetime, timezone

from sqlalchemy import text

from app.config import MODELS_DIR
from app.db import engine

logger = logging.getLogger("sangam.app.reset")

# Every table except core.users. TRUNCATE ... CASCADE takes care of the
# foreign-key order; RESTART IDENTITY resets the timetable-version and
# traversal sequences so the reloaded bundled timetable is version 1 again.
TRUNCATE_TABLES = [
    "raw.defects_tms", "raw.defects_smms", "raw.defects_tdms",
    "core.stations", "core.corridors", "core.timetable_versions", "core.corridor_traversals", "core.assets",
    "core.corridor_block_windows", "core.compatibility_matrix", "core.compatibility_overrides",
    "core.work_type_compatibility", "core.pair_decisions", "core.defects", "core.defect_events",
    "core.goods_train_forecasts",
    "plan.block_plans", "plan.block_assignments", "plan.modification_requests", "plan.notifications",
    "plan.plan_history", "plan.pipeline_runs", "plan.model_versions",
]
STAGES = ["pause_clock", "wipe_database", "delete_models", "load_network", "build_windows", "seed_compatibility", "resume_clock"]

_jobs: dict[str, dict] = {}
_lock = threading.Lock()
_active: str | None = None


def active_job_id() -> str | None:
    return _active


def get_job(job_id: str) -> dict | None:
    job = _jobs.get(job_id)
    return dict(job) if job else None


def start_reset(scheduler, requested_by: str, horizon_days: int = 35) -> str:
    global _active
    with _lock:
        if _active and _jobs[_active]["status"] == "running":
            raise RuntimeError(_active)
        job_id = str(uuid.uuid4())
        _jobs[job_id] = {
            "job_id": job_id, "status": "running", "stage": None, "progress": 0,
            "started_at": datetime.now(timezone.utc).isoformat(), "finished_at": None,
            "error": None, "log": [], "stats": {}, "requested_by": requested_by,
        }
        _active = job_id
    threading.Thread(target=_run, args=(job_id, scheduler, horizon_days), daemon=True, name=f"reset-{job_id[:8]}").start()
    return job_id


def _stage(job: dict, stage: str, message: str) -> None:
    job["stage"] = stage
    job["progress"] = int(STAGES.index(stage) / len(STAGES) * 100)
    job["log"].append(f"{datetime.now(timezone.utc):%H:%M:%S} {message}")
    logger.info("reset %s: %s", job["job_id"][:8], message)


def _run(job_id: str, scheduler, horizon_days: int) -> None:
    from etl import build_windows, load_network
    from scripts import seed_compatibility

    job = _jobs[job_id]
    clock = scheduler.get_job("clock-sync") if scheduler else None
    try:
        _stage(job, "pause_clock", "pausing the clock sync")
        if clock:
            clock.pause()

        _stage(job, "wipe_database", f"truncating {len(TRUNCATE_TABLES)} tables (login accounts kept)")
        with engine.begin() as conn:
            conn.execute(text(f"TRUNCATE TABLE {', '.join(TRUNCATE_TABLES)} RESTART IDENTITY CASCADE"))

        _stage(job, "delete_models", "deleting trained model artifacts")
        removed = 0
        for pattern in ("priority_ranker*.json", "pair_compat*"):
            for path in MODELS_DIR.glob(pattern):
                path.unlink()
                removed += 1
        job["stats"]["models_deleted"] = removed

        _stage(job, "load_network", "loading stations, corridors and the bundled timetable from mapData/ (this takes a few minutes)")
        job["stats"]["network"] = load_network.load()

        _stage(job, "build_windows", f"building the {horizon_days}-day free-window calendar")
        job["stats"]["windows"] = build_windows.build(horizon_days)

        _stage(job, "seed_compatibility", "seeding department and work-type compatibility defaults")
        seed_compatibility.seed()

        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO plan.pipeline_runs (finished_at, status, stage, log) VALUES (now(), 'done', 'reset', :log)"),
                {"log": json.dumps({"requested_by": job["requested_by"], "stats": job["stats"]})},
            )
        job["status"] = "done"
        job["progress"] = 100
        job["log"].append(f"{datetime.now(timezone.utc):%H:%M:%S} done")
    except Exception as exc:  # noqa: BLE001 - reported to the caller through the job status
        job["status"] = "failed"
        job["error"] = str(exc)
        job["log"].append(f"{datetime.now(timezone.utc):%H:%M:%S} FAILED: {exc}")
        logger.error("reset %s failed:\n%s", job_id[:8], traceback.format_exc())
    finally:
        _stage(job, "resume_clock", "resuming the clock sync") if job["status"] != "failed" else job["log"].append("resuming the clock sync")
        if clock:
            clock.resume()
        job["finished_at"] = datetime.now(timezone.utc).isoformat()
        if job["status"] == "done":
            job["progress"] = 100
            job["stage"] = "done"
