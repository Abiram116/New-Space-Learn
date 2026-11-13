"""LLM interface + Groq implementation + graceful stub when no key is set.

The Chat streaming route treats every LLM as an `AsyncIterator[str]`. That
keeps SSE happy and lets us swap Groq for OpenAI, Anthropic, or a local model
by writing one class — no route changes required.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import re
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, Literal, Protocol

import httpx

from ..config import settings
from ..errors import ApiError, NotConfigured, RateLimited, UpstreamUnavailable
from . import usage
from .context_budget import estimate_tokens

log = logging.getLogger("space_learn.llm")


#: {"role": "system"|"user"|"assistant", "content": str | list[dict]}
#:
#: `content` is a plain string for text turns and an OpenAI-style content array
#: when images are attached. Typed `Any` rather than a union because every
#: call site builds one shape or the other and none inspects it — a union here
#: would buy a cast at each of them for no checking that matters.
ChatMessage = dict[str, Any]


# ── Routing: which model each task uses, and how far it may fall ────────
#
# The free tier gives each model about 8,000 tokens a minute and 200,000 a day,
# shared by every student. So the question for each task is not "which model is
# best" but "which is the cheapest that is good enough, and what happens when its
# allowance runs out". The answers live here, in one table, so they can be read,
# tested (tests/test_routing.py) and reported (eval/routing.py) in one place.
#
# The call sites still name their model (`model=settings.groq_model_fast`); the
# table adds what a call site cannot know on its own: how long a reply may be,
# whether a failure may move to the other model, and what to do when a model's
# day is nearly spent. The task is read from `usage.task(...)`, which every call
# site already sets, so no interface grows a parameter.

Tier = Literal["large", "fast", "vision"]


@dataclass(frozen=True, slots=True)
class Route:
    tier: Tier
    #: `max_completion_tokens` for the call (thinking included), never above
    #: `settings.groq_max_completion_tokens`.
    max_tokens: int
    #: A planning figure for a typical reply, in tokens: used to judge whether a
    #: call still fits this minute's allowance, and by the capacity estimates in
    #: `eval/routing.py`. Not a measurement; `services/usage.py` has the real ones.
    reply_tokens: int
    #: Whether a failure may be answered by the other text model.
    fallback: bool = True
    #: Chat: switch to the small model *before* trying, once the large model's day
    #: is `groq_switch_at` spent, so the last of it is left for quizzes, decks and
    #: notes, which the small model does worse.
    degrade_early: bool = False
    #: A nicety with its own model-free fallback (headings for starters, a plain
    #: line for the brief, no summary this turn). Skipped without a call once its
    #: model's day is `groq_shed_at` spent, and never moved up to the large model.
    optional: bool = False
    why: str = ""


#: task name (as given to `usage.task`) → its route.
ROUTES: dict[str, Route] = {
    "chat": Route("large", 4096, 800, degrade_early=True,
                  why="the answer students read; the small model makes about twice the unsupported claims (eval route_check C)"),
    "chat.smalltalk": Route("fast", 1024, 150,
                            why="one friendly sentence; nothing to ground"),
    "chat.resolve": Route("fast", 512, 80,
                          why="rewrites a follow-up into one standalone question (at most 240 characters)"),
    "chat.starters": Route("fast", 768, 200, fallback=False, optional=True,
                           why="four short questions; headings make them without a model"),
    "chat.memory": Route("fast", 768, 250, fallback=False, optional=True,
                         why="a 120-word summary, in the background; retried on the next turn"),
    "brief": Route("fast", 768, 200, fallback=False, optional=True,
                   why="a home-screen line; the page renders without it"),
    "quiz.write": Route("large", 4096, 3000,
                        why="up to 15 questions with distractors and explanations (~235 tokens each)"),
    "quiz.repair": Route("large", 4096, 1200,
                         why="the questions verification dropped, rewritten"),
    "quiz.verify": Route("fast", 1536, 400,
                         why="one JSON verdict per question; a wrong 'supported' only drops a question"),
    "quiz.reword": Route("fast", 3072, 1500, fallback=False, optional=True,
                         why="a retake's questions reworded as JSON; without it the retake is reshuffled instead"),
    "cards.write": Route("large", 4096, 2500,
                         why="up to 22 cards; backs may be long"),
    "notes.write": Route("large", 4096, 2000,
                         why="a whole study note from the sources"),
    "notes.edit": Route("fast", 4096, 600,
                        why="shorten, fix or continue a passage the student wrote"),
    "ocr.page": Route("vision", 4096, 1500, fallback=False,
                      why="a scanned page, transcribed; only the vision model can see it"),
    "image.read": Route("vision", 4096, 800, fallback=False,
                        why="an uploaded image, read; only the vision model can see it"),
}

#: Anything untagged (or a task added without a route): the old behaviour.
DEFAULT_ROUTE = Route("large", 4096, 800, why="untagged call: settings' defaults")


def route_for(task: str | None) -> Route:
    return ROUTES.get(task or "", DEFAULT_ROUTE)


def tier_model(tier: Tier) -> str:
    return {
        "large": settings.groq_model,
        "fast": settings.groq_model_fast,
        "vision": settings.groq_model_vision,
    }[tier]


def tier_of(model: str) -> Tier | None:
    for tier in ("large", "fast", "vision"):
        if tier_model(tier) == model:  # type: ignore[arg-type]
            return tier  # type: ignore[return-value]
    return None


def day_nearly_spent(model: str, fraction: float | None = None) -> bool:
    """Has `model` used `fraction` (default `groq_switch_at`) of today's tokens, by our count?"""
    return usage.near_daily_limit(
        model,
        settings.groq_daily_token_limit,
        settings.groq_switch_at if fraction is None else fraction,
    )


