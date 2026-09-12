"""Timetable versions.

A train timetable is not one thing: the working timetable changes on a date,
and a block plan approved under the old one is still valid for the days the
old one covers. So timetables are versioned by *effective date*:

- `core.timetable_versions` — one row per loaded timetable (the bundled
  mapData/schedules.json, then each upload), with the date it takes effect.
- `core.corridor_traversals.version_id` — every train passage belongs to a
  version. The version in force on a day is the one with the latest
  effective_from ≤ that day.
- Block windows are built per day from the version in force that day.

Loading a new timetable effective from D therefore rebuilds windows from D
on, releases only the block assignments that fall on/after D, and leaves
everything before D — and every plan that ends before D — exactly as it was.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import text

BUNDLED_LABEL = "mapData/schedules.json"
BUNDLED_EFFECTIVE_FROM = date(1900, 1, 1)


def create_version(conn, *, source: str, label: str, effective_from: date, loaded_by: str | None, trains: int, stop_rows: int) -> int:
    return int(
        conn.execute(
            text(
                """
                INSERT INTO core.timetable_versions (source, label, effective_from, loaded_by, trains, stop_rows)
                VALUES (:source, :label, :eff, :by, :trains, :rows)
                RETURNING version_id
                """
            ),
            {"source": source, "label": label, "eff": effective_from, "by": loaded_by, "trains": trains, "rows": stop_rows},
        ).scalar()
    )


def versions(conn) -> list[dict]:
    rows = conn.execute(
        text("SELECT version_id, source, label, effective_from, loaded_at, loaded_by, trains, stop_rows FROM core.timetable_versions ORDER BY effective_from, version_id")
    ).mappings().all()
    return [dict(r) for r in rows]


def version_for_day(conn, day: date) -> int | None:
    """The version in force on `day`: latest effective_from ≤ day (ties → the
    most recently loaded)."""
    return conn.execute(
        text(
            """
            SELECT version_id FROM core.timetable_versions
            WHERE effective_from <= :d ORDER BY effective_from DESC, version_id DESC LIMIT 1
            """
        ),
        {"d": day},
    ).scalar()


def version_ranges(conn) -> list[tuple[int, date, date | None]]:
    """(version_id, effective_from, effective_to) for every version, where
    effective_to is the next version's effective_from (None = open-ended)."""
    vs = versions(conn)
    out = []
    for i, v in enumerate(vs):
        nxt = vs[i + 1]["effective_from"] if i + 1 < len(vs) else None
        out.append((int(v["version_id"]), v["effective_from"], nxt))
    return out


def traversals_for_version(conn, version_id: int, corridor_ids: list[str] | None = None) -> dict[str, list[tuple[int, int]]]:
    where = "WHERE version_id = :v" + (" AND corridor_id = ANY(:ids)" if corridor_ids is not None else "")
    rows = conn.execute(
        text(f"SELECT corridor_id, depart_min, arrive_min FROM core.corridor_traversals {where}"),
        {"v": version_id, "ids": corridor_ids},
    ).mappings().all()
    out: dict[str, list[tuple[int, int]]] = {}
    for r in rows:
        out.setdefault(r["corridor_id"], []).append((r["depart_min"], r["arrive_min"]))
    return out
