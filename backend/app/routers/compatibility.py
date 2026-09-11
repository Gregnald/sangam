from __future__ import annotations

from itertools import combinations_with_replacement

from fastapi import APIRouter, Depends, Query
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
    db.commit()
    return CompatibilityOverrideEntry(window_id=body.window_id, dept_a=body.dept_a, dept_b=body.dept_b, compatible=body.compatible, notes=body.notes, is_override=True)


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
