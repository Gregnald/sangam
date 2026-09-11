from __future__ import annotations

import argparse
import random
from datetime import date, datetime, timedelta
from pathlib import Path

import openpyxl
from sqlalchemy import text

from app.config import REPO_ROOT
from app.db import engine

DEFECT_TYPES = {
    "ENGG": ["rail_fracture_risk", "track_geometry_twist", "weld_defect", "ballast_deficiency", "rail_wear"],
    "SIGNAL": ["signal_relay_fault", "interlocking_fault", "cable_fault", "track_circuit_failure"],
    "TRD": ["insulator_flashover_risk", "feeder_fault", "ohe_wire_wear", "traction_transformer_fault"],
}
SEVERITY_WEIGHTS = [("A", 0.2), ("B", 0.35), ("C", 0.45)]
DUE_OFFSET_DAYS = {"A": (5, 10), "B": (10, 20), "C": (20, 45)}
# Corridor blocks in practice run 1.5–5 h; anything longer is a special
# possession with train cancellations, which this planner doesn't model.
BLOCK_HOURS_RANGE = (1.5, 5.0)

HEADER = [
    "corridor_id", "asset_id", "defect_type", "severity_code", "detected_date",
    "due_date", "estimated_block_hours", "speed_restriction_kmph",
    "requested_window_start", "requested_window_end",
]
# Share of rows that pin a preferred block window (the rest leave it to the
# planner). Pinned rows draw as "Requested" on the Gantt.
REQUESTED_WINDOW_SHARE = 0.35
# Defects cluster: a worn section tends to throw up track, signalling and
# OHE work together, and that co-location is exactly what a coordinated
# block plan exploits. This share of every department's rows lands on a
# common pool of "hot" sections (the same pool for all three departments, so
# multi-department possessions are possible); the rest scatter randomly.
HOT_SECTION_SHARE = 0.6
HOT_SECTION_COUNT = 40
HOT_SECTION_SEED = 2026


def _weighted_severity(rng: random.Random) -> str:
    r = rng.random()
    acc = 0.0
    for code, w in SEVERITY_WEIGHTS:
        acc += w
        if r <= acc:
            return code
    return "C"


def generate(department: str, n_rows: int, seed_value: int, out_dir: Path) -> Path:
    rng = random.Random(seed_value)
    today = date.today()
    month_start = today.replace(day=1)

    with engine.connect() as conn:
        assets = conn.execute(
            text("SELECT asset_id, corridor_id FROM core.assets WHERE department = :d"), {"d": department}
        ).mappings().all()
        # Hot sections are picked with a seed shared by every department so
        # all three land work on the same corridors. Busier corridors first —
        # that is where the real backlog concentrates too.
        # Sections that actually see traffic *and* still have a gap long
        # enough for a real block (≥ 5 h). The very busiest trunk sections
        # have no such gap — work there needs train regulation, which is
        # outside this planner — so they are not where demo backlog goes.
        hot_corridors = conn.execute(
            text(
                """
                SELECT c.corridor_id
                FROM core.corridors c
                JOIN (
                    SELECT corridor_id, max(EXTRACT(EPOCH FROM (window_end - window_start)) / 3600.0) AS longest_h
                    FROM core.corridor_block_windows GROUP BY corridor_id
                ) w ON w.corridor_id = c.corridor_id
                WHERE c.zone IS NOT NULL AND c.train_count BETWEEN 2 AND 40 AND w.longest_h >= 5
                ORDER BY c.train_count DESC, c.corridor_id
                LIMIT 400
                """
            )
        ).scalars().all()
    if not assets:
        raise RuntimeError(f"no assets found for {department} — run the pipeline first")
    hot_pool = random.Random(HOT_SECTION_SEED).sample(hot_corridors, min(HOT_SECTION_COUNT, len(hot_corridors)))
    hot_assets = [a for a in assets if a["corridor_id"] in set(hot_pool)]

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = f"{department}_backlog"
    ws.append(HEADER)

    for _ in range(n_rows):
        asset = rng.choice(hot_assets) if hot_assets and rng.random() < HOT_SECTION_SHARE else rng.choice(assets)
        defect_type = rng.choice(DEFECT_TYPES[department])
        severity = _weighted_severity(rng)
        detected_date = month_start + timedelta(days=rng.randint(0, max((today - month_start).days, 0)))
        lo, hi = DUE_OFFSET_DAYS[severity]
        due_date = detected_date + timedelta(days=rng.randint(lo, hi))
        speed_restriction = rng.choice([15, 20, 30]) if severity == "A" else None
        block_hours = round(rng.uniform(*BLOCK_HOURS_RANGE), 2)

        requested_start = requested_end = None
        if rng.random() < REQUESTED_WINDOW_SHARE:
            # Prefer a night slot a few days out, before the due date.
            day = today + timedelta(days=rng.randint(1, max(1, min(10, (due_date - today).days))))
            start_hour = rng.choice([0, 1, 2, 22, 23, 10, 11, 14])
            requested_start = datetime(day.year, day.month, day.day, start_hour, rng.choice([0, 15, 30]))
            requested_end = requested_start + timedelta(hours=block_hours)

        ws.append(
            [
                asset["corridor_id"],
                asset["asset_id"],
                defect_type,
                severity,
                detected_date.isoformat(),
                due_date.isoformat(),
                block_hours,
                speed_restriction,
                requested_start.strftime("%Y-%m-%d %H:%M") if requested_start else None,
                requested_end.strftime("%Y-%m-%d %H:%M") if requested_end else None,
            ]
        )

    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{department}_backlog_{today.strftime('%Y-%m')}.xlsx"
    wb.save(out_path)
    return out_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--n-rows", type=int, default=100)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out-dir", type=str, default=str(REPO_ROOT / "sample_data"))
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    for i, department in enumerate(["ENGG", "SIGNAL", "TRD"]):
        path = generate(department, args.n_rows, args.seed + i, out_dir)
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
