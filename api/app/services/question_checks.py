"""Checks a generated question must pass before a student sees it — the ones
code can make without asking a model.

- **Well formed:** a question, four distinct choices, an answer that points at
  one of them, an explanation, and a source that exists.
- **Not a repeat:** of another question in the same quiz, or of one this topic
  has already asked. First by wording (cheap, exact), then by meaning for
  questions on the same concept (the local embedding model: catches the same
  question reworded, which wording alone misses).

Shared by every generator, so a deck and a quiz mean the same thing by "a
duplicate".
"""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable, Sequence

#: Share of the same words, above which two questions are the same question.
TEXT_DUPLICATE = 0.7
#: Cosine similarity of the local embeddings, above which they are.
MEANING_DUPLICATE = 0.92
#: Earlier questions compared by meaning, at most — embedding is not free on
#: a tenth of a CPU.
MAX_EARLIER = 30

_WORD = re.compile(r"[a-z0-9]+")
_STOP = frozenset(
    "a an the of to in on for and or is are was were be by with what which who whom whose when where why how does do did "
    "this that these those it its as at from than then into about can could would should will not no".split()
)

Embed = Callable[[list[str]], Awaitable[list[list[float]]]]


def words(text: str) -> set[str]:
    return {w for w in _WORD.findall(text.lower()) if w not in _STOP}


def text_similarity(a: str, b: str) -> float:
    """Jaccard similarity of the two texts' meaningful words."""
    x, y = words(a), words(b)
    return len(x & y) / len(x | y) if x and y else 0.0


def problems(question: dict, *, sources: int) -> list[str]:
    """What is wrong with one generated question, in words; empty when nothing is.
    `question` is the raw dict the model wrote, `sources` how many there were."""
    found: list[str] = []
    q = str(question.get("q") or "").strip()
    choices = question.get("choices")
    if len(q) < 8:
        found.append("no question")
    if not isinstance(choices, list) or len(choices) != 4:
        found.append("not four choices")
    else:
        texts = [str(c).strip() for c in choices]
        if not all(texts):
            found.append("an empty choice")
        if len({t.lower() for t in texts}) != 4:
            found.append("repeated choices")
    answer = question.get("answer_index")
    if isinstance(answer, bool) or not isinstance(answer, int) or not 0 <= answer < 4:
        found.append("no valid answer")
    if len(str(question.get("explanation") or "").strip()) < 10:
        found.append("no explanation")
    source = question.get("source")
    if sources and (isinstance(source, bool) or not isinstance(source, int) or not 1 <= source <= sources):
        found.append("no valid source")
    return found


def _fingerprint(question: dict) -> str:
    """The question with its correct answer: "Which is NOT a normal form?" and
    "Which IS a normal form?" differ only in what the answer is. A card is its
    two sides."""
    if "front" in question:
        return f"{question.get('front', '')} {question.get('back', '')}"
    choices = question.get("choices") or []
    answer = question.get("answer_index")
    right = choices[answer] if isinstance(answer, int) and 0 <= answer < len(choices) else ""
    return f"{question.get('q', '')} {right}"


def _concept(question: dict) -> str:
    return str(question.get("subtopic") or "").strip().lower()


def repeats_by_wording(new: Sequence[dict], earlier: Sequence[dict]) -> set[int]:
    """Indexes of `new` questions that repeat an earlier one, or one before
    them in `new` itself."""
    out: set[int] = set()
    seen = [_fingerprint(q) for q in earlier]
    for i, q in enumerate(new):
        mark = _fingerprint(q)
        if any(text_similarity(mark, s) >= TEXT_DUPLICATE for s in seen):
            out.add(i)
        else:
            seen.append(mark)
    return out


async def repeats_by_meaning(new: Sequence[dict], earlier: Sequence[dict], embed: Embed) -> set[int]:
    """Indexes of `new` questions that ask what an earlier question on the same
    concept already asked, in other words."""
    concepts = {_concept(q) for q in new} - {""}
    pool = [q for q in earlier if _concept(q) in concepts][:MAX_EARLIER]
    if not pool:
        return set()
    vectors = await embed([_fingerprint(q) for q in new] + [_fingerprint(q) for q in pool])
    mine, theirs = vectors[: len(new)], vectors[len(new) :]
    out: set[int] = set()
    for i, (q, v) in enumerate(zip(new, mine, strict=True)):
        for p, w in zip(pool, theirs, strict=True):
            if _concept(p) == _concept(q) and _cosine(v, w) >= MEANING_DUPLICATE:
                out.add(i)
                break
    return out


