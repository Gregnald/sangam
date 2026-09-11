"""CP-SAT block assignment model.

One *window* is one candidate possession: a timetable gap on one corridor on
one day. Any number of jobs can be placed in it, and that is the whole point
of coordinated block planning — an "integrated block" where Engineering,
S&T and TRD crews work the same section under one possession instead of
each taking the corridor out of service separately.

How a shared window is modelled:

- Departments work **in parallel**: an ENGG crew on the track and a SIGNAL
  crew on the relay room don't queue behind each other. Whether two
  departments may share a possession at all is the compatibility matrix
  (with per-window overrides), and a window's `max_concurrent_depts` caps how
  many can be on the section at once.
- Jobs of the **same department** run **in sequence** inside the possession —
  one crew, one job after another — so their durations add up and must fit
  the window.
- The possession therefore lasts as long as the busiest department's queue,
  not the sum of every job. That length is what the objective charges for:
  bundling work into one possession is cheaper than spreading it out, and
  that is the pull that produces joint blocks.

Objective (maximised):

    + PRIORITY_WEIGHT * (score + 1)   for every job placed
    - POSSESSION_PENALTY * possession length (tenths of an hour) per used window
    - BLOCK_EVENT_PENALTY               per used window
    - LATENESS_PENALTY_PER_DAY * days   for a job placed after its due date

Placing a job always beats leaving it out: the smallest reward (score 0) is
PRIORITY_WEIGHT, larger than the worst possession penalty a single window can
incur (24 h → 240 tenths × POSSESSION_PENALTY), so the duration terms only
ever decide *where* work goes, never *whether* it goes.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from ortools.sat.python import cp_model

logger = logging.getLogger("sangam.optimizer.model")

DEPARTMENTS = ("ENGG", "SIGNAL", "TRD")
PRIORITY_WEIGHT = 1000
# Per tenth-of-an-hour of possession. 3 × 240 tenths = 720 < PRIORITY_WEIGHT,
# so even a 24 h possession never outweighs placing the lowest-ranked job.
POSSESSION_PENALTY = 3
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


@dataclass
class Window:
    window_id: str
    corridor_id: str
    start: datetime
    end: datetime
    duration_hours: float
    max_concurrent_depts: int


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


def solve(
    jobs: list[Job],
    windows: list[Window],
    compatible_pairs: set[frozenset[str]] | None = None,
    window_overrides: dict[str, dict[frozenset, bool]] | None = None,
    time_limit_s: int = 120,
    num_workers: int = 8,
) -> SolveResult:
    compatible_pairs = compatible_pairs if compatible_pairs is not None else {
        frozenset(p) for p in ((a, b) for a in DEPARTMENTS for b in DEPARTMENTS)
    }
    window_overrides = window_overrides or {}

    def pair_compatible(window_id: str, a: str, b: str) -> bool:
        override = window_overrides.get(window_id)
        pair = frozenset((a, b))
        if override and pair in override:
            return override[pair]
        return pair in compatible_pairs

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

        # Different departments: in parallel, if they are allowed to share.
        model.Add(sum(dept_used.values()) <= w.max_concurrent_depts)
        present = list(dept_used.keys())
        for i, a in enumerate(present):
            for b in present[i + 1 :]:
                if not pair_compatible(w.window_id, a, b):
                    model.Add(dept_used[a] + dept_used[b] <= 1)

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
        objective_terms.append(-BLOCK_EVENT_PENALTY * var)
        objective_terms.append(-POSSESSION_PENALTY * possession[wid])

    model.Maximize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_s
    solver.parameters.num_search_workers = num_workers
    status = solver.Solve(model)

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
