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


if __name__ == "__main__":
    seed()
