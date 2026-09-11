from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import CurrentUser, create_token, get_current_user, verify_password
from app.db import get_db
from app.schemas import LoginRequest, LoginResponse

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    row = db.execute(text("SELECT * FROM core.users WHERE username = :u"), {"u": body.username}).mappings().first()
    if not row or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(401, "invalid username or password")

    token = create_token(str(row["user_id"]), row["username"], row["role"], row["display_name"])
    return LoginResponse(token=token, username=row["username"], role=row["role"], display_name=row["display_name"])


@router.get("/me", response_model=LoginResponse)
def me(user: CurrentUser = Depends(get_current_user)):
    return LoginResponse(token="", username=user.username, role=user.role, display_name=user.display_name)
