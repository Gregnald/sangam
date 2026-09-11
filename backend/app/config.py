from pathlib import Path
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
DATA_DIR = BACKEND_ROOT / "data"
MODELS_DIR = BACKEND_ROOT / "models"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "postgresql+psycopg://sangam:sangam@localhost:5433/sangam"

    jwt_secret: str = "sangam-dev-secret-change-me"
    jwt_expiry_hours: int = 12

    api_host: str = "127.0.0.1"
    api_port: int = 8000

    preemption_margin: float = 15.0


@lru_cache
def get_settings() -> Settings:
    return Settings()


for d in (DATA_DIR, DATA_DIR / "raw", DATA_DIR / "processed", MODELS_DIR):
    d.mkdir(parents=True, exist_ok=True)
