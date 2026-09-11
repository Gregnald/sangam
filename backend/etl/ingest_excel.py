from __future__ import annotations

import io
import json
import logging
import uuid
from datetime import date, datetime, timedelta, timezone

import openpyxl
from sqlalchemy import text

from app.db import engine
from etl import build_windows
from etl.load_network import build_corridors_and_traversals, load_stations

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("sangam.etl.ingest_excel")

IST = timezone(timedelta(hours=5, minutes=30))

DEPARTMENT_TO_SOURCE = {"ENGG": "TMS", "SIGNAL": "SMMS", "TRD": "TDMS"}
RAW_TABLE = {"TMS": "raw.defects_tms", "SMMS": "raw.defects_smms", "TDMS": "raw.defects_tdms"}

BACKLOG_REQUIRED_COLUMNS = ["corridor_id", "defect_type", "severity_code", "detected_date", "due_date", "estimated_block_hours"]
SCHEDULE_REQUIRED_COLUMNS = ["train_number", "station_code"]
GOODS_REQUIRED_COLUMNS = ["corridor_id", "forecast_date", "band_start", "band_end"]


def _read_sheet_rows(file_bytes: bytes) -> list[dict]:
    wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
    ws = wb.active
    header_cells = next(ws.iter_rows(min_row=1, max_row=1))
    header = [str(c.value).strip() if c.value is not None else "" for c in header_cells]
    col_index = {name: i for i, name in enumerate(header) if name}

    rows = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        if all(v is None for v in r):
            continue
        rows.append({name: r[i] for name, i in col_index.items() if i < len(r)})
    return rows, col_index


def _to_date_str(value) -> str:
    if isinstance(value, (datetime, date)):
        return value.date().isoformat() if isinstance(value, datetime) else value.isoformat()
    return str(value).strip()


def _to_datetime_str(value) -> str | None:
    """Optional timestamp cell → ISO string in IST, or None when blank. Excel
    hands back naive datetimes for date-formatted cells; a text cell may be
    'YYYY-MM-DD HH:MM' or ISO. Either way the wall-clock time is the
    department's local (IST) time."""
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, date):
        dt = datetime(value.year, value.month, value.day)
    else:
        raw = str(value).strip().replace("T", " ")
        try:
            dt = datetime.fromisoformat(raw)
        except ValueError:
            dt = datetime.strptime(raw, "%Y-%m-%d %H:%M")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=IST)
    return dt.isoformat()


def parse_backlog_workbook(file_bytes: bytes) -> list[dict]:
    rows, col_index = _read_sheet_rows(file_bytes)
    missing = [c for c in BACKLOG_REQUIRED_COLUMNS if c not in col_index]
    if missing:
        raise ValueError(f"missing required columns: {', '.join(missing)}")
    return [r for r in rows if r.get("corridor_id")]


def ingest_backlog(department: str, rows: list[dict], requested_by: str) -> dict:
    source = DEPARTMENT_TO_SOURCE[department]
    raw_table = RAW_TABLE[source]
    inserted = 0
    errors: list[str] = []

    with engine.begin() as conn:
        corridor_ids = {str(r["corridor_id"]) for r in rows if r.get("corridor_id")}
        existing = set(
            conn.execute(text("SELECT corridor_id FROM core.corridors WHERE corridor_id = ANY(:ids)"), {"ids": list(corridor_ids)}).scalars().all()
        )

        for i, row in enumerate(rows, start=2):
            corridor_id = str(row.get("corridor_id") or "").strip()
            try:
                if corridor_id not in existing:
                    raise ValueError(f"unknown corridor_id '{corridor_id}'")
                severity = str(row["severity_code"]).strip().upper()
                if severity not in ("A", "B", "C"):
                    raise ValueError(f"invalid severity_code '{severity}' (must be A, B, or C)")

                payload = {
                    "defect_id": str(uuid.uuid4()),
                    "source_system": source,
                    "asset_id": (str(row["asset_id"]).strip() if row.get("asset_id") not in (None, "") else None),
                    "corridor_id": corridor_id,
                    "defect_type": str(row["defect_type"]).strip(),
                    "severity_code": severity,
                    "department": department,
                    "detected_date": _to_date_str(row["detected_date"]),
                    "due_date": _to_date_str(row["due_date"]),
                    "speed_restriction_kmph": int(row["speed_restriction_kmph"]) if row.get("speed_restriction_kmph") not in (None, "") else None,
                    "estimated_block_hours": float(row["estimated_block_hours"]),
                    # Optional: the department's preferred block window. Drives
                    # the "Requested" bars on the Gantt and the pinned-time
                    # placement path in the workflow engine.
                    "requested_window_start": _to_datetime_str(row.get("requested_window_start")),
                    "requested_window_end": _to_datetime_str(row.get("requested_window_end")),
                    "requested_by": requested_by,
                }
                if bool(payload["requested_window_start"]) != bool(payload["requested_window_end"]):
                    raise ValueError("requested_window_start and requested_window_end must be given together")
                conn.execute(
                    text(f"INSERT INTO {raw_table} (defect_id, payload) VALUES (:id, :payload)"),
                    {"id": payload["defect_id"], "payload": json.dumps(payload)},
                )
                inserted += 1
            except Exception as exc:  # noqa: BLE001 - reporting per-row, not raising
                errors.append(f"row {i}: {exc}")

    logger.info("ingested %d/%d %s backlog rows (%d errors)", inserted, len(rows), department, len(errors))
    return {"rows_read": len(rows), "rows_ingested": inserted, "errors": errors}