def model_for(task: str, *, images: bool = False) -> str:
    """The model to ask for `task` now. The one decision the chat route needs:

        model_for_turn = llm.model_for("chat.smalltalk" if small_talk else "chat", images=bool(images))

    An image always goes to the vision model. A task whose route says
    `degrade_early` goes to the small model once the large one's day is nearly
    spent, and says so in the log: a quieter answer, on purpose, rather than a
    refused one later.
    """
    if images:
        return settings.groq_model_vision
    r = route_for(task)
    model = tier_model(r.tier)
    if r.degrade_early and r.tier == "large" and day_nearly_spent(model):
        small = settings.groq_model_fast
        log.warning(
            "routing task=%s to %s instead of %s: the large model has used %.0f%% of its day",
            task, small, model, settings.groq_switch_at * 100,
        )
        usage.rerouted(task, model, small, "day-nearly-spent")
        return small
    return model


class LLM(Protocol):
    async def stream_chat(
        self,
        messages: list[ChatMessage],
        *,
        model: str | None = None,
        temperature: float = 0.4,
        json_object: bool = False,
    ) -> AsyncIterator[str]: ...


#: Worth retrying on the SAME model — the request was fine, the moment wasn't.
#: 498 is Groq's own "flex tier over capacity".
_RETRYABLE_STATUS = frozenset({408, 429, 498, 500, 502, 503, 504})

#: Groq's error codes for "this model id is gone or was never here". The
#: 2026-08-16 and 2026-09-21 decommissions both surfaced as exactly this, and
#: each one took the whole feature down because nothing fell back.
_MODEL_GONE_CODES = frozenset({"model_decommissioned", "model_not_found"})


class _Retryable(Exception):
    """A transient failure. `error` is what the student sees if every attempt
    and every fallback fails the same way."""

    def __init__(
        self, error: ApiError, retry_after: float | None = None, *, same_model: bool = True, reason: str = "unavailable"
    ) -> None:
        super().__init__(error.message)
        self.error = error
        self.retry_after = retry_after
        #: Whether asking the same model again could help. Not after a timeout
        #: (another full wait, likely the same), nor after a refusal with no
        #: short Retry-After (the minute or the day is spent).
        self.same_model = same_model
        #: For the log, when another model ends up answering.
        self.reason = reason


class _ModelGone(Exception):
    """This model id is unusable. Retrying it is pointless; the next model in
    the chain is the only move."""


