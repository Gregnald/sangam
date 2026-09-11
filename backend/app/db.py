from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

from app.config import get_settings

settings = get_settings()

# Every "which day is this?" decision in the system — window calendars built
# at IST midnight, `allocated_start::date` range filters, week/month horizon
# boundaries, the Gantt's day rows — is an Indian Railways operational day.
# The Postgres container defaults to UTC, under which a block starting at
# 00:00 IST casts to the *previous* date and silently drops out of every
# day-bounded query. Pinning the session timezone makes ::date casts and
# returned timestamps agree with the calendar the rest of the code assumes.
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    future=True,
    connect_args={"options": "-c timezone=Asia/Kolkata"},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
