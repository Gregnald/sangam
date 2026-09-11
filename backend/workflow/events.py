"""Append-only trail of what happened to each block request."""
from __future__ import annotations

from sqlalchemy import text


def log_event(
    conn,
    defect_id: str,
    event_type: str,
    from_status: str | None = None,
    to_status: str | None = None,
    actor: str | None = None,
    details: str | None = None,
) -> None:
    conn.execute(
        text(
            """
            INSERT INTO core.defect_events (defect_id, event_type, from_status, to_status, actor, details)
            VALUES (:id, :type, :from_status, :to_status, :actor, :details)
            """
        ),
        {"id": str(defect_id), "type": event_type, "from_status": from_status, "to_status": to_status, "actor": actor, "details": details},
    )


def log_events(conn, defect_ids, event_type: str, from_status: str | None, to_status: str | None, actor: str | None = None, details: str | None = None) -> None:
    ids = [str(d) for d in defect_ids]
    if not ids:
        return
    conn.execute(
        text(
            """
            INSERT INTO core.defect_events (defect_id, event_type, from_status, to_status, actor, details)
            SELECT unnest(CAST(:ids AS uuid[])), :type, :from_status, :to_status, :actor, :details
            """
        ),
        {"ids": ids, "type": event_type, "from_status": from_status, "to_status": to_status, "actor": actor, "details": details},
    )
