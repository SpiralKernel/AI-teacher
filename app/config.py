from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")
    auth_required: bool = True
    database_path: Path = ROOT / "data/ai-teacher.sqlite3"
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-flash"
    deepseek_vision_model: str = "deepseek-flash"
    ai_timeout_seconds: float = Field(default=35, ge=1, le=120)
    vision_timeout_seconds: float = Field(default=90, ge=5, le=180)
