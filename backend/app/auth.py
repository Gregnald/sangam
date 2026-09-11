from __future__ import annotations

import datetime as dt

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Header
from pydantic import BaseModel

from app.config import get_settings

ROLES = ("ENGG", "SIGNAL", "TRD", "CONTROLLER")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def create_token(user_id: str, username: str, role: str, display_name: str) -> str:
    settings = get_settings()
    payload = {
        "sub": user_id,
        "username": username,
        "role": role,
        "display_name": display_name,
        "exp": dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=settings.jwt_expiry_hours),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


class CurrentUser(BaseModel):
    user_id: str
    username: str
    role: str
    display_name: str


def get_current_user(authorization: str | None = Header(default=None)) -> CurrentUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "missing or malformed Authorization header")
    token = authorization.split(" ", 1)[1]
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "token expired") from None
    except jwt.InvalidTokenError:
        raise HTTPException(401, "invalid token") from None
    return CurrentUser(
        user_id=payload["sub"], username=payload["username"], role=payload["role"], display_name=payload["display_name"]
    )


def require_role(*roles: str):
    def dependency(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in roles:
            raise HTTPException(403, f"role {user.role} is not permitted to perform this action")
        return user

    return dependency
