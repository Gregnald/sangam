from __future__ import annotations

import pandas as pd
from sqlalchemy import text

FAILURE_RATE_TABLE = {
    "rail_fracture_risk": 0.62,
    "track_geometry_twist": 0.40,
    "weld_defect": 0.35,
    "ballast_deficiency": 0.20,
    "rail_wear": 0.25,
    "signal_relay_fault": 0.30,
    "interlocking_fault": 0.55,
    "cable_fault": 0.20,
    "track_circuit_failure": 0.35,
    "insulator_flashover_risk": 0.50,
    "feeder_fault": 0.45,
    "ohe_wire_wear": 0.30,
    "traction_transformer_fault": 0.60,
}

FEATURE_COLUMNS = [
    "days_overdue",
    "days_to_due",
    "sev_A",
    "sev_B",
    "sev_C",
    "speed_restriction_active",
    "defect_type_failure_rate",
    "corridor_traffic_density",
    "estimated_block_hours",
    "co_locatable_jobs_count",
    "dept_backlog_pressure",
    "defer_count",
]


def corridor_traffic_density(conn) -> dict[str, float]:
    rows = conn.execute(text("SELECT corridor_id, train_count FROM core.corridors")).mappings().all()
    if not rows:
        return {}
    max_count = max((r["train_count"] or 0) for r in rows) or 1
    return {r["corridor_id"]: (r["train_count"] or 0) / max_count * 24 for r in rows}


def build_features(df: pd.DataFrame, density_by_corridor: dict[str, float]) -> pd.DataFrame:
    out = pd.DataFrame(index=df.index)
    today = pd.Timestamp.today().normalize()

    due = pd.to_datetime(df["due_date"])
    out["days_overdue"] = (today - due).dt.days.clip(lower=0)
    out["days_to_due"] = (due - today).dt.days

    for code in ("A", "B", "C"):
        out[f"sev_{code}"] = (df["severity_code"] == code).astype(int)

    out["speed_restriction_active"] = df["speed_restriction_kmph"].notna().astype(int)
    out["defect_type_failure_rate"] = df["defect_type"].map(FAILURE_RATE_TABLE).fillna(0.3)
    out["corridor_traffic_density"] = df["corridor_id"].map(density_by_corridor).fillna(6.0)
    out["estimated_block_hours"] = df["estimated_block_hours"].astype(float)

    co_locatable = df.groupby("corridor_id")["defect_id"].transform("count") - 1
    out["co_locatable_jobs_count"] = co_locatable.clip(lower=0)

    this_month = today.to_period("M")
    is_this_month_ab = (pd.to_datetime(df["detected_date"]).dt.to_period("M") == this_month) & (
        df["severity_code"].isin(["A", "B"])
    )
    dept_pressure = df.assign(_flag=is_this_month_ab.astype(int)).groupby("department")["_flag"].transform("sum")
    out["dept_backlog_pressure"] = dept_pressure
    out["defer_count"] = df["defer_count"].fillna(0).astype(int)

    return out[FEATURE_COLUMNS]


def synthetic_bootstrap_label(df: pd.DataFrame, X: pd.DataFrame) -> pd.Series:
    severity_multiplier = df["severity_code"].map({"A": 3.0, "B": 1.6, "C": 1.0}).fillna(1.0)
    urgency = X["days_overdue"] * 2 + (30 - X["days_to_due"]).clip(lower=0)
    risk = X["defect_type_failure_rate"] * 40 + X["speed_restriction_active"] * 20 + X["corridor_traffic_density"] * 1.5
    efficiency = X["co_locatable_jobs_count"] * 5 - X["estimated_block_hours"] * 0.5
    aging = X["defer_count"] * 8
    return severity_multiplier * (urgency + risk + efficiency + aging)
