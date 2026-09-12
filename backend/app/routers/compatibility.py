from __future__ import annotations

import logging

from itertools import combinations_with_replacement

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import CurrentUser, require_role
from app.db import get_db
from app.schemas import (
    ClearCompatibilityOverrideBody,
    CompatibilityEntry,
    CompatibilityOverrideEntry,
    SetCompatibilityOverrideBody,
)

logger = logging.getLogger("sangam.app.routers.compatibility")

CamelModel = ConfigDict(alias_generator=to_camel, populate_by_name=True)

router = APIRouter(prefix="/api/v1/compatibility", tags=["compatibility"])
DEPARTMENTS = ("ENGG", "SIGNAL", "TRD")


@router.get("", response_model=list[CompatibilityEntry])
def list_compatibility(db: Session = Depends(get_db)):
    rows = db.execute(text("SELECT * FROM core.compatibility_matrix")).mappings().all()
    return [CompatibilityEntry.model_validate(dict(r)) for r in rows]


@router.post("", response_model=CompatibilityEntry)
def set_compatibility(
    body: CompatibilityEntry,
    user: CurrentUser = Depends(require_role("CONTROLLER")),
    db: Session = Depends(get_db),
):
    db.execute(
        text(
            """
            INSERT INTO core.compatibility_matrix (dept_a, dept_b, compatible, notes)
            VALUES (:a, :b, :compatible, :notes)
            ON CONFLICT (dept_a, dept_b) DO UPDATE SET compatible = EXCLUDED.compatible, notes = EXCLUDED.notes
            """
        ),
        {"a": body.dept_a, "b": body.dept_b, "compatible": body.compatible, "notes": body.notes},
    )
    db.commit()
    return body


class SetWorkTypeCellBody(BaseModel):
    model_config = CamelModel
    type_a: str
    type_b: str
    compatible: bool
    notes: str | None = None


def _retrain_pair_model() -> None:
    """A change to what may share a possession is exactly the signal the
    pairwise model learns from — retrain right away, never block the edit."""
    from app.db import engine as db_engine
    from ml.pair_compat_model import train

    try:
        with db_engine.connect() as conn:
            train(conn)
    except Exception:  # noqa: BLE001
        logger.exception("pair-compatibility model retrain failed after a matrix change")


@router.get("/work-types")
def work_type_matrix(db: Session = Depends(get_db)):
    """The job-level matrix: every pair of kinds of work, may they share."""
    from ml.pair_compat_model import status as pair_model_status
    from scripts.seed_compatibility import WORK_TYPES

    cells = [dict(r) for r in db.execute(text("SELECT type_a, type_b, compatible, notes, updated_by, updated_at FROM core.work_type_compatibility")).mappings()]
    return {"workTypes": [{"type": t, "department": d} for t, d in WORK_TYPES.items()], "cells": cells, "pairModel": pair_model_status()}


@router.post("/work-types")
def set_work_type_cell(
    body: SetWorkTypeCellBody,
    user: CurrentUser = Depends(require_role("CONTROLLER")),
    db: Session = Depends(get_db),
):
    from ml.pair_compat_model import log_decision
    from scripts.seed_compatibility import WORK_TYPES

    if body.type_a not in WORK_TYPES or body.type_b not in WORK_TYPES:
        raise HTTPException(400, "unknown work type")
    a, b = sorted((body.type_a, body.type_b))
    db.execute(
        text(
            """
            INSERT INTO core.work_type_compatibility (type_a, type_b, compatible, notes, updated_by, updated_at)
            VALUES (:a, :b, :c, :n, :by, now())
            ON CONFLICT (type_a, type_b) DO UPDATE SET compatible = EXCLUDED.compatible, notes = EXCLUDED.notes, updated_by = EXCLUDED.updated_by, updated_at = now()
            """
        ),
        {"a": a, "b": b, "c": body.compatible, "n": body.notes, "by": user.username},
    )
    log_decision(db, source="matrix", decided_by=user.username, dept_a=WORK_TYPES[a], dept_b=WORK_TYPES[b], type_a=a, type_b=b, compatible=body.compatible)
    db.commit()
    _retrain_pair_model()
    return {"typeA": a, "typeB": b, "compatible": body.compatible, "notes": body.notes}


@router.get("/learned")
def learned_compatibility(db: Session = Depends(get_db)):
    """What the planner has learned about each department pair from the
    controller's per-window overrides, and which default is in effect."""
    from ml.compatibility_learning import FLIP_THRESHOLD, MIN_EVIDENCE, pair_evidence

    return {
        "minEvidence": MIN_EVIDENCE,
        "flipThreshold": FLIP_THRESHOLD,
        "pairs": [
            {
                "deptA": e.dept_a, "deptB": e.dept_b, "seededCompatible": e.seeded_compatible, "seededNotes": e.seeded_notes,
                "overridesYes": e.overrides_yes, "overridesNo": e.overrides_no, "posteriorMean": e.posterior_mean,
                "learnedCompatible": e.learned_compatible, "inEffect": e.in_effect,
            }
            for e in pair_evidence(db)
        ],
    }


