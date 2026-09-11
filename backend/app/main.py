from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import auth, compatibility, corridors, ingestion, modifications, notifications, plans, requests

app = FastAPI(title="SANGAM API", version="1.0.0")


@app.on_event("startup")
def apply_schema() -> None:
    """db/schema.sql is all CREATE ... IF NOT EXISTS, so re-running it is a
    no-op on a current database and brings an older one (created before a
    table was added) up to date without a container rebuild."""
    from sqlalchemy import text

    from app.config import BACKEND_ROOT
    from app.db import engine

    sql = (BACKEND_ROOT / "db" / "schema.sql").read_text(encoding="utf-8")
    with engine.begin() as conn:
        conn.execute(text(sql))

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(corridors.router)
app.include_router(requests.router)
app.include_router(modifications.router)
app.include_router(notifications.router)
app.include_router(compatibility.router)
app.include_router(plans.router)
app.include_router(ingestion.router)


@app.get("/api/v1/health")
def health():
    return {"status": "ok"}
