"""Works out what a follow-up question is actually asking about.

"Why does that happen?" has no subject in it. Searched as typed, it matches
whatever passages happen to talk about things happening. The subject is in the
conversation, so before searching, a question that leans on the conversation
is rewritten into one that stands by itself.

Most questions already do, and rewriting those would spend a model call to
change nothing. So a cheap check in code decides first (`leans_on_history`),
and only then is the small fast model asked — with a short timeout, and a
fallback that needs no model at all (the previous question, then this one), so
a slow or absent model never holds up or breaks a chat turn.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from ..config import settings
from . import usage
from .llm import get_llm
from .memo import TTLCache

log = logging.getLogger("space_learn.resolver")

#: A question this short, with a conversation before it, is taken as a follow-up.
SHORT_WORDS = 6
#: The longest wait for the rewrite before falling back.
TIMEOUT_S = 2.5
#: How much of the previous answer the rewrite sees.
ANSWER_CHARS = 500
MAX_QUERY_CHARS = 240

# Words that point at something said earlier rather than naming it.
_POINTING = re.compile(
    r"\b(it|its|it's|that|this|these|those|they|them|their|there|one|ones|he|she|his|her|"
    r"former|latter|same|above|such)\b",
    re.IGNORECASE,
)
_CONTINUING = re.compile(r"^\s*(and|so|but|then|also|ok(ay)?|why|how come|what about|how about|which one)\b", re.IGNORECASE)
_WORD = re.compile(r"[\w'+-]+")

_PROMPT = """Rewrite the student's latest question so it can be understood with no conversation: name the thing it refers to. Keep it one short question. Do not answer it. Reply with the rewritten question only.

Topic: {topic}
Previous question: {previous}
Previous answer: {answer}
Latest question: {question}"""

Complete = Callable[[str], Awaitable[str]]


@dataclass(frozen=True, slots=True)
class Query:
    #: What the student typed.
    original: str
    #: What to search by meaning: the original, or its rewrite.
    standalone: str
    #: How `standalone` was reached: "as-is", "rewritten" or "joined".
    how: str = "as-is"

    @property
    def keywords(self) -> str:
        """What to search by keyword: the student's own words always count,
        plus whatever the rewrite named."""
        return self.original if self.how == "as-is" else f"{self.original} {self.standalone}"


def leans_on_history(question: str, history: list[dict[str, str]]) -> bool:
    """Whether the question probably cannot be searched without the chat."""
    if not any(turn.get("role") == "user" for turn in history):
        return False
    words = _WORD.findall(question)
    if len(words) <= SHORT_WORDS:
        return True
    if _CONTINUING.search(question):
        return True
    # A longer question that still points at something: only when the pointing
    # word is a good share of it ("how does it compare to that?"), not a stray
    # "this" in a question that names its subject.
    return len(_POINTING.findall(question)) * 6 >= len(words)


@usage.tagged("chat.resolve")
async def _ask_model(prompt: str) -> str:
    parts: list[str] = []
    async for delta in get_llm().stream_chat(
        [{"role": "user", "content": prompt}], model=settings.groq_model_fast, temperature=0.0
    ):
        parts.append(delta)
    return "".join(parts)


#: Rewrites already paid for. A regenerate or a retry asks the same thing again
#: with the same history; the model call is made once. Ten minutes, 256 entries.
_REWRITES: TTLCache[str] = TTLCache(maxsize=256, ttl=600)


async def resolve(
    question: str,
    history: list[dict[str, str]],
    *,
    topic: str = "",
    complete: Complete | None = None,
) -> Query:
    """The question as a search query. Never raises and never waits long."""
    question = question.strip()
    if not leans_on_history(question, history):
        return Query(question, question)

    previous = next((t["content"] for t in reversed(history) if t.get("role") == "user"), "")
    answer = next((t["content"] for t in reversed(history) if t.get("role") == "assistant"), "")
    joined = Query(question, f"{previous.strip()} {question}".strip()[:MAX_QUERY_CHARS], "joined")
    if complete is None and not settings.llm_configured:
        return joined

    prompt = _PROMPT.format(
        topic=topic or "(not given)",
        previous=previous.strip()[:300] or "(none)",
        answer=" ".join(answer.split())[:ANSWER_CHARS] or "(none)",
        question=question,
    )
    # A caller that passes its own `complete` (tests, the benchmark) is never cached.
    key = hashlib.sha256(prompt.encode()).hexdigest() if complete is None else None
    try:
        text = _REWRITES.get(key) if key else None
        if text is None:
            text = await asyncio.wait_for((complete or _ask_model)(prompt), TIMEOUT_S)
            if key:
                _REWRITES.set(key, text)
    except Exception:  # a timeout, a rate limit, anything: search anyway
        log.info("follow-up rewrite unavailable; joining with the previous question")
        return joined
    rewritten = " ".join(text.split()).strip("\"'` ")[:MAX_QUERY_CHARS]
    # A model that answers, refuses or rambles instead of rewriting is ignored.
    if not rewritten or len(rewritten) < 8 or "\n" in text.strip() and len(text) > MAX_QUERY_CHARS:
        return joined
    return Query(question, rewritten, "rewritten")
