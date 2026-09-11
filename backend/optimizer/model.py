from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from ortools.sat.python import cp_model

logger = logging.getLogger("sangam.optimizer.model")

DEPARTMENTS = ("ENGG", "SIGNAL", "TRD")
PRIORITY_WEIGHT = 1000
BLOCK_EVENT_PENALTY = 5
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
    jobs_by_id = {j.defect_id: j for j in jobs}

    for w in windows:
        jobs_on_window = [j for j in jobs if (j.defect_id, w.window_id) in x]
        if not jobs_on_window:
            continue

        model.Add(
            sum(int(jobs_by_id[j.defect_id].duration_hours * 100) * x[j.defect_id, w.window_id] for j in jobs_on_window)
            <= int(w.duration_hours * 100)
        )

        dept_used: dict[str, cp_model.IntVar] = {}
        for dept in DEPARTMENTS:
            dept_jobs = [j for j in jobs_on_window if j.department == dept]
            if not dept_jobs:
                continue
            dept_used[dept] = model.NewBoolVar(f"deptused_{w.window_id}_{dept}")
            for j in dept_jobs:
                model.Add(x[j.defect_id, w.window_id] <= dept_used[dept])
        if dept_used:
            model.Add(sum(dept_used.values()) <= w.max_concurrent_depts)
            present = list(dept_used.keys())
            for i, a in enumerate(present):
                for b in present[i + 1 :]:
                    if not pair_compatible(w.window_id, a, b):
                        model.Add(dept_used[a] + dept_used[b] <= 1)

        used[w.window_id] = model.NewBoolVar(f"used_{w.window_id}")
        for j in jobs_on_window:
            model.Add(x[j.defect_id, w.window_id] <= used[w.window_id])

    objective_terms = []
    for j in jobs:
        # +1 baseline before scaling: priority_score is min-max scaled to
        # [0, 100] per batch, so the single lowest-scored job in any batch is
        # *exactly* 0 by construction. Without this floor, that job's reward
        # for being scheduled is 0 while the duration/event penalties below
        # are still negative — the solver then "optimally" leaves a feasible,
        # real backlog item unscheduled forever just because it happened to
        # rank last, wasting free capacity. The duration/event terms stay
        # meant only as tie-breakers among comparable options, never as a
        # reason to prefer doing nothing over placing a lower-priority job.
        objective_terms.append(int((j.priority_score + 1) * PRIORITY_WEIGHT) * y[j.defect_id])
    window_by_id_all = {w.window_id: w for w in windows}
    for (defect_id, window_id), var in x.items():
        objective_terms.append(-int(jobs_by_id[defect_id].duration_hours * 10) * var)
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
    for var in used.values():
        objective_terms.append(-BLOCK_EVENT_PENALTY * var)

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

        group_id_by_window = {
            wid: str(uuid.uuid4()) for wid, defect_ids in jobs_per_window.items() if len(defect_ids) > 1
        }

        for (defect_id, window_id), var in x.items():
            if not solver.Value(var):
                continue
            job = jobs_by_id[defect_id]
            w = window_by_id[window_id]
            assignments.append(
                Assignment(
                    defect_id=defect_id,
                    window_id=window_id,
                    corridor_id=job.corridor_id,
                    department=job.department,
                    allocated_start=w.start,
                    allocated_end=w.start + timedelta(hours=job.duration_hours),
                    joint_block_group_id=group_id_by_window.get(window_id),
                )
            )
            scheduled.add(defect_id)

    all_ids = {j.defect_id for j in jobs}
    return SolveResult(
        assignments=assignments,
        scheduled_defect_ids=scheduled,
        unscheduled_defect_ids=all_ids - scheduled,
        status=status_name,
        objective_value=solver.ObjectiveValue() if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else 0.0,
        solve_seconds=solver.WallTime(),
    )
