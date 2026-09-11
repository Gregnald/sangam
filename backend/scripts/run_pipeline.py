from __future__ import annotations

import argparse
import logging

from etl import build_windows, conform_defects, load_network
from ml import score_priority
from scripts import retrain_ranker, seed_compatibility, seed_users

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("sangam.pipeline")


def run(horizon_days: int = 35, train_model: bool = True) -> None:
    logger.info("loading rail network from mapData/")
    stats = load_network.load()
    logger.info("network: %s", stats)

    logger.info("building %d-day window calendar", horizon_days)
    n_win = build_windows.build(horizon_days)
    logger.info("windows: %d", n_win)

    # The backlog itself is never generated here — departments' block
    # requests come in only through the controller's Data Ingestion page
    # (Excel uploads), landing in raw.defects_* and promoted by conform().
    new_defect_ids = conform_defects.conform()
    logger.info("conformed: %d", len(new_defect_ids))

    seed_users.seed()
    seed_compatibility.seed()

    if train_model and new_defect_ids:
        metrics = retrain_ranker.retrain()
        logger.info("ranker holdout spearman=%.3f (promoted=%s)", metrics["holdout_spearman"], metrics["promoted"])
        n_scored = score_priority.score()
        logger.info("scored: %d", n_scored)
    else:
        logger.info("no requests yet — skipping ranker training/scoring until the backlog is ingested")

    logger.info("done")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--horizon-days", type=int, default=35)
    parser.add_argument("--no-train", action="store_true")
    args = parser.parse_args()
    run(args.horizon_days, not args.no_train)


if __name__ == "__main__":
    main()
