from __future__ import annotations

import argparse
import csv
import logging

from sqlalchemy import text

from app.config import DATA_DIR
from app.db import engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("sangam.etl.publish")

EXPORT_DIR = DATA_DIR / "processed" / "exports"
EXPORT_DIR.mkdir(parents=True, exist_ok=True)


def publish_plan(plan_id: str) -> str:
    with engine.connect() as conn:
        plan = conn.execute(text("SELECT * FROM plan.block_plans WHERE plan_id = :id"), {"id": plan_id}).mappings().first()
        if not plan:
            raise ValueError(f"no such plan {plan_id}")

        rows = conn.execute(
            text(
                """
                SELECT a.department, a.allocated_start, a.allocated_end, a.joint_block_group_id,
                       c.line_name, c.station_a_code, c.station_b_code,
                       d.defect_type, d.severity_code, d.estimated_block_hours
                FROM plan.block_assignments a
                LEFT JOIN core.corridors c ON c.corridor_id = a.corridor_id
                LEFT JOIN core.defects d ON d.defect_id = a.defect_id
                WHERE a.plan_id = :id
                ORDER BY a.allocated_start
                """
            ),
            {"id": plan_id},
        ).mappings().all()

    out_path = EXPORT_DIR / f"block_plan_{plan['horizon_type']}_{plan['period_label']}.csv"
    with out_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(
            ["corridor", "department", "defect_type", "severity", "block_hours", "window_start", "window_end", "joint_block_group"]
        )
        for r in rows:
            writer.writerow(
                [
                    r["line_name"],
                    r["department"],
                    r["defect_type"],
                    r["severity_code"],
                    r["estimated_block_hours"],
                    r["allocated_start"],
                    r["allocated_end"],
                    r["joint_block_group_id"] or "",
                ]
            )

    logger.info("exported plan %s -> %s (%d rows)", plan_id, out_path, len(rows))
    return str(out_path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan-id", required=True)
    args = parser.parse_args()
    publish_plan(args.plan_id)


if __name__ == "__main__":
    main()
