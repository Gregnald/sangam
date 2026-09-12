"""Pairwise "can these two jobs share a possession?" model.

A gradient-boosted classifier over the features of a *pair* of jobs —
department pair, work types, durations, corridor traffic — trained on the
controller's own decisions (`core.pair_decisions`: every edit of the
work-type matrix and every per-window override is logged with the pair's
features).

What it is for: the rule layers in optimizer/pair_compat.py are hard and
conservative. Where they *allow* a pairing, this model says how much the
controller has historically liked pairings like it, and the solver uses that
as a soft preference when choosing between otherwise-equal ways to bundle.
It never overrides a hard rule — a safety decision does not ride on a model.

Until there are at least MIN_TRAINING_ROWS decisions it stays inactive and
the solver runs on rules alone; the Compatibility tab says which.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

import numpy as np
import pandas as pd
from sqlalchemy import text

from app.config import MODELS_DIR

logger = logging.getLogger("sangam.ml.pair_compat_model")

MODEL_PATH = MODELS_DIR / "pair_compat.json"
META_PATH = MODELS_DIR / "pair_compat.meta.json"
MIN_TRAINING_ROWS = 30
DEPARTMENTS = ("ENGG", "SIGNAL", "TRD")
WORK_TYPES = [
    "track_geometry_twist", "rail_fracture_risk", "weld_defect", "ballast_deficiency", "rail_wear",
    "signal_relay_fault", "interlocking_fault", "cable_fault", "track_circuit_failure",
    "insulator_flashover_risk", "feeder_fault", "ohe_wire_wear", "traction_transformer_fault",
]


def _pair_key(a: str, b: str) -> tuple[str, str]:
    return tuple(sorted((a, b)))  # type: ignore[return-value]


def build_features(rows: pd.DataFrame) -> pd.DataFrame:
    """Order-independent pair features (the pair (a,b) and (b,a) must look the same)."""
    out = pd.DataFrame(index=rows.index)
    da, db = rows["dept_a"], rows["dept_b"]
    for x in DEPARTMENTS:
        for y in DEPARTMENTS:
            if x <= y:
                out[f"pair_{x}_{y}"] = (((da == x) & (db == y)) | ((da == y) & (db == x))).astype(int)
    ta, tb = rows["type_a"].fillna(""), rows["type_b"].fillna("")
    for t in WORK_TYPES:
        out[f"has_{t}"] = ((ta == t) | (tb == t)).astype(int)
    out["duration_max_h"] = rows[["duration_a_h", "duration_b_h"]].astype(float).max(axis=1).fillna(0)
    out["duration_min_h"] = rows[["duration_a_h", "duration_b_h"]].astype(float).min(axis=1).fillna(0)
    out["traffic_factor"] = rows["traffic_factor"].astype(float).fillna(0)
    return out


def log_decision(conn, *, source: str, decided_by: str | None, dept_a: str, dept_b: str, type_a: str | None, type_b: str | None,
                 duration_a_h: float | None = None, duration_b_h: float | None = None, traffic_factor: float | None = None,
                 corridor_id: str | None = None, window_id: str | None = None, compatible: bool) -> None:
    conn.execute(
        text(
            """
            INSERT INTO core.pair_decisions
                (decided_by, source, dept_a, dept_b, type_a, type_b, duration_a_h, duration_b_h, traffic_factor, corridor_id, window_id, compatible)
            VALUES (:by, :src, :da, :db, :ta, :tb, :dua, :dub, :tf, :cid, :wid, :ok)
            """
        ),
        {"by": decided_by, "src": source, "da": dept_a, "db": dept_b, "ta": type_a, "tb": type_b,
         "dua": duration_a_h, "dub": duration_b_h, "tf": traffic_factor, "cid": corridor_id, "wid": window_id, "ok": compatible},
    )


def train(conn) -> dict:
    df = pd.DataFrame(conn.execute(text("SELECT * FROM core.pair_decisions")).mappings().all())
    n = len(df)
    if n < MIN_TRAINING_ROWS or df["compatible"].nunique() < 2:
        meta = {"active": False, "rows": int(n), "reason": f"need ≥ {MIN_TRAINING_ROWS} decisions with both outcomes (have {n})"}
        META_PATH.write_text(json.dumps(meta), encoding="utf-8")
        logger.info("pair model inactive: %s", meta["reason"])
        return meta

    import xgboost as xgb
    from sklearn.model_selection import cross_val_score

    X = build_features(df)
    y = df["compatible"].astype(int)
    model = xgb.XGBClassifier(n_estimators=200, max_depth=4, learning_rate=0.05, subsample=0.9, eval_metric="logloss")
    folds = min(5, int(y.value_counts().min()))
    auc = float(cross_val_score(model, X, y, cv=max(2, folds), scoring="roc_auc").mean()) if folds >= 2 else float("nan")
    model.fit(X, y)
    model.save_model(str(MODEL_PATH))
    meta = {"active": True, "rows": int(n), "cv_auc": auc, "features": list(X.columns)}
    META_PATH.write_text(json.dumps(meta), encoding="utf-8")
    logger.info("pair model trained on %d decisions, cv AUC %.3f", n, auc)
    return meta


def status() -> dict:
    if META_PATH.exists():
        return json.loads(META_PATH.read_text(encoding="utf-8"))
    return {"active": False, "rows": 0, "reason": "not trained yet"}


class PairPreference:
    """Loaded model → P(compatible) for job pairs; returns None when inactive."""

    def __init__(self) -> None:
        self.model = None
        meta = status()
        if meta.get("active") and MODEL_PATH.exists():
            import xgboost as xgb

            self.model = xgb.XGBClassifier()
            self.model.load_model(str(MODEL_PATH))

    @property
    def active(self) -> bool:
        return self.model is not None

    def probability(self, dept_a: str, dept_b: str, type_a: str | None, type_b: str | None,
                    duration_a_h: float, duration_b_h: float, traffic_factor: float) -> float | None:
        if self.model is None:
            return None
        row = pd.DataFrame([{
            "dept_a": dept_a, "dept_b": dept_b, "type_a": type_a, "type_b": type_b,
            "duration_a_h": duration_a_h, "duration_b_h": duration_b_h, "traffic_factor": traffic_factor,
        }])
        return float(self.model.predict_proba(build_features(row))[0][1])


if __name__ == "__main__":
    from app.db import engine

    with engine.connect() as c:
        print(train(c))
