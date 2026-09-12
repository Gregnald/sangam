"""CP-SAT block assignment model.

One *window* is one candidate possession: a timetable gap on one corridor on
one day. Any number of jobs can be placed in it — that is the whole point of
coordinated block planning: an "integrated block" where Engineering, S&T and
TRD crews work the same section under one possession instead of each taking
the corridor out of service separately.

How many departments end up sharing a possession is **not a parameter**. It
falls out of the optimization, bounded only by constraints that are real:

- **Compatibility.** Whether two *jobs* may be on the section at the same
  time is the work-type × work-type matrix (optimizer/pair_compat.py; the
  controller's per-window overrides on top). Pairwise hard constraint on the
  jobs — a possession takes as many crews as are mutually compatible.
- **Time.** Departments work in parallel; a department's own jobs run back to
  back, so its queue must fit the window.

The objective then does the deciding: placing a job always beats leaving it
out, and beyond that the solver pays for every hour a corridor is under
possession — weighted by how busy the corridor is — so it bundles work into
shared possessions wherever the constraints above allow, most aggressively on
the corridors where downtime costs the most traffic.

Objective (maximised):

    + PRIORITY_WEIGHT * (score + 1)                        for every job placed
    - possession length (tenths of an hour) * cost(traffic) per used window
    - BLOCK_EVENT_PENALTY                                    per used window
    - LATENESS_PENALTY_PER_DAY * days                        for a job placed after its due date

where cost(traffic) = POSSESSION_PENALTY * (1 + TRAFFIC_WEIGHT * traffic_factor),
traffic_factor in [0, 1] being the corridor's trains/day relative to the
busiest corridor in the zone. The smallest job reward (score 0) is
PRIORITY_WEIGHT = 1000; the worst possession penalty a single window can incur
is 24 h × 10 × POSSESSION_PENALTY × (1 + TRAFFIC_WEIGHT) = 960 < 1000, so the
possession terms only ever decide *where* work goes, never *whether* it goes.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from ortools.sat.python import cp_model

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ml.pair_compat_model import PairPreference
    from optimizer.pair_compat import PairCompatibility

logger = logging.getLogger("sangam.optimizer.model")

DEPARTMENTS = ("ENGG", "SIGNAL", "TRD")
PRIORITY_WEIGHT = 1000
# Per tenth-of-an-hour of possession on an idle corridor …
POSSESSION_PENALTY = 2
# … up to (1 + TRAFFIC_WEIGHT)× that on the zone's busiest corridor.
TRAFFIC_WEIGHT = 1.0
BLOCK_EVENT_PENALTY = 20
LATENESS_PENALTY_PER_DAY = 50


@dataclass
class Job:
    defect_id: str
    corridor_id: str
    department: str
    priority_score: float
    duration_hours: float
    due_date: date | None = None
    # What the work is — the key into the work-type compatibility matrix.
    defect_type: str | None = None


@dataclass
class Window:
    window_id: str
    corridor_id: str
    start: datetime
    end: datetime
    duration_hours: float
    # Kept for schema compatibility; concurrency is decided by the
    # constraints in `solve`, not by this number.
    max_concurrent_depts: int = len(DEPARTMENTS)
    # Corridor busyness relative to the zone's busiest corridor, 0..1.
    traffic_factor: float = 0.0


@dataclass
class Assignment:
    defect_id: str
    window_id: str
    corridor_id: str
    department: str
    allocated_start: datetime
    allocated_end: datetime
    joint_block_group_id: str | None


@dataclass
class SolveResult:
    assignments: list[Assignment]
    scheduled_defect_ids: set[str]
    unscheduled_defect_ids: set[str]
    status: str
    objective_value: float
    solve_seconds: float


def _tenths(hours: float) -> int:
    return int(round(hours * 10))


# Soft preference from the pairwise model, per pair actually placed together:
# +PAIR_PREF_WEIGHT * (2p − 1), i.e. up to ±PAIR_PREF_WEIGHT. Kept an order of
# magnitude under the possession terms so it only breaks ties between
# equally good bundlings; it can't make the solver open an extra block.
PAIR_PREF_WEIGHT = 10


def solve(
    jobs: list[Job],
    windows: list[Window],
    pair_compat: "PairCompatibility | None" = None,
    pair_preference: "PairPreference | None" = None,
    compatible_pairs: set[frozenset[str]] | None = None,
    window_overrides: dict[str, dict[frozenset, bool]] | None = None,
    time_limit_s: int = 120,
    num_workers: int = 8,
) -> SolveResult:
    """`pair_compat` is the job-pair engine (optimizer/pair_compat.py). When
    it isn't given (unit tests), a minimal one is built from `compatible_pairs`
    / `window_overrides` (department level, no work-type cells)."""
    if pair_compat is None:
        from optimizer.pair_compat import PairCompatibility

        pairs = compatible_pairs if compatible_pairs is not None else {frozenset(p) for p in ((a, b) for a in DEPARTMENTS for b in DEPARTMENTS)}
        pair_compat = PairCompatibility(matrix={}, dept_pairs=pairs, window_overrides=window_overrides or {})

    model = cp_model.CpModel()

    windows_by_corridor: dict[str, list[Window]] = {}
    for w in windows:
        windows_by_corridor.setdefault(w.corridor_id, []).append(w)

    x: dict[tuple[str, str], cp_model.IntVar] = {}
    y: dict[str, cp_model.IntVar] = {}
    feasible_windows: dict[str, list[Window]] = {}

    for j in jobs:
        y[j.defect_id] = model.NewBoolVar(f"y_{j.defect_id}")
        candidates = [
            w for w in windows_by_corridor.get(j.corridor_id, []) if j.duration_hours <= w.duration_hours + 1e-6
        ]
        feasible_windows[j.defect_id] = candidates
        for w in candidates:
            x[j.defect_id, w.window_id] = model.NewBoolVar(f"x_{j.defect_id}_{w.window_id}")

    for j in jobs:
        cands = feasible_windows[j.defect_id]
        if cands:
            model.Add(sum(x[j.defect_id, w.window_id] for w in cands) == y[j.defect_id])
        else:
            model.Add(y[j.defect_id] == 0)

    used: dict[str, cp_model.IntVar] = {}
    possession: dict[str, cp_model.IntVar] = {}
    jobs_by_id = {j.defect_id: j for j in jobs}
    n_pair_constraints = 0
    pair_terms: list = []

    for w in windows:
        jobs_on_window = [j for j in jobs if (j.defect_id, w.window_id) in x]
        if not jobs_on_window:
            continue

        cap = _tenths(w.duration_hours)
        used[w.window_id] = model.NewBoolVar(f"used_{w.window_id}")
        possession[w.window_id] = model.NewIntVar(0, cap, f"poss_{w.window_id}")

        dept_used: dict[str, cp_model.IntVar] = {}
        for dept in DEPARTMENTS:
            dept_jobs = [j for j in jobs_on_window if j.department == dept]
            if not dept_jobs:
                continue
            dept_used[dept] = model.NewBoolVar(f"deptused_{w.window_id}_{dept}")
            queue = sum(_tenths(j.duration_hours) * x[j.defect_id, w.window_id] for j in dept_jobs)
            # Same department: one crew, jobs back to back — the queue must
            # fit the window, and the possession lasts at least that long.
            model.Add(queue <= cap)
            model.Add(possession[w.window_id] >= queue)
            for j in dept_jobs:
                model.Add(x[j.defect_id, w.window_id] <= dept_used[dept])
                model.Add(x[j.defect_id, w.window_id] <= used[w.window_id])

        # Different departments in parallel — job by job. Every pair of
        # jobs that could land in this window is checked against the
        # work-type matrix; an incompatible pair can't both be here. This —
        # not a head-count — is what bounds concurrency: three mutually
        # compatible jobs make a three-crew possession.
        for i, a in enumerate(jobs_on_window):
            for b in jobs_on_window[i + 1 :]:
                if a.department == b.department:
                    continue
                verdict = pair_compat.check(a, b, w.window_id)
                if not verdict.ok:
                    model.Add(x[a.defect_id, w.window_id] + x[b.defect_id, w.window_id] <= 1)
                    n_pair_constraints += 1
                elif pair_preference is not None and pair_preference.active:
                    # Allowed pair: let the learned preference nudge the choice.
                    p = pair_preference.probability(a.department, b.department, a.defect_type, b.defect_type, a.duration_hours, b.duration_hours, w.traffic_factor)
                    if p is not None:
                        both = model.NewBoolVar(f"pair_{a.defect_id}_{b.defect_id}_{w.window_id}")
                        model.Add(both <= x[a.defect_id, w.window_id])
                        model.Add(both <= x[b.defect_id, w.window_id])
                        model.Add(both >= x[a.defect_id, w.window_id] + x[b.defect_id, w.window_id] - 1)
                        pair_terms.append(int(round(PAIR_PREF_WEIGHT * (2 * p - 1))) * both)

    objective_terms = []
    for j in jobs:
        # +1 baseline before scaling: priority_score is min-max scaled to
        # [0, 100] per batch, so the single lowest-scored job in any batch is
        # *exactly* 0 by construction. Without this floor its reward would be
        # 0 while the possession/event penalties are still negative — the
        # solver would then "optimally" leave a feasible, real backlog item
        # unscheduled forever just because it happened to rank last.
        objective_terms.append(int((j.priority_score + 1) * PRIORITY_WEIGHT) * y[j.defect_id])
    window_by_id_all = {w.window_id: w for w in windows}
    for (defect_id, window_id), var in x.items():
        due = jobs_by_id[defect_id].due_date
        if due is not None:
            # Prefer the earliest window that meets the due date over one
            # that doesn't, without ever forbidding the late one outright —
            # a job with no on-time option left should still get scheduled
            # rather than sit in the backlog forever. This is what stops a
            # later horizon (e.g. next month, solved out of order) from
            # casually absorbing a job that an on-time horizon should have
            # gotten first crack at: on-time windows always score higher.
            days_late = (window_by_id_all[window_id].start.date() - due).days
            if days_late > 0:
                objective_terms.append(-LATENESS_PENALTY_PER_DAY * days_late * var)
    for wid, var in used.items():
        w = window_by_id_all[wid]
        # An hour of possession on the zone's busiest corridor costs
        # (1 + TRAFFIC_WEIGHT)× an hour on an idle branch — availability is
        # worth most where the trains are.
        cost = int(round(POSSESSION_PENALTY * (1.0 + TRAFFIC_WEIGHT * max(0.0, min(1.0, w.traffic_factor)))))
        objective_terms.append(-BLOCK_EVENT_PENALTY * var)
        objective_terms.append(-cost * possession[wid])

    model.Maximize(sum(objective_terms) + sum(pair_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_s
    solver.parameters.num_search_workers = num_workers
    status = solver.Solve(model)
    logger.info("model: %d jobs, %d windows, %d x-vars, %d pair-incompatibility constraints, %d learned pair preferences", len(jobs), len(windows), len(x), n_pair_constraints, len(pair_terms))

    status_name = solver.StatusName(status)
    assignments: list[Assignment] = []
    scheduled: set[str] = set()

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        window_by_id = {w.window_id: w for w in windows}
        jobs_per_window: dict[str, list[str]] = {}
        for (defect_id, window_id), var in x.items():
            if solver.Value(var):
                jobs_per_window.setdefault(window_id, []).append(defect_id)

        for window_id, defect_ids in jobs_per_window.items():
            w = window_by_id[window_id]
            # One possession, one group id, whether it holds one job or five.
            group_id = str(uuid.uuid4()) if len(defect_ids) > 1 else None
            # Departments start together at the window opening; within a
            # department, jobs run back to back in priority order.
            by_dept: dict[str, list[Job]] = {}
            for defect_id in defect_ids:
                job = jobs_by_id[defect_id]
                by_dept.setdefault(job.department, []).append(job)
            for dept_jobs in by_dept.values():
                cursor = w.start
                for job in sorted(dept_jobs, key=lambda j: -j.priority_score):
                    start = cursor
                    end = start + timedelta(hours=job.duration_hours)
                    assignments.append(
                        Assignment(
                            defect_id=job.defect_id,
                            window_id=window_id,
                            corridor_id=job.corridor_id,
                            department=job.department,
                            allocated_start=start,
                            allocated_end=end,
                            joint_block_group_id=group_id,
                        )
                    )
                    scheduled.add(job.defect_id)
                    cursor = end

    all_ids = {j.defect_id for j in jobs}
    return SolveResult(
        assignments=assignments,
        scheduled_defect_ids=scheduled,
        unscheduled_defect_ids=all_ids - scheduled,
        status=status_name,
        objective_value=solver.ObjectiveValue() if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else 0.0,
        solve_seconds=solver.WallTime(),
    )
