"""Write a sample Control Office goods-train forecast workbook.

Real COA forecasts are internal; this stands in for one by picking the
corridors that actually carry backlog (so the forecast visibly changes what
the planner can do) and forecasting a few freight bands per day over the
next couple of weeks, biased toward the night hours where goods paths run.
"""
from __future__ import annotations

import argparse
import random
from datetime import date, timedelta
from pathlib import Path

import openpyxl
from sqlalchemy import text

from app.config import REPO_ROOT
from app.db import engine

HEADER = ["corridor_id", "forecast_date", "band_start", "band_end", "train_count"]

# (start_hour, end_hour, weight) — night-heavy, matching how freight paths
# are actually pathed around the passenger timetable.
BANDS = [
    (0, 3, 0.30),
    (2, 5, 0.25),
    (10, 12, 0.15),
    (13, 16, 0.15),
    (22, 24, 0.15),
]


def _pick_band(rng: random.Random) -> tuple[int, int]:
    r = rng.random()
    acc = 0.0
    for start_h, end_h, w in BANDS:
        acc += w
        if r <= acc:
            return start_h, end_h
    return BANDS[-1][0], BANDS[-1][1]


def generate(days: int, seed_value: int, out_dir: Path, max_corridors: int = 120) -> Path:
    rng = random.Random(seed_value)
    today = date.today()

    with engine.connect() as conn:
        corridor_ids = conn.execute(
            text(
                """
                SELECT DISTINCT d.corridor_id FROM core.defects d
                WHERE d.corridor_id IS NOT NULL AND d.workflow_status != 'cleared'
                ORDER BY d.corridor_id
                """
            )
        ).scalars().all()
    if not corridor_ids:
        raise RuntimeError("no corridors with backlog — ingest a department backlog first")
    corridor_ids = corridor_ids[:max_corridors]

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "goods_forecast"
    ws.append(HEADER)

    n_rows = 0
    for corridor_id in corridor_ids:
        for offset in range(days):
            day = today + timedelta(days=offset)
            # Not every corridor sees freight every day.
            for _ in range(rng.choice([0, 1, 1, 2])):
                start_h, end_h = _pick_band(rng)
                ws.append(
                    [
                        corridor_id,
                        day.isoformat(),
                        f"{start_h:02d}:{rng.choice([0, 15, 30, 45]):02d}",
                        f"{min(end_h, 23):02d}:{'59' if end_h == 24 else rng.choice(['00', '30']):s}",
                        rng.choice([1, 1, 2, 3]),
                    ]
                )
                n_rows += 1

    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"GOODS_forecast_{today.strftime('%Y-%m')}.xlsx"
    wb.save(out_path)
    print(f"wrote {n_rows} forecast bands across {len(corridor_ids)} corridors")
    return out_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=21)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out-dir", type=str, default=str(REPO_ROOT / "sample_data"))
    args = parser.parse_args()
    path = generate(args.days, args.seed, Path(args.out_dir))
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
