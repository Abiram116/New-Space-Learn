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

    # Embeddings.
    # Local, not hosted — see docs/decisions.md.
    # A hosted OpenAI-compatible provider was built and benchmarked, then
    # replaced: this is $0 marginal cost with no external API dependency,
    # measured to fit Render free tier's 512MB with real headroom. BGE-M3
    # was evaluated as a quality benchmark and rejected for production —
    # its own model weights alone (~2.2GB) exceed the entire RAM ceiling.
    # No API key, no base URL, no network dependency: the model runs
    # in-process, loaded once per worker on first use.
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    # How many chunks per inference call. The model can take a bigger batch,
    # but bounding it keeps peak memory predictable on a 512MB instance and
    # limits how much work is lost if a batch fails mid-document.
    embedding_batch_size: int = 64

    # Feature flags
    use_stub_embeddings: bool = True

    # Runtime
    cors_origins: str = "http://localhost:5173,http://localhost:4173"
    log_level: str = "info"
    # OpenAPI docs are a live map of every endpoint and payload shape. Useful
    # locally, needless attack-surface detail in production.
    expose_api_docs: bool = True

    # Embedding dimension must match the vector column in the DB migration.
    # 384 is BGE-small-en-v1.5's native output size AND the target of
    # supabase/migrations/20260810090000_embedding_dim_384.sql.
    #
    # THAT MIGRATION MUST BE APPLIED BEFORE FLIPPING USE_STUB_EMBEDDINGS TO
    # FALSE. The column is still vector(1536) until you run it by hand in
    # the Supabase SQL editor (this repo's standing convention — nothing
    # applies migrations automatically). Flipping the flag first doesn't
    # corrupt anything: the dimension check below still passes (384==384),
    # but Postgres then rejects the insert outright — a loud failure on that
    # upload, not silent corruption, since pgvector enforces exact column
    # width. Still: apply the migration first.
    embedding_dim: int = 384

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)

    @property
    def llm_configured(self) -> bool:
        return bool(self.groq_api_key)

    @property
    def real_embeddings_enabled(self) -> bool:
        """Just the flag, now. A hosted provider needed a second condition
        here (a key might be missing) — a local model has no key to be
        missing. If loading it ever fails (corrupt cache, blocked network on
        first download), that surfaces as a loud failure on the one upload
        that triggered it, not a silent fallback — see
        `LocalBgeEmbeddingProvider` in `services/embeddings.py`."""
        return not self.use_stub_embeddings


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


# Convenience alias so we don't call get_settings() everywhere.
settings = get_settings()

# Prevent accidental use of Field to satisfy the linter about unused imports.
_ = Field
