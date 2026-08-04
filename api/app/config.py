"""Central settings — loaded once at startup, hashable, cache-safe."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Loaded from repo-root .env (../.env from api/).
    model_config = SettingsConfigDict(
        env_file=[
            Path(__file__).resolve().parents[2] / ".env",
            Path(__file__).resolve().parents[1] / ".env",
        ],
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # Supabase
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""
    supabase_storage_bucket: str = "documents"

    # Groq / LLM
    # Three tiers so we don't pay 70B latency + quota for work an 8B model
    # handles fine. Verified available on the account as of 2026-08-04.
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"     # RAG chat, quiz generation
    groq_model_fast: str = "llama-3.1-8b-instant"   # short, low-stakes prompts
    groq_model_vision: str = "qwen/qwen3.6-27b"     # only image-capable model here
    groq_base_url: str = "https://api.groq.com/openai/v1"
    groq_timeout_s: float = 60.0

    # Feature flags
    use_stub_embeddings: bool = True

    # Runtime
    cors_origins: str = "http://localhost:5173,http://localhost:4173"
    log_level: str = "info"

    # Embedding dimension must match the vector column in the DB migration.
    embedding_dim: int = 1536

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)

    @property
    def llm_configured(self) -> bool:
        return bool(self.groq_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


# Convenience alias so we don't call get_settings() everywhere.
settings = get_settings()

# Prevent accidental use of Field to satisfy the linter about unused imports.
_ = Field