@dataclass(slots=True)
class _Breaker:
    """A per-model circuit breaker.

    Closed: calls go through. After `threshold` consecutive failures it OPENS:
    for `cooldown` seconds the model is skipped outright, straight to the
    fallback, rather than every request separately waiting out a timeout
    against an upstream already known to be down. After the cooldown one
    request is let through as a probe — success closes it, failure re-opens it.
    """

    failures: int = 0
    opened_at: float | None = None

    def allows(self, now: float, cooldown: float) -> bool:
        return self.opened_at is None or now - self.opened_at >= cooldown

    def succeed(self) -> None:
        self.failures = 0
        self.opened_at = None

    def fail(self, now: float, threshold: int) -> None:
        self.failures += 1
        if self.failures >= threshold:
            self.opened_at = now

    def trip(self, now: float) -> None:
        """Open immediately — for a model that's gone, not merely flaky."""
        self.failures = max(self.failures, 1)
        self.opened_at = now


def _has_images(messages: list[ChatMessage]) -> bool:
    return any(isinstance(m.get("content"), list) for m in messages)


def _backoff(attempt: int, retry_after: float | None) -> float:
    """Full-jitter exponential backoff, or the server's own Retry-After.

    Jitter matters even on one worker: without it, every request that failed
    in the same blip retries in the same instant and trips the same limit.
    """
    if retry_after is not None:
        return retry_after + random.uniform(0, 0.25)
    return random.uniform(0, min(4.0, 0.4 * (2**attempt)))


