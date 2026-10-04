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
    # Three tiers so we don't pay 70B-class latency + quota for work an 8B
    # model handles fine. `groq_model` was `llama-3.3-70b-versatile` until
    # Groq decommissioned it on 2026-08-16 (requests now 400); swapped to
    # their own recommended free replacement, GPT-OSS-120B.
    #
    # 2026-09-21: two more of Groq's own decommissions caught up with us,
    # confirmed by hitting the live `/v1/models` list and a real completion
    # call against each — not assumed from docs, which were themselves
    # stale/contradictory when checked. `llama-3.1-8b-instant` (the fast
    # tier — brief.py's home-screen line, plus documents.py) is gone
    # outright: "does not exist or you do not have access to it." Swapped
    # to GPT-OSS-20B, Groq's own current fastest model (1000 tok/s),
    # which is if anything a better fit for "short, low-stakes prompts"
    # than the model it replaces. `qwen/qwen3.6-27b` (the vision tier —
    # only used when a chat message carries a pasted image) is also gone,
    # replaced by its direct successor `qwen/qwen3.8-27b`. `groq_model`
    # itself (GPT-OSS-120B, RAG chat + quiz generation) was NOT affected —
    # verified live and still serving normally; a report of "chat is
    # broken" traced to the vision tier specifically, not general chat.
    groq_api_key: str = ""
    groq_model: str = "openai/gpt-oss-120b"        # RAG chat, quiz generation
    groq_model_fast: str = "openai/gpt-oss-20b"    # short, low-stakes prompts
    groq_model_vision: str = "qwen/qwen3.8-27b"    # only image-capable model here
    groq_base_url: str = "https://api.groq.com/openai/v1"
    # GPT-OSS models think before they answer, and the thinking counts against
    # the reply's token budget. At Groq's defaults (medium effort, a 3,072-token
    # reply) a quiz spent ~2,300 tokens thinking and was cut off mid-JSON —
    # unreadable, so the quiz failed. Low effort thinks in tens of tokens, the
    # reply fits, and a call costs ~3,800 tokens instead of ~5,300 of the free
    # tier's 8,000 a minute. Measured 2026-10-03; see services/llm.py.
    # Per-student limits on the text models. The free tier gives the whole app about
    # 3 answers a minute and 60-80 a day on the large model (eval/REPORT.md), so a
    # student's limits have to be sized against THAT, not against what feels generous:
    # one student with no daily cap could use everyone's allowance.
    #   burst / refill: how fast one student can ask (chat costs 1, a quiz or deck 2).
    #   daily: units of that same cost a student may spend in any rolling 24 hours.
    llm_burst: float = 6.0
    llm_refill_per_minute: float = 4.0
    llm_daily_quota: float = 30.0
    # The large model's daily token allowance, and how much of it is used before chat
    # starts going to the small model on purpose rather than failing mid-answer.
    groq_daily_token_limit: int = 200_000
    groq_switch_at: float = 0.9
    # A re-asked question is answered from the stored answer when everything it was
    # built from is unchanged (services/answer_cache.py). A switch, in case it ever misbehaves.
    answer_cache_enabled: bool = True
    groq_reasoning_effort: str = "low"
    groq_max_completion_tokens: int = 4096
    groq_timeout_s: float = 60.0
    # Resilience. Retries happen only BEFORE the first token reaches the
    # client — once a stream has started, retrying would duplicate text the
    # student has already read. See `services/llm.py`.
    groq_max_retries: int = 2
    # Past this, a 429's Retry-After is not worth waiting out: falling back to
    # the other text model answers sooner than sleeping on this one.
    groq_max_retry_after_s: float = 2.0
    # Consecutive failures before a model's circuit opens, and how long it
    # stays open. While open, requests skip straight to the fallback model
    # instead of each paying a full timeout against an upstream already known
    # to be down — on one worker, piled-up waits are what takes the app down.
    groq_breaker_threshold: int = 3
    groq_breaker_cooldown_s: float = 30.0

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
    # How many chunks `embed_texts` hands the provider per call.
    embedding_batch_size: int = 64
    # Sequences per ONNX forward pass. 1 is measured fastest AND smallest on
    # real chunks (no padding) — see LocalBgeEmbeddingProvider._embed_sync.
    embedding_infer_batch_size: int = 1
    # ONNX Runtime sizes its thread pool to the cores it can SEE. A
    # CPU-throttled container (Render free: 0.1 vCPU) sees the host's cores,
    # so the default spawns many threads that all contend for a sliver of one
    # — more context switching, slower inference. One thread is the right
    # number when there is barely one CPU to begin with. `None` = ORT default,
    # for machines where cores are real.
    embedding_threads: int | None = None
    # Where model weights live. Set at build time on Render so the model is
    # baked into the deployed image instead of re-downloaded on every cold
    # start (the container's disk does not survive a spin-down).
    embedding_cache_dir: str | None = None

    # Feature flags
    use_stub_embeddings: bool = True

    # Runtime
    cors_origins: str = "http://localhost:5173,http://localhost:4173"
    log_level: str = "info"
    # The lock on the admin page: a salted hash of the one shared password,
    # never the password itself. Make it with
    # `uv run python -m app.services.admin_gate`. Empty = the admin side is closed.
    admin_password_hash: str = ""

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
