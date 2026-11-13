"""Tells a greeting from a question, in code, before anything is paid for.

"Hi" in the middle of a session used to take the whole road a real question
takes: a model call to rewrite it as a follow-up (it is short, so it looked
like one), an embedding, a search, the large model, and — with "answer only
from my documents" on — a reply that the documents do not cover "hi".

So a message that is *only* small talk skips all of that (see
`subspace_chat.send_chat`). The check is a list of known phrases, not a model
and not a guess: the whole message has to be made of them. One wrong "yes"
costs a student their sources on a real question; one wrong "no" costs a
slower hello. So anything not on the list is a question.
"""

from __future__ import annotations

import re
import unicodedata

#: Longer than this is never small talk, whatever it says.
MAX_CHARS = 48
MAX_WORDS = 7

_GREETING = (
    r"hi+|hello+|hey+|heya|hiya|yo|sup|howdy|hola|namaste|"
    r"good (?:morning|afternoon|evening|day)|morning|gm"
)
#: A question, but about nothing in the material.
_HOW_ARE_YOU = (
    r"how are (?:you|u|ya)(?: doing| today)?|how r u|hows it going|how is it going|"
    r"how are things|how do you do|whats up|what is up|wassup"
)
_THANKS = (
    r"thanks|thank (?:you|u)|thx|ty|tysm|many thanks|cheers|much appreciated|appreciate it|"
    r"that help(?:s|ed)"
)
_BYE = (
    r"bye+|bye bye|goodbye|good ?night|gn|see (?:you|ya|u)(?: later| soon| tomorrow)?|cya|"
    r"take care|ttyl"
)
#: "ok", "got it": small talk only when the tutor did not just ask something
#: (see `is_small_talk`) — after a question they are the student's answer.
_ACK = (
    r"ok+|okay|k|kk|cool|nice|great|awesome|perfect|good|fine|alright|all right|got it|i see|"
    r"noted|understood|makes sense|sounds good|wow|lol|haha+"
)
#: Words that ride along with the above and change nothing.
_FILLER = (
    r"there|again|so much|very much|a lot|a ton|for now|then|buddy|friend|bro|mate|man|sir|"
    r"tutor|and|for (?:the|your) help|for that"
)

_ALWAYS = f"{_GREETING}|{_HOW_ARE_YOU}|{_THANKS}|{_BYE}"
_SMALL_TALK = re.compile(rf"(?:{_ALWAYS}|{_ACK})(?: (?:{_ALWAYS}|{_ACK}|{_FILLER}))*")
_STARTS_WITH_ACK = re.compile(rf"(?!(?:{_ALWAYS})\b)(?:{_ACK})\b")
_ASKS_AFTER_YOU = re.compile(rf"\b(?:{_HOW_ARE_YOU})\b")
_EMOTICON = re.compile(r"(?:[:;=]-?[)D(pP]|<3|\^_?\^)+")
_NOT_A_WORD = re.compile(r"[^\w\s]|_")
#: How much of the tutor's last message is checked for a question it ended on.
_TAIL_CHARS = 160


def _words(text: str) -> str:
    """Lower-case words only: "Thank you!! 🙏" → "thank you", "what's up?" → "whats up"."""
    text = text.lower().replace("'", "").replace("’", "")
    return " ".join(_NOT_A_WORD.sub(" ", text).split())


def _only_emoji(text: str) -> bool:
    """A lone 👍 or :) — no words, and at least one actual symbol (not just "!!")."""
    if _EMOTICON.fullmatch(text.replace(" ", "")):
        return True
    return any(unicodedata.category(ch) == "So" for ch in text)


def is_small_talk(text: str, history: list[dict[str, str]] | None = None) -> bool:
    """Whether this message is a greeting, thanks, an acknowledgement or a
    goodbye and nothing else.

    `history` is the conversation before this message. It matters for one case:
    "ok" after the tutor asked "want a worked example?" is an answer to that
    question, and has to be treated as one.
    """
    raw = text.strip()
    if not raw or len(raw) > MAX_CHARS:
        return False
    words = _words(raw)
    if not words:
        # "?" or "??" is a student saying they are lost: a follow-up, not a wave.
        return "?" not in raw and _only_emoji(raw)
    if len(words.split()) > MAX_WORDS or not _SMALL_TALK.fullmatch(words):
        return False
    # "ok?" and "hello?" are asking for something; "how are you?" is not.
    if "?" in raw and not _ASKS_AFTER_YOU.search(words):
        return False
    # "ok thanks" after "want a worked example?" is a yes, so it counts too.
    return not (_STARTS_WITH_ACK.match(words) and _tutor_just_asked(history or []))


def _tutor_just_asked(history: list[dict[str, str]]) -> bool:
    last = next((t.get("content") or "" for t in reversed(history) if t.get("role") == "assistant"), "")
    return "?" in last.strip()[-_TAIL_CHARS:]


#: Replaces the answer-shape, diagram and sources rules for a small-talk turn.
#: It has to say "do not mention documents" out loud: with no sources and
#: "answer only from my documents" on, the model was otherwise told to reply
#: that nothing indexed covers a greeting.
PROMPT = (
    "The student's message is small talk — a greeting, thanks, an acknowledgement or a "
    "goodbye — not a question about the material. Reply the way a person would, in one "
    "short sentence, in the same voice. You may offer to carry on with the topic or pick "
    "up where the conversation left off. Do not teach, summarise or cite anything, do not "
    "mention sources or documents, and do not say the material does not cover this."
)
