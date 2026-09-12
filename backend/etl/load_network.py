from __future__ import annotations

import argparse
import json
import logging
import math
from collections import defaultdict
from pathlib import Path

from sqlalchemy import text

from app.config import REPO_ROOT
from app.db import engine
from etl.timetable import BUNDLED_EFFECTIVE_FROM, BUNDLED_LABEL, create_version

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("sangam.etl.load_network")

MAPDATA_DIR = REPO_ROOT / "mapData"
EARTH_RADIUS_KM = 6371.0
MIN_TIMED_GAP_MIN = 1


def _haversine_km(lon1, lat1, lon2, lat2) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, [lon1, lat1, lon2, lat2])
    dlon, dlat = lon2 - lon1, lat2 - lat1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def _bearing_rad(lon1, lat1, lon2, lat2) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, [lon1, lat1, lon2, lat2])
    dlon = lon2 - lon1
    y = math.sin(dlon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return math.atan2(y, x)


TRACK_OFFSET_KM = 0.12


def _perp_offset(lon: float, lat: float, bearing_rad: float, side: int) -> tuple[float, float]:
    """Shift a point perpendicular to a bearing so the UP and DOWN lines of a
    corridor render as two visibly separate parallel tracks rather than one
    line drawn twice — real double lines run side by side, not on top of
    each other, and only one of the two need ever be blocked at a time."""
    perp = bearing_rad + (math.pi / 2 if side > 0 else -math.pi / 2)
    dlat = (TRACK_OFFSET_KM / EARTH_RADIUS_KM) * math.cos(perp) * (180 / math.pi)
    dlon = (TRACK_OFFSET_KM / EARTH_RADIUS_KM) * math.sin(perp) / math.cos(math.radians(lat)) * (180 / math.pi)
    return lon + dlon, lat + dlat


def _parse_time(value: str | None) -> int | None:
    if not value or value == "None":
        return None
    try:
        h, m, s = value.split(":")
        return int(h) * 60 + int(m)
    except (ValueError, AttributeError):
        return None


UNKNOWN_ZONE_VALUES = {None, "", "?"}


def infer_missing_zones(stations: dict[str, dict]) -> int:
    """Roughly half the stations in the source data carry no zone field at
    all (or a literal '?' placeholder) — left as-is, every corridor touching
    one becomes zone=NULL, which is invisible to the zone selector and can
    never be reached by any plan generation. IR zones are geographically
    contiguous, so a station's real zone is reliably the same as its nearest
    neighbor that does have one — fill the gap from real coordinates rather
    than leaving that backlog stranded. Mutates `stations` in place; returns
    how many got a zone this way."""
    zoned = [(s["lon"], s["lat"], s["zone"]) for s in stations.values() if s["zone"] not in UNKNOWN_ZONE_VALUES]
    unzoned_codes = [code for code, s in stations.items() if s["zone"] in UNKNOWN_ZONE_VALUES]
    if not zoned or not unzoned_codes:
        return 0

    from scipy.spatial import cKDTree

    tree = cKDTree([(lon, lat) for lon, lat, _ in zoned])
    zone_labels = [z for _, _, z in zoned]
    query_points = [(stations[code]["lon"], stations[code]["lat"]) for code in unzoned_codes]
    _, nearest_idx = tree.query(query_points)
    for code, i in zip(unzoned_codes, nearest_idx):
        stations[code]["zone"] = zone_labels[int(i)]
    return len(unzoned_codes)


def load_stations() -> dict[str, dict]:
    data = json.loads((MAPDATA_DIR / "stations.json").read_text(encoding="utf-8"))
    stations: dict[str, dict] = {}
    for f in data["features"]:
        props = f.get("properties") or {}
        geom = f.get("geometry")
        code = props.get("code")
        if not code or not geom or geom.get("type") != "Point":
            continue
        lon, lat = geom["coordinates"]
        stations[code] = {
            "code": code,
            "name": props.get("name") or code,
            "state": props.get("state"),
            "zone": props.get("zone"),
            "lon": lon,
            "lat": lat,
        }
    n_inferred = infer_missing_zones(stations)
    if n_inferred:
        logger.info("inferred zone for %d/%d stations with no zone in the source data (nearest zoned neighbor)", n_inferred, len(stations))
    return stations


def _write_stations(conn, stations: dict[str, dict]) -> None:
    rows = [
        {
            "station_id": s["code"],
            "code": s["code"],
            "name": s["name"],
            "state": s["state"],
            "zone": s["zone"],
            "lon": s["lon"],
            "lat": s["lat"],
        }
        for s in stations.values()
    ]
    conn.execute(
        text(
            """
            INSERT INTO core.stations (station_id, code, name, state, zone, geom)
            VALUES (:station_id, :code, :name, :state, :zone, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))
            ON CONFLICT (station_id) DO NOTHING
            """
        ),
        rows,
    )
    logger.info("wrote %d stations", len(rows))


def _make_corridor(canon_a: str, canon_b: str, station_a_code: str, station_b_code: str, direction: str, stations: dict[str, dict], canonical_bearing: float, canonical_zone: str | None) -> dict:
    """One physical link has two independent corridors — UP (canon_a -> canon_b)
    and DOWN (canon_b -> canon_a) — so a block on one never implies the other
    is unavailable, matching how a double-tracked line actually works.

    Both directions must offset relative to the *same* canon_a->canon_b
    bearing, not their own station_a->station_b bearing — the down corridor's
    own bearing runs backwards, which would silently cancel the side flip
    and put both lines on the same side instead of opposite ones. They must
    also share the same *zone* — computed once from canon_a/canon_b, not
    re-derived per direction — otherwise a boundary link between two zones
    assigns UP to one zone and DOWN to the other, so filtering the map by
    either zone makes half of that physical link vanish."""
    sa, sb = stations[station_a_code], stations[station_b_code]
    corridor_id = f"COR-{station_a_code}-{station_b_code}"
    side = 1 if direction == "up" else -1
    a_lon, a_lat = _perp_offset(sa["lon"], sa["lat"], canonical_bearing, side)
    b_lon, b_lat = _perp_offset(sb["lon"], sb["lat"], canonical_bearing, side)
    return {
        "corridor_id": corridor_id,
        "station_a_code": station_a_code,
        "station_b_code": station_b_code,
        "direction": direction,
        "line_name": f"{sa['name']} - {sb['name']}",
        "zone": canonical_zone,
        "length_km": round(_haversine_km(sa["lon"], sa["lat"], sb["lon"], sb["lat"]), 3),
        "wkt": f"LINESTRING({a_lon} {a_lat}, {b_lon} {b_lat})",
        "train_count": 0,
    }


def build_corridors_and_traversals(stations: dict[str, dict], raw: list[dict] | None = None) -> tuple[dict[str, dict], list[dict]]:
    """Corridors are adjacent-station segments actually run by real trains,
    derived from schedule stop records (mapData/schedules.json by default, or
    an arbitrary list of same-shaped rows — e.g. an ingested schedule Excel).
    `id` is the row's original sequence number and increases monotonically
    within a train's stop list — confirmed against sample data — so sorting
    by it reconstructs stop order without needing to parse ambiguous/missing
    time fields for ordering.

    Each physical station pair yields two corridor rows, one per direction of
    travel (UP: alphabetically-lower code -> higher code, DOWN: the reverse) —
    real double-tracked lines have separate up and down lines that can be
    blocked independently, and a single shared corridor per pair couldn't
    represent that."""
    if raw is None:
        raw = json.loads((MAPDATA_DIR / "schedules.json").read_text(encoding="utf-8"))
    by_train: dict[str, list[dict]] = defaultdict(list)
    for row in raw:
        by_train[row["train_number"]].append(row)

    pairs_seen: set[tuple[str, str]] = set()
    corridors: dict[str, dict] = {}
    traversals: list[dict] = []

    for train_number, stops in by_train.items():
        stops.sort(key=lambda r: r["id"])
        # Keep only stops with a station we have coordinates for and at least
        # one valid time field — untimed/uncoded halts are bridged over so
        # the segment connects the two nearest usable stations directly.
        timed = []
        for s in stops:
            if s["station_code"] not in stations:
                continue
            dep = _parse_time(s.get("departure"))
            arr = _parse_time(s.get("arrival"))
            if dep is None and arr is None:
                continue
            timed.append({**s, "_dep": dep, "_arr": arr})

        for a, b in zip(timed, timed[1:]):
            code_a, code_b = a["station_code"], b["station_code"]
            if code_a == code_b:
                continue
            dep_min = a["_dep"] if a["_dep"] is not None else a["_arr"]
            arr_min = b["_arr"] if b["_arr"] is not None else b["_dep"]
            day_a, day_b = a.get("day") or 1, b.get("day") or 1
            duration_min = (arr_min - dep_min) + max(0, (day_b - day_a)) * 1440
            if duration_min < MIN_TIMED_GAP_MIN or duration_min > 720:
                continue  # discard bad/outlier timing rather than poison a corridor's calendar

            canon_a, canon_b = sorted([code_a, code_b])
            pair = (canon_a, canon_b)
            if pair not in pairs_seen:
                pairs_seen.add(pair)
                sa, sb = stations[canon_a], stations[canon_b]
                canonical_bearing = _bearing_rad(sa["lon"], sa["lat"], sb["lon"], sb["lat"])
                canonical_zone = sa["zone"] or sb["zone"]
                up = _make_corridor(canon_a, canon_b, canon_a, canon_b, "up", stations, canonical_bearing, canonical_zone)
                down = _make_corridor(canon_a, canon_b, canon_b, canon_a, "down", stations, canonical_bearing, canonical_zone)
                corridors[up["corridor_id"]] = up
                corridors[down["corridor_id"]] = down

            traveling_forward = code_a == canon_a
            corridor_id = f"COR-{canon_a}-{canon_b}" if traveling_forward else f"COR-{canon_b}-{canon_a}"
            corridors[corridor_id]["train_count"] += 1

            traversals.append(
                {
                    "corridor_id": corridor_id,
                    "train_number": train_number,
                    "train_name": a.get("train_name"),
                    "direction": f"{code_a}->{code_b}",
                    "depart_min": dep_min % 1440,
                    "arrive_min": (dep_min % 1440) + duration_min,
                }
            )

    return corridors, traversals


def _write_corridors(conn, corridors: dict[str, dict]) -> None:
    rows = list(corridors.values())
    for chunk_start in range(0, len(rows), 2000):
        chunk = rows[chunk_start : chunk_start + 2000]
        conn.execute(
            text(
                """
                INSERT INTO core.corridors
                    (corridor_id, station_a_code, station_b_code, direction, line_name, zone, length_km, train_count, geom)
                VALUES
                    (:corridor_id, :station_a_code, :station_b_code, :direction, :line_name, :zone, :length_km, :train_count,
                     ST_GeomFromText(:wkt, 4326))
                ON CONFLICT (corridor_id) DO UPDATE SET train_count = EXCLUDED.train_count
                """
            ),
            chunk,
        )
    logger.info("wrote %d corridors", len(rows))


def _write_traversals(conn, traversals: list[dict]) -> None:
    for chunk_start in range(0, len(traversals), 5000):
        chunk = traversals[chunk_start : chunk_start + 5000]
        conn.execute(
            text(
                """
                INSERT INTO core.corridor_traversals
                    (corridor_id, train_number, train_name, direction, depart_min, arrive_min)
                VALUES (:corridor_id, :train_number, :train_name, :direction, :depart_min, :arrive_min)
                """
            ),
            chunk,
        )
    logger.info("wrote %d traversals", len(traversals))


def build_assets(conn, corridors: dict[str, dict]) -> int:
    count = 0
    rows = []
    for corridor_id, c in corridors.items():
        for frac, asset_type, department in ((0.25, "track", "ENGG"), (0.5, "signal", "SIGNAL"), (0.75, "ohe_mast", "TRD")):
            rows.append(
                {
                    "asset_id": f"{corridor_id}-{asset_type}",
                    "corridor_id": corridor_id,
                    "asset_type": asset_type,
                    "department": department,
                    "km_marker": round((c["length_km"] or 0) * frac, 3),
                    "frac": frac,
                }
            )
    for chunk_start in range(0, len(rows), 2000):
        chunk = rows[chunk_start : chunk_start + 2000]
        conn.execute(
            text(
                """
                INSERT INTO core.assets (asset_id, corridor_id, asset_type, department, km_marker, geom)
                SELECT :asset_id, :corridor_id, :asset_type, :department, :km_marker,
                       ST_LineInterpolatePoint(c.geom, :frac)
                FROM core.corridors c WHERE c.corridor_id = :corridor_id
                ON CONFLICT (asset_id) DO NOTHING
                """
            ),
            chunk,
        )
        count += len(chunk)
    logger.info("wrote %d assets", count)
    return count


def load(limit_trains: int | None = None) -> dict:
    stations = load_stations()
    logger.info("parsed %d stations with coordinates", len(stations))

    corridors, traversals = build_corridors_and_traversals(stations)
    logger.info("derived %d corridors, %d traversals", len(corridors), len(traversals))

    with engine.begin() as conn:
        conn.execute(text("DELETE FROM plan.block_assignments"))
        conn.execute(text("DELETE FROM plan.block_plans"))
        conn.execute(text("DELETE FROM core.defects"))
        conn.execute(text("DELETE FROM core.corridor_block_windows"))
        conn.execute(text("DELETE FROM core.corridor_traversals"))
        conn.execute(text("DELETE FROM core.assets"))
        conn.execute(text("DELETE FROM core.corridors"))
        conn.execute(text("DELETE FROM core.stations"))

        _write_stations(conn, stations)
        _write_corridors(conn, corridors)
        _write_traversals(conn, traversals)
        n_assets = build_assets(conn, corridors)
        conn.execute(text("DELETE FROM core.timetable_versions"))
        conn.execute(text("ALTER SEQUENCE core.timetable_versions_version_id_seq RESTART WITH 1"))
        create_version(conn, source=BUNDLED_LABEL, label=BUNDLED_LABEL, effective_from=BUNDLED_EFFECTIVE_FROM, loaded_by=None,
                       trains=len({t["train_number"] for t in traversals}), stop_rows=len(traversals))

    return {
        "stations": len(stations),
        "corridors": len(corridors),
        "traversals": len(traversals),
        "assets": n_assets,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.parse_args()
    result = load()
    logger.info("done: %s", result)


if __name__ == "__main__":
    main()
