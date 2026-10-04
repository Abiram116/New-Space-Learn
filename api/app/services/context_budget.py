"""How much of the conversation goes back to the model on each turn.

The free tier allows about 8,000 tokens a minute on the large model. The fixed
instructions and the retrieved sources already take a good share of that, and
the history used to be unbounded: eight earlier messages, and an assistant
answer is often a thousand tokens by itself. A long conversation could spend a
whole minute's allowance on what was said before, then be refused.

What this does, in order of how much it saves:

1. **Old answers are shortened.** The newest answer is kept nearly whole,
   because a follow-up ("explain the second point") is almost always about it.
   Older ones are cut to their opening, which is where the answer is: the
   response shape asks for the answer first.
2. **Citation markers are removed from past answers.** `[[2]]` meant the second
   source of *that* turn. Shown again next to a different list of sources it is
   an invitation to cite the wrong one, and it costs tokens for nothing.
3. **A ceiling on the total.** The oldest turns go first, never the last two
   messages.

The rolling topic summary already carries what scrolled out of the window, so
what is dropped here is not forgotten, only no longer repeated.
"""

from __future__ import annotations

import re

_MARKER = re.compile(r"[ \t]*\[\[\d+\]\]")

#: The newest answer, kept almost whole: a follow-up is about it.
RECENT_ANSWER_CHARS = 2500
#: Every older answer: its opening, which is the answer itself.
OLDER_ANSWER_CHARS = 700
#: A student's own message. Pasted text can be long; it was read when it was sent.
QUESTION_CHARS = 1200
#: Hard ceiling for the whole history (about 3,500 tokens), however many turns a skill asks for.
MAX_CHARS = 14_000
#: What each turn the skill asks for may use before the ceiling applies.
PER_TURN_CHARS = 900

ELLIPSIS = " […]"


def shorten(text: str, cap: int) -> str:
    """`text` cut to about `cap` characters at the end of a sentence or paragraph."""
    if len(text) <= cap:
        return text
    head = text[:cap]
    at = max(head.rfind("\n\n"), head.rfind(". "), head.rfind("? "), head.rfind("! "))
    if at < cap * 0.5:  # no natural stop near the end: cut where it is
        return head.rstrip() + ELLIPSIS
    return head[: at + 1].rstrip() + ELLIPSIS


def fit_history(history: list[dict[str, str]], *, max_chars: int | None = None) -> list[dict[str, str]]:
    """The history as it should be sent: shortened, free of stale markers, within budget."""
    if not history:
        return []
    ceiling = max_chars if max_chars is not None else min(MAX_CHARS, PER_TURN_CHARS * len(history))
    last_answer = max((i for i, m in enumerate(history) if m.get("role") == "assistant"), default=-1)
    fitted: list[dict[str, str]] = []
    for i, m in enumerate(history):
        content = m.get("content") or ""
        if m.get("role") == "assistant":
            content = _MARKER.sub("", content)
            content = shorten(content, RECENT_ANSWER_CHARS if i == last_answer else OLDER_ANSWER_CHARS)
        else:
            content = shorten(content, QUESTION_CHARS)
        fitted.append({**m, "content": content})
    while len(fitted) > 2 and sum(len(m["content"]) for m in fitted) > ceiling:
        fitted.pop(0)
    return fitted
