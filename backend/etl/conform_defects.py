from __future__ import annotations

import logging

from sqlalchemy import text

from app.db import engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("sangam.etl.conform_defects")

RAW_TABLES = ["raw.defects_tms", "raw.defects_smms", "raw.defects_tdms"]

UPSERT = text(
    """
    INSERT INTO core.defects (
        defect_id, source_system, asset_id, corridor_id, defect_type, severity_code,
        department, detected_date, due_date, speed_restriction_kmph, estimated_block_hours,
        requested_window_start, requested_window_end, requested_by, workflow_status, traffic_suspended
    )
    VALUES (
        :defect_id, :source_system, :asset_id, :corridor_id, :defect_type, :severity_code,
        :department, :detected_date, :due_date, :speed_restriction_kmph, :estimated_block_hours,
        :requested_window_start, :requested_window_end, :requested_by, 'pending', :traffic_suspended
    )
    ON CONFLICT (defect_id) DO NOTHING
    RETURNING defect_id
    """
)


def conform() -> list[str]:
    """Promote raw landing-table rows into core.defects. Returns the
    defect_ids that were newly inserted this call (already-conformed rows
    are silently skipped via ON CONFLICT DO NOTHING and excluded)."""
    new_ids: list[str] = []
    with engine.begin() as conn:
        for raw_table in RAW_TABLES:
            rows = conn.execute(text(f"SELECT payload FROM {raw_table}")).mappings().all()
            for r in rows:
                p = r["payload"]
                inserted_id = conn.execute(
                    UPSERT,
                    {
                        "defect_id": p["defect_id"],
                        "source_system": p["source_system"],
                        "asset_id": p.get("asset_id"),
                        "corridor_id": p.get("corridor_id"),
                        "defect_type": p["defect_type"],
                        "severity_code": p["severity_code"],
                        "department": p["department"],
                        "detected_date": p["detected_date"],
                        "due_date": p["due_date"],
                        "speed_restriction_kmph": p.get("speed_restriction_kmph"),
                        "estimated_block_hours": p["estimated_block_hours"],
                        "requested_window_start": p.get("requested_window_start"),
                        "requested_window_end": p.get("requested_window_end"),
                        "requested_by": p.get("requested_by"),
                        "traffic_suspended": bool(p.get("traffic_suspended", False)),
                    },
                ).scalar()
                if inserted_id:
                    new_ids.append(str(inserted_id))
    logger.info("conformed %d new requests into core.defects", len(new_ids))
    return new_ids


if __name__ == "__main__":
    conform()
