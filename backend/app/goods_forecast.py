"""Goods-train forecast from the Control Office, applied to block windows.

The corridor window calendar is built from the passenger timetable alone.
Freight paths aren't timetabled the same way — the Control Office forecasts
them per section per day — so without this layer the planner would happily
offer a block across a slot the COA expects to run goods trains through.

A forecast band (corridor, date, minute-of-day range) is treated as occupied:
any candidate window overlapping it is clipped down to its largest remaining
free stretch, or dropped entirely if what's left is shorter than the minimum
useful block. Window ids are preserved so existing plan assignments that
reference them stay valid; only the usable start/end shrink.
"""
from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime, timedelta
from typing import Iterable, Protocol, TypeVar

from sqlalchemy import text

from etl.build_windows import IST, MIN_WINDOW_MINUTES

Band = tuple[int, int]  # (start_min, end_min), minute-of-day, half-open


class _WindowLike(Protocol):
    window_id: str
    corridor_id: str
    start: datetime
    end: datetime
    duration_hours: float


W = TypeVar("W", bound=_WindowLike)


def load_bands(conn, corridor_ids: Iterable[str], start: date, end: date) -> dict[tuple[str, date], list[Band]]:
    ids = list(corridor_ids)
    if not ids:
        return {}
    rows = conn.execute(
        text(
            """
            SELECT corridor_id, forecast_date, band_start_min, band_end_min
            FROM core.goods_train_forecasts
            WHERE corridor_id = ANY(:ids) AND forecast_date BETWEEN :s AND :e
            ORDER BY corridor_id, forecast_date, band_start_min
            """
        ),
        {"ids": ids, "s": start, "e": end},
    ).mappings().all()
    out: dict[tuple[str, date], list[Band]] = {}
    for r in rows:
        out.setdefault((r["corridor_id"], r["forecast_date"]), []).append((int(r["band_start_min"]), int(r["band_end_min"])))
    return out


def _local_day_and_minutes(start: datetime, end: datetime) -> tuple[date, int, int]:
    s = start.astimezone(IST)
    e = end.astimezone(IST)
    day = s.date()
    s_min = s.hour * 60 + s.minute
    e_min = int((e - s).total_seconds() // 60) + s_min
    return day, s_min, e_min


def _subtract(interval: Band, bands: list[Band]) -> list[Band]:
    """Remove every band from [interval), returning the leftover pieces."""
    pieces = [interval]
    for b_start, b_end in bands:
        nxt: list[Band] = []
        for p_start, p_end in pieces:
            if b_end <= p_start or b_start >= p_end:
                nxt.append((p_start, p_end))
                continue
            if p_start < b_start:
                nxt.append((p_start, b_start))
            if b_end < p_end:
                nxt.append((b_end, p_end))
        pieces = nxt
    return pieces


def clip_windows(windows: list[W], bands: dict[tuple[str, date], list[Band]]) -> list[W]:
    """Return windows with goods bands carved out. Each surviving window keeps
    its id and is narrowed to its longest free stretch; a window with no
    stretch of at least MIN_WINDOW_MINUTES left is dropped."""
    if not bands:
        return list(windows)
    out: list[W] = []
    for w in windows:
        day, s_min, e_min = _local_day_and_minutes(w.start, w.end)
        day_bands = bands.get((w.corridor_id, day))
        if not day_bands:
            out.append(w)
            continue
        pieces = [p for p in _subtract((s_min, e_min), day_bands) if p[1] - p[0] >= MIN_WINDOW_MINUTES]
        if not pieces:
            continue
        best_start, best_end = max(pieces, key=lambda p: p[1] - p[0])
        if (best_start, best_end) == (s_min, e_min):
            out.append(w)
            continue
        base = w.start.astimezone(IST).replace(hour=0, minute=0, second=0, microsecond=0)
        new_start = base + timedelta(minutes=best_start)
        new_end = base + timedelta(minutes=best_end)
        out.append(replace(w, start=new_start, end=new_end, duration_hours=(best_end - best_start) / 60.0))
    return out


def clip_window_rows(rows: list[dict], bands: dict[tuple[str, date], list[Band]]) -> list[dict]:
    """Same as clip_windows but for plain dict rows carrying window_start /
    window_end (and optionally duration_hours) — the shape the workflow
    engine and the schedule API work with."""
    if not bands:
        return rows
    out: list[dict] = []
    for r in rows:
        day, s_min, e_min = _local_day_and_minutes(r["window_start"], r["window_end"])
        day_bands = bands.get((r["corridor_id"], day))
        if not day_bands:
            out.append(r)
            continue
        pieces = [p for p in _subtract((s_min, e_min), day_bands) if p[1] - p[0] >= MIN_WINDOW_MINUTES]
        if not pieces:
            continue
        best_start, best_end = max(pieces, key=lambda p: p[1] - p[0])
        if (best_start, best_end) == (s_min, e_min):
            out.append(r)
            continue
        base = r["window_start"].astimezone(IST).replace(hour=0, minute=0, second=0, microsecond=0)
        clipped = dict(r)
        clipped["window_start"] = base + timedelta(minutes=best_start)
        clipped["window_end"] = base + timedelta(minutes=best_end)
        if "duration_hours" in clipped:
            clipped["duration_hours"] = (best_end - best_start) / 60.0
        out.append(clipped)
    return out
