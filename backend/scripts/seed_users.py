from __future__ import annotations

import logging

from sqlalchemy import text

from app.auth import hash_password
from app.db import engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("sangam.scripts.seed_users")

ACCOUNTS = [
    {"username": "engg_dept", "password": "Engg@2026", "role": "ENGG", "display_name": "Engineering (P.Way)"},
    {"username": "trd_dept", "password": "Trd@2026", "role": "TRD", "display_name": "Traction Distribution"},
    {"username": "snt_dept", "password": "Snt@2026", "role": "SIGNAL", "display_name": "Signal & Telecommunication"},
    {"username": "controller", "password": "Controller@2026", "role": "CONTROLLER", "display_name": "Section Controller"},
]


def seed() -> None:
    with engine.begin() as conn:
        for acc in ACCOUNTS:
            conn.execute(
                text(
                    """
                    INSERT INTO core.users (username, password_hash, role, display_name)
                    VALUES (:username, :password_hash, :role, :display_name)
                    ON CONFLICT (username) DO UPDATE SET
                        password_hash = EXCLUDED.password_hash,
                        role = EXCLUDED.role,
                        display_name = EXCLUDED.display_name
                    """
                ),
                {
                    "username": acc["username"],
                    "password_hash": hash_password(acc["password"]),
                    "role": acc["role"],
                    "display_name": acc["display_name"],
                },
            )
    logger.info("seeded %d accounts", len(ACCOUNTS))
    for acc in ACCOUNTS:
        logger.info("  %-12s / %-16s (%s)", acc["username"], acc["password"], acc["role"])


if __name__ == "__main__":
    seed()