def _parse_retry_after(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        return None


_WAIT = re.compile(r"try again in\s+(?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?(?:([\d.]+)ms)?", re.IGNORECASE)


def _wait_in_message(body: bytes) -> float | None:
    """Groq's refusal text says how long to wait ("Please try again in 7m12.5s").
    Used when the Retry-After header is missing."""
    m = _WAIT.search(body[:600].decode("utf-8", "replace"))
    if not m or not any(m.groups()):
        return None
    h, mins, secs, ms = m.groups()
    return int(h or 0) * 3600 + int(mins or 0) * 60 + float(secs or 0) + float(ms or 0) / 1000


def _error_code(body: bytes) -> str | None:
    try:
        return json.loads(body).get("error", {}).get("code")
    except (ValueError, AttributeError):
        return None


class GroqLLM:
    """OpenAI-compatible client pointed at Groq, with retry, fallback, and a
    circuit breaker.

    **The one rule everything below follows: never retry after the first
    token.** Once text has reached the student, a retry would restart the
    answer and duplicate what they already read. So every retry and every
    fallback happens in the window before the first `yield`; a failure after
    it is surfaced as a clean "stopped mid-answer" error instead.

    Fallback order: the requested model, then the other text model. Vision
    requests never fall back — the text models can't see the image, and a
    confident answer that ignored the attachment is worse than an honest error.
    The task's route (`ROUTES`) can narrow that further: no fallback for work
    with a model-free answer, and no move up to the large model for cheap work
    while the large model's day is nearly spent. A model known to be out (open
    circuit, a refusal with a long wait, this minute's tokens gone) is skipped
    before it is asked, except the last in line; every answer from a model other
    than the one asked for is logged and counted (`_log_fallback`).
    """

    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None
        self._breakers: dict[str, _Breaker] = {}
        #: model → monotonic time before which a refusal (429) said not to come
        #: back. Every request in that window would be refused the same way, so
        #: it goes straight to the fallback instead of each spending a round trip.
        self._cooling: dict[str, float] = {}

    async def _get(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=settings.groq_base_url.rstrip("/"),
                headers={
                    "Authorization": f"Bearer {settings.groq_api_key}",
                    "Content-Type": "application/json",
                },
                timeout=httpx.Timeout(settings.groq_timeout_s, connect=5.0),
            )
        return self._client

    def _chain(self, model: str | None, messages: list[ChatMessage]) -> list[str]:
        """The models to try, in order. Never the vision model's fallback (the text
        models can't see the image); never a fallback for a route that says so;
        and a cheap task never moves up to the large model once the large model's
        day is nearly spent: its last tokens are for the work only it does well."""
        primary = model or settings.groq_model
        if _has_images(messages):
            return [primary]
        route = route_for(usage.current_task())
        if not route.fallback:
            return [primary]
        text_models = [settings.groq_model, settings.groq_model_fast]
        chain = [primary, *[m for m in text_models if m != primary]]
        if primary != settings.groq_model and settings.groq_model in chain[1:] and (
            route.optional or day_nearly_spent(settings.groq_model)
        ):
            chain.remove(settings.groq_model)
        return chain

    def _breaker(self, model: str) -> _Breaker:
        return self._breakers.setdefault(model, _Breaker())

    async def stream_chat(
        self,
        messages: list[ChatMessage],
        *,
        model: str | None = None,
        temperature: float = 0.4,
        json_object: bool = False,
    ) -> AsyncIterator[str]:
        """`json_object=True` makes the provider guarantee the reply is one
        JSON object. Asked politely instead, the small model answered a
        verification request with `[]` on some material — measured — so
        anything a program reads back should ask this way."""
        # Read now: by the time the reply ends, the caller may be elsewhere.
        task_name = usage.current_task()
        route = route_for(task_name)
        primary = model or settings.groq_model
        images = _has_images(messages)
        if route.optional and not images and day_nearly_spent(primary, settings.groq_shed_at):
            # Its caller has a model-free answer; the day's last tokens are for answers.
            log.warning("skipping optional task=%s: %s has used most of its day", task_name, primary)
            usage.rerouted(task_name, primary, None, "shed")
            raise RateLimited("Skipped to save today's AI allowance for answers.")

        chain = self._chain(model, messages)
        last_error: ApiError = UpstreamUnavailable("The AI service is unavailable.")
        # One budget of requests for the whole call, across every model: a
        # failing upstream gets a few tries in total, never retries × models.
        attempts_left = max(1, settings.groq_max_attempts)
        need = estimate_tokens(messages) + route.reply_tokens
        why_moved = ""

        for position, candidate in enumerate(chain):
            breaker = self._breaker(candidate)
            is_last = position == len(chain) - 1
            later = len(chain) - position - 1
            if attempts_left <= 0:
                break
            # The last model is always tried, whatever we believe about it:
            # failing a request without making a single attempt helps nobody.
            if not is_last:
                now = time.monotonic()
                skip = ""
                if not breaker.allows(now, settings.groq_breaker_cooldown_s):
                    skip = "circuit-open"
                elif self._cooling.get(candidate, 0.0) > now:
                    skip = "refused-recently"
                elif usage.minute_wait_s(candidate, need) > settings.groq_max_retry_after_s:
                    skip = "minute-spent"
                if skip:
                    log.info("groq %s skipped for task=%s (%s); trying the fallback", candidate, task_name, skip)
                    why_moved = why_moved or skip
                    continue

            for attempt in range(settings.groq_max_retries + 1):
                started = False
                attempts_left -= 1
                try:
                    async for delta in self._stream_once(candidate, messages, temperature, json_object, task_name):
                        started = True
                        yield delta
                    breaker.succeed()
                    self._cooling.pop(candidate, None)
                    if candidate != primary:
                        _log_fallback(task_name, primary, candidate, why_moved or "failed")
                    return
                except _ModelGone:
                    breaker.trip(time.monotonic())
                    log.warning("groq model %s is gone; falling back", candidate)
                    why_moved = why_moved or "model-gone"
                    break
                except _Retryable as e:
                    if started:
                        raise UpstreamUnavailable(
                            "The AI stopped partway through. Try again."
                        ) from e
                    now = time.monotonic()
                    breaker.fail(now, settings.groq_breaker_threshold)
                    last_error = e.error
                    why_moved = why_moved or e.reason
                    waits_too_long = (
                        e.retry_after is not None
                        and e.retry_after > settings.groq_max_retry_after_s
                    )
                    if waits_too_long:
                        self._cooling[candidate] = now + float(e.retry_after or 0.0)
                    if (
                        not e.same_model
                        or waits_too_long
                        or attempt >= settings.groq_max_retries
                        # Keep one request for each model still to try.
                        or attempts_left <= later
                    ):
                        break
                    delay = _backoff(attempt, e.retry_after)
                    log.info(
                        "groq %s transient failure (%s); retry %d in %.2fs",
                        candidate, e.error.code, attempt + 1, delay,
                    )
                    await asyncio.sleep(delay)

        raise last_error

    async def _stream_once(
        self,
        model: str,
        messages: list[ChatMessage],
        temperature: float,
        json_object: bool = False,
        task_name: str | None = None,
    ) -> AsyncIterator[str]:
        client = await self._get()
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "stream": True,
            **_reply_budget(model, task_name),
        }
        if json_object:
            payload["response_format"] = {"type": "json_object"}
        began = time.monotonic()
        try:
            async with client.stream("POST", "/chat/completions", json=payload) as r:
                usage.limits(model, r.headers)
                if r.status_code >= 400:
                    body = await r.aread()
                    if r.status_code == 429:
                        usage.refused(model, body)
                        usage.refused_task(task_name or usage.current_task(), model)
                    # Log the provider's text; never surface it — it can carry
                    # account and quota details the user shouldn't see.
                    log.warning("groq %s on %s: %s", r.status_code, model, body[:300])
                    raise _classify(r.status_code, body, r.headers.get("retry-after"))
                async for line in r.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        return
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    # The last chunk carries what the whole call used.
                    report = (chunk.get("x_groq") or {}).get("usage") or chunk.get("usage")
                    if isinstance(report, dict):
                        usage.record(model, report, task_name=task_name, seconds=time.monotonic() - began)
                    delta = (
                        chunk.get("choices", [{}])[0]
                        .get("delta", {})
                        .get("content")
                    )
                    if delta:
                        yield delta
        except httpx.TimeoutException as e:
            # Not retried on the same model: the student has already waited the
            # whole timeout once, and an overloaded model is likely to do it again.
            raise _Retryable(
                UpstreamUnavailable("The AI took too long to respond. Try again."),
                same_model=False,
                reason="timeout",
            ) from e
        except httpx.HTTPError as e:
            raise _Retryable(UpstreamUnavailable("The AI service didn't respond."), reason="network") from e


