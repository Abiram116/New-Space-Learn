"""One suggested follow-up question, written by the same call that answers.

Asking a second model call for a suggestion would spend a request per answer on
a free tier that is tight already. Instead the answer itself is asked to end
with a single marked line, and this module takes that line out of the stream so
the student never sees the marker:

    …the end of the answer.
    [[next: Why is the attention score scaled by the square root of d?]]

Models do not always write it exactly so. Seen in practice: `[[Next: …]]`,
`**[[next: …]]**`, `[next: …]`, a missing "?", and a bare `Next: …` as the
last line. All of them are recognised:

- a bracketed marker (`[[next:` or `[next:`, any case, any spacing) is the
  marker wherever it appears, and everything from it on is held back;
- a bare `Next:` line counts only when it is the LAST line of the answer and
  reads as a question — "Next: we normalise the scores." in the middle of an
  explanation is prose, and is shown.

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
    "The question must be about what the Sources cover and about this topic, under 12 words, "
    "and different from the question just asked. Leave this line out if you "
    "could not answer from the Sources, or declined the question."
)

#: A bracketed marker, anywhere: "[[next:", "[ Next :", "[[NEXT question:".
_BRACKETED = re.compile(r"\[\[?[ \t]*next(?:[ \t]+question)?[ \t]*:", re.IGNORECASE)
#: A bare marker line: "Next: …", "**Next:** …", "> next question: …".
_BARE_LINE = re.compile(r"^[ \t>*_\-]*next(?:[ \t]+question)?[ \t]*[*_]*[ \t]*:[*_ \t]*(.*)$", re.IGNORECASE)
#: Characters a model wraps around a marker line: bold, italics, a quote, a bullet.
_DECORATION = " \t>*_-"
#: Compact (spaces removed, lower-cased) forms a held line may still turn into.
_BRACKET_FORMS = ("[[next:", "[next:", "[[nextquestion:", "[nextquestion:")
_BARE_FORMS = ("next:", "nextquestion:")
#: First words that make a sentence without "?" a question anyway.
_ASKING = re.compile(
    r"^(what|why|how|when|where|which|who|whom|whose|can|could|does|do|did|is|are|was|were|should|"
    r"would|will|has|have|if|isn't|aren't|doesn't)\b",
    re.IGNORECASE,
)


def clean(raw: str | None) -> str | None:
    """The suggestion, if it is fit to show; otherwise None."""
    if not raw:
        return None
    if "\n" in raw.strip():
        return None
    text = re.sub(r"\s+", " ", raw).strip().strip("\"'“”`*_ ").strip()
    # "**Why is it scaled?**" leaves "Why is it scaled?" once the bold is gone;
    # a closing bracket the split missed goes too.
    text = text.rstrip("]").strip()
    if not text or len(text) > MAX_LEN:
        return None
    # A marker or code fence inside it means the model was confused.
    if "[[" in text or "]]" in text or "```" in text:
        return None
    if not text.endswith("?"):
        # "Why is attention scaled" is a question that lost its mark; "Explain
        # attention" is an instruction, not a question, and is dropped.
        if not _ASKING.match(text):
            return None
        text = text.rstrip(".!:; ") + "?"
    return text


def _compact(s: str) -> str:
    return "".join(s.split()).lower()


def _could_be_bracket(tail: str) -> bool:
    """Whether `tail` (starting with "[") may still grow into a bracketed marker."""
    c = _compact(tail)
    return bool(c) and any(form.startswith(c) for form in _BRACKET_FORMS)


def _could_be_bare_line(line: str) -> bool:
    """Whether a line may be (or still grow into) a bare `Next:` marker line."""
    c = _compact(line.lstrip(_DECORATION)).replace("*", "").replace("_", "")
    if not c:
        # Only decoration so far ("**", "> "): wait for what follows.
        return bool(line.strip())
    if c.startswith("["):
        # "**[[ne…": a bracketed marker wrapped in bold — hold the bold with it.
        return _could_be_bracket(c)
    return any(form.startswith(c) or c.startswith(form) for form in _BARE_FORMS)


def _trim(text: str) -> str:
    """The answer, minus the whitespace and dangling bold/bullet that opened the marker."""
    text = text.rstrip()
    stripped = re.sub(r"(?:^|(?<=\s))[*_>\-]+$", "", text)
    return stripped.rstrip()


class FollowUpFilter:
    """Passes streamed text through, minus the trailing next-question marker."""

    def __init__(self) -> None:
        self._pending = ""
        self._capture: str | None = None

    def feed(self, delta: str) -> str:
        """What is safe to show now. Text that might be the start of the marker is held."""
        if self._capture is not None:
            self._capture += delta
            return ""
        self._pending += delta
        m = _BRACKETED.search(self._pending)
        if m:
            safe, self._capture = self._pending[: m.start()], self._pending[m.end() :]
            self._pending = ""
            return _trim(safe)
        hold = len(self._pending)
        # A tail that may still become "[[next:" — "[", "[[", "[[ne".
        for n in range(min(len(self._pending), 16), 0, -1):
            tail = self._pending[-n:]
            if tail.startswith("[") and _could_be_bracket(tail):
                hold = len(self._pending) - n
                break
        # The last line, if it is (or may become) a bare "Next:" line. Trailing
        # whitespace is ignored: a finished "Next: …?\n" may still be the last line.
        core = self._pending.rstrip()
        start = core.rfind("\n") + 1
        if core and _could_be_bare_line(core[start:]):
            hold = min(hold, start)
        # Hold the whitespace (the newline) that separates it from the answer too.
        while hold > 0 and self._pending[hold - 1].isspace():
            hold -= 1
        safe, self._pending = self._pending[:hold], self._pending[hold:]
        return safe

    def finish(self) -> tuple[str, str | None]:
        """(any held text that turned out not to be the marker, the suggestion or None)."""
        if self._capture is not None:
            raw, _, after = self._capture.partition("]")
            self._capture = None
            if "\n" in raw.strip():  # never closed: the line it was on is the suggestion
                raw = raw.strip().split("\n", 1)[0]
            # Text the model went on to write after the marker is still answer.
            after = after.lstrip("]").strip().strip("*_").strip()
            return ("\n\n" + after if after else ""), clean(raw)
        pending, self._pending = self._pending, ""
        core = pending.rstrip()
        start = core.rfind("\n") + 1
        m = _BARE_LINE.match(core[start:])
        if m:
            suggestion = clean(m.group(1))
            if suggestion:
                return _trim(core[:start]), suggestion
        # Not a marker after all: prose that happened to start "Next:", or a
        # half-started bracket at the very end. It is answer, so it is shown.
        return pending, None


#: Content words shorter than this are ignored by `on_topic`.
_MIN_WORD = 4
_WORD = re.compile(r"[a-z0-9]+")
_STOP = frozenset(
    "what when where which while with would could should does about from have that this these those "
    "their there they them then than into over more most some such your also only very just like "
    "example examples explain difference between work works mean means used using other each".split()
)


def on_topic(suggestion: str | None, material: list[str]) -> str | None:
    """The suggestion, if it shares a meaningful word with the material it
    should be about (the sources and the topic's names); otherwise None.

    A model that drifted ("Want to learn about black holes next?") is caught
    here in code. Words match by their first five letters, so "normalise"
    finds "normalization". A suggestion with no content words at all ("Why?")
    has nothing to check and passes."""
    if not suggestion:
        return None
    words = [w for w in _WORD.findall(suggestion.lower()) if len(w) >= _MIN_WORD and w not in _STOP]
    if not words:
        return suggestion
    text = " ".join(material).lower()
    return suggestion if any(w[:5] in text for w in words) else None