def parse_schedule_workbook(file_bytes: bytes) -> list[dict]:
    rows, col_index = _read_sheet_rows(file_bytes)
    missing = [c for c in SCHEDULE_REQUIRED_COLUMNS if c not in col_index]
    if missing:
        raise ValueError(f"missing required columns: {', '.join(missing)}")
    cleaned = []
    for i, r in enumerate(rows, start=2):
        if not r.get("train_number") or not r.get("station_code"):
            continue
        r.setdefault("id", i)
        r["station_code"] = str(r["station_code"]).strip()
        r["train_number"] = str(r["train_number"]).strip()
        for time_field in ("arrival", "departure"):
            if isinstance(r.get(time_field), datetime):
                r[time_field] = r[time_field].strftime("%H:%M:%S")
        cleaned.append(r)
    return cleaned


def ingest_schedule(rows: list[dict]) -> dict:
    stations = load_stations()
    unknown_stations = sorted({r["station_code"] for r in rows if r["station_code"] not in stations})
    usable_rows = [r for r in rows if r["station_code"] in stations]

    corridors, traversals = build_corridors_and_traversals(stations, raw=usable_rows)

    with engine.begin() as conn:
        existing_ids = set(
            conn.execute(text("SELECT corridor_id FROM core.corridors WHERE corridor_id = ANY(:ids)"), {"ids": list(corridors.keys())}).scalars().all()
        )
        new_corridors = [c for cid, c in corridors.items() if cid not in existing_ids]
        touched_existing = [c for cid, c in corridors.items() if cid in existing_ids]

        for chunk_start in range(0, len(new_corridors), 2000):
            chunk = new_corridors[chunk_start : chunk_start + 2000]
            if chunk:
                conn.execute(
                    text(
                        """
                        INSERT INTO core.corridors
                            (corridor_id, station_a_code, station_b_code, direction, line_name, zone, length_km, train_count, geom)
                        VALUES
                            (:corridor_id, :station_a_code, :station_b_code, :direction, :line_name, :zone, :length_km, :train_count,
                             ST_GeomFromText(:wkt, 4326))
                        ON CONFLICT (corridor_id) DO NOTHING
                        """
                    ),
                    chunk,
                )

        for c in touched_existing:
            conn.execute(
                text("UPDATE core.corridors SET train_count = train_count + :n WHERE corridor_id = :id"),
                {"n": c["train_count"], "id": c["corridor_id"]},
            )

        for chunk_start in range(0, len(traversals), 5000):
            chunk = traversals[chunk_start : chunk_start + 5000]
            if chunk:
                conn.execute(
                    text(
                        """
                        INSERT INTO core.corridor_traversals (corridor_id, train_number, train_name, direction, depart_min, arrive_min)
                        VALUES (:corridor_id, :train_number, :train_name, :direction, :depart_min, :arrive_min)
                        """
                    ),
                    chunk,
                )

        for cid in new_corridors:
            corridor_id = cid["corridor_id"]
            for frac, asset_type, department in ((0.25, "track", "ENGG"), (0.5, "signal", "SIGNAL"), (0.75, "ohe_mast", "TRD")):
                conn.execute(
                    text(
                        """
                        INSERT INTO core.assets (asset_id, corridor_id, asset_type, department, km_marker, geom)
                        SELECT :asset_id, :corridor_id, :asset_type, :department, :km_marker, ST_LineInterpolatePoint(c.geom, :frac)
                        FROM core.corridors c WHERE c.corridor_id = :corridor_id
                        ON CONFLICT (asset_id) DO NOTHING
                        """
                    ),
                    {
                        "asset_id": f"{corridor_id}-{asset_type}",
                        "corridor_id": corridor_id,
                        "asset_type": asset_type,
                        "department": department,
                        "km_marker": round((cid["length_km"] or 0) * frac, 3),
                        "frac": frac,
                    },
                )

    # Only the brand-new corridors get a window calendar built here — an
    # existing corridor that picked up extra traversals keeps its existing
    # calendar untouched, since recomputing it could invalidate window_ids
    # that already-approved plans reference. Its updated train_count still
    # improves the live "is a train running here" status right away.
    new_corridor_ids = [c["corridor_id"] for c in new_corridors]
    n_windows = build_windows.build_for_corridors(new_corridor_ids, horizon_days=35)

    result = {
        "rows_read": len(rows),
        "rows_used": len(usable_rows),
        "unknown_stations": unknown_stations,
        "corridors_added": len(new_corridors),
        "corridors_updated": len(touched_existing),
        "traversals_added": len(traversals),
        "windows_added": n_windows,
    }
    logger.info("ingested schedule: %s", result)
    return result