def _log_fallback(task: str, wanted: str, used: str, why: str) -> None:
    """Every answer from a model other than the one asked for is logged and counted.
    Moving down from the large model is a quality loss, so it is a warning."""
    worse = tier_of(wanted) == "large" and tier_of(used) != "large"
    log.log(
        logging.WARNING if worse else logging.INFO,
        "llm task=%s answered by %s instead of %s (%s)%s",
        task, used, wanted, why, " - a smaller model than this task is routed to" if worse else "",
    )
    usage.rerouted(task, wanted, used, why)


def _reply_budget(model: str, task: str | None = None) -> dict[str, Any]:
    """How long a reply may be and, for a reasoning model, how hard it thinks.

    Without this a GPT-OSS model thinks at medium effort inside Groq's default
    reply budget, and a long reply (a quiz, a deck) is cut off once the
    thinking has used most of it. Only GPT-OSS takes `reasoning_effort` and
    `include_reasoning`; other models get the length cap alone.

    The cap is the task's own (`ROUTES`), never above the setting: a rewrite of
    one question does not need room for a quiz."""
    cap = settings.groq_max_completion_tokens
    if task in ROUTES:
        cap = min(cap, ROUTES[task].max_tokens)
    budget: dict[str, Any] = {"max_completion_tokens": cap}
    if "gpt-oss" in model:
        budget["reasoning_effort"] = settings.groq_reasoning_effort
        # The thinking is not shown to anyone; don't stream it.
        budget["include_reasoning"] = False
    return budget


