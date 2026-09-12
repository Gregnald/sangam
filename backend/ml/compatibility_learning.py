from __future__ import annotations

from dataclasses import dataclass, asdict

from sqlalchemy import text

MIN_EVIDENCE = 5
FLIP_THRESHOLD = 0.8


@dataclass
class PairEvidence:
    dept_a: str
    dept_b: str
    seeded_compatible: bool
    seeded_notes: str | None
    overrides_yes: int
    overrides_no: int
    posterior_mean: float
    learned_compatible: bool | None  # None = not enough / not decisive evidence
    in_effect: bool

    def to_dict(self) -> dict:
        return asdict(self)


def pair_evidence(conn) -> list[PairEvidence]:
    seeded = conn.execute(text("SELECT dept_a, dept_b, compatible, notes FROM core.compatibility_matrix")).mappings().all()
    counts = conn.execute(
        text(
            """
            SELECT LEAST(dept_a, dept_b) AS a, GREATEST(dept_a, dept_b) AS b,
                   count(*) FILTER (WHERE compatible) AS yes, count(*) FILTER (WHERE NOT compatible) AS no
            FROM core.compatibility_overrides
            GROUP BY 1, 2
            """
        )
    ).mappings().all()
    by_pair = {(r["a"], r["b"]): (int(r["yes"]), int(r["no"])) for r in counts}

    out: list[PairEvidence] = []
    for r in seeded:
        a, b = sorted((r["dept_a"], r["dept_b"]))
        yes, no = by_pair.get((a, b), (0, 0))
        n = yes + no
        mean = (yes + 1) / (n + 2)
        learned: bool | None = None
        if n >= MIN_EVIDENCE:
            if mean >= FLIP_THRESHOLD:
                learned = True
            elif mean <= 1 - FLIP_THRESHOLD:
                learned = False
        in_effect = learned if learned is not None else bool(r["compatible"])
        out.append(PairEvidence(a, b, bool(r["compatible"]), r["notes"], yes, no, round(mean, 3), learned, in_effect))
    return out


def effective_compatible_pairs(conn) -> set[frozenset[str]]:
    """The matrix the planner should use right now: seeded defaults with
    learned flips applied. Same-department pairs are always compatible."""
    pairs = {frozenset((e.dept_a, e.dept_b)) for e in pair_evidence(conn) if e.in_effect}
    for d in ("ENGG", "SIGNAL", "TRD"):
        pairs.add(frozenset((d,)))
    return pairs
