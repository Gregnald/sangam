from __future__ import annotations

import logging

from sqlalchemy import text

from app.db import engine
from etl.load_network import infer_missing_zones

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("sangam.scripts.fix_corridor_zones")


def fix() -> dict:
    """Re-derive station and corridor zones on a live database using the same
    nearest-zoned-neighbor inference load_network.py now applies on a fresh
    load — but only UPDATEs the zone columns, so existing defects, plans, and
    assignments (which reference stations/corridors by id, not by zone) are
    completely untouched. Safe to run against a database that already has
    real ingested backlog and generated plans."""
    with engine.begin() as conn:
        rows = conn.execute(
            text("SELECT station_id, code, zone, ST_X(geom) AS lon, ST_Y(geom) AS lat FROM core.stations")
        ).mappings().all()
        stations = {r["code"]: {"code": r["code"], "zone": r["zone"], "lon": r["lon"], "lat": r["lat"]} for r in rows}

        n_inferred = infer_missing_zones(stations)
        logger.info("inferred zone for %d/%d stations", n_inferred, len(stations))

        station_updates = [{"code": code, "zone": s["zone"]} for code, s in stations.items()]
        conn.execute(text("UPDATE core.stations SET zone = :zone WHERE code = :code"), station_updates)

        corridor_rows = conn.execute(text("SELECT corridor_id, station_a_code, station_b_code, direction FROM core.corridors")).mappings().all()
        canonical_zone: dict[tuple[str, str], str | None] = {}
        for r in corridor_rows:
            pair = tuple(sorted((r["station_a_code"], r["station_b_code"])))
            if pair not in canonical_zone:
                a, b = pair
                canonical_zone[pair] = stations.get(a, {}).get("zone") or stations.get(b, {}).get("zone")

        corridor_updates = []
        for r in corridor_rows:
            pair = tuple(sorted((r["station_a_code"], r["station_b_code"])))
            corridor_updates.append({"id": r["corridor_id"], "zone": canonical_zone[pair]})
        conn.execute(text("UPDATE core.corridors SET zone = :zone WHERE corridor_id = :id"), corridor_updates)

    logger.info("updated zones on %d stations and %d corridors", len(station_updates), len(corridor_updates))
    return {"stations_inferred": n_inferred, "stations_updated": len(station_updates), "corridors_updated": len(corridor_updates)}


if __name__ == "__main__":
    fix()