# ── Rewording ──────────────────────────────────────────────────────────
#
# A reworded retake must ask the same thing with the same right answer. The
# model never decides which choice is right — it rewrites each choice in
# place and the code reshuffles afterwards — so the one way it can break a
# question is by changing what a sentence says. These are the changes that
# flip an answer in practice, and each can be seen without a model: a number
# or formula that changed, a "not"/"except" that appeared or vanished, a
# choice that now says what another choice said. A question that trips any
# of them keeps its stored wording (it is still reshuffled), which is always
# safe, so a false alarm costs only a little novelty.

_NUMBER = re.compile(r"\d+(?:[.,]\d+)*")
_MATH = re.compile(r"\$\$.+?\$\$|\$[^$\n]+?\$|\\\(.+?\\\)|\\\[.+?\\\]", re.DOTALL)
_NEGATION = re.compile(
    r"\b(not|no|never|none|neither|nor|cannot|without|false|incorrect|untrue)\b|n't\b", re.IGNORECASE
)
_EXCEPTION = re.compile(r"\b(except|excluding|other than|least)\b", re.IGNORECASE)
#: How far a reworded choice may grow or shrink, as a share of the original.
_LENGTH_RATIO = (0.34, 3.0)


def _numbers(text: str) -> list[str]:
    return sorted(n.replace(",", ".") for n in _NUMBER.findall(_MATH.sub(" ", text)))


def _math(text: str) -> list[str]:
    return sorted(re.sub(r"\s+", "", m) for m in _MATH.findall(text))


def _same_facts(old: str, new: str) -> bool:
    """Same numbers, same formulas, same polarity."""
    return (
        _numbers(old) == _numbers(new)
        and _math(old) == _math(new)
        and bool(_NEGATION.search(old)) == bool(_NEGATION.search(new))
        and bool(_EXCEPTION.search(old)) == bool(_EXCEPTION.search(new))
    )


def reword_problems(original: dict, reworded: dict) -> list[str]:
    """Why `reworded` is not a safe rewording of `original`; empty when it is.

    Both are `{"q": str, "choices": [str, ...], "answer_index": int}` with the
    choices in the SAME order — the rewording is checked before any shuffle.
    """
    found: list[str] = []
    q_old, q_new = str(original.get("q") or ""), str(reworded.get("q") or "").strip()
    old_choices = [str(c) for c in original.get("choices") or []]
    new_choices = reworded.get("choices")
    if len(q_new) < 8:
        found.append("no question")
    elif not _same_facts(q_old, q_new):
        found.append("the question's facts changed")
    if not isinstance(new_choices, list) or len(new_choices) != len(old_choices):
        found.append("the choices don't line up")
        return found
    new_choices = [str(c).strip() for c in new_choices]
    if not all(new_choices) or len({c.lower() for c in new_choices}) != len(new_choices):
        found.append("an empty or repeated choice")
        return found
    answer = original.get("answer_index")
    for i, (old, new) in enumerate(zip(old_choices, new_choices, strict=True)):
        ratio = len(new) / max(1, len(old))
        if not _LENGTH_RATIO[0] <= ratio <= _LENGTH_RATIO[1]:
            found.append(f"choice {i + 1} changed size")
        elif not _same_facts(old, new):
            found.append(f"choice {i + 1}'s facts changed")
        # A choice that now reads like ANOTHER original choice has swapped
        # meaning — the one way an answer can move without anyone saying so.
        for j, other in enumerate(old_choices):
            if j != i and text_similarity(new, other) > max(TEXT_DUPLICATE, text_similarity(new, old)):
                found.append(f"choice {i + 1} reads like choice {j + 1}")
                break
    if isinstance(answer, int) and 0 <= answer < len(new_choices):
        right = new_choices[answer]
        if any(text_similarity(right, w) >= 0.9 for k, w in enumerate(new_choices) if k != answer):
            found.append("the right answer reads like a wrong one")
    return found


def _cosine(a: Sequence[float], b: Sequence[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    return dot / (na * nb) if na and nb else 0.0
