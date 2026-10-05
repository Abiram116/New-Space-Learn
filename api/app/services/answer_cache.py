"""Re-asked questions: a stored answer instead of a new model call.

Students revise by asking the same thing again, a day later, in slightly
different words. When the question means the same and everything the answer was
built from is the same, the answer already written is still the right one, and
sending it costs no tokens and no waiting.

It is deliberately strict, because a wrong cached answer is worse than a slow
fresh one. An answer is reused only when ALL of these hold:

- **same student, same topic.** Nothing is shared between people.
- **the question stands alone.** A follow-up ("and the second one?") depends on
  the conversation, so it is never cached or served from cache.
- **the sources are the same.** The answer is keyed on exactly which passages
  retrieval returned. Edit, remove or add a file and the passages change, so the
  old answer is not offered.
- **the settings are the same:** answer-only-from-documents, citations, which
  skills are on, and the student's real preferences. (Not the sampled style: it changes on
  every message by design, and would make a hit impossible. The stored answer keeps the
  style it was written in, and is recorded with it.)
- **no image, and not a regenerate.** Pressing regenerate asks for a different
  answer; it must never be handed the same one.
- **the question means the same:** the same text, or a very close vector.

In process memory only: a restart empties it, and one worker keeps its own. It
holds a few answers per student and topic and forgets after hours.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass

from .memo import TTLCache

#: Cosine similarity at or above which two questions count as the same question.
#: High on purpose: BGE-small puts reworded questions around 0.85–0.93, so this
#: reuses an answer for a near-identical wording, not a loosely related one.
SIMILARITY = 0.97
PER_TOPIC = 12
TTL_S = 6 * 3600


@dataclass(frozen=True, slots=True)
class Cached:
    question: str
    vector: tuple[float, ...]
    fingerprint: str
    answer: str
    suggestion: str | None
    #: The learned/sampled style this answer was written in. A re-served answer is
    #: recorded with THIS style, not a fresh sample, so the style experiment is credited
    #: with what the student actually read.
    style: dict | None = None


_STORE: TTLCache[list[Cached]] = TTLCache(maxsize=500, ttl=TTL_S)


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", "", text.lower()).strip()


def fingerprint(*, chunk_ids: list[str], flags: dict[str, object]) -> str:
    """What the answer was built from, as a short hash."""
    blob = json.dumps({"chunks": chunk_ids, "flags": flags}, sort_keys=True, default=str)
    return hashlib.sha256(blob.encode()).hexdigest()[:24]


def _cosine(a: tuple[float, ...] | list[float], b: tuple[float, ...] | list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def _key(user_id: str, subspace_id: str) -> str:
    return f"{user_id}:{subspace_id}"


def lookup(
    user_id: str, subspace_id: str, question: str, vector: list[float] | None, fp: str
) -> Cached | None:
    """A stored answer for this question, if the same sources and settings produced it.

    Without a `vector` only the same words match, which needs no embedding."""
    for entry in _STORE.get(_key(user_id, subspace_id)) or []:
        if entry.fingerprint != fp:
            continue
        if _norm(entry.question) == _norm(question):
            return entry
        if vector is not None and _cosine(entry.vector, vector) >= SIMILARITY:
            return entry
    return None


def has_entries(user_id: str, subspace_id: str, fp: str) -> bool:
    """Whether anything is stored under these exact sources and settings, i.e. whether
    embedding a question to compare it could possibly find a match."""
    return any(e.fingerprint == fp for e in _STORE.get(_key(user_id, subspace_id)) or [])


def store(
    user_id: str,
    subspace_id: str,
    question: str,
    vector: list[float],
    fp: str,
    answer: str,
    suggestion: str | None,
    style: dict | None = None,
) -> None:
    key = _key(user_id, subspace_id)
    entries = [e for e in (_STORE.get(key) or []) if e.fingerprint != fp or _norm(e.question) != _norm(question)]
    entries.append(Cached(question, tuple(vector), fp, answer, suggestion, style))
    _STORE.set(key, entries[-PER_TOPIC:])


def clear() -> None:
    _STORE.clear()


def pieces(text: str, size: int = 48) -> list[str]:
    """A stored answer as the small chunks the client expects from a stream, so it
    arrives the way an answer does and not as one jump."""
    return [text[i : i + size] for i in range(0, len(text), size)] or [""]
