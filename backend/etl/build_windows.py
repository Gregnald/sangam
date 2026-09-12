from __future__ import annotations

import argparse
import logging
from datetime import date, datetime, timedelta, timezone

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


# How many departments may share a window is not decided here. The optimizer
# works it out per possession from the safety compatibility matrix, the
# physical separation of the jobs' work sites, and whether each department's
# queue fits the window (see optimizer/model.py). The column is kept at the
# number of departments purely as an upper bound for schema compatibility.
MAX_DEPARTMENTS = 3


def _concurrency_for(duration_min: int) -> int:  # noqa: ARG001 - kept for call sites
    return MAX_DEPARTMENTS


def _insert_windows(conn, window_rows: list[dict]) -> None:
    for chunk_start in range(0, len(window_rows), 5000):
        chunk = window_rows[chunk_start : chunk_start + 5000]
        conn.execute(
            text(
                """
                INSERT INTO core.corridor_block_windows (corridor_id, window_start, window_end, max_concurrent_depts, version_id)
                VALUES (:corridor_id, :window_start, :window_end, :max_concurrent_depts, :version_id)
                """
            ),
            chunk,
        )


def _windows_for_days(conn, corridor_ids: list[str], days: list[datetime], version_on) -> list[dict]:
    """Candidate windows for each day, from the timetable version in force
    that day (`version_on(date) -> version_id | None`)."""
    from etl.timetable import traversals_for_version

    gaps_cache: dict[int, dict[str, list[tuple[int, int]]]] = {}
    rows: list[dict] = []
    for day_start in days:
        vid = version_on(day_start.date())
        if vid is None:
            continue
        if vid not in gaps_cache:
            busy = traversals_for_version(conn, vid, corridor_ids)
            gaps_cache[vid] = {cid: _free_gaps(busy.get(cid, [])) for cid in corridor_ids}
        for corridor_id in corridor_ids:
            for g_start, g_end in gaps_cache[vid].get(corridor_id, []):
                rows.append(
                    {
                        "corridor_id": corridor_id,
                        "window_start": day_start + timedelta(minutes=g_start),
                        "window_end": day_start + timedelta(minutes=g_end),
                        "max_concurrent_depts": _concurrency_for(g_end - g_start),
                        "version_id": vid,
                    }
                )
    return rows


def build(horizon_days: int = 35, reset_plans: bool = True) -> int:
    """Full rebuild of the window calendar (pipeline fresh load): every
    window for `horizon_days` from today, each day from the timetable version
    in force that day. With `reset_plans` the plans go too."""
    from etl.timetable import version_ranges

    with engine.begin() as conn:
        conn.execute(text("DELETE FROM plan.block_assignments"))
        if reset_plans:
            conn.execute(text("DELETE FROM plan.block_plans"))
        conn.execute(text("DELETE FROM core.corridor_block_windows"))

        corridor_ids = conn.execute(text("SELECT corridor_id FROM core.corridors")).scalars().all()
        ranges = version_ranges(conn)

        def version_on(day: date) -> int | None:
            return next((vid for vid, ef, et in reversed(ranges) if ef <= day and (et is None or day < et)), None)

        today = datetime.now(IST).replace(minute=0, second=0, microsecond=0, hour=0)
        days = [today + timedelta(days=i) for i in range(horizon_days)]
        window_rows = _windows_for_days(conn, corridor_ids, days, version_on)
        _insert_windows(conn, window_rows)
        logger.info("wrote %d candidate windows across %d corridors (full rebuild)", len(window_rows), len(corridor_ids))
        return len(window_rows)


def build_version(version_id: int, effective_from: date, horizon_days: int = 35) -> int:
    """Add the windows of one timetable version for the days it is in force,
    from max(today, effective_from) until the next version takes over or the
    horizon ends. Insert-only: nothing existing is deleted or modified —
    plans built on earlier windows keep them; the active_block_windows view
    is what steers new solves to this version's windows."""
    from etl.timetable import version_ranges

    with engine.begin() as conn:
        corridor_ids = conn.execute(text("SELECT corridor_id FROM core.corridors")).scalars().all()
        eff_to = next((et for vid, ef, et in version_ranges(conn) if vid == version_id), None)
        today = datetime.now(IST).replace(minute=0, second=0, microsecond=0, hour=0)
        start = max(today, datetime(effective_from.year, effective_from.month, effective_from.day, tzinfo=IST))
        end = today + timedelta(days=horizon_days)
        if eff_to is not None:
            end = min(end, datetime(eff_to.year, eff_to.month, eff_to.day, tzinfo=IST))
        days = []
        d = start
        while d < end:
            days.append(d)
            d += timedelta(days=1)
        window_rows = _windows_for_days(conn, corridor_ids, days, lambda _day: version_id)
        _insert_windows(conn, window_rows)
        logger.info("wrote %d windows for timetable version %d (%d days from %s)", len(window_rows), version_id, len(days), start.date())
        return len(window_rows)


def build_for_corridors(corridor_ids: list[str], horizon_days: int = 35) -> int:
    """Add a window calendar for a specific set of corridors without touching
    anything else — used when ingesting a schedule adds brand-new corridors
    mid-session. Unlike `build()`, this never deletes existing block plans or
    assignments: it's only ever called for corridors that didn't exist a
    moment ago, so there's nothing of theirs to preserve or conflict with."""
    if not corridor_ids:
        return 0

    from etl.timetable import version_ranges

    with engine.begin() as conn:
        ranges = version_ranges(conn)

        def version_on(day: date) -> int | None:
            return next((vid for vid, ef, et in reversed(ranges) if ef <= day and (et is None or day < et)), None)

        now = datetime.now(IST).replace(minute=0, second=0, microsecond=0, hour=0)
        days = [now + timedelta(days=i) for i in range(horizon_days)]
        window_rows = _windows_for_days(conn, corridor_ids, days, version_on)
        _insert_windows(conn, window_rows)
        logger.info("wrote %d windows for %d newly-ingested corridors", len(window_rows), len(corridor_ids))
        return len(window_rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--horizon-days", type=int, default=35)
    args = parser.parse_args()
    build(args.horizon_days)


if __name__ == "__main__":
    main()
