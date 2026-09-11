from __future__ import annotations

import argparse
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from app.db import engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("sangam.etl.build_windows")

IST = timezone(timedelta(hours=5, minutes=30))
MIN_WINDOW_MINUTES = 90
DAY_MINUTES = 1440


def _split_wrapped(intervals: list[tuple[int, int]]) -> list[tuple[int, int]]:
    out = []
    for start, end in intervals:
        if end <= DAY_MINUTES:
            out.append((start, end))
        else:
            out.append((start, DAY_MINUTES))
            out.append((0, end - DAY_MINUTES))
    return out


def _merge(intervals: list[tuple[int, int]]) -> list[tuple[int, int]]:
    if not intervals:
        return []
    ordered = sorted(intervals)
    merged = [ordered[0]]
    for start, end in ordered[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))
    return merged


def _free_gaps(busy: list[tuple[int, int]]) -> list[tuple[int, int]]:
    merged = _merge(_split_wrapped(busy))
    gaps = []
    cursor = 0
    for start, end in merged:
        if start - cursor >= MIN_WINDOW_MINUTES:
            gaps.append((cursor, start))
        cursor = max(cursor, end)
    if DAY_MINUTES - cursor >= MIN_WINDOW_MINUTES:
        gaps.append((cursor, DAY_MINUTES))
    return gaps


def _concurrency_for(duration_min: int) -> int:
    if duration_min >= 300:
        return 3
    if duration_min >= 120:
        return 2
    return 1


def build(horizon_days: int = 35) -> int:
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM plan.block_assignments"))
        conn.execute(text("DELETE FROM plan.block_plans"))
        conn.execute(text("DELETE FROM core.corridor_block_windows"))

        rows = conn.execute(
            text("SELECT corridor_id, depart_min, arrive_min FROM core.corridor_traversals")
        ).mappings().all()

        busy_by_corridor: dict[str, list[tuple[int, int]]] = {}
        for r in rows:
            busy_by_corridor.setdefault(r["corridor_id"], []).append((r["depart_min"], r["arrive_min"]))

        corridor_ids = conn.execute(text("SELECT corridor_id FROM core.corridors")).scalars().all()
        now = datetime.now(IST).replace(minute=0, second=0, microsecond=0, hour=0)
        window_rows = []

        for corridor_id in corridor_ids:
            gaps = _free_gaps(busy_by_corridor.get(corridor_id, []))
            if not gaps:
                continue
            for day_offset in range(horizon_days):
                day_start = now + timedelta(days=day_offset)
                for g_start, g_end in gaps:
                    duration_min = g_end - g_start
                    window_rows.append(
                        {
                            "corridor_id": corridor_id,
                            "window_start": day_start + timedelta(minutes=g_start),
                            "window_end": day_start + timedelta(minutes=g_end),
                            "max_concurrent_depts": _concurrency_for(duration_min),
                        }
                    )

        for chunk_start in range(0, len(window_rows), 5000):
            chunk = window_rows[chunk_start : chunk_start + 5000]
            conn.execute(
                text(
                    """
                    INSERT INTO core.corridor_block_windows (corridor_id, window_start, window_end, max_concurrent_depts)
                    VALUES (:corridor_id, :window_start, :window_end, :max_concurrent_depts)
                    """
                ),
                chunk,
            )

        logger.info("wrote %d candidate windows across %d corridors", len(window_rows), len(corridor_ids))
        return len(window_rows)


def build_for_corridors(corridor_ids: list[str], horizon_days: int = 35) -> int:
    """Add a window calendar for a specific set of corridors without touching
    anything else — used when ingesting a schedule adds brand-new corridors
    mid-session. Unlike `build()`, this never deletes existing block plans or
    assignments: it's only ever called for corridors that didn't exist a
    moment ago, so there's nothing of theirs to preserve or conflict with."""
    if not corridor_ids:
        return 0

    with engine.begin() as conn:
        rows = conn.execute(
            text("SELECT corridor_id, depart_min, arrive_min FROM core.corridor_traversals WHERE corridor_id = ANY(:ids)"),
            {"ids": corridor_ids},
        ).mappings().all()

        busy_by_corridor: dict[str, list[tuple[int, int]]] = {}
        for r in rows:
            busy_by_corridor.setdefault(r["corridor_id"], []).append((r["depart_min"], r["arrive_min"]))

        now = datetime.now(IST).replace(minute=0, second=0, microsecond=0, hour=0)
        window_rows = []

        for corridor_id in corridor_ids:
            gaps = _free_gaps(busy_by_corridor.get(corridor_id, []))
            if not gaps:
                continue
            for day_offset in range(horizon_days):
                day_start = now + timedelta(days=day_offset)
                for g_start, g_end in gaps:
                    duration_min = g_end - g_start
                    window_rows.append(
                        {
                            "corridor_id": corridor_id,
                            "window_start": day_start + timedelta(minutes=g_start),
                            "window_end": day_start + timedelta(minutes=g_end),
                            "max_concurrent_depts": _concurrency_for(duration_min),
                        }
                    )

        for chunk_start in range(0, len(window_rows), 5000):
            chunk = window_rows[chunk_start : chunk_start + 5000]
            conn.execute(
                text(
                    """
                    INSERT INTO core.corridor_block_windows (corridor_id, window_start, window_end, max_concurrent_depts)
                    VALUES (:corridor_id, :window_start, :window_end, :max_concurrent_depts)
                    """
                ),
                chunk,
            )

        logger.info("wrote %d windows for %d newly-ingested corridors", len(window_rows), len(corridor_ids))
        return len(window_rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--horizon-days", type=int, default=35)
    args = parser.parse_args()
    build(args.horizon_days)


if __name__ == "__main__":
    main()
