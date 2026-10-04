"""One suggested follow-up question, written by the same call that answers.

Asking a second model call for a suggestion would spend a request per answer on
a free tier that is tight already. Instead the answer itself is asked to end
with a single marked line, and this module takes that line out of the stream so
the student never sees the marker:

    …the end of the answer.
    [[next: Why is the attention score scaled by the square root of d?]]

The marker is held back while it arrives (it can be split across any number of
streamed pieces), parsed at the end, and checked: one line, a question, short.
Anything that fails the check is simply dropped; the client then falls back to
its own generic suggestions. A bad suggestion is worse than none.
"""

from __future__ import annotations

import re

OPEN = "[[next:"
CLOSE = "]]"
MAX_LEN = 110

PROMPT = (
    "After your answer, add one last line, on its own, exactly in this form: "
    f"{OPEN} <one short question the student could ask next> {CLOSE} "
    "The question must be about what the Sources cover, under 12 words, "
    "and different from the question just asked. Leave this line out if you "
    "could not answer from the Sources."
)


def clean(raw: str | None) -> str | None:
    """The suggestion, if it is fit to show; otherwise None."""
    if not raw:
        return None
    text = re.sub(r"\s+", " ", raw).strip().strip("\"'“”")
    if not text or len(text) > MAX_LEN or "\n" in raw.strip():
        return None
    if not text.endswith("?"):
        return None
    # A marker or code fence inside it means the model was confused.
    if "[[" in text or "]]" in text or "```" in text:
        return None
    return text


class FollowUpFilter:
    """Passes streamed text through, minus a trailing `[[next: …]]` line."""

    def __init__(self) -> None:
        self._pending = ""
        self._capture: str | None = None

    def feed(self, delta: str) -> str:
        """What is safe to show now. Text that might be the start of the marker is held."""
        if self._capture is not None:
            self._capture += delta
            return ""
        self._pending += delta
        at = self._pending.find(OPEN)
        if at != -1:
            safe, self._capture = self._pending[:at], self._pending[at + len(OPEN) :]
            self._pending = ""
            return safe.rstrip()
        # Hold what might still turn out to be the start of the marker: the
        # longest tail that is a prefix of it, plus any whitespace right before
        # that (the newline that separates it from the answer).
        keep = 0
        for n in range(min(len(OPEN) - 1, len(self._pending)), 0, -1):
            if OPEN.startswith(self._pending[-n:]):
                keep = n
                break
        cut = len(self._pending) - keep
        while cut > 0 and self._pending[cut - 1].isspace():
            cut -= 1
        safe, self._pending = self._pending[:cut], self._pending[cut:]
        return safe

    def finish(self) -> tuple[str, str | None]:
        """(any held text that turned out not to be the marker, the suggestion or None)."""
        if self._capture is None:
            tail, self._pending = self._pending, ""
            return tail, None
        raw = self._capture.split(CLOSE, 1)[0]
        self._capture = None
        return "", clean(raw)
