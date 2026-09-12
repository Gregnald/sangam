"""Can these two jobs share one possession?

One answer, used everywhere a block is assembled — the CP-SAT solver, the
live request workflow slotting a new job into an existing possession, and
the API explaining why a job did or didn't join a block.

The rule is a single matrix over kinds of work (`core.work_type_compatibility`).
Each kind of work belongs to one department, so the department question is
inside it: "may tamping share a possession with a track-circuit repair?" —
no; "relay-room work with rail grinding?" — yes. Jobs of the same department
always share (they queue back to back inside the possession).

On top of the matrix sit the controller's per-window overrides
(`core.compatibility_overrides`, by department pair) — a one-off "yes, these
two may share *this* block" or "not this one".

A pairwise ML model (ml/pair_compat_model.py) trained on the controller's
matrix edits and overrides adds a *preference* for choosing among allowed
pairings; it never relaxes the matrix.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from sqlalchemy import text

from app.compatibility import load_compatible_pairs, load_window_overrides


class JobLike(Protocol):
    department: str
    defect_type: str | None


@dataclass(frozen=True)
class Verdict:
    ok: bool
    reason: str


@dataclass
class PairCompatibility:
    # work-type pair → may share
    matrix: dict[frozenset[str], bool]
    # department pair fallback for a work type not in the matrix yet
    dept_pairs: set[frozenset[str]]
    window_overrides: dict[str, dict[frozenset, bool]] = field(default_factory=dict)
    notes: dict[frozenset[str], str | None] = field(default_factory=dict)

    def check(self, a: JobLike, b: JobLike, window_id: str | None = None) -> Verdict:
        if a.department == b.department:
            return Verdict(True, "same department — back to back")
        # Controller's per-window decision wins.
        if window_id:
            override = self.window_overrides.get(str(window_id), {}).get(frozenset((a.department, b.department)))
            if override is not None:
                return Verdict(bool(override), f"controller override for this block: {a.department} and {b.department} {'may' if override else 'may not'} share")
        key = frozenset((a.defect_type or "", b.defect_type or ""))
        cell = self.matrix.get(key)
        if cell is not None:
            note = self.notes.get(key)
            if cell:
                return Verdict(True, f"{_t(a.defect_type)} + {_t(b.defect_type)} may share a possession")
            return Verdict(False, f"{_t(a.defect_type)} and {_t(b.defect_type)} may not share a possession" + (f" — {note}" if note else ""))
        # Work type unknown to the matrix: fall back to the department pair.
        if frozenset((a.department, b.department)) in self.dept_pairs:
            return Verdict(True, f"{a.department} and {b.department} may share (department default; no work-type rule yet)")
        return Verdict(False, f"{a.department} and {b.department} may not share (department default; no work-type rule yet)")

    def check_against(self, job: JobLike, others: list[JobLike], window_id: str | None = None) -> Verdict:
        """Can `job` join a possession already holding `others`? Every pair
        must pass; the first failure is the reason."""
        for o in others:
            v = self.check(job, o, window_id)
            if not v.ok:
                return v
        return Verdict(True, "compatible with every job in the possession" if others else "empty window")


def _t(defect_type: str | None) -> str:
    return (defect_type or "unknown work").replace("_", " ")


def load_pair_compatibility(conn, window_ids: list[str] | None = None) -> PairCompatibility:
    matrix: dict[frozenset[str], bool] = {}
    notes: dict[frozenset[str], str | None] = {}
    for r in conn.execute(text("SELECT type_a, type_b, compatible, notes FROM core.work_type_compatibility")).mappings():
        key = frozenset((r["type_a"], r["type_b"]))
        matrix[key] = bool(r["compatible"])
        notes[key] = r["notes"]
    return PairCompatibility(
        matrix=matrix,
        dept_pairs=load_compatible_pairs(conn),
        window_overrides=load_window_overrides(conn, window_ids or []),
        notes=notes,
    )
