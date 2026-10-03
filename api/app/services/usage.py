"""What every model call costs, by task.

Groq reports a call's token use in the last chunk of its stream; this module
keeps it, so a change meant to save tokens can be shown to have saved them.
Each call is tagged with the task it serves (`with usage.task("quiz.verify")`
around the call) — a context variable, so no model interface or test double
has to grow a parameter for it.

What is kept, in process memory (one worker; a restart starts the count again,
which is fine for a measuring tool):

- per (task, model): calls, prompt / reply / reasoning / cached tokens, the
  largest prompt seen;
- per model, today (UTC): total tokens, against the free tier's daily limit —
  Groq says how many tokens a minute are left in a header, but the daily limit
  only shows up as a refusal;
- per model: the last rate-limit headers, and how many calls were refused, for
  a minute's limit or a day's.

Each call is also logged on one line, so the numbers survive in the host's logs.
"""

from __future__ import annotations

import contextlib
import contextvars
import functools
import logging
import time
from collections.abc import Awaitable, Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any, ParamSpec, TypeVar

log = logging.getLogger("space_learn.usage")

P = ParamSpec("P")
R = TypeVar("R")

_task: contextvars.ContextVar[str] = contextvars.ContextVar("llm_task", default="other")

#: Rate-limit headers worth keeping (minus the `x-ratelimit-` prefix).
_HEADERS = (
    "remaining-tokens",
    "limit-tokens",
    "remaining-requests",
    "limit-requests",
    "reset-tokens",
)


@contextmanager
def task(name: str) -> Iterator[None]:
    """Tag the model calls made inside this block as serving `name`."""
    token = _task.set(name)
    try:
        yield
    finally:
        # A streaming response can be closed from outside its own context (the
        # student left mid-answer); the tag only needs to outlive the call.
        with contextlib.suppress(ValueError):
            _task.reset(token)


def tagged(name: str) -> Callable[[Callable[P, Awaitable[R]]], Callable[P, Awaitable[R]]]:
    """`task(name)` for the whole of an async function."""

    def wrap(fn: Callable[P, Awaitable[R]]) -> Callable[P, Awaitable[R]]:
        @functools.wraps(fn)
        async def inner(*args: P.args, **kwargs: P.kwargs) -> R:
            with task(name):
                return await fn(*args, **kwargs)

        return inner

    return wrap


def current_task() -> str:
    return _task.get()


@dataclass(slots=True)
class _Tally:
    calls: int = 0
    prompt: int = 0
    reply: int = 0
    reasoning: int = 0
    cached: int = 0
    largest_prompt: int = 0
    seconds: float = 0.0


@dataclass(slots=True)
class _Model:
    day: str = ""
    tokens_today: int = 0
    calls_today: int = 0
    refused_minute: int = 0
    refused_day: int = 0
    limits: dict[str, str] = field(default_factory=dict)
    limits_at: float | None = None


_tallies: dict[tuple[str, str], _Tally] = {}
_models: dict[str, _Model] = {}
_started = time.time()


def _today() -> str:
    return datetime.now(UTC).date().isoformat()


def _model(name: str) -> _Model:
    m = _models.setdefault(name, _Model())
    if m.day != _today():
        m.day, m.tokens_today, m.calls_today, m.refused_minute, m.refused_day = _today(), 0, 0, 0, 0
    return m


def _int(value: Any) -> int:
    return value if isinstance(value, int) and value > 0 else 0


def record(
    model: str, report: Mapping[str, Any], *, task_name: str | None = None, seconds: float = 0.0
) -> None:
    """One finished call: Groq's `usage` object for it. `task_name` is the task
    as it stood when the call began (default: as it stands now)."""
    name = task_name or current_task()
    prompt = _int(report.get("prompt_tokens"))
    reply = _int(report.get("completion_tokens"))
    reasoning = _int((report.get("completion_tokens_details") or {}).get("reasoning_tokens"))
    cached = _int((report.get("prompt_tokens_details") or {}).get("cached_tokens"))

    t = _tallies.setdefault((name, model), _Tally())
    t.calls += 1
    t.prompt += prompt
    t.reply += reply
    t.reasoning += reasoning
    t.cached += cached
    t.largest_prompt = max(t.largest_prompt, prompt)
    t.seconds += seconds

    m = _model(model)
    m.tokens_today += prompt + reply
    m.calls_today += 1
    log.info(
        "llm usage task=%s model=%s prompt=%d cached=%d reply=%d reasoning=%d seconds=%.2f",
        name,
        model,
        prompt,
        cached,
        reply,
        reasoning,
        seconds,
    )


def limits(model: str, headers: Mapping[str, str]) -> None:
    """The rate-limit headers from a response, kept as the latest word on them."""
    kept = {k: headers[f"x-ratelimit-{k}"] for k in _HEADERS if f"x-ratelimit-{k}" in headers}
    if kept:
        m = _model(model)
        m.limits = kept
        m.limits_at = time.time()


def refused(model: str, body: bytes) -> None:
    """A 429. Groq names the limit in the message: per day (TPD/RPD) or per minute."""
    m = _model(model)
    text = body[:400].decode("utf-8", "replace")
    if "per day" in text or "(TPD)" in text or "(RPD)" in text:
        m.refused_day += 1
    else:
        m.refused_minute += 1


def snapshot() -> dict[str, Any]:
    """Everything kept, for the admin page. Tasks sorted by tokens spent."""
    tasks = [
        {"task": name, "model": model, **asdict(t)}
        for (name, model), t in sorted(
            _tallies.items(), key=lambda kv: -(kv[1].prompt + kv[1].reply)
        )
    ]
    models = []
    for name, m in sorted(_models.items()):
        _model(name)  # roll the day over if it has turned
        models.append({"model": name, **asdict(m)})
    return {"since": _started, "tasks": tasks, "models": models}


def reset() -> None:
    """Test hook."""
    global _started
    _tallies.clear()
    _models.clear()
    _started = time.time()
