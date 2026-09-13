from __future__ import annotations

import json
import logging

import numpy as np
import pandas as pd
import shap
import xgboost as xgb
from sqlalchemy import text

from app.config import MODELS_DIR
from app.db import engine
from ml.features import FEATURE_COLUMNS, build_features, corridor_traffic_density

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("sangam.ml.score_priority")

MODEL_PATH = MODELS_DIR / "priority_ranker.json"

FRIENDLY_NAMES = {
    "days_overdue": "Days overdue",
    "days_to_due": "Days until due",
    "sev_A": "Severity A (safety-critical)",
    "sev_B": "Severity B (major)",
    "sev_C": "Severity C (routine)",
    "speed_restriction_active": "Active speed restriction",
    "defect_type_failure_rate": "Defect-type failure rate",
    "corridor_traffic_density": "Corridor traffic density",
    "estimated_block_hours": "Estimated block hours",
    "co_locatable_jobs_count": "Co-locatable jobs on corridor",
    "dept_backlog_pressure": "Department backlog pressure",
    "defer_count": "Times previously deferred",
}

SAFETY_FLOOR_SCORE = 90.0
# A fault whose repair cancels trains outranks even the safety floor — the
# sooner the block runs, the fewer days the line stays unsafe.
CLOSED_SECTION_SCORE = 98.0


def _min_max_0_100(values: np.ndarray) -> np.ndarray:
    lo, hi = values.min(), values.max()
    if hi - lo < 1e-9:
        return np.full_like(values, 50.0)
    return (values - lo) / (hi - lo) * 100.0


def score() -> int:
    if not MODEL_PATH.exists():
        raise RuntimeError(f"No trained model at {MODEL_PATH} — run `python -m scripts.retrain_ranker` first")

    model = xgb.XGBRanker()
    model.load_model(str(MODEL_PATH))

    with engine.begin() as conn:
        df = pd.DataFrame(
            conn.execute(
                text(
                    """
                    SELECT defect_id, severity_code, detected_date, due_date,
                           speed_restriction_kmph, estimated_block_hours, defect_type,
                           corridor_id, department, defer_count, traffic_suspended
                    FROM core.defects
                    WHERE workflow_status NOT IN ('cleared', 'completed')
                    """
                )
            ).mappings().all()
        )
        if df.empty:
            logger.warning("no defects to score")
            return 0

        density = corridor_traffic_density(conn)
        X = build_features(df, density)

        raw_scores = model.predict(X)
        scaled = _min_max_0_100(raw_scores)

        safety_floor = (df["severity_code"] == "A").to_numpy() & (X["speed_restriction_active"].to_numpy() == 1)
        closed = df["traffic_suspended"].fillna(False).to_numpy().astype(bool)
        final = np.where(safety_floor, np.maximum(scaled, SAFETY_FLOOR_SCORE), scaled)
        final = np.where(closed, np.maximum(final, CLOSED_SECTION_SCORE), final)

        explainer = shap.TreeExplainer(model.get_booster())
        shap_values = explainer.shap_values(X)

        for i, defect_id in enumerate(df["defect_id"]):
            row_shap = shap_values[i]
            top_idx = np.argsort(-np.abs(row_shap))[:4]
            explanation = [
                {"factor": FRIENDLY_NAMES.get(FEATURE_COLUMNS[j], FEATURE_COLUMNS[j]), "score": float(row_shap[j])}
                for j in top_idx
            ]
            if safety_floor[i]:
                explanation.insert(0, {"factor": "Safety floor: Severity A + active speed restriction", "score": 100.0})
            if closed[i]:
                explanation.insert(0, {"factor": "Trains cancelled during block (section unsafe)", "score": 100.0})

            conn.execute(
                text(
                    """
                    UPDATE core.defects
                    SET priority_score = :score, priority_explanation = :explanation, updated_at = now()
                    WHERE defect_id = :id
                    """
                ),
                {"score": round(float(final[i]), 2), "explanation": json.dumps(explanation[:4]), "id": str(defect_id)},
            )

    logger.info("scored %d defects", len(df))
    return len(df)


if __name__ == "__main__":
    score()