@router.get("/overrides", response_model=list[CompatibilityOverrideEntry])
def list_block_overrides(
    window_id: str = Query(..., alias="windowId"),
    db: Session = Depends(get_db),
):
    defaults = {
        frozenset((r["dept_a"], r["dept_b"])): bool(r["compatible"])
        for r in db.execute(text("SELECT dept_a, dept_b, compatible FROM core.compatibility_matrix")).mappings().all()
    }
    overrides = {
        frozenset((r["dept_a"], r["dept_b"])): (bool(r["compatible"]), r["notes"])
        for r in db.execute(
            text("SELECT dept_a, dept_b, compatible, notes FROM core.compatibility_overrides WHERE window_id = :w"),
            {"w": window_id},
        ).mappings().all()
    }

    entries = []
    for a, b in combinations_with_replacement(DEPARTMENTS, 2):
        if a == b:
            continue
        pair = frozenset((a, b))
        if pair in overrides:
            compatible, notes = overrides[pair]
            entries.append(CompatibilityOverrideEntry(window_id=window_id, dept_a=a, dept_b=b, compatible=compatible, notes=notes, is_override=True))
        else:
            entries.append(CompatibilityOverrideEntry(window_id=window_id, dept_a=a, dept_b=b, compatible=defaults.get(pair, False), notes=None, is_override=False))
    return entries


@router.post("/overrides", response_model=CompatibilityOverrideEntry)
def set_block_override(
    body: SetCompatibilityOverrideBody,
    user: CurrentUser = Depends(require_role("CONTROLLER")),
    db: Session = Depends(get_db),
):
    db.execute(
        text(
            """
            INSERT INTO core.compatibility_overrides (window_id, dept_a, dept_b, compatible, notes)
            VALUES (:w, :a, :b, :compatible, :notes)
            ON CONFLICT (window_id, dept_a, dept_b) DO UPDATE SET compatible = EXCLUDED.compatible, notes = EXCLUDED.notes
            """
        ),
        {"w": str(body.window_id), "a": body.dept_a, "b": body.dept_b, "compatible": body.compatible, "notes": body.notes},
    )
    _log_pair_decisions(db, str(body.window_id), body.dept_a, body.dept_b, body.compatible, user.username)
    db.commit()
    _retrain_pair_model()
    return CompatibilityOverrideEntry(window_id=body.window_id, dept_a=body.dept_a, dept_b=body.dept_b, compatible=body.compatible, notes=body.notes, is_override=True)


def _log_pair_decisions(db, window_id: str, dept_a: str, dept_b: str, compatible: bool, by: str) -> None:
    """An override is a decision about *these* jobs on *this* section. Log
    one training row per cross-department job pair the window holds (or
    could hold: the pending jobs on the corridor), with the pair's real
    features, so the pairwise model can learn from it."""
    from itertools import product

    from ml.pair_compat_model import log_decision

    w = db.execute(
        text(
            """
            SELECT w.corridor_id, c.train_count,
                   (SELECT max(train_count) FROM core.corridors z WHERE z.zone = c.zone) AS busiest
            FROM core.corridor_block_windows w JOIN core.corridors c ON c.corridor_id = w.corridor_id
            WHERE w.window_id = :w
            """
        ),
        {"w": window_id},
    ).mappings().first()
    if not w:
        return
    jobs = db.execute(
        text(
            """
            SELECT d.department, d.defect_type, d.estimated_block_hours
            FROM core.defects d
            WHERE d.corridor_id = :c AND d.workflow_status IN ('pending', 'scheduled', 'awaiting_dept_response', 'awaiting_controller')
            """
        ),
        {"c": w["corridor_id"]},
    ).mappings().all()
    traffic = (w["train_count"] or 0) / (w["busiest"] or 1)
    ja = [j for j in jobs if j["department"] == dept_a]
    jb = [j for j in jobs if j["department"] == dept_b]
    pairs = list(product(ja, jb)) or [(None, None)]
    for a, b in pairs[:20]:
        log_decision(
            db, source="override", decided_by=by, dept_a=dept_a, dept_b=dept_b,
            type_a=a["defect_type"] if a else None, type_b=b["defect_type"] if b else None,
            duration_a_h=float(a["estimated_block_hours"]) if a else None, duration_b_h=float(b["estimated_block_hours"]) if b else None,
            traffic_factor=traffic, corridor_id=w["corridor_id"], window_id=window_id, compatible=compatible,
        )


@router.delete("/overrides")
def clear_block_override(
    body: ClearCompatibilityOverrideBody,
    user: CurrentUser = Depends(require_role("CONTROLLER")),
    db: Session = Depends(get_db),
):
    db.execute(
        text(
            """
            DELETE FROM core.compatibility_overrides
            WHERE window_id = :w AND ((dept_a = :a AND dept_b = :b) OR (dept_a = :b AND dept_b = :a))
            """
        ),
        {"w": str(body.window_id), "a": body.dept_a, "b": body.dept_b},
    )
    db.commit()
    return {"ok": True}
