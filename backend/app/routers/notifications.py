from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user
from app.db import get_db
from app.schemas import Notification

router = APIRouter(prefix="/api/v1/notifications", tags=["notifications"])


@router.get("", response_model=list[Notification])
def list_notifications(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.execute(
        text("SELECT * FROM plan.notifications WHERE recipient_role = :role ORDER BY created_at DESC LIMIT 200"),
        {"role": user.role},
    ).mappings().all()
    return [Notification.model_validate(dict(r)) for r in rows]


@router.post("/{notification_id}/read")
def mark_read(notification_id: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    db.execute(
        text("UPDATE plan.notifications SET is_read = TRUE WHERE notification_id = :id AND recipient_role = :role"),
        {"id": notification_id, "role": user.role},
    )
    db.commit()
    return {"ok": True}


@router.post("/read-all")
def mark_all_read(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    db.execute(text("UPDATE plan.notifications SET is_read = TRUE WHERE recipient_role = :role"), {"role": user.role})
    db.commit()
    return {"ok": True}
