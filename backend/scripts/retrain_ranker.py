from __future__ import annotations

import json
import logging
import uuid

import pandas as pd
import xgboost as xgb
from scipy.stats import spearmanr
from sklearn.model_selection import train_test_split
from sqlalchemy import text

from app.config import MODELS_DIR
from app.db import engine
from ml.features import build_features, corridor_traffic_density, synthetic_bootstrap_label

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("sangam.scripts.retrain_ranker")


def _controller_nudge(conn, defect_ids: pd.Series) -> pd.Series:
    rows = conn.execute(
        text(
            """
            SELECT defect_id, status FROM plan.modification_requests
            WHERE request_type = 'preemption' AND status IN ('approved', 'rejected')
            """
        )
    ).mappings().all()
    nudge = {str(r["defect_id"]): (1 if r["status"] == "approved" else -1) for r in rows}
    return defect_ids.astype(str).map(nudge).fillna(0)


def retrain() -> dict:
    with engine.connect() as conn:
        df = pd.DataFrame(
            conn.execute(
                text(
                    """
                    SELECT defect_id, severity_code, detected_date, due_date,
                           speed_restriction_kmph, estimated_block_hours, defect_type,
                           corridor_id, department, defer_count
                    FROM core.defects
                    """
                )
            ).mappings().all()
        )
        if df.empty:
            raise RuntimeError("core.defects is empty — run the ETL stages first")
        density = corridor_traffic_density(conn)
        nudge = _controller_nudge(conn, df["defect_id"])

        current = conn.execute(
            text("SELECT metrics FROM plan.model_versions WHERE promoted = TRUE ORDER BY trained_at DESC LIMIT 1")
        ).mappings().first()
        current_score = (current["metrics"] or {}).get("holdout_spearman", -1.0) if current else -1.0

    X = build_features(df, density)
    y = synthetic_bootstrap_label(df, X) * (1 + 0.15 * nudge)

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=7)
    model = xgb.XGBRanker(objective="rank:pairwise", n_estimators=300, max_depth=5, learning_rate=0.05)
    model.fit(X_train, y_train, group=[len(X_train)])

    preds = model.predict(X_test)
    corr, _ = spearmanr(preds, y_test)
    logger.info("candidate model holdout spearman=%.3f (current promoted=%.3f)", corr, current_score)

    version_id = str(uuid.uuid4())
    artifact_path = MODELS_DIR / f"priority_ranker_{version_id[:8]}.json"
    model.save_model(str(artifact_path))

    promote = corr >= current_score
    metrics = {"holdout_spearman": float(corr), "n_controller_decisions_used": int((nudge != 0).sum())}

    with engine.begin() as conn:
        if promote:
            conn.execute(text("UPDATE plan.model_versions SET promoted = FALSE WHERE promoted = TRUE"))
            model.save_model(str(MODELS_DIR / "priority_ranker.json"))
        conn.execute(
            text(
                """
                INSERT INTO plan.model_versions (version_id, artifact_path, metrics, promoted)
                VALUES (:id, :path, :metrics, :promoted)
                """
            ),
            {"id": version_id, "path": str(artifact_path), "metrics": json.dumps(metrics), "promoted": promote},
        )

    logger.info("candidate %s: %s", version_id, "PROMOTED" if promote else "kept as challenger")
    return {**metrics, "promoted": promote}


if __name__ == "__main__":
    retrain()
