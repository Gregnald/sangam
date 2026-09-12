from __future__ import annotations

import logging
from itertools import combinations_with_replacement

from sqlalchemy import text

from app.db import engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("sangam.scripts.seed_compatibility")

DEPARTMENTS = ["ENGG", "SIGNAL", "TRD"]

# Defaults reflect real block-working constraints, not a blanket "everyone's
# fine together" — the controller can still override any specific block from
# the Compatibility tab when local conditions genuinely allow it.
#
# - Same department, multiple crews: always fine, same safety envelope.
# - ENGG + SIGNAL: routine joint possession — track and signalling work are
#   commonly coordinated under one block in real practice.
# - TRD + anything else: TRD work almost always requires the section's OHE to
#   be isolated (a "power block"). Heavy engineering plant or other crews
#   working close to a de-energized-but-not-yet-earthed structure is a real
#   hazard, so the safe default is incompatible until the controller confirms
#   the specific block's isolation/clearance supports sharing it.
PAIR_NOTES: dict[frozenset, tuple[bool, str]] = {
    frozenset({"ENGG"}): (True, "same department, multiple crews"),
    frozenset({"SIGNAL"}): (True, "same department, multiple crews"),
    frozenset({"TRD"}): (True, "same department, multiple crews"),
    frozenset({"ENGG", "SIGNAL"}): (True, "routine joint possession — track and signalling work is commonly coordinated"),
    frozenset({"ENGG", "TRD"}): (False, "TRD work requires OHE isolation — heavy plant near an unearthed structure is unsafe by default"),
    frozenset({"SIGNAL", "TRD"}): (False, "TRD work requires OHE isolation — signalling crews need confirmed clearance to share the block"),
}


def seed() -> None:
    with engine.begin() as conn:
        for a, b in combinations_with_replacement(DEPARTMENTS, 2):
            compatible, notes = PAIR_NOTES[frozenset({a, b})]
            conn.execute(
                text(
                    """
                    INSERT INTO core.compatibility_matrix (dept_a, dept_b, compatible, notes)
                    VALUES (:a, :b, :compatible, :notes)
                    ON CONFLICT (dept_a, dept_b) DO NOTHING
                    """
                ),
                {"a": a, "b": b, "compatible": compatible, "notes": notes},
            )
    logger.info("seeded compatibility matrix for %s", DEPARTMENTS)
    seed_work_types()


# ---------------------------------------------------------------------------
# Work-type × work-type matrix — the single job-level rule.
# ---------------------------------------------------------------------------
# Every kind of work belongs to one department. A cell says whether two kinds
# of work may share one possession. Seeded from the department matrix above,
# then the specific conflicts below are applied; the controller edits cells
# from the Compatibility tab and every edit retrains the pairwise model.
WORK_TYPES: dict[str, str] = {
    "track_geometry_twist": "ENGG", "rail_fracture_risk": "ENGG", "weld_defect": "ENGG", "ballast_deficiency": "ENGG", "rail_wear": "ENGG",
    "signal_relay_fault": "SIGNAL", "interlocking_fault": "SIGNAL", "cable_fault": "SIGNAL", "track_circuit_failure": "SIGNAL",
    "insulator_flashover_risk": "TRD", "feeder_fault": "TRD", "ohe_wire_wear": "TRD", "traction_transformer_fault": "TRD",
}

# Specific cells that differ from the department default, with the reason.
WORK_TYPE_EXCEPTIONS: list[tuple[str, str, bool, str]] = [
    ("track_geometry_twist", "track_circuit_failure", False, "tamping disturbs track-circuit bonds being worked on"),
    ("track_geometry_twist", "cable_fault", False, "tamping machine over an open cable trench"),
    ("weld_defect", "cable_fault", False, "sparks from welding near an open cable trench"),
    # TRD substation work is off the running line — sharing it costs nothing,
    # even though TRD on the line needs an isolation by default.
    ("traction_transformer_fault", "signal_relay_fault", True, "both indoor, off the running line"),
    ("traction_transformer_fault", "interlocking_fault", True, "both indoor, off the running line"),
    ("traction_transformer_fault", "rail_wear", True, "substation work is off the running line"),
    ("traction_transformer_fault", "ballast_deficiency", True, "substation work is off the running line"),
]


def seed_work_types() -> None:
    types = list(WORK_TYPES)
    exceptions = {frozenset((a, b)): (c, n) for a, b, c, n in WORK_TYPE_EXCEPTIONS}
    with engine.begin() as conn:
        n = 0
        for i, a in enumerate(types):
            for b in types[i:]:
                da, db = WORK_TYPES[a], WORK_TYPES[b]
                default = PAIR_NOTES[frozenset({da, db})][0]
                compatible, notes = exceptions.get(frozenset((a, b)), (default, None if da == db else PAIR_NOTES[frozenset({da, db})][1]))
                x, y = sorted((a, b))
                conn.execute(
                    text(
                        """
                        INSERT INTO core.work_type_compatibility (type_a, type_b, compatible, notes, updated_by)
                        VALUES (:a, :b, :c, :n, 'seed')
                        ON CONFLICT (type_a, type_b) DO NOTHING
                        """
                    ),
                    {"a": x, "b": y, "c": compatible, "n": notes},
                )
                n += 1
    logger.info("seeded work-type compatibility matrix: %d cells (%d exceptions to department defaults)", n, len(WORK_TYPE_EXCEPTIONS))


if __name__ == "__main__":
    seed()