def _classify(status: int, body: bytes, retry_after: str | None) -> Exception:
    """Sort a provider failure into: retry this model, try the next model, or
    stop — and pick the message the student sees if it comes to that.

    429 matters most for the message: 'at capacity, wait' is a different
    instruction than 'the service is down', and the UI toasts them differently.
    """
    code = _error_code(body)
    if status == 404 or code in _MODEL_GONE_CODES:
        return _ModelGone()
    if status == 429:
        wait = _parse_retry_after(retry_after)
        if wait is None:
            wait = _wait_in_message(body)
        return _Retryable(
            RateLimited("The AI is at capacity right now. Try again in a moment."),
            wait,
            # Only a short, stated wait is worth spending on the same model.
            same_model=wait is not None,
            reason="rate-limited",
        )
    if status == 413:
        # One request bigger than a minute's allowance. The other model has the
        # same limit, so falling back cannot help; say what can.
        return UpstreamUnavailable("That was too much for the AI to read at once. Try a shorter message.")
    if status in _RETRYABLE_STATUS:
        return _Retryable(UpstreamUnavailable("The AI service is unavailable."))
    if status in (401, 403):
        # Our key is bad — the user can't fix this, so don't imply they can.
        return NotConfigured("The AI provider rejected our credentials.")
    return UpstreamUnavailable("The AI couldn't handle that request.")


class StubLLM:
    """Streams a canned reply so the UI is exercisable without a real key."""

    async def stream_chat(
        self,
        messages: list[ChatMessage],
        *,
        model: str | None = None,
        temperature: float = 0.4,
        json_object: bool = False,
    ) -> AsyncIterator[str]:
        _ = messages, model, temperature, json_object
        text = (
            "This is a placeholder reply — the AI provider isn't configured yet.\n\n"
            "Add `GROQ_API_KEY` to your `.env`, restart the backend, and this "
            "message will be replaced with a real answer that cites your uploaded "
            "documents."
        )
        for word in text.split(" "):
            await asyncio.sleep(0.02)
            yield word + " "


# Module-level singleton — one instance per process.
_llm: LLM | None = None


def get_llm() -> LLM:
    global _llm
    if _llm is None:
        _llm = GroqLLM() if settings.llm_configured else StubLLM()
    return _llm


async def close_llm() -> None:
    global _llm
    if isinstance(_llm, GroqLLM) and _llm._client is not None:  # noqa: SLF001
        await _llm._client.aclose()  # noqa: SLF001
    _llm = None


def loads_lenient(text: str) -> Any:
    """`json.loads`, but tolerant of the one thing models reliably get wrong.

    A model asked for `{"title": ..., "body_md": ...}` will happily put real
    newlines inside the markdown string rather than escaping them as `\\n`.
    That is invalid JSON — U+000A is a control character and the strict
    parser rejects it — so a perfectly good note was thrown away with
    "came back in an unexpected format" for the crime of having more than
    one line. Which is every note.

    `strict=False` is the documented switch for exactly this: it permits
    control characters inside strings and changes nothing else. Preferred
    over regex-repairing the payload, which would risk corrupting content
    that happens to contain braces or quotes.
    """

    return json.JSONDecoder(strict=False).decode(text)


def extract_title_line(raw: str, *, before: str = "[") -> str | None:
    """Pull a short model-written title out of a `TITLE: ...` line.

    Shared by quiz and flashcard-deck generation, which both ask the model
    to precede its JSON payload with `TITLE: <3-6 words>` — the one place a
    generated quiz or deck gets a real name instead of the caller's own
    (often unset, or a raw excerpt of chat text) `topic` string. Originally
    written for quizzes alone; decks had the exact same "topic ends up as
    the visible name, unedited" problem — `firstSentence()` on the frontend
    truncates a chat reply into a title-shaped string, `…` included, and
    nothing downstream ever replaced it with something a model was actually
    asked to write.

    Only looks `before` the payload marker (default `[`, the JSON array both
    callers use) rather than anywhere in the raw text, since a generated
    question or card can otherwise contain the word "title" itself.
    """
    array_start = raw.find(before)
    head = raw[:array_start] if array_start != -1 else raw
    for line in head.splitlines():
        line = line.strip().strip("*_# ")
        if line.upper().startswith("TITLE:"):
            title = line.split(":", 1)[1].strip().strip('"\'')
            return title[:140] or None
    return None