def _to_minute_of_day(value) -> int:
    """'HH:MM', 'HH:MM:SS', an Excel time cell, or a bare integer minute."""
    if isinstance(value, datetime):
        return value.hour * 60 + value.minute
    if hasattr(value, "hour") and hasattr(value, "minute"):  # datetime.time
        return value.hour * 60 + value.minute
    if isinstance(value, (int, float)):
        # openpyxl gives a fraction-of-day float for time-formatted cells
        # without a date; a whole number is taken as a minute count.
        if 0 <= float(value) < 1:
            return int(round(float(value) * 1440))
        return int(value)
    parts = str(value).strip().split(":")
    if len(parts) < 2:
        raise ValueError(f"bad time '{value}' (expected HH:MM)")
    return int(parts[0]) * 60 + int(parts[1])


def parse_goods_forecast_workbook(file_bytes: bytes) -> list[dict]:
    rows, col_index = _read_sheet_rows(file_bytes)
    missing = [c for c in GOODS_REQUIRED_COLUMNS if c not in col_index]
    if missing:
        raise ValueError(f"missing required columns: {', '.join(missing)}")
    return [r for r in rows if r.get("corridor_id")]


def ingest_goods_forecast(rows: list[dict], uploaded_by: str) -> dict:
    """Load Control Office goods-train forecast bands. Re-uploading the same
    corridor/date/band updates its train count rather than duplicating it.
    A band that wraps past midnight is split into two same-day pieces."""
    inserted = 0
    updated = 0
    errors: list[str] = []
    touched: set[tuple[str, date]] = set()

    with engine.begin() as conn:
        corridor_ids = {str(r["corridor_id"]).strip() for r in rows if r.get("corridor_id")}
        existing = set(
            conn.execute(text("SELECT corridor_id FROM core.corridors WHERE corridor_id = ANY(:ids)"), {"ids": list(corridor_ids)}).scalars().all()
        )
        for i, row in enumerate(rows, start=2):
            corridor_id = str(row.get("corridor_id") or "").strip()
            try:
                if corridor_id not in existing:
                    raise ValueError(f"unknown corridor_id '{corridor_id}'")
                forecast_date = date.fromisoformat(_to_date_str(row["forecast_date"]))
                start_min = _to_minute_of_day(row["band_start"])
                end_min = _to_minute_of_day(row["band_end"])
                if end_min == 0:
                    end_min = 1440
                train_count = int(row["train_count"]) if row.get("train_count") not in (None, "") else 1
                if train_count < 1:
                    raise ValueError("train_count must be at least 1")

                pieces: list[tuple[date, int, int]]
                if end_min > start_min:
                    pieces = [(forecast_date, start_min, end_min)]
                else:
                    pieces = [(forecast_date, start_min, 1440), (forecast_date + timedelta(days=1), 0, end_min)]

                for day, s_min, e_min in pieces:
                    if e_min <= s_min:
                        continue
                    result = conn.execute(
                        text(
                            """
                            INSERT INTO core.goods_train_forecasts
                                (corridor_id, forecast_date, band_start_min, band_end_min, train_count, uploaded_by)
                            VALUES (:c, :d, :s, :e, :n, :by)
                            ON CONFLICT (corridor_id, forecast_date, band_start_min, band_end_min)
                            DO UPDATE SET train_count = EXCLUDED.train_count, uploaded_by = EXCLUDED.uploaded_by, created_at = now()
                            RETURNING (xmax = 0) AS inserted
                            """
                        ),
                        {"c": corridor_id, "d": day, "s": s_min, "e": e_min, "n": train_count, "by": uploaded_by},
                    ).scalar()
                    if result:
                        inserted += 1
                    else:
                        updated += 1
                    touched.add((corridor_id, day))
            except Exception as exc:  # noqa: BLE001 - reporting per-row, not raising
                errors.append(f"row {i}: {exc}")

        windows_affected = 0
        if touched:
            # How many candidate windows now overlap a forecast band — the
            # planner will clip or drop these.
            windows_affected = conn.execute(
                text(
                    """
                    SELECT count(*) FROM core.corridor_block_windows w
                    JOIN core.goods_train_forecasts g
                      ON g.corridor_id = w.corridor_id AND g.forecast_date = w.window_start::date
                    WHERE w.corridor_id = ANY(:cids) AND w.window_start::date = ANY(:days)
                      AND (EXTRACT(HOUR FROM w.window_start) * 60 + EXTRACT(MINUTE FROM w.window_start)) < g.band_end_min
                      AND (EXTRACT(EPOCH FROM (w.window_end - w.window_start)) / 60
                           + EXTRACT(HOUR FROM w.window_start) * 60 + EXTRACT(MINUTE FROM w.window_start)) > g.band_start_min
                    """
                ),
                {"cids": sorted({c for c, _ in touched}), "days": sorted({d for _, d in touched})},
            ).scalar() or 0

    logger.info("goods forecast: %d inserted, %d updated, %d errors, %d windows affected", inserted, updated, len(errors), windows_affected)
    return {"rows_read": len(rows), "bands_inserted": inserted, "bands_updated": updated, "errors": errors, "windows_affected": int(windows_affected)}
