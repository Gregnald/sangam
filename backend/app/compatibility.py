from __future__ import annotations

from sqlalchemy import text


def load_compatible_pairs(conn) -> set[frozenset[str]]:
    """Seeded defaults with the learned flips from controller overrides
    applied (see ml/compatibility_learning.py)."""
    from ml.compatibility_learning import effective_compatible_pairs

    return effective_compatible_pairs(conn)


def load_window_overrides(conn, window_ids: list[str]) -> dict[str, dict[frozenset, bool]]:
    if not window_ids:
        return {}
    rows = conn.execute(
        text("SELECT window_id, dept_a, dept_b, compatible FROM core.compatibility_overrides WHERE window_id = ANY(:ids)"),
        {"ids": window_ids},
    ).mappings().all()
    out: dict[str, dict[frozenset, bool]] = {}
    for r in rows:
        out.setdefault(str(r["window_id"]), {})[frozenset((r["dept_a"], r["dept_b"]))] = r["compatible"]
    return out


def is_compatible(conn, dept_a: str, dept_b: str, window_id: str | None = None) -> bool:
    if dept_a == dept_b:
        return True

    if window_id:
        override = conn.execute(
            text(
                """
                SELECT compatible FROM core.compatibility_overrides
                WHERE window_id = :w AND ((dept_a = :a AND dept_b = :b) OR (dept_a = :b AND dept_b = :a))
                """
            ),
            {"w": window_id, "a": dept_a, "b": dept_b},
        ).scalar()
        if override is not None:
            return bool(override)

    return frozenset((dept_a, dept_b)) in load_compatible_pairs(conn)
